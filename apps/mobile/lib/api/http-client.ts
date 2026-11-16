import {
	type ApiResponse,
	type NetworkError,
	type RequestConfig,
} from '@repo/types'

interface HttpErrorData {
	error?: string
	message?: string
	errors?: unknown
	[key: string]: unknown
}

export interface HttpClientConfig {
	baseUrl: string
	timeout?: number
	retryAttempts?: number
	defaultHeaders?: Record<string, string>
}

export interface RetryConfig {
	attempts: number
	delay: number
	backoffMultiplier: number
	maxDelay: number
}

export class HttpClient {
	private config: Required<HttpClientConfig>
	private retryConfig: RetryConfig

	constructor(config: HttpClientConfig) {
		this.config = {
			baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
			timeout: config.timeout ?? 10000, // 10 seconds default
			retryAttempts: config.retryAttempts ?? 3,
			defaultHeaders: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				...config.defaultHeaders,
			},
		}

		this.retryConfig = {
			attempts: this.config.retryAttempts,
			delay: 1000, // 1 second initial delay
			backoffMultiplier: 2,
			maxDelay: 10000, // 10 seconds max delay
		}
	}

	/**
	 * Makes an HTTP request with timeout, retry logic, and error handling
	 */
	async request<T = unknown>(
		endpoint: string,
		config: RequestConfig = {},
	): Promise<ApiResponse<T>> {
		const url = this.buildUrl(endpoint)
		const requestConfig = this.buildRequestConfig(config)

		let lastError: Error | null = null

		for (let attempt = 0; attempt <= this.retryConfig.attempts; attempt++) {
			try {
				const controller = new AbortController()
				const timeoutId = setTimeout(
					() => controller.abort(),
					this.config.timeout,
				)

				const attemptStart = Date.now()
				const response = await fetch(url, {
					...requestConfig,
					signal: controller.signal,
				})
				const attemptDuration = Date.now() - attemptStart

				clearTimeout(timeoutId)

				if (__DEV__) {
					console.log(
						`[HTTP] ${config.method || 'GET'} ${endpoint} - ${response.status} (${attemptDuration}ms)`,
					)
				}

				// Handle HTTP error responses
				if (!response.ok) {
					return this.handleHttpError(response)
				}

				// Parse successful response
				const data = await this.parseResponse<T>(response)
				return {
					success: true,
					status: response.status,
					...data,
				}
			} catch (error) {
				lastError = error as Error

				// Don't retry on certain errors
				if (!this.shouldRetry(error as Error, attempt)) {
					break
				}

				// Wait before retrying (except on last attempt)
				if (attempt < this.retryConfig.attempts) {
					await this.delay(this.calculateRetryDelay(attempt))
				}
			}
		}

		// All retries failed, return error response
		return this.handleNetworkError(lastError!)
	}

	/**
	 * GET request
	 */
	async get<T = unknown>(
		endpoint: string,
		config?: RequestConfig,
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...config, method: 'GET' })
	}

	/**
	 * POST request
	 */
	async post<T = unknown>(
		endpoint: string,
		data?: unknown,
		config?: RequestConfig,
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, {
			...config,
			method: 'POST',
			body: data ? JSON.stringify(data) : undefined,
		})
	}

	/**
	 * POST request with form data (URL-encoded)
	 */
	async postForm<T = unknown>(
		endpoint: string,
		data?: object,
		config?: RequestConfig,
	): Promise<ApiResponse<T>> {
		const params = new URLSearchParams()

		if (data) {
			Object.entries(data).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					// Handle boolean values properly for form data (like HTML checkboxes)
					if (typeof value === 'boolean') {
						// Only append if true (like HTML checkboxes - unchecked boxes don't send data)
						if (value) {
							params.append(key, 'on')
						}
					} else {
						params.append(key, String(value))
					}
				}
			})
		}

		// Only what differs from the defaults. The defaults (including
		// `Authorization`) are merged when the request is sent, so a token
		// refreshed in between is not overridden by a stale copy.
		const headers = {
			...config?.headers,
			'Content-Type': 'application/x-www-form-urlencoded',
		}

		return this.request<T>(endpoint, {
			...config,
			method: 'POST',
			headers,
			body: params.toString(),
		})
	}

	/**
	 * PUT request
	 */
	async put<T = unknown>(
		endpoint: string,
		data?: unknown,
		config?: RequestConfig,
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, {
			...config,
			method: 'PUT',
			body: data ? JSON.stringify(data) : undefined,
		})
	}

	/**
	 * DELETE request
	 */
	async delete<T = unknown>(
		endpoint: string,
		config?: RequestConfig,
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...config, method: 'DELETE' })
	}

	/**
	 * Builds the full URL for the request
	 */
	private buildUrl(endpoint: string): string {
		const cleanEndpoint = endpoint.startsWith('/')
			? endpoint.slice(1)
			: endpoint
		return `${this.config.baseUrl}/${cleanEndpoint}`
	}

	/**
	 * Builds the request configuration
	 */
	private buildRequestConfig(config: RequestConfig): RequestInit {
		const headers = {
			...this.config.defaultHeaders,
			...config.headers,
		}

		return {
			method: config.method ?? 'GET',
			headers,
			body: config.body,
		}
	}

	/**
	 * Parses the response based on content type
	 */
	private async parseResponse<T>(response: Response): Promise<T> {
		const contentType = response.headers.get('content-type')

		if (contentType?.includes('application/json')) {
			return response.json()
		}

		if (contentType?.includes('text/')) {
			return response.text() as T
		}

		// For other content types, return the response as is
		return response as T
	}

	/**
	 * Handles HTTP error responses (4xx, 5xx)
	 */
	private async handleHttpError<T>(
		response: Response,
	): Promise<ApiResponse<T>> {
		let errorData: HttpErrorData | null = null

		try {
			const contentType = response.headers.get('content-type')
			if (contentType?.includes('application/json')) {
				errorData = (await response.json()) as HttpErrorData
			} else {
				errorData = { message: await response.text() }
			}
		} catch {
			errorData = { message: response.statusText || 'Unknown error' }
		}

		// Handle specific error types
		if (response.status === 429) {
			return {
				success: false,
				error: 'rate_limit_exceeded',
				message: 'Too many requests. Please try again later.',
				status: response.status,
			}
		}

		if (response.status === 403 && errorData?.error === 'bot_detected') {
			return {
				success: false,
				error: 'bot_detected',
				message: 'Request blocked due to bot detection',
				status: response.status,
			}
		}

		if (response.status === 400 && errorData?.errors) {
			return {
				success: false,
				error: 'validation_error',
				message: 'Validation failed',
				status: response.status,
			}
		}

		return {
			success: false,
			error: errorData?.error || 'http_error',
			message: errorData?.message || response.statusText || 'Request failed',
			status: response.status,
		}
	}

	/**
	 * Handles network errors (timeout, connection issues, etc.)
	 */
	private handleNetworkError<T>(error: Error): ApiResponse<T> {
		const networkError: NetworkError = this.categorizeNetworkError(error)

		return {
			success: false,
			error: networkError.type,
			message: networkError.message,
			status: 0, // Network errors don't have HTTP status codes
		}
	}

	/**
	 * Categorizes network errors for better error handling
	 */
	private categorizeNetworkError(error: Error): NetworkError {
		if (error.name === 'AbortError') {
			return {
				type: 'timeout',
				message:
					'Request timed out. Please check your connection and try again.',
				originalError: error,
			}
		}

		if (error.message.includes('fetch')) {
			return {
				type: 'network',
				message: 'Network error. Please check your internet connection.',
				originalError: error,
			}
		}

		return {
			type: 'unknown',
			message: error.message || 'An unexpected error occurred',
			originalError: error,
		}
	}

	/**
	 * Determines if a request should be retried based on the error
	 */
	private shouldRetry(error: Error, attempt: number): boolean {
		// Don't retry if we've reached max attempts
		if (attempt >= this.retryConfig.attempts) {
			return false
		}

		// Don't retry on abort errors (user cancelled or timeout)
		if (error.name === 'AbortError') {
			return false
		}

		// Don't retry on syntax errors (malformed JSON, etc.)
		if (error instanceof SyntaxError) {
			return false
		}

		// Retry on network errors
		return true
	}

	/**
	 * Calculates the delay for retry attempts with exponential backoff
	 */
	private calculateRetryDelay(attempt: number): number {
		const delay =
			this.retryConfig.delay *
			Math.pow(this.retryConfig.backoffMultiplier, attempt)
		return Math.min(delay, this.retryConfig.maxDelay)
	}

	/**
	 * Utility function to create a delay
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Updates the default headers (useful for adding auth tokens)
	 */
	setDefaultHeader(key: string, value: string): void {
		this.config.defaultHeaders[key] = value
	}

	/**
	 * Removes a default header
	 */
	removeDefaultHeader(key: string): void {
		delete this.config.defaultHeaders[key]
	}

	/**
	 * Gets the current configuration
	 */
	getConfig(): HttpClientConfig {
		return { ...this.config }
	}
}

/**
 * Creates a new HTTP client instance
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
	return new HttpClient(config)
}
