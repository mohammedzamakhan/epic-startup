import { createHealthResponse } from '@repo/common/health'
import { type LoaderFunctionArgs } from 'react-router'

/**
 * API v1 health check endpoint
 * GET /api/v1/health
 *
 * Returns health status for mobile client monitoring.
 */
export async function loader({ request: _request }: LoaderFunctionArgs) {
	return createHealthResponse('app-v1')
}
