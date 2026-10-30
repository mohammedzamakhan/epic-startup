import { type FeatureContext } from '../state/app-store'

/**
 * The signed-in customer's features; recreated per organization and session.
 * The template ships none. A feature is a store with `reset()` (and optionally
 * `dispose()`) built from the context's customer session: add it here, read it
 * with a hook in `use-app.ts`, and give it a tab in `app/(tabs)`.
 */
export type AppFeatures = { readonly [name: string]: never }

export function createCustomerFeatures(
	ignoredContext: FeatureContext,
): AppFeatures {
	return {}
}
