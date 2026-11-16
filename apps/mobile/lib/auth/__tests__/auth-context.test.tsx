import { act, renderHook, waitFor } from '@testing-library/react-native'
import React, { useContext, type ReactNode } from 'react'
import { AuthContext, AuthProvider } from '../auth-context'

const mockApi = {
	signup: jest.fn(),
	verify: jest.fn(),
	onboarding: jest.fn(),
	socialCallback: jest.fn(),
	setAuthToken: jest.fn(),
	clearAuthToken: jest.fn(),
	refreshSession: jest.fn(),
	logout: jest.fn(),
}
jest.mock('../../api', () => ({
	get jwtAuthApi() {
		return mockApi
	},
}))
jest.mock('../../api/session-refresh', () => ({ endsSession: () => false }))

const mockTokenManager = {
	getCurrentTokens: jest.fn(async () => null),
	getCurrentUser: jest.fn(async () => null),
	validateTokens: jest.fn(async () => ({ isValid: false, tokens: null })),
	storeTokens: jest.fn(async () => {}),
	storeUser: jest.fn(async () => {}),
	clearTokens: jest.fn(async () => {}),
	clearAll: jest.fn(async () => {}),
}
jest.mock('../../storage/session-manager', () => ({
	TokenManager: { getInstance: () => mockTokenManager },
}))

const wrapper = ({ children }: { children: ReactNode }) => (
	<AuthProvider>{children}</AuthProvider>
)

async function renderAuth() {
	const hook = renderHook(() => useContext(AuthContext)!, { wrapper })
	await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
	return hook
}

const session = {
	user: {
		id: 'user_1',
		email: 'ada@example.com',
		username: 'ada',
		name: 'Ada',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	},
	accessToken: 'access',
	refreshToken: 'refresh',
	expiresIn: 900,
	expiresAt: '2026-01-01T00:15:00.000Z',
}

const onboardingInput = {
	username: 'ada',
	name: 'Ada',
	password: 'password-123',
	confirmPassword: 'password-123',
	agreeToTermsOfServiceAndPrivacyPolicy: true,
}
const verifyInput = { code: '123456', type: 'onboarding', target: 'a@b.co' }

type Auth = NonNullable<React.ContextType<typeof AuthContext>>

const flows: Array<{
	name: string
	api: jest.Mock
	success: unknown
	run: (auth: Auth) => Promise<void>
}> = [
	{
		name: 'signup',
		api: mockApi.signup,
		success: { success: true },
		run: (auth) => auth.signup('a@b.co'),
	},
	{
		name: 'verify',
		api: mockApi.verify,
		success: { success: true },
		run: (auth) => auth.verify(verifyInput),
	},
	{
		name: 'onboarding',
		api: mockApi.onboarding,
		success: { success: true, data: session },
		run: (auth) => auth.onboarding(onboardingInput),
	},
	{
		name: 'socialLogin',
		api: mockApi.socialCallback,
		success: { success: true, data: session },
		run: (auth) => auth.socialLogin('github', 'code', 'state'),
	},
]

describe('AuthProvider failure signalling', () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe.each(flows)('$name', ({ api, success, run }) => {
		it('rejects with the API error and records it', async () => {
			api.mockResolvedValue({ success: false, error: 'Nope' })
			const { result } = await renderAuth()

			let failure: unknown
			await act(async () => {
				failure = await run(result.current).catch((error: unknown) => error)
			})

			expect(failure).toEqual(new Error('Nope'))
			expect(result.current.error).toBe('Nope')
			expect(result.current.isAuthenticated).toBe(false)
		})

		it('rejects when the request throws', async () => {
			api.mockRejectedValue(new Error('Network down'))
			const { result } = await renderAuth()

			let failure: unknown
			await act(async () => {
				failure = await run(result.current).catch((error: unknown) => error)
			})

			expect(failure).toEqual(new Error('Network down'))
			expect(result.current.error).toBe('Network down')
		})

		it('resolves on success', async () => {
			api.mockResolvedValue(success)
			const { result } = await renderAuth()

			await act(async () => {
				await run(result.current)
			})

			expect(result.current.error).toBeNull()
		})
	})

	it('rejects a social login that has no authorization code', async () => {
		const { result } = await renderAuth()

		let failure: unknown
		await act(async () => {
			failure = await result.current
				.socialLogin('github')
				.catch((error: unknown) => error)
		})

		expect(failure).toEqual(new Error('OAuth authorization code is required'))
		expect(mockApi.socialCallback).not.toHaveBeenCalled()
	})
})
