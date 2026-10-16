/** Strip Stripe secret key material from error strings before they reach clients. */
export function sanitizeStripeErrorMessage(message: string): string {
	return message.replace(
		/sk_(?:live|test)_[A-Za-z0-9]+/g,
		'[STRIPE_KEY_REDACTED]',
	)
}

export function toPublicStripeError(error: unknown, fallback: string): Error {
	const raw =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: fallback
	return new Error(sanitizeStripeErrorMessage(raw) || fallback)
}
