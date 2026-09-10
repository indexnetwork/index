import Foundation

/// Index ▸ Check for Updates…, against the rolling GitHub release.
///
/// The release workflow (.github/workflows/mac-app-release.yml) overwrites one
/// `Index.dmg` per channel and writes the source commit into the release notes
/// ("Index.dmg from <sha> on <branch>"). There is no version feed and the
/// bundle version is not bumped per build, so the check compares that commit
/// against the one baked in at build time rather than comparing versions.
enum UpdateChecker {
    enum Outcome {
        /// The release was built from this exact commit.
        case current
        /// The release is a different commit; offer the DMG.
        case available(URL)
        /// The comparison could not be made. The DMG is still offered, because
        /// downloading it is the one thing that always resolves the question.
        case indeterminate(reason: String, download: URL)
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
        URL(string: "https://github.com/indexnetwork/index/releases/download/\(releaseTag)/Index.dmg")!
    }

    private static var releaseAPIURL: URL {
        URL(string: "https://api.github.com/repos/indexnetwork/index/releases/tags/\(releaseTag)")!
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
                : .available(download))
        }.resume()
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
