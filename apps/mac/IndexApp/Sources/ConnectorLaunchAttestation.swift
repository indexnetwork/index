import Foundation
import Security

struct HermesConnectorLaunchIdentity: Equatable {
    let teamIdentifier: String?
    let bundleIdentifier: String
    let allowedCDHashes: Set<Data>
}

enum HermesConnectorAttestationError: Error {
    case invalidIdentity
}

enum HermesConnectorCodeAttestor {
    static func captureExpectedIdentity(
        staticCode: SecStaticCode,
        expectedTeamID: String?,
        expectedBundleID: String
    ) throws -> HermesConnectorLaunchIdentity {
        var signingInformation: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &signingInformation
        ) == errSecSuccess,
              let information = signingInformation as? [String: Any],
              information[kSecCodeInfoTeamIdentifier as String] as? String == expectedTeamID,
              information[kSecCodeInfoIdentifier as String] as? String == expectedBundleID,
              let cdHashes = information[kSecCodeInfoCdHashes as String] as? [Data],
              !cdHashes.isEmpty,
              cdHashes.allSatisfy({ !$0.isEmpty }) else {
            throw HermesConnectorAttestationError.invalidIdentity
        }
        return HermesConnectorLaunchIdentity(
            teamIdentifier: expectedTeamID,
            bundleIdentifier: expectedBundleID,
            allowedCDHashes: Set(cdHashes)
        )
    }

    static func attestSuspendedChild(
        pid: pid_t,
        expected: HermesConnectorLaunchIdentity,
        requirement: SecRequirement
    ) throws {
        let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
        var dynamicCode: SecCode?
        guard SecCodeCopyGuestWithAttributes(
            nil,
            attributes,
            SecCSFlags(),
            &dynamicCode
        ) == errSecSuccess,
              let dynamicCode,
              SecCodeCheckValidity(
                dynamicCode,
                SecCSFlags(rawValue: kSecCSStrictValidate),
                requirement
              ) == errSecSuccess else {
            throw HermesConnectorAttestationError.invalidIdentity
        }

        // Swift does not expose SecCodeCopySigningInformation's documented
        // implicit SecCode-to-SecStaticCode conversion. Use the explicit bridge
        // after dynamic validity succeeds. With default flags the static view is
        // narrowed to the architecture loaded by this child, so its labels and
        // kSecCodeInfoUnique describe the validated running image.
        var loadedStaticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(
            dynamicCode,
            SecCSFlags(),
            &loadedStaticCode
        ) == errSecSuccess, let loadedStaticCode else {
            throw HermesConnectorAttestationError.invalidIdentity
        }

        var signingInformation: CFDictionary?
        guard SecCodeCopySigningInformation(
            loadedStaticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &signingInformation
        ) == errSecSuccess,
              let information = signingInformation as? [String: Any],
              information[kSecCodeInfoTeamIdentifier as String] as? String
                == expected.teamIdentifier,
              information[kSecCodeInfoIdentifier as String] as? String
                == expected.bundleIdentifier,
              let loadedCDHash = information[kSecCodeInfoUnique as String] as? Data,
              !loadedCDHash.isEmpty,
              expected.allowedCDHashes.contains(loadedCDHash) else {
            throw HermesConnectorAttestationError.invalidIdentity
        }
    }
}
