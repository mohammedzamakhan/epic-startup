import { db, eq, Organization } from '@repo/database'
import type * as paymentsModule from '@repo/payments'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertTestMember, insertTestUser } from '#tests/dashboard-utils.ts'
import { createTestOrganization } from '#tests/test-utils.ts'

/** Stripe's subscriptions as far as seat counts go. */
const stripeState = vi.hoisted(() => ({
	subscriptions: new Map<string, { status: string; quantity: number }>(),
	failRetrieve: new Set<string>(),
}))

vi.mock('@repo/payments', async (importOriginal) => {
	const actual = await importOriginal<typeof paymentsModule>()
	const retrieve = async (id: string) => {
		const sub = stripeState.subscriptions.get(id)
		if (!sub || stripeState.failRetrieve.has(id)) {
			throw new Error(`No such subscription: ${id}`)
		}
		return {
			id,
			status: sub.status,
			customerId: 'cus',
			productId: 'prod',
			priceId: 'price_seat',
			trialEnd: null,
			quantity: sub.quantity,
			items: [{ id: 'si_1', priceId: 'price_seat', quantity: sub.quantity }],
		}
	}
	return {
		...actual,
		createStripeProvider: () => ({
			getClient: () => ({}),
			retrieveSubscription: retrieve,
			updateSubscription: async (options: {
				subscriptionId: string
				quantity: number
			}) => {
				stripeState.subscriptions.get(options.subscriptionId)!.quantity =
					options.quantity
				return retrieve(options.subscriptionId)
			},
		}),
	}
})

const { reconcileSeatQuantities } = await import('./payments.server.ts')

describe('daily seat reconcile', () => {
	beforeEach(() => {
		stripeState.subscriptions.clear()
		stripeState.failRetrieve.clear()
	})

	async function subscribedOrg(subscriptionId: string, quantity: number) {
		const owner = await insertTestUser()
		const organization = await createTestOrganization(owner.id, 'admin')
		await db
			.update(Organization)
			.set({
				stripeSubscriptionId: subscriptionId,
				subscriptionStatus: 'active',
			})
			.where(eq(Organization.id, organization.id))
		stripeState.subscriptions.set(subscriptionId, {
			status: 'active',
			quantity,
		})
		return organization
	}

	it('corrects a seat count left wrong by a failed Stripe write, and one failure does not stop the rest', async () => {
		// Two members, but the Stripe write after the second one joined failed.
		const drifted = await subscribedOrg('sub_seats_drift', 1)
		await insertTestMember(drifted.id)
		const broken = await subscribedOrg('sub_seats_broken', 1)
		stripeState.failRetrieve.add('sub_seats_broken')
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		const result = await reconcileSeatQuantities()
		const errors = errorSpy.mock.calls
		errorSpy.mockRestore()

		expect(stripeState.subscriptions.get('sub_seats_drift')?.quantity).toBe(2)
		expect(result).toMatchObject({ updated: 1, failed: 1 })
		expect(errors).toContainEqual([
			expect.stringContaining(broken.id),
			expect.any(Error),
		])
	})
})
