#!/usr/bin/env node
/**
 * Turns `tenants/<slug>.json` into a build-time configuration:
 *
 *   1. `app/tenant.properties` — application id, app name, version, endpoints,
 *      site binding, and icon background (read by `app/build.gradle.kts`).
 *   2. `app/src/main/res/values/ic_launcher_background.xml` — the adaptive icon
 *      background colour.
 *   3. `app/src/main/res/mipmap-<density>/ic_launcher_foreground.png` — the
 *      tenant's published site icon, centred in the adaptive icon's safe zone.
 *
 * The committed placeholder icon is restored first, so a tenant without a
 * published icon can never inherit the previous tenant's icon (same rule as
 * apps/ios/scripts/generate-tenant.mjs).
 *
 * Icon composition needs ImageMagick (`magick`): `brew install imagemagick`,
 * `apt-get install imagemagick`, or `choco install imagemagick` on Windows.
 * Without it the placeholder icon is kept and the build continues.
 *
 * No secrets pass through here: the Play upload key lives in the tenant's
 * GitHub environment (see docs/play-store-release.md).
 *
 * Usage:
 *   node scripts/generate-tenant.mjs --tenant acme [--build-number 123]
 *                                    [--icon-source <url|path>] [--no-icon]
 *                                    [--no-api] [--out <path>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RES_ROOT = join(APP_ROOT, 'app/src/main/res')
const PLACEHOLDER_ICON = join(
	APP_ROOT,
	'scripts/assets/ic-launcher-placeholder.png',
)
const BACKGROUND_FILE = join(RES_ROOT, 'values/ic_launcher_background.xml')

/** Adaptive icons: a 108dp canvas whose outer 18dp may be masked away. */
const FOREGROUND_DENSITIES = [
	{ dir: 'mipmap-mdpi', size: 108 },
	{ dir: 'mipmap-hdpi', size: 162 },
	{ dir: 'mipmap-xhdpi', size: 216 },
	{ dir: 'mipmap-xxhdpi', size: 324 },
	{ dir: 'mipmap-xxxhdpi', size: 432 },
]
/** Share of the canvas the artwork occupies (inside the 66dp safe zone). */
const FOREGROUND_SCALE = 0.6

const DEFAULT_BACKGROUND = '#0F172A'

function parseArgs(argv) {
	const args = { flags: new Set() }
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index]
		if (!value.startsWith('--')) continue
		const [name, inline] = value.slice(2).split('=')
		if (['no-icon', 'no-api'].includes(name)) {
			args.flags.add(name)
			continue
		}
		args[name] = inline ?? argv[index + 1]
		if (inline === undefined) index += 1
	}
	return args
}

function fail(message) {
	console.error(`✖ ${message}`)
	process.exit(1)
}

function log(message) {
	console.log(`• ${message}`)
}

function requireString(config, key, file) {
	const value = config[key]
	if (typeof value !== 'string' || value.trim() === '') {
		fail(`tenants/${file} is missing "${key}"`)
	}
	return value.trim()
}

function loadTenant(slug) {
	const file = `${slug}.json`
	const path = join(APP_ROOT, 'tenants', file)
	if (!existsSync(path))
		fail(`No tenant config at apps/android/tenants/${file}`)
	let config
	try {
		config = JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		fail(`tenants/${file} is not valid JSON: ${error.message}`)
	}
	return { config, file }
}

/**
 * Reads the tenant's published branding so the icon and app name match what the
 * app renders at runtime.
 */
async function fetchOrganization(config, { useApi }) {
	if (!useApi) return null
	const scheme = /^localhost|^127\.|^10\.0\.2\.2/.test(config.appUrl)
		? 'http'
		: 'https'
	const site = config.site ?? {}
	const params = new URLSearchParams()
	if (site.host) params.set('host', site.host)
	else if (site.slug) params.set('slug', site.slug)
	if (!params.size) return null

	const url = `${scheme}://${config.appUrl}/resources/sites?${params}`
	try {
		const response = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) {
			log(
				`No published site for this tenant yet (${response.status} from ${url})`,
			)
			return null
		}
		return await response.json()
	} catch (error) {
		log(
			`Could not reach ${url} (${error.message}); continuing without API data`,
		)
		return null
	}
}

function haveImageMagick() {
	try {
		execFileSync('magick', ['-version'], { stdio: 'pipe' })
		return true
	} catch {
		return false
	}
}

/** Composes one adaptive-icon foreground: transparent canvas + centred logo. */
function composeForeground(source, destination, size) {
	const inner = Math.round(size * FOREGROUND_SCALE)
	execFileSync(
		'magick',
		[
			'-size',
			`${size}x${size}`,
			'xc:none',
			'(',
			source,
			'-resize',
			`${inner}x${inner}`,
			')',
			'-gravity',
			'center',
			'-composite',
			'-strip',
			`PNG32:${destination}`,
		],
		{ stdio: 'pipe' },
	)
}

/** Restores the committed placeholder icon (every generation starts here). */
function resetIcons() {
	if (!existsSync(PLACEHOLDER_ICON))
		fail(`Missing placeholder icon at ${PLACEHOLDER_ICON}`)
	if (!haveImageMagick()) {
		log(
			'ImageMagick (magick) not found; keeping the committed placeholder icon',
		)
		return false
	}
	for (const { dir, size } of FOREGROUND_DENSITIES) {
		const target = join(RES_ROOT, dir, 'ic_launcher_foreground.png')
		mkdirSync(dirname(target), { recursive: true })
		composeForeground(PLACEHOLDER_ICON, target, size)
	}
	writeBackground(DEFAULT_BACKGROUND)
	return true
}

