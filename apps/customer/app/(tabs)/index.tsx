import { Redirect } from 'expo-router'

/** The app opens on the customer's profile. */
export default function Index() {
	return <Redirect href="/profile" />
}
