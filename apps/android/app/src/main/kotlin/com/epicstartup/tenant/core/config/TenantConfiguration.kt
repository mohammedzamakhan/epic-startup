package com.epicstartup.tenant.core.config

import com.epicstartup.tenant.core.support.SiteAddress

/**
 * How the app reaches the platform.
 *
 * Values come from Android string resources, which `app/build.gradle.kts` fills
 * from `app/tenant.properties` (written by `scripts/generate-tenant.mjs`). A
 * build can therefore be pointed at any environment without touching Kotlin.
 */
data class TenantConfiguration(
	/** US control-plane App origin — public Sites payloads (`/resources/sites`). */
	val appBaseUrl: String,
	/** Regional tenant-api nodes that own customer PII. */
	val tenantApiBaseUrlUs: String,
	val tenantApiBaseUrlKsa: String? = null,
	/** Which tenant this build is bound to (empty = ask the customer). */
	val siteAddress: SiteAddress = SiteAddress(),
	val brandDomain: String = "epic-startup.com",
	val requestTimeoutMs: Int = 15_000,
	/** `us` | `ksa` — set from the org payload; customer PII never leaves its region. */
	val dataRegion: String = "us",
) {
	val isBoundToTenant: Boolean
		get() = siteAddress.isBound

	/** The regional tenant-api node that owns this org's customer data. */
	val tenantApiBaseUrl: String
		get() = tenantApiBaseUrlFor(dataRegion)

	fun tenantApiBaseUrlFor(region: String): String {
		val normalized = region.trim().lowercase()
		if (normalized == "ksa") {
			val ksa = tenantApiBaseUrlKsa
			if (!ksa.isNullOrBlank()) return ksa
		}
		return tenantApiBaseUrlUs
	}

	fun withSiteAddress(address: SiteAddress): TenantConfiguration = copy(siteAddress = address)

	fun withDataRegion(region: String): TenantConfiguration = copy(dataRegion = region)

	companion object {
		/** Local development defaults, matching `apps/ios/Config/Debug.xcconfig`. */
		val localDevelopment = TenantConfiguration(
			appBaseUrl = "http://localhost:3001",
			tenantApiBaseUrlUs = "http://localhost:3007",
			tenantApiBaseUrlKsa = "http://localhost:3009",
			siteAddress = SiteAddress(),
			brandDomain = "epic-startup.test",
		)

		/**
		 * Builds a configuration from the resource values, applying the same
		 * rules as iOS: host-or-URL values get a scheme from `useTls`, and a
		 * cleartext URL to a non-loopback host is refused (the build falls back
		 * to the dev default rather than sending tokens over plain HTTP).
		 */
		fun from(
			appUrl: String,
			tenantApiUs: String,
			tenantApiKsa: String?,
			useTls: Boolean,
			brandDomain: String,
			siteSlug: String?,
			siteHost: String?,
			siteOrigin: String?,
			requestTimeoutMs: Int,
		): TenantConfiguration {
			val fallback = localDevelopment
			val ksa = tenantApiKsa?.trim().orEmpty()
			return TenantConfiguration(
				appBaseUrl = normalizeUrl(appUrl, useTls, fallback.appBaseUrl),
				tenantApiBaseUrlUs = normalizeUrl(tenantApiUs, useTls, fallback.tenantApiBaseUrlUs),
				// A blank KSA node means "this deployment is US-only"; an unsafe
				// one falls back to the local dev node, so a misconfigured build
				// fails instead of routing KSA customers anywhere else.
				tenantApiBaseUrlKsa = if (ksa.isEmpty()) {
					null
				} else {
					normalizeUrl(ksa, useTls, fallback.tenantApiBaseUrlKsa.orEmpty())
				},
				siteAddress = SiteAddress(
					slug = siteSlug?.trim()?.ifEmpty { null },
					host = siteHost?.trim()?.ifEmpty { null },
					origin = siteOrigin?.trim()?.ifEmpty { null },
				),
				brandDomain = brandDomain.trim().ifEmpty { fallback.brandDomain },
				requestTimeoutMs = if (requestTimeoutMs > 0) requestTimeoutMs else fallback.requestTimeoutMs,
			)
		}

		fun normalizeUrl(raw: String, useTls: Boolean, fallback: String): String {
			val trimmed = raw.trim()
			if (trimmed.isEmpty()) return fallback
			val candidate = if (trimmed.contains("://")) {
				trimmed
			} else {
				"${if (useTls) "https" else "http"}://$trimmed"
			}
			if (!isTransportSafe(candidate)) return fallback
			return candidate.trimEnd('/')
		}

		/** HTTPS anywhere, HTTP only on loopback (emulator and device development). */
		fun isTransportSafe(url: String): Boolean {
			val trimmed = url.trim()
			val separator = trimmed.indexOf("://")
			if (separator <= 0) return false
			val scheme = trimmed.substring(0, separator).lowercase()
			val authority = trimmed.substring(separator + 3).substringBefore('/')
				.substringBefore('?')
				.substringBefore('#')
			return when (scheme) {
				"https" -> true
				"http" -> isLoopbackHost(hostOf(authority))
				else -> false
			}
		}

		/** Strips the port from an authority, keeping IPv6 brackets intact. */
		private fun hostOf(authority: String): String {
			val host = authority.substringBefore('@')
			if (host.startsWith("[")) return host.substringBefore(']') + "]"
			return host.substringBefore(':')
		}

		/**
		 * `10.0.2.2` is the Android emulator's alias for the host machine's
		 * loopback, so it is as safe as `localhost` for local development.
		 */
		fun isLoopbackHost(host: String?): Boolean {
			val normalized = host?.trim()?.lowercase() ?: return false
			if (normalized.isEmpty()) return false
			return normalized == "localhost" ||
				normalized == "::1" ||
				normalized == "[::1]" ||
				normalized == "10.0.2.2" ||
				normalized.endsWith(".localhost") ||
				normalized.startsWith("127.")
		}
	}
}
