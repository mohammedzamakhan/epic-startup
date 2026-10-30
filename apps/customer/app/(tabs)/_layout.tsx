import { useLingui } from '@lingui/react/macro'
import { Tabs } from 'expo-router'
import { type ColorValue } from 'react-native'
import { Icon } from '../../components/ui/icon'
import { useThemePalette } from '../../lib/theme/use-theme-palette'

function tabIconColor(color: ColorValue | undefined, fallback: string): string {
	return typeof color === 'string' ? color : fallback
}

/**
 * The signed-in customer's tabs, in the organization's colors. The shell
 * above draws the brand header, so the tabs have no header of their own.
 * Profile is the only tab, so the bar stays hidden; a feature that adds a
 * tab (see `lib/app/features.ts`) shows it again.
 */
export default function TabsLayout() {
	const { t } = useLingui()
	const palette = useThemePalette()

	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: palette.primary,
				tabBarInactiveTintColor: palette.mutedForeground,
				tabBarStyle: {
					display: 'none',
					backgroundColor: palette.card,
					borderTopColor: palette.border,
				},
				sceneStyle: { backgroundColor: palette.background },
			}}
		>
			<Tabs.Screen name="index" options={{ href: null }} />
			<Tabs.Screen
				name="profile"
				options={{
					title: t`Profile`,
					tabBarIcon: ({ color, size }) => (
						<Icon
							name="person-circle-outline"
							size={size}
							color={tabIconColor(color, palette.primary)}
						/>
					),
				}}
			/>
		</Tabs>
	)
}
