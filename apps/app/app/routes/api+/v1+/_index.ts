import { type LoaderFunctionArgs } from 'react-router'

/**
 * API v1 root endpoint
 * GET /api/v1
 *
 * Returns versioned API information for mobile clients.
 */
export async function loader({ request: _request }: LoaderFunctionArgs) {
	return Response.json(
		{
			version: '1.0.0',
			name: 'Menuza API',
			description: 'Menuza restaurant management platform API',
			endpoints: {
				health: '/api/v1/health',
				auth: '/api/v1/auth',
				menus: '/api/v1/menus',
				orders: '/api/v1/orders',
				restaurants: '/api/v1/restaurants',
			},
		},
		{
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=3600',
			},
		},
	)
}
