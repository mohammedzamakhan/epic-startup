import { useSyncExternalStore } from 'react'
import { type AppSnapshot, type AppStore } from '../state/app-store'
import { type SiteTheme } from '../theme/site-theme'
import { useAppStoreContext } from './app-provider'
import { type AppFeatures } from './features'

/** The app's store; every screen lives under `AppProvider`. */
export function useAppStore(): AppStore<AppFeatures> {
	const store = useAppStoreContext()
	if (!store) throw new Error('useAppStore must be used under AppProvider')
	return store
}

/** The whole app snapshot; re-renders whenever any part changes. */
export function useAppSnapshot(): AppSnapshot<AppFeatures> {
	const store = useAppStore()
	return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** The organization's theme (the neutral fallback before the site loads). */
export function useSiteTheme(): SiteTheme {
	return useAppSnapshot().theme
}
