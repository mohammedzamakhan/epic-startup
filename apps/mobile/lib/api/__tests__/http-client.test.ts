import { type HttpClient, createHttpClient } from '../http-client'

// Mock fetch globally
global.fetch = jest.fn()

// Mock setTimeout and clearTimeout
// @ts-ignore
global.setTimeout = jest.fn((callback) => {
	if (typeof callback === 'function') {
		callback()
	}
	return 1 as unknown as NodeJS.Timeout
})
global.clearTimeout = jest.fn()

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>

describe('HttpClient', () => {
	let client: HttpClient

	beforeEach(() => {
		client = createHttpClient({
			baseUrl: 'https://api.example.com',
			timeout: 5000,
			retryAttempts: 2,
		})
		mockFetch.mockClear()
		jest.clearAllMocks()
	})

	describe('constructor and configuration', () => {
		it('should create client with default configuration', () => {
			const defaultClient = createHttpClient({
				baseUrl: 'https://api.example.com',
			})

			const config = defaultClient.getConfig()
			expect(config.baseUrl).toBe('https://api.example.com')
			expect(config.timeout).toBe(10000)
			expect(config.retryAttempts).toBe(3)
			expect(config.defaultHeaders).toEqual({
				'Content-Type': 'application/json',
			})
		})

		it('should remove trailing slash from baseUrl', () => {
			const clientWithSlash = createHttpClient({
				baseUrl: 'https://api.example.com/',
			})

			const config = clientWithSlash.getConfig()
			expect(config.baseUrl).toBe('https://api.example.com')
		})

		it('should merge custom headers with defaults', () => {
			const clientWithHeaders = createHttpClient({
				baseUrl: 'https://api.example.com',
				defaultHeaders: {
					Authorization: 'Bearer token',
					'X-Custom': 'value',
				},
			})

			const config = clientWithHeaders.getConfig()
			expect(config.defaultHeaders).toEqual({
				'Content-Type': 'application/json',
				Authorization: 'Bearer token',
				'X-Custom': 'value',
			})
		})
	})

	describe('successful requests', () => {
		it('should make successful GET request', async () => {
			const mockResponse = { data: 'test' }
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue(mockResponse),
			} as unknown as Response)

			const result = await client.get('/test')

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/test',
				expect.objectContaining({
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
					},
				}),
			)
			expect(result).toEqual({
				success: true,
				data: mockResponse,
				status: 200,
			})
		})

		it('should make successful POST request with data', async () => {
			const requestData = { username: 'test', password: 'password' }
			const mockResponse = { success: true }

			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 201,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue(mockResponse),
			} as unknown as Response)

			const result = await client.post('/auth/login', requestData)

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/auth/login',
				expect.objectContaining({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(requestData),
				}),
			)
			expect(result).toEqual({
				success: true,
				data: mockResponse,
				status: 201,
			})
		})

		it('should handle text responses', async () => {
			const textResponse = 'Plain text response'

			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'text/plain' }),
				text: jest.fn().mockResolvedValue(textResponse),
			} as unknown as Response)

			const result = await client.get('/text')

			expect(result).toEqual({
				success: true,
				data: textResponse,
				status: 200,
			})
		})
	})

	describe('error handling', () => {
		it('should handle 400 validation errors', async () => {
			const errorResponse = {
				error: 'validation_error',
				errors: [
					{ field: 'username', message: 'Username is required' },
					{ field: 'password', message: 'Password is too short' },
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue(errorResponse),
			} as unknown as Response)

			const result = await client.post('/auth/login', {})

			expect(result).toEqual({
				success: false,
				error: 'validation_error',
				message: 'Validation failed',
				data: errorResponse.errors,
				status: 400,
			})
		})

		it('should handle 401 authentication errors', async () => {
			const errorResponse = {
				error: 'authentication_failed',
				message: 'Invalid credentials',
			}

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue(errorResponse),
			} as unknown as Response)

			const result = await client.post('/auth/login', {})

			expect(result).toEqual({
				success: false,
				error: 'authentication_failed',
				message: 'Invalid credentials',
				status: 401,
			})
		})

		it('should handle 429 rate limiting', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				statusText: 'Too Many Requests',
				headers: new Headers(),
				json: jest.fn().mockResolvedValue({}),
			} as unknown as Response)

			const result = await client.post('/auth/login', {})

			expect(result).toEqual({
				success: false,
				error: 'rate_limit_exceeded',
				message: 'Too many requests. Please try again later.',
				status: 429,
			})
		})

		it('should handle 403 bot detection', async () => {
			const errorResponse = {
				error: 'bot_detected',
				message: 'Request blocked due to bot detection',
			}

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue(errorResponse),
			} as unknown as Response)

			const result = await client.post('/auth/login', {})

			expect(result).toEqual({
				success: false,
				error: 'bot_detected',
				message: 'Request blocked due to bot detection',
				status: 403,
			})
		})

		it('should handle network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'))

			const result = await client.get('/test')

			expect(result.success).toBe(false)
			expect(result.status).toBe(0)
			// The error type should be 'unknown' for generic errors
			expect(['unknown', 'network']).toContain(result.error)
		})

		it('should handle timeout errors', async () => {
			const abortError = new Error('The operation was aborted')
			abortError.name = 'AbortError'
			mockFetch.mockRejectedValueOnce(abortError)

			const result = await client.get('/test')

			expect(result).toEqual({
				success: false,
				error: 'timeout',
				message:
					'Request timed out. Please check your connection and try again.',
				status: 0,
			})
		})
	})

	describe('retry logic', () => {
		it('should retry on network errors', async () => {
			// First two calls fail, third succeeds
			mockFetch
				.mockRejectedValueOnce(new Error('Network error'))
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: jest.fn().mockResolvedValue({ success: true }),
				} as unknown as Response)

			const result = await client.get('/test')

			expect(mockFetch).toHaveBeenCalledTimes(3)
			expect(result).toEqual({
				success: true,
				data: { success: true },
				status: 200,
			})
		})

		it('should not retry on abort errors', async () => {
			const abortError = new Error('The operation was aborted')
			abortError.name = 'AbortError'
			mockFetch.mockRejectedValueOnce(abortError)

			const result = await client.get('/test')

			expect(mockFetch).toHaveBeenCalledTimes(1)
			expect(result.success).toBe(false)
			expect(result.error).toBe('timeout')
		})

		it('should not retry on syntax errors', async () => {
			mockFetch.mockRejectedValueOnce(new SyntaxError('Invalid JSON'))

			const result = await client.get('/test')

			expect(mockFetch).toHaveBeenCalledTimes(1)
			expect(result.success).toBe(false)
		})

		it('should exhaust all retry attempts', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'))

			const result = await client.get('/test')

			// Initial attempt + 2 retries = 3 total calls
			expect(mockFetch).toHaveBeenCalledTimes(3)
			expect(result.success).toBe(false)
		})
	})

	describe('header management', () => {
		it('should set default headers', () => {
			client.setDefaultHeader('Authorization', 'Bearer token')

			const config = client.getConfig()
			expect(config.defaultHeaders?.['Authorization']).toBe('Bearer token')
		})

		it('should remove default headers', () => {
			client.setDefaultHeader('Authorization', 'Bearer token')
			client.removeDefaultHeader('Authorization')

			const config = client.getConfig()
			expect(config.defaultHeaders?.['Authorization']).toBeUndefined()
		})

		it('should merge request headers with defaults', async () => {
			client.setDefaultHeader('Authorization', 'Bearer token')

			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue({}),
			} as unknown as Response)

			await client.get('/test', {
				headers: { 'X-Custom': 'value' },
			})

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/test',
				expect.objectContaining({
					headers: {
						'Content-Type': 'application/json',
						Authorization: 'Bearer token',
						'X-Custom': 'value',
					},
				}),
			)
		})
	})

	describe('HTTP methods', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue({}),
			} as unknown as Response)
		})

		it('should make PUT request', async () => {
			const data = { name: 'Updated' }
			await client.put('/users/1', data)

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/users/1',
				expect.objectContaining({
					method: 'PUT',
					body: JSON.stringify(data),
				}),
			)
		})

		it('should not copy the default Authorization into a form post', async () => {
			client.setDefaultHeader('Authorization', 'Bearer old')
			const request = jest.spyOn(client, 'request')

			await client.postForm('/organizations/default', { id: 'org_1' })

			// A per-request copy would override a token refreshed before the
			// request (or its 401 retry) is sent.
			const passed = request.mock.calls[0]?.[1]?.headers ?? {}
			expect(passed).not.toHaveProperty('Authorization')
			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/organizations/default',
				expect.objectContaining({
					method: 'POST',
					body: 'id=org_1',
					headers: expect.objectContaining({
						Authorization: 'Bearer old',
						'Content-Type': 'application/x-www-form-urlencoded',
					}),
				}),
			)
		})

		it('should send the current token when a form post is retried', async () => {
			client.setDefaultHeader('Authorization', 'Bearer old')
			const request = jest.spyOn(client, 'request')
			await client.postForm('/organizations/default', { id: 'org_1' })

			// What JwtHttpClient does after a refresh: same options, new default.
			client.setDefaultHeader('Authorization', 'Bearer new')
			const [endpoint, options] = request.mock.calls[0]!
			await client.request(endpoint, options)

			expect(mockFetch).toHaveBeenLastCalledWith(
				'https://api.example.com/organizations/default',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer new',
						'Content-Type': 'application/x-www-form-urlencoded',
					}),
				}),
			)
		})

		it('should make DELETE request', async () => {
			await client.delete('/users/1')

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/users/1',
				expect.objectContaining({
					method: 'DELETE',
				}),
			)
		})
	})

	describe('URL building', () => {
		it('should handle endpoints with leading slash', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue({}),
			} as unknown as Response)

			await client.get('/api/test')

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/api/test',
				expect.any(Object),
			)
		})

		it('should handle endpoints without leading slash', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: jest.fn().mockResolvedValue({}),
			} as unknown as Response)

			await client.get('api/test')

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/api/test',
				expect.any(Object),
			)
		})
	})
})
