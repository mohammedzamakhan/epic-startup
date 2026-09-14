import Foundation
import SwiftUI
import TenantKit

/// Persisted, non-sensitive app preferences (the site this app is connected to
/// and the customer's language choice). Tokens never live here — they are in the
/// Keychain via `CustomerSession`.
struct AppPreferences {
	private let defaults: UserDefaults

	init(defaults: UserDefaults = .standard) {
		self.defaults = defaults
	}

	var siteAddress: SiteAddress? {
		get {
			let slug = defaults.string(forKey: "epic.siteSlug") ?? ""
			let host = defaults.string(forKey: "epic.siteHost") ?? ""
			let origin = defaults.string(forKey: "epic.siteOrigin") ?? ""
			guard !slug.isEmpty || !host.isEmpty else { return nil }
			return SiteAddress(
				slug: slug.isEmpty ? nil : slug,
				host: host.isEmpty ? nil : host,
				origin: URL(string: origin)
			)
		}
		set {
			defaults.set(newValue?.slug ?? "", forKey: "epic.siteSlug")
			defaults.set(newValue?.host ?? "", forKey: "epic.siteHost")
			defaults.set(newValue?.origin?.absoluteString ?? "", forKey: "epic.siteOrigin")
		}
	}

	var languageOverride: String? {
		get {
			let value = defaults.string(forKey: "epic.language") ?? ""
			return value.isEmpty ? nil : value
		}
		set { defaults.set(newValue ?? "", forKey: "epic.language") }
	}
}

/// The app's single source of truth: tenant branding, the customer session, and
/// the profile shown behind login.
@MainActor
final class AppState: ObservableObject {
	enum Phase: Equatable {
		case loading
		/// No tenant bound yet — the customer connects their site.
		case needsSite
		case ready
		case failed(String)
	}

	@Published private(set) var phase: Phase = .loading
	@Published private(set) var organization: PublicOrganization?
	@Published private(set) var theme: SiteTheme = .fallback
	@Published private(set) var profile: CustomerProfile?
	@Published private(set) var isSignedIn = false
	@Published private(set) var needsName = false
	@Published private(set) var isBusy = false
	@Published private(set) var isSavingProfile = false
	@Published private(set) var didSaveProfile = false
	@Published private(set) var errorMessage: String?
	@Published var pendingPhone: String?

	private(set) var configuration: TenantConfiguration
	private var client: TenantAPIClient
	private var session: CustomerSession?
	private let preferences: AppPreferences

	init(
		configuration: TenantConfiguration = .from(infoDictionary: Bundle.main.infoDictionary),
		preferences: AppPreferences = AppPreferences()
	) {
		self.configuration = configuration
		self.preferences = preferences
		if let stored = preferences.siteAddress {
			self.configuration.siteAddress = stored
		}
		self.client = TenantAPIClient(configuration: self.configuration)
	}

	// MARK: - Branding

	var siteName: String { organization?.name ?? "Tenant" }

	var iconURL: URL? { organization?.iconURL(baseURL: configuration.appBaseURL) }

	var announcements: [PublicSiteAnnouncement] { organization?.announcements ?? [] }

	/// UI language: customer override → device language → org language → English.
	var language: AppLanguage {
		AppLanguage.resolve(
			organization: organization,
			deviceLanguages: Locale.preferredLanguages,
			appLocales: AppLocalizations.available,
			override: preferences.languageOverride
		)
	}

	var languageOverride: String? {
		get { preferences.languageOverride }
		set {
			preferences.languageOverride = newValue
			objectWillChange.send()
		}
	}

	var availableLanguages: [String] { AppLocalizations.available }

	// MARK: - Lifecycle

	func start() async {
		guard configuration.isBoundToTenant else {
			phase = .needsSite
			return
		}
		await loadSite()
	}

	/// Connects the app to a tenant the customer typed in.
	func connect(to input: String) async {
		guard let address = SiteAddress.parse(input, brandDomain: configuration.brandDomain) else {
			errorMessage = language.string("connect.error")
			return
		}
		configuration.siteAddress = address
		preferences.siteAddress = address
		await loadSite()
	}

