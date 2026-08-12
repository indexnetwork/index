import Foundation
import Security

struct IndexKeychainItemDescriptor: Equatable {
    let service: String
    let account: String
    let accessGroup: String?

    init(service: String, account: String, accessGroup: String? = nil) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }
}

enum IndexKeychainStoreError: Error, Equatable {
    case securityStatus(OSStatus)
    case invalidResult
    case verificationFailed
}

struct IndexKeychainSecurityOperations {
    typealias Add = (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    typealias CopyMatching = (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    typealias Update = (CFDictionary, CFDictionary) -> OSStatus
    typealias Delete = (CFDictionary) -> OSStatus

    let add: Add
    let copyMatching: CopyMatching
    let update: Update
    let delete: Delete

    static let live = IndexKeychainSecurityOperations(
        add: { SecItemAdd($0, $1) },
        copyMatching: { SecItemCopyMatching($0, $1) },
        update: { SecItemUpdate($0, $1) },
        delete: { SecItemDelete($0) }
    )
}

struct IndexKeychainStore {
    private let security: IndexKeychainSecurityOperations

    init(security: IndexKeychainSecurityOperations = .live) {
        self.security = security
    }

    func putAndVerify(_ data: Data, descriptor: IndexKeychainItemDescriptor) throws {
        var attributes = query(for: descriptor)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = security.add(attributes as CFDictionary, nil)
        switch addStatus {
        case errSecSuccess:
            break
        case errSecDuplicateItem:
            let replacement = [kSecValueData as String: data] as CFDictionary
            let updateStatus = security.update(query(for: descriptor) as CFDictionary, replacement)
            guard updateStatus == errSecSuccess else {
                throw IndexKeychainStoreError.securityStatus(updateStatus)
            }
        default:
            throw IndexKeychainStoreError.securityStatus(addStatus)
        }

        guard try read(descriptor: descriptor) == data else {
            throw IndexKeychainStoreError.verificationFailed
        }
    }

    func read(descriptor: IndexKeychainItemDescriptor) throws -> Data? {
        var attributes = query(for: descriptor)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = security.copyMatching(attributes as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else {
                throw IndexKeychainStoreError.invalidResult
            }
            return data
        case errSecItemNotFound:
            return nil
        default:
            throw IndexKeychainStoreError.securityStatus(status)
        }
    }

    func delete(descriptor: IndexKeychainItemDescriptor) throws {
        let status = security.delete(query(for: descriptor) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw IndexKeychainStoreError.securityStatus(status)
        }
    }

    private func query(for descriptor: IndexKeychainItemDescriptor) -> [String: Any] {
        var attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: descriptor.service,
            kSecAttrAccount as String: descriptor.account,
        ]
        if let accessGroup = descriptor.accessGroup {
            attributes[kSecAttrAccessGroup as String] = accessGroup
        }
        return attributes
    }
}
