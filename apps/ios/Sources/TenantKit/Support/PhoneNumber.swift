import Foundation

/// Phone handling that matches tenant-api's `normalizePhone()` so the same
/// number hashes to the same customer record on both clients.
public enum PhoneNumber {
	/// Mirrors `phone.replace(/[\s\-()]/g, '')` in `apps/tenant-api/src/routes/auth.ts`.
	public static func normalize(_ phone: String) -> String {
		let stripped = phone.filter { character in
			!character.isWhitespace && character != "-" && character != "(" && character != ")"
		}
		return String(stripped)
	}

	public static func isValid(_ phone: String) -> Bool {
		normalize(phone).count >= 5
	}

	/// Formats a normalized number for display without changing its digits.
	public static func display(_ phone: String) -> String {
		let normalized = normalize(phone)
		guard normalized.hasPrefix("+") else { return normalized }
		let digits = String(normalized.dropFirst())
		guard digits.count > 6 else { return normalized }
		let countryCode = digits.prefix(digits.count > 10 ? digits.count - 10 : 1)
		let rest = digits.dropFirst(countryCode.count)
		var groups: [String] = []
		var remaining = Array(rest)
		while remaining.count > 4 {
			groups.append(String(remaining.prefix(3)))
			remaining.removeFirst(3)
		}
		if !remaining.isEmpty { groups.append(String(remaining)) }
		return "+\(countryCode) " + groups.joined(separator: " ")
	}
}
