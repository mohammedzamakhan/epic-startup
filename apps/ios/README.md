# Tenant iOS app (`apps/ios`)

A **branded customer app** for a tenant (org) on this platform. It reuses the
same public contracts as `apps/sites` and `apps/tenant-api`:

| What                                               | Where it comes from                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Branding (name, icon, theme tokens, announcements) | `GET {APP_URL}/resources/sites?slug=…\|host=…` — the same KV-cached payload Sites SSR uses |
| Sign in                                            | `POST {TENANT_API}/auth/send-code` + `/auth/verify` (phone OTP, regional node)             |
| Profile                                            | `GET {TENANT_API}/auth/me`, `POST {TENANT_API}/auth/profile`                               |
| Session                                            | Access token (15 min) + rotating refresh token, stored in the **Keychain**                 |

Scope is intentionally small: a branded shell, phone-OTP login, and the customer
profile. CMS pages, blocks, and shop stay on the org's website.

## Does Turbo support a Swift app?

Turbo does not need to understand Swift — it runs the package scripts declared
in `package.json`. This app therefore participates in the monorepo the same way
the Expo app does:

```bash
npm run ios:test  -w ios   # swift test   (macOS and Linux)
npm run ios:build -w ios   # swift build  (macOS and Linux)
npm run ios:generate -w ios        # xcodegen generate  (macOS)
npm run ios:xcode:build -w ios     # xcodebuild         (macOS + Xcode)
```

Two deliberate choices keep CI green:

1. **No `build` / `test` / `typecheck` scripts.**
   `turbo run build|test|typecheck` would otherwise try to run Swift on Linux CI
   runners, where Xcode does not exist. iOS tasks are opt-in via the `ios:*`
   scripts.
2. **Xcode project is generated, not committed.** `project.yml` (XcodeGen) is
   the source of truth, so the repo has no binary `.xcodeproj` to merge.

## Layout

```
apps/ios/
├── Package.swift              # TenantKit (Foundation only) + tests
├── project.yml                # XcodeGen spec for the iOS app target
├── Config/Shared.xcconfig     # endpoints + white-label binding
├── Sources/
│   ├── TenantKit/             # platform-independent core (Linux-testable)
│   │   ├── Configuration/     # TenantConfiguration (env → URLs, data region)
│   │   ├── Localization/      # SiteLocale + AppLanguage negotiation (i18n/RTL)
│   │   ├── Models/            # PublicOrganization, theme, announcements, profile
│   │   ├── Networking/        # TenantAPIClient, HTTPTransport, APIError
│   │   ├── Session/           # CustomerSession, Keychain TokenStorage
│   │   ├── Support/           # phone, JWT claims, site address parsing
│   │   └── Theme/             # oklch/rgb/hsl → sRGB, theme tokens
│   └── TenantApp/             # SwiftUI app (Xcode only)
│       ├── AppState.swift     # branding + auth + profile state machine
│       ├── Theme/             # SiteTheme → SwiftUI palette
│       ├── Components/        # themed cards, fields, buttons, brand header
│       ├── Views/             # root, connect, login, verify, name, profile
│       └── Resources/         # Info.plist + en/ar/de/es/fr/zh .lproj strings
└── Tests/TenantKitTests/      # 58 unit tests, runnable on Linux
```

## Running it

```bash
# Core package (works on macOS and Linux)
npm run ios:test -w ios

# iOS app (macOS + Xcode + XcodeGen)
brew install xcodegen
npm run ios:generate -w ios
open apps/ios/EpicTenantApp.xcodeproj
```

Local development expects the usual dev servers: App on `:3001` and tenant-api
on `:3007` (US) / `:3009` (KSA), as configured by `Config/Shared.xcconfig`.

## Pointing the app at a tenant

`Config/Shared.xcconfig` ships local defaults. A production/white-label build
sets:

```
EPIC_USE_TLS = YES
EPIC_APP_BASE_URL = app.epic-startup.com
EPIC_TENANT_API_US_BASE_URL = tenant-us.epic-startup.com
EPIC_TENANT_API_KSA_BASE_URL = tenant-ksa.epic-startup.com
EPIC_BRAND_DOMAIN = epic-startup.com
EPIC_SITE_SLUG = acme
EPIC_SITE_ORIGIN = https:/$()/acme.epic-startup.com   # `//` starts a comment in xcconfig
```

Leave `EPIC_SITE_SLUG`/`EPIC_SITE_HOST` empty and the app asks the customer for
their site address on first launch instead.

## i18n

The app ships the same content locales as the org sites — `en`, `ar`, `es`,
`fr`, `de`, `zh`
(`Sources/TenantApp/Resources/<locale>.lproj/Localizable.strings`).
`AppLanguage.resolve` picks the UI language in this order:

1. the customer's explicit choice (Profile → Language),
2. the device's preferred languages when translated,
3. the locale the org negotiated for this request (so an Arabic-only tenant gets
   Arabic chrome on an untranslated phone),
4. English.

`ar` also switches the whole app to RTL (`layoutDirection`) and localizes number
and date formatting through the `Locale` environment value.

## Tenant data residency

The app follows the platform rule: customer PII only ever lives in the regional
tenant-api (`us` or `ksa`) chosen from `organization.dataRegion`. Branding comes
from the US control-plane App payload, which contains no customer data.

Because a native app has no browser `Origin`, `send-code`/`verify` are bound to
the tenant by sending the tenant's public site origin (`EPIC_SITE_ORIGIN`) as
the `Origin` header for https origins — the exact origin↔org rule Sites
satisfies with its `Host` header. Local `http` development omits it and uses the
body `slug`/`host` binding that tenant-api allows outside production. No
tenant-api change was needed for native clients.
