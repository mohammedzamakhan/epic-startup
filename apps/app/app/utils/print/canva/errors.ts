/** Errors of the Canva client, by what the Print shop does about them. */
export type CanvaErrorCode =
	| 'unauthorized'
	| 'not_found'
	| 'license_required'
	| 'rate_limited'
	| 'too_large'
	| 'unavailable'
	| 'failed'

export class CanvaError extends Error {
	constructor(
		readonly code: CanvaErrorCode,
		message: string,
		readonly status?: number,
	) {
		super(message)
		this.name = 'CanvaError'
	}
}
