import { type LoaderFunctionArgs } from 'react-router'

/**
 * API v1 menus endpoint
 * GET /api/v1/menus
 *
 * Returns list of restaurant menus for mobile clients.
 */
export async function loader({ request: _request }: LoaderFunctionArgs) {
	// TODO: Implement menu listing logic
	// This is a placeholder for WO-1 scope

	return Response.json(
		{
			menus: [],
			message: 'Menu API endpoint not yet implemented',
			note: 'This endpoint is part of the Menuza v1 API scaffold. Menu management logic will be implemented in a future work order.',
		},
		{
			status: 501, // Not Implemented
			headers: {
				'Content-Type': 'application/json',
			},
		},
	)
}
