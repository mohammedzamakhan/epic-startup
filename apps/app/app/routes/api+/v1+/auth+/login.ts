import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'

const LoginSchema = z.object({
	email: z.string().email('Invalid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
})

/**
 * API v1 login endpoint
 * POST /api/v1/auth/login
 *
 * Authenticates a user and returns a JWT token for mobile clients.
 */
export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== 'POST') {
		return Response.json(
			{ error: 'Method not allowed' },
			{ status: 405, headers: { Allow: 'POST' } },
		)
	}

	try {
		const body = await request.json()
		const { email, password } = LoginSchema.parse(body)

		// TODO: Implement actual authentication logic
		// This is a placeholder for WO-1 scope

		return Response.json(
			{
				success: false,
				error: 'Authentication endpoint not yet implemented',
				message:
					'This endpoint is part of the Menuza v1 API scaffold. Authentication logic will be implemented in a future work order.',
			},
			{
				status: 501, // Not Implemented
				headers: { 'Content-Type': 'application/json' },
			},
		)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return Response.json(
				{
					success: false,
					error: 'Validation error',
					details: error.errors,
				},
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			)
		}

		return Response.json(
			{
				success: false,
				error: 'Internal server error',
			},
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		)
	}
}