	func retry() async {
		guard configuration.isBoundToTenant else {
			phase = .needsSite
			return
		}
		await loadSite()
	}

	private func loadSite() async {
		phase = .loading
		errorMessage = nil
		do {
			let organization = try await client.fetchOrganization()
			self.organization = organization
			self.theme = SiteTheme(theme: organization.theme)
			configureSession(for: organization)
			phase = .ready
		} catch let error as APIError {
			phase = .failed(message(for: error))
		} catch {
			phase = .failed(error.localizedDescription)
		}
	}

	/// Rebuilds the API client for the org's data region and restores any session.
	private func configureSession(for organization: PublicOrganization) {
		configuration.dataRegion = organization.resolvedDataRegion
		let client = TenantAPIClient(configuration: configuration)
		let session = CustomerSession(client: client)
		self.client = client
		self.session = session

		Task {
			let tokens = await session.restore()
			// A stored session belongs to one org; drop it when the tenant changes.
			if let tokens, tokens.orgId != organization.id {
				await session.signOut()
				isSignedIn = false
				return
			}
			isSignedIn = tokens != nil
			if tokens != nil { await loadProfile() }
		}
	}

	// MARK: - Authentication

	func sendCode(phone: String) async {
		guard let session else { return }
		guard PhoneNumber.isValid(phone) else {
			errorMessage = language.string("login.invalidPhone")
			return
		}
		isBusy = true
		errorMessage = nil
		do {
			try await session.sendCode(phone: phone)
			pendingPhone = PhoneNumber.normalize(phone)
		} catch let error as APIError {
			errorMessage = message(for: error)
		} catch {
			errorMessage = language.string("login.networkError")
		}
		isBusy = false
	}

	func verify(code: String) async {
		guard let session, let phone = pendingPhone else { return }
		isBusy = true
		errorMessage = nil
		do {
			let result = try await session.verify(phone: phone, code: code)
			isSignedIn = true
			if result.needsName == true {
				needsName = true
			} else {
				await loadProfile()
			}
		} catch let error as APIError {
			errorMessage = message(for: error)
		} catch {
			errorMessage = language.string("login.networkError")
		}
		isBusy = false
	}

	func resendCode() async {
		guard let phone = pendingPhone else { return }
		await sendCode(phone: phone)
	}

	func cancelVerification() {
		pendingPhone = nil
		errorMessage = nil
	}

	func completeName(_ name: String) async {
		guard let session else { return }
		isBusy = true
		errorMessage = nil
		do {
			profile = try await session.updateProfile(name: name, email: nil)
			needsName = false
		} catch let error as APIError {
			errorMessage = message(for: error)
		} catch {
			errorMessage = language.string("login.networkError")
		}
		isBusy = false
	}

	func signOut() async {
		await session?.signOut()
		isSignedIn = false
		profile = nil
		needsName = false
		pendingPhone = nil
		errorMessage = nil
	}

	// MARK: - Profile

	func loadProfile() async {
		guard let session, isSignedIn else { return }
		do {
			let profile = try await session.profile()
			self.profile = profile
			if profile.needsName == true { needsName = true }
		} catch let error as APIError where error.isUnauthorized {
			isSignedIn = false
			profile = nil
		} catch {
			errorMessage = message(for: error)
		}
	}

	func saveProfile(name: String, email: String) async {
		guard let session else { return }
		isSavingProfile = true
		errorMessage = nil
		didSaveProfile = false
		do {
			profile = try await session.updateProfile(name: name, email: email)
			didSaveProfile = true
		} catch let error as APIError {
			errorMessage = message(for: error)
		} catch {
			errorMessage = language.string("profile.networkError")
		}
		isSavingProfile = false
	}

	func clearTransientMessages() {
		errorMessage = nil
		didSaveProfile = false
	}

	// MARK: - Helpers

	/// Server messages are English; network/transport failures get a localized one.
	private func message(for error: APIError) -> String {
		if error.isTransportFailure {
			return language.string("login.networkError")
		}
		if error.isRateLimited || error.statusCode >= 500 {
			return error.message
		}
		if error.statusCode == 400 || error.statusCode == 401 {
			return error.message
		}
		return error.message
	}
}
