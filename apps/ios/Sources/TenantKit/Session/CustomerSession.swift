import Foundation

/// Owns the customer's tenant-api session for one org.
///
/// Mirrors the browser behaviour in `apps/sites/src/lib/client-auth.ts`:
/// a short-lived access token (15 min) plus a rotating refresh token, with a
/// single transparent retry when tenant-api answers `401`.
public actor CustomerSession {
	private let client: TenantAPIClient
	private let storage: TokenStorage
	private var currentTokens: AuthTokens?
	/// One in-flight refresh shared by every caller: tenant-api rotates refresh
	/// tokens and revokes the family when a token is replayed, so two parallel
	/// refreshes would sign the customer out.
	private var refreshTask: Task<AuthTokens, Error>?

	public init(client: TenantAPIClient, storage: TokenStorage = TokenStorageFactory.makeDefault()) {
		self.client = client
		self.storage = storage
		self.currentTokens = storage.load()
	}

	public var tokens: AuthTokens? { currentTokens }

	public var isSignedIn: Bool { currentTokens != nil }

	public var customerName: String? { currentTokens?.name }

	public var customerFirstName: String? { currentTokens?.firstName }

	/// Loads a previously stored session (call on launch).
	@discardableResult
	public func restore() -> AuthTokens? {
		if currentTokens == nil { currentTokens = storage.load() }
		return currentTokens
	}

	// MARK: - Auth flows

	public func sendCode(phone: String) async throws {
		let normalized = PhoneNumber.normalize(phone)
		guard PhoneNumber.isValid(normalized) else {
			throw APIError(statusCode: 400, message: "Enter a valid phone number.")
		}
		try await client.sendCode(phone: normalized)
	}

	@discardableResult
	public func verify(phone: String, code: String) async throws -> VerifyResult {
		let result = try await client.verify(
			phone: PhoneNumber.normalize(phone),
			code: code.trimmingCharacters(in: .whitespacesAndNewlines)
		)
		if let accessToken = result.accessToken {
			store(AuthTokens(accessToken: accessToken, refreshToken: result.refreshToken))
		}
		return result
	}

	public func signOut() async {
		let refreshToken = currentTokens?.refreshToken
		let orgId = currentTokens?.orgId
		clearTokens()
		await client.logout(refreshToken: refreshToken, orgId: orgId)
	}

	// MARK: - Authorized calls

	/// Runs an authenticated request, refreshing the access token once on `401`.
	public func authorized<T>(_ operation: @Sendable (String) async throws -> T) async throws -> T {
		guard let accessToken = currentTokens?.accessToken else {
			throw APIError.unauthorized
		}
		do {
			return try await operation(accessToken)
		} catch let error as APIError where error.isUnauthorized {
			guard let refreshed = try? await refresh() else {
				clearTokens()
				throw APIError.unauthorized
			}
			return try await operation(refreshed.accessToken)
		}
	}

	public func profile() async throws -> CustomerProfile {
		try await authorized { [client] token in
			try await client.fetchProfile(accessToken: token)
		}
	}

	public func updateProfile(name: String, email: String?) async throws -> CustomerProfile {
		let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmedName.count >= 2 else {
			throw APIError(statusCode: 400, message: "Name is required.")
		}
		let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
		let next = try await authorized { [client] token in
			try await client.updateProfile(
				name: trimmedName,
				email: trimmedEmail,
				accessToken: token
			)
		}
		// `/auth/profile` rotates the refresh token; keep the current one if the
		// response omits it so the session can still be refreshed.
		store(
			AuthTokens(
				accessToken: next.accessToken,
				refreshToken: next.refreshToken ?? currentTokens?.refreshToken
			)
		)
		return try await profile()
	}

	// MARK: - Refresh

	@discardableResult
	public func refresh() async throws -> AuthTokens {
		if let refreshTask {
			return try await refreshTask.value
		}

		let task = Task<AuthTokens, Error> { [client] in
			try await CustomerSession.performRefresh(client: client, session: self)
		}
		refreshTask = task

		do {
			let tokens = try await task.value
			refreshTask = nil
			return tokens
		} catch {
			refreshTask = nil
			throw error
		}
	}

	private static func performRefresh(
		client: TenantAPIClient,
		session: CustomerSession
	) async throws -> AuthTokens {
		guard
			let tokens = await session.currentTokens,
			let refreshToken = tokens.refreshToken,
			let orgId = tokens.orgId
		else {
			throw APIError.unauthorized
		}

		do {
			let refreshed = try await client.refresh(refreshToken: refreshToken, orgId: orgId)
			// tenant-api rotates refresh tokens; keep the newest one.
			let merged = AuthTokens(
				accessToken: refreshed.accessToken,
				refreshToken: refreshed.refreshToken ?? refreshToken
			)
			await session.store(merged)
			return merged
		} catch {
			await session.clearTokens()
			throw error
		}
	}

	private func store(_ tokens: AuthTokens) {
		currentTokens = tokens
		// A Keychain failure only costs the session on next launch; the customer
		// stays signed in for this run rather than being dropped mid-flow.
		storage.save(tokens)
	}

	private func clearTokens() {
		currentTokens = nil
		storage.save(nil)
	}
}
