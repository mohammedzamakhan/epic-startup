// @vitest-environment jsdom

import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { RoleAccessForm } from './tenant-role-access-manager.tsx'

beforeEach(() => {
	i18n.load('en', {})
	i18n.activate('en')
})

function renderForm() {
	const Stub = createRoutesStub([
		{
			path: '/acme/settings/roles/new',
			Component: () => <RoleAccessForm cancelHref="/acme/settings/roles" />,
			HydrateFallback: () => null,
		},
	])
	return render(
		<I18nProvider i18n={i18n}>
			<Stub initialEntries={['/acme/settings/roles/new']} />
		</I18nProvider>,
	)
}

describe('RoleAccessForm permission checkboxes', () => {
	it('names each permission checkbox after its permission', async () => {
		renderForm()

		const createNotes = await screen.findByRole('checkbox', {
			name: 'Create notes',
		})
		expect(createNotes).toBeChecked()
		expect(
			screen.getByRole('checkbox', { name: 'Delete team notes' }),
		).not.toBeChecked()
	})

	it('shows the group checkbox as mixed while only some permissions are selected', async () => {
		const user = userEvent.setup()
		renderForm()

		// The default "Content editor" template selects 4 of the 7 note permissions.
		const group = await screen.findByRole('checkbox', {
			name: 'Select all Notes & Documents',
		})
		expect(group).toBePartiallyChecked()
		// The box draws a dash, not an empty square, for the mixed state.
		expect(group.querySelector('use')?.getAttribute('href')).toMatch(/#minus$/)

		await user.click(group)
		expect(group.querySelector('use')?.getAttribute('href')).toMatch(/#check$/)
		expect(group).toBeChecked()

		await user.click(group)
		expect(group).not.toBeChecked()
	})
})
