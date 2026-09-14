import Foundation

#if canImport(Security)
import Security
#endif

/// Where the customer's tenant-api tokens live.
///
/// The web app keeps these in `localStorage` so a US Sites render never touches
/// KSA PII. On iOS the equivalent is the Keychain: tokens are stored on the
/// device, never sent to the control plane.
public protocol TokenStorage: Sendable {
	func load() -> AuthTokens?
	func save(_ tokens: AuthTokens?)
}

/// Test/Linux storage. Not used by the shipping app.
public final class InMemoryTokenStorage: TokenStorage, @unchecked Sendable {
	private let lock = NSLock()
	private var tokens: AuthTokens?

	public init(tokens: AuthTokens? = nil) {
		self.tokens = tokens
	}

	public func load() -> AuthTokens? {
		lock.lock()
		defer { lock.unlock() }
		return tokens
	}

	public func save(_ tokens: AuthTokens?) {
		lock.lock()
		defer { lock.unlock() }
		self.tokens = tokens
	}
}

#if canImport(Security)
/// Keychain-backed storage for the shipping iOS app.
public final class KeychainTokenStorage: TokenStorage, @unchecked Sendable {
	private let service: String
	private let account: String

	public init(service: String = "com.epicstartup.tenant", account: String = "customer-session") {
		self.service = service
		self.account = account
	}

	public func load() -> AuthTokens? {
		var query = baseQuery()
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne

		var item: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &item)
		guard status == errSecSuccess, let data = item as? Data else { return nil }
		return try? JSONDecoder().decode(AuthTokens.self, from: data)
	}

	public func save(_ tokens: AuthTokens?) {
		guard let tokens else {
			SecItemDelete(baseQuery() as CFDictionary)
			return
		}
		guard let data = try? JSONEncoder().encode(tokens) else { return }

		let query = baseQuery()
		let attributes: [String: Any] = [kSecValueData as String: data]
		let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
		if status == errSecItemNotFound {
			var insert = query
			insert[kSecValueData as String] = data
			insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
			SecItemAdd(insert as CFDictionary, nil)
		}
	}

	private func baseQuery() -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
		]
	}
}
#endif

public enum TokenStorageFactory {
	/// Keychain on Apple platforms, in-memory elsewhere (tests/Linux).
	public static func makeDefault() -> TokenStorage {
		#if canImport(Security)
		return KeychainTokenStorage()
		#else
		return InMemoryTokenStorage()
		#endif
	}
}
