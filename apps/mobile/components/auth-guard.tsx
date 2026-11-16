import {
	useRouter,
	useSegments,
	useRootNavigationState,
	useLocalSearchParams,
	type Href,
} from 'expo-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/hooks/use-auth'

/**
 * AuthGuard component that handles protected route logic and authentication-based navigation
 * This component runs after the layout is mounted and handles redirects based on auth state
 */
export function AuthGuard() {
	const { isAuthenticated, isLoading } = useAuth()
	const router = useRouter()
	const segments = useSegments()
	const navigationState = useRootNavigationState()
	const params = useLocalSearchParams()
	const [isNavigationReady, setIsNavigationReady] = useState(false)

	// Wait for navigation to be ready
	useEffect(() => {
		if (navigationState?.key) {
			// Add a small delay to ensure navigation is fully mounted
			const timer = setTimeout(() => {
				setIsNavigationReady(true)
			}, 100)

			return () => clearTimeout(timer)
		}
	}, [navigationState?.key])

	useEffect(() => {
		// Don't redirect while still loading or navigation not ready
		if (isLoading || !isNavigationReady) return

		const inAuthGroup = segments[0] === '(auth)'
		const inDashboardGroup = segments[0] === '(dashboard)'
		const inOAuthCallback = segments[0] === 'auth'
		// A single top-level screen such as the root `index`. Every screen in the
		// `(dashboard)` group has `(dashboard)` first, so matching the group here
		// sent nested dashboard screens back to the dashboard home.
		const onIndexScreen = segments.length === 1 && !inDashboardGroup

		// Don't redirect if we're in the OAuth callback flow
		if (inOAuthCallback) return

		// Handle redirectTo parameter for post-authentication navigation
		const redirectTo =
			typeof params.redirectTo === 'string' ? params.redirectTo : undefined

		if (!isAuthenticated) {
			// User is not authenticated
			if (inDashboardGroup) {
				// Redirect to sign-in if trying to access protected routes
				// Preserve the attempted route as redirectTo parameter
				const currentPath = `/(dashboard)${segments.slice(1).length > 0 ? '/' + segments.slice(1).join('/') : ''}`
				router.replace({
					pathname: '/(auth)/sign-in',
					params: { redirectTo: currentPath },
				})
			} else if (onIndexScreen) {
				// Index screen will handle the redirect, but we can help by going to sign-in
				router.replace('/(auth)/sign-in')
			}
		} else {
			// User is authenticated
			if (inAuthGroup) {
				// Redirect to dashboard or specified redirect location
				if (redirectTo && redirectTo.startsWith('/')) {
					router.replace(redirectTo as Href)
				} else {
					router.replace('/(dashboard)')
				}
			} else if (onIndexScreen) {
				// Index screen will handle the redirect, but we can help by going to dashboard
				if (redirectTo && redirectTo.startsWith('/')) {
					router.replace(redirectTo as Href)
				} else {
					router.replace('/(dashboard)')
				}
			}
		}
	}, [
		isAuthenticated,
		isLoading,
		segments,
		router,
		isNavigationReady,
		params.redirectTo,
	])

	// AuthGuard doesn't render anything - it just handles navigation logic
	return null
}
