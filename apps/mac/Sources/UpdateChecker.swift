import Foundation
import Security

/// Update check and self-install against the rolling GitHub release.
///
/// The release workflow (.github/workflows/mac-app-release.yml) overwrites one
/// `Index.dmg` and one `Index.zip` per channel and writes the source commit into
/// the release notes ("Index.dmg from <sha> on <branch>"). There is no version
/// feed and the bundle version is not bumped per build, so the check compares
/// that commit against the one baked in at build time rather than comparing
/// versions.
enum UpdateChecker {
    enum Outcome {
        /// The release was built from this exact commit.
        case current
        /// The release is a different commit.
        case available(sha: String)
        /// The comparison could not be made. The DMG is still offered, because
        /// downloading it is the one thing that always resolves the question.
        case indeterminate(reason: String, download: URL)
    }

    /// A downloaded, signature-checked bundle waiting to replace this one.
    struct Staged {
        let sha: String
        let app: URL
    }

    /// Written into the bundle's Info.plist by scripts/build.sh. Absent only
    /// when the build happened outside a git checkout.
    static var buildSHA: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "IndexBuildSHA") as? String
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    /// `main` ships under `mac`, every other branch under the `mac-dev`
    /// prerelease. The link host is what the build already distinguishes them by.
    private static var releaseTag: String {
        let host = (Bundle.main.object(forInfoDictionaryKey: "IndexDeepLinkHost") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return host == "index.network" ? "mac" : "mac-dev"
    }

    static var downloadURL: URL {
        URL(string: "https://github.com/indexnetwork/mac-client/releases/download/\(releaseTag)/Index.dmg")!
    }

    private static var zipURL: URL {
        URL(string: "https://github.com/indexnetwork/mac-client/releases/download/\(releaseTag)/Index.zip")!
    }

    private static var releaseAPIURL: URL {
        URL(string: "https://api.github.com/repos/indexnetwork/mac-client/releases/tags/\(releaseTag)")!
    }

    private static var stagingDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("network.index.system6/Update", isDirectory: true)
    }

    /// - Parameter completion: Called on the main queue.
    static func check(completion: @escaping (Outcome) -> Void) {
        let download = downloadURL
        guard let buildSHA else {
            completion(.indeterminate(reason: "This build does not record the commit it was made from.",
                                      download: download))
            return
        }

        var request = URLRequest(url: releaseAPIURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        URLSession(configuration: .ephemeral).dataTask(with: request) { data, response, _ in
            let finish = { (outcome: Outcome) in DispatchQueue.main.async { completion(outcome) } }
            guard let data,
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let notes = json["body"] as? String else {
                finish(.indeterminate(reason: "Could not reach the release feed.", download: download))
                return
            }
            guard let releasedSHA = commitSHA(in: notes) else {
                finish(.indeterminate(reason: "The latest release does not name its commit.",
                                      download: download))
                return
            }
            finish(releasedSHA.caseInsensitiveCompare(buildSHA) == .orderedSame
                ? .current
                : .available(sha: releasedSHA))
        }.resume()
    }

    /// True when this copy is Developer ID-signed and sits somewhere it can
    /// replace itself. Ad-hoc builds are excluded because their designated
    /// requirement names only the bundle id, which any signer satisfies.
    static var canSelfUpdate: Bool {
        let bundle = Bundle.main.bundleURL
        return !bundle.path.contains("/AppTranslocation/")
            && FileManager.default.isWritableFile(atPath: bundle.deletingLastPathComponent().path)
            && ownTeamIdentifier() != nil
    }

    /// Downloads and unzips the release, keeping it only if it satisfies this
    /// app's own designated requirement (same Team ID and bundle id).
    ///
    /// - Parameters:
    ///   - sha: Release commit the download is recorded under.
    ///   - completion: Called on the main queue; nil on any failure.
    static func stage(sha: String, completion: @escaping (Staged?) -> Void) {
        let finish = { (staged: Staged?) in DispatchQueue.main.async { completion(staged) } }
        URLSession(configuration: .ephemeral).downloadTask(with: zipURL) { tmp, response, _ in
            guard let tmp, (response as? HTTPURLResponse)?.statusCode == 200 else { return finish(nil) }
            let fm = FileManager.default
            let dir = stagingDirectory
            try? fm.removeItem(at: dir)
            do {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            } catch {
                return finish(nil)
            }
            let unzip = Process()
            unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            unzip.arguments = ["-x", "-k", tmp.path, dir.path]
            guard (try? unzip.run()) != nil else { return finish(nil) }
            unzip.waitUntilExit()
            let app = dir.appendingPathComponent(Bundle.main.bundleURL.lastPathComponent)
            guard unzip.terminationStatus == 0, satisfiesOwnRequirement(app) else {
                try? fm.removeItem(at: dir)
                return finish(nil)
            }
            finish(Staged(sha: sha, app: app))
        }.resume()
    }

    /// Spawns a detached shell that waits for this process to exit, moves the
    /// staged bundle over this one, and optionally reopens it.
    static func installOnExit(_ staged: Staged, relaunch: Bool) {
        let script = """
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        [ -d "$3" ] || exit 1
        rm -rf "$2" && mv "$3" "$2" || exit 1
        rm -rf "$(dirname "$3")"
        [ "$4" = 1 ] && open "$2"
        """
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = ["-c", script, "sh",
                            String(ProcessInfo.processInfo.processIdentifier),
                            Bundle.main.bundleURL.path,
                            staged.app.path,
                            relaunch ? "1" : "0"]
        try? helper.run()
    }

    private static func ownStaticCode() -> SecStaticCode? {
        var code: SecCode?
        var staticCode: SecStaticCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
              SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess else { return nil }
        return staticCode
    }

    private static func ownTeamIdentifier() -> String? {
        var info: CFDictionary?
        guard let code = ownStaticCode(),
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let info = info as? [String: Any] else { return nil }
        return info[kSecCodeInfoTeamIdentifier as String] as? String
    }

    private static func satisfiesOwnRequirement(_ app: URL) -> Bool {
        var requirement: SecRequirement?
        var candidate: SecStaticCode?
        guard let own = ownStaticCode(),
              SecCodeCopyDesignatedRequirement(own, [], &requirement) == errSecSuccess,
              let requirement,
              SecStaticCodeCreateWithPath(app as CFURL, [], &candidate) == errSecSuccess,
              let candidate else { return false }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
        return SecStaticCodeCheckValidity(candidate, flags, requirement) == errSecSuccess
    }

    /// First full-length commit hash in the release notes.
    private static func commitSHA(in notes: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: "\\b[0-9a-f]{40}\\b",
                                                   options: .caseInsensitive) else { return nil }
        let range = NSRange(notes.startIndex..., in: notes)
        guard let match = regex.firstMatch(in: notes, range: range),
              let matched = Range(match.range, in: notes) else { return nil }
        return String(notes[matched])
    }
}
