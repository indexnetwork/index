import Foundation
import Security

private final class FakeKeychainBackend {
    var storedData: Data?
    var forcedAddStatus: OSStatus?
    var forcedCopyStatus: OSStatus?
    var forcedDeleteStatus: OSStatus?
    var returnWrongReadback = false
    var updateCount = 0

    lazy var operations = IndexKeychainSecurityOperations(
        add: { [unowned self] attributes, _ in
            if let status = self.forcedAddStatus {
                return status
            }
            if self.storedData != nil {
                return errSecDuplicateItem
            }
            self.storedData = self.data(from: attributes)
            return errSecSuccess
        },
        copyMatching: { [unowned self] _, result in
            if let status = self.forcedCopyStatus {
                return status
            }
            guard let storedData = self.storedData else {
                return errSecItemNotFound
            }
            let returnedData = self.returnWrongReadback ? Data("wrong-secret".utf8) : storedData
            result?.pointee = returnedData as CFData
            return errSecSuccess
        },
        update: { [unowned self] _, attributes in
            self.updateCount += 1
            self.storedData = self.data(from: attributes)
            return errSecSuccess
        },
        delete: { [unowned self] _ in
            if let status = self.forcedDeleteStatus {
                return status
            }
            guard self.storedData != nil else {
                return errSecItemNotFound
            }
            self.storedData = nil
            return errSecSuccess
        }
    )

    private func data(from attributes: CFDictionary) -> Data? {
        (attributes as NSDictionary)[kSecValueData as String] as? Data
    }
}

private func expectStoreError(
    _ expected: IndexKeychainStoreError,
    _ body: () throws -> Void
) {
    do {
        try body()
        preconditionFailure("Expected \(expected)")
    } catch let error as IndexKeychainStoreError {
        precondition(error == expected, "Expected \(expected), received \(error)")
    } catch {
        preconditionFailure("Expected IndexKeychainStoreError, received \(error)")
    }
}

private func runRealCRUDFixture() throws {
    let store = IndexKeychainStore()
    let descriptor = IndexKeychainItemDescriptor(
        service: "network.index.connector.fixture",
        account: UUID().uuidString,
        accessGroup: ProcessInfo.processInfo.environment["INDEX_TEST_KEYCHAIN_GROUP"]
    )
    defer { try? store.delete(descriptor: descriptor) }

    let fixtureSecret = Data("fixture-secret".utf8)
    try store.putAndVerify(fixtureSecret, descriptor: descriptor)
    precondition(try store.read(descriptor: descriptor) == fixtureSecret)

    let replacementSecret = Data("fixture-secret-replaced".utf8)
    try store.putAndVerify(replacementSecret, descriptor: descriptor)
    precondition(try store.read(descriptor: descriptor) == replacementSecret)

    try store.delete(descriptor: descriptor)
    precondition(try store.read(descriptor: descriptor) == nil)
}

private func runInjectedFailureFixtures() throws {
    let descriptor = IndexKeychainItemDescriptor(
        service: "network.index.connector.injected-fixture",
        account: "fixture-account"
    )

    let duplicateBackend = FakeKeychainBackend()
    duplicateBackend.storedData = Data("old-secret".utf8)
    let duplicateStore = IndexKeychainStore(security: duplicateBackend.operations)
    let newSecret = Data("new-secret".utf8)
    try duplicateStore.putAndVerify(newSecret, descriptor: descriptor)
    precondition(duplicateBackend.updateCount == 1)
    precondition(try duplicateStore.read(descriptor: descriptor) == newSecret)
    precondition(errSecDuplicateItem != errSecSuccess)

    let interactionBackend = FakeKeychainBackend()
    interactionBackend.forcedAddStatus = errSecInteractionNotAllowed
    let interactionStore = IndexKeychainStore(security: interactionBackend.operations)
    expectStoreError(.securityStatus(errSecInteractionNotAllowed)) {
        try interactionStore.putAndVerify(newSecret, descriptor: descriptor)
    }

    let readbackBackend = FakeKeychainBackend()
    readbackBackend.returnWrongReadback = true
    let readbackStore = IndexKeychainStore(security: readbackBackend.operations)
    expectStoreError(.verificationFailed) {
        try readbackStore.putAndVerify(newSecret, descriptor: descriptor)
    }

    let deletionBackend = FakeKeychainBackend()
    deletionBackend.storedData = newSecret
    deletionBackend.forcedDeleteStatus = errSecInteractionNotAllowed
    let deletionStore = IndexKeychainStore(security: deletionBackend.operations)
    expectStoreError(.securityStatus(errSecInteractionNotAllowed)) {
        try deletionStore.delete(descriptor: descriptor)
    }
}

private func requireEnvironment(_ name: String) -> String {
    guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
        preconditionFailure("\(name) is required for the signed access fixture")
    }
    return value
}

private func runSignedAccessFixture() throws {
    let role = requireEnvironment("INDEX_KEYCHAIN_FIXTURE_ROLE")
    let action = requireEnvironment("INDEX_KEYCHAIN_FIXTURE_ACTION")
    let appGroup = requireEnvironment("INDEX_TEST_APP_KEYCHAIN_GROUP")
    let connectorGroup = requireEnvironment("INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP")
    precondition(appGroup != connectorGroup)

    let ownGroup: String
    let otherGroup: String
    let ownService: String
    let otherService: String
    let ownAccount: String
    let otherAccount: String
    switch role {
    case "app":
        ownGroup = appGroup
        otherGroup = connectorGroup
        ownService = "network.index.system6.owner-credentials.cross-identity-fixture"
        otherService = "network.index.connector.credentials.cross-identity-fixture"
        ownAccount = "app-cross-identity-fixture"
        otherAccount = "connector-cross-identity-fixture"
    case "connector":
        ownGroup = connectorGroup
        otherGroup = appGroup
        ownService = "network.index.connector.credentials.cross-identity-fixture"
        otherService = "network.index.system6.owner-credentials.cross-identity-fixture"
        ownAccount = "connector-cross-identity-fixture"
        otherAccount = "app-cross-identity-fixture"
    default:
        preconditionFailure("Unknown signed fixture role: \(role)")
    }

    let store = IndexKeychainStore()
    let ownDescriptor = IndexKeychainItemDescriptor(
        service: ownService,
        account: ownAccount,
        accessGroup: ownGroup
    )
    // Query the actual descriptor seeded by the other identity, including its
    // inaccessible group. Security.framework must fail closed rather than
    // converting a missing entitlement into an ordinary not-found result.
    let otherDescriptor = IndexKeychainItemDescriptor(
        service: otherService,
        account: otherAccount,
        accessGroup: otherGroup
    )

    switch action {
    case "seed":
        try store.putAndVerify(Data("\(role)-secret".utf8), descriptor: ownDescriptor)
    case "check":
        precondition(
            try store.read(descriptor: ownDescriptor) == Data("\(role)-secret".utf8)
        )
        expectStoreError(.securityStatus(errSecMissingEntitlement)) {
            _ = try store.read(descriptor: otherDescriptor)
        }
    case "cleanup":
        try store.delete(descriptor: ownDescriptor)
    default:
        preconditionFailure("Unknown signed fixture action: \(action)")
    }
}

@main
struct IndexKeychainIntegrationFixture {
    static func main() throws {
        if ProcessInfo.processInfo.environment["INDEX_KEYCHAIN_SIGNED_ACCESS_RUN"] == "1" {
            try runSignedAccessFixture()
            return
        }
        try runRealCRUDFixture()
        try runInjectedFailureFixtures()
        print("Keychain CRUD and failure fixtures passed")
    }
}
