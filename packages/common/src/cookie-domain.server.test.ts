import { describe, expect, it } from 'vitest'

import { getBrandDomain } from '@repo/config/brand'

import {
	isStagingOperatorHost,
	operatorCookieName,
	operatorThemeCookieName,
	sharedCookieDomain,
	sharedCookieDomainFromHost,
} from './cookie-domain.server.ts'

describe('sharedCookieDomainFromHost', () => {
	it('strips the app/admin label from a two-label apex', () => {
		expect(sharedCookieDomainFromHost('app.menuza.dev')).toBe(
			'.menuza.dev',
		)
		expect(sharedCookieDomainFromHost('app.preview.example.dev:2999')).toBe(
			'.preview.example.dev',
		)
		expect(sharedCookieDomainFromHost(`admin.${getBrandDomain()}`)).toBe(
			`.${getBrandDomain()}`,
		)
	})

	it('shares cookies across flat staging operator hosts on the production apex', () => {
		expect(sharedCookieDomainFromHost('app-staging.lighteninggroup.com')).toBe(
			'.lighteninggroup.com',
		)
		expect(
			sharedCookieDomainFromHost('admin-staging.lighteninggroup.com'),
		).toBe('.lighteninggroup.com')
	})

	it('omits domain on localhost and opaque Workers hosts', () => {
		expect(sharedCookieDomainFromHost('localhost:3001')).toBeUndefined()
		expect(sharedCookieDomainFromHost('127.0.0.1')).toBeUndefined()
		expect(
			sharedCookieDomainFromHost('example-app.example.workers.dev'),
		).toBeUndefined()
	})

	it('shares cookies across *.localhost subdomains', () => {
		expect(sharedCookieDomainFromHost('app.localhost:3001')).toBe('.localhost')
	})
})

describe('operatorCookieName', () => {
	it('suffixes cookie names for flat staging operator origins', () => {
		expect(
			operatorCookieName('en_session', 'https://app-staging.example.com'),
		).toBe('en_session_staging')
		expect(
			operatorCookieName('en_theme', 'https://admin-staging.example.com'),
		).toBe('en_theme_staging')
		expect(operatorCookieName('en_session', 'https://app.example.com')).toBe(
			'en_session',
		)
	})

	it('derives the theme cookie name from the operator app URL', () => {
		expect(operatorThemeCookieName('https://app-staging.example.com')).toBe(
			'en_theme_staging',
		)
		expect(operatorThemeCookieName('https://app.example.com')).toBe('en_theme')
	})
})

describe('isStagingOperatorHost', () => {
	it('detects flat staging operator hosts', () => {
		expect(isStagingOperatorHost('app-staging.example.com')).toBe(true)
		expect(isStagingOperatorHost('admin-staging.example.com')).toBe(true)
		expect(isStagingOperatorHost('app.example.com')).toBe(false)
	})
})

describe('sharedCookieDomain', () => {
	it('reads the apex from BASE_URL', () => {
		expect(sharedCookieDomain('https://app.menuza.dev')).toBe(
			'.menuza.dev',
		)
		expect(sharedCookieDomain('https://app-staging.lighteninggroup.com')).toBe(
			'.lighteninggroup.com',
		)
		expect(sharedCookieDomain('http://localhost:3001')).toBeUndefined()
	})
})
