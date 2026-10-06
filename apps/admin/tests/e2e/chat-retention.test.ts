import { db, eq, Organization, Role, _RoleToUser } from '@repo/database'
import { expect, test } from '#tests/playwright-utils.ts'

test('platform admins explicitly save organization chat retention', async ({
	page,
	login,
	navigate,
}, testInfo) => {
	test.setTimeout(60_000)
	const user = await login()
	const adminRole = await db.query.Role.findFirst({
		where: eq(Role.name, 'admin'),
	})
	if (!adminRole) throw new Error('Platform admin role missing')
	await db
		.insert(_RoleToUser)
		.values({ A: adminRole.id, B: user.id })
		.onConflictDoNothing()
	const [organization] = await db
		.insert(Organization)
		.values({
			name: 'Retention test organization',
			slug: `retention-${user.id}`,
			chatRetentionDays: 90,
		})
		.returning()
	if (!organization) throw new Error('Test organization missing')

	try {
		await navigate('/organizations/:id', { id: organization.id })
		await page.waitForLoadState('networkidle')
		await page.getByRole('link', { name: 'Message retention' }).click()
		await page.waitForLoadState('networkidle')
		await expect(
			page.getByRole('heading', { name: 'Message retention', exact: true }),
		).toBeVisible()
		const retention = page.getByRole('combobox', { name: 'Retention period' })
		await expect(retention).toHaveText('90 days')
		await retention.click()
		await page
			.getByRole('option', { name: '30 days', exact: true })
			.click({ timeout: 10_000 })

		const beforeSave = await db.query.Organization.findFirst({
			where: eq(Organization.id, organization.id),
		})
		expect(beforeSave?.chatRetentionDays).toBe(90)
		await page.getByRole('button', { name: 'Save retention' }).click()
		await expect(page.getByText('Message retention updated')).toBeVisible()
		const afterSave = await db.query.Organization.findFirst({
			where: eq(Organization.id, organization.id),
		})
		expect(afterSave?.chatRetentionDays).toBe(30)

		await page.screenshot({
			path: testInfo.outputPath('retention-desktop.png'),
			fullPage: true,
		})
		await page.setViewportSize({ width: 390, height: 844 })
		await expect(retention).toBeVisible()
		await page.screenshot({
			path: testInfo.outputPath('retention-mobile.png'),
			fullPage: true,
		})
	} finally {
		await db.delete(Organization).where(eq(Organization.id, organization.id))
	}
})