function writeBackground(color) {
	mkdirSync(dirname(BACKGROUND_FILE), { recursive: true })
	writeFileSync(
		BACKGROUND_FILE,
		[
			'<?xml version="1.0" encoding="utf-8"?>',
			'<!-- Generated by apps/android/scripts/generate-tenant.mjs — do not edit by hand. -->',
			'<resources>',
			`\t<color name="ic_launcher_background">${color}</color>`,
			'</resources>',
			'',
		].join('\n'),
	)
}

async function resolveIcon(config, organization, { iconSource, useIcon }) {
	const ready = resetIcons()
	if (!useIcon || !ready)
		return { applied: false, reason: 'icon generation disabled' }

	const scheme = /^localhost|^127\.|^10\.0\.2\.2/.test(config.appUrl)
		? 'http'
		: 'https'
	const source =
		iconSource ??
		(organization?.siteIcon?.original
			? `${scheme}://${config.appUrl}${organization.siteIcon.original}`
			: null)

	if (!source) {
		return {
			applied: false,
			reason: 'no site icon published; keeping the committed placeholder',
		}
	}

	const isRemote = /^https?:/.test(source)
	let localPath = source
	if (isRemote) {
		let response
		try {
			response = await fetch(source, { signal: AbortSignal.timeout(15_000) })
		} catch (error) {
			return {
				applied: false,
				reason: `icon download failed (${error.message})`,
			}
		}
		if (!response.ok) {
			return {
				applied: false,
				reason: `icon download failed (${response.status})`,
			}
		}
		localPath = join(APP_ROOT, 'app/build/icon-source')
		mkdirSync(dirname(localPath), { recursive: true })
		writeFileSync(localPath, Buffer.from(await response.arrayBuffer()))
	} else if (!existsSync(localPath)) {
		return { applied: false, reason: `icon source not found: ${localPath}` }
	}

	try {
		for (const { dir, size } of FOREGROUND_DENSITIES) {
			composeForeground(
				localPath,
				join(RES_ROOT, dir, 'ic_launcher_foreground.png'),
				size,
			)
		}
	} catch (error) {
		return { applied: false, reason: `icon resize failed (${error.message})` }
	}

	writeBackground(
		typeof config.iconBackground === 'string' &&
			config.iconBackground.trim() !== ''
			? config.iconBackground.trim()
			: DEFAULT_BACKGROUND,
	)
	return { applied: true, reason: `icon from ${isRemote ? source : localPath}` }
}

/** Java `.properties` values only need backslashes escaped. */
function escapeProperty(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

function writeTenantProperties({ config, file, buildNumber, out }) {
	const site = config.site ?? {}
	const useTls =
		typeof config.useTls === 'boolean'
			? config.useTls
			: !/^localhost|^127\.|^10\.0\.2\.2/.test(config.appUrl)
	const entries = [
		['applicationId', config.bundleId],
		['appName', config.displayName],
		['versionName', config.marketingVersion ?? '1.0.0'],
		['versionCode', buildNumber],
		['useTls', useTls ? 'true' : 'false'],
		['appBaseUrl', config.appUrl],
		['brandDomain', config.brandDomain ?? 'epic-startup.com'],
		['tenantApiUs', config.tenantApiUs],
		['tenantApiKsa', config.tenantApiKsa ?? ''],
		['siteSlug', site.host ? '' : (site.slug ?? '')],
		['siteHost', site.host ?? ''],
		['siteOrigin', site.origin ?? ''],
		['iconBackground', config.iconBackground ?? DEFAULT_BACKGROUND],
	]

	const lines = [
		`# Generated from apps/android/tenants/${file} — do not edit by hand.`,
		`# Regenerate with: npm run android:tenant -w android -- --tenant ${config.slug}`,
		'',
		...entries.map(([key, value]) => `${key}=${escapeProperty(value ?? '')}`),
		'',
	]

	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, lines.join('\n'))
	return out
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const slug = args.tenant ?? process.env.TENANT_SLUG
	if (!slug) fail('Pass --tenant <slug> (or set TENANT_SLUG)')

	const { config, file } = loadTenant(slug)
	requireString(config, 'displayName', file)
	requireString(config, 'bundleId', file)
	requireString(config, 'appUrl', file)
	requireString(config, 'tenantApiUs', file)
	if (!config.site?.slug && !config.site?.host) {
		fail(
			`tenants/${file} needs site.slug or site.host — a published app must be bound to one tenant`,
		)
	}

	const buildNumber = String(
		args['build-number'] ?? process.env.GITHUB_RUN_NUMBER ?? '1',
	)
	const out = resolve(args.out ?? join(APP_ROOT, 'app/tenant.properties'))

	const organization = await fetchOrganization(config, {
		useApi: !args.flags.has('no-api'),
	})
	if (organization?.name && organization.name !== config.displayName) {
		log(
			`Note: the published site is named "${organization.name}" but tenants/${file} says "${config.displayName}" — the store name comes from the config, the in-app name from the API.`,
		)
	}

	const icon = await resolveIcon(config, organization, {
		iconSource: args['icon-source'],
		useIcon: !args.flags.has('no-icon'),
	})
	const properties = writeTenantProperties({ config, file, buildNumber, out })

	console.log('')
	console.log(`✓ ${config.displayName} (${config.slug})`)
	console.log(`  application id ${config.bundleId}`)
	console.log(
		`  version        ${config.marketingVersion ?? '1.0.0'} (${buildNumber})`,
	)
	console.log(
		`  site           ${config.site.origin ?? config.site.host ?? config.site.slug}`,
	)
	console.log(`  properties     ${properties}`)
	console.log(
		`  app icon       ${icon.applied ? icon.reason : `placeholder (${icon.reason})`}`,
	)
}

main().catch((error) => {
	fail(error.stack ?? error.message)
})
