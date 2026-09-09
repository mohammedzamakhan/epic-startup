import { Trans } from '@lingui/macro'
import { toPublicFormProjection } from '@repo/common/public-form'
import { cn } from '@repo/ui'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Icon, type IconName } from '@repo/ui/icon'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { ScrollArea } from '@repo/ui/scroll-area'
import { Switch } from '@repo/ui/switch'
import { Textarea } from '@repo/ui/textarea'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	useBlocker,
	useFetcher,
	useLoaderData,
} from 'react-router'
import { z } from 'zod'

import {
	ORG_PERMISSIONS,
	requireUserWithOrganizationPermission,
} from '#app/utils/organization/permissions.server.ts'
import {
	deleteCachedPublicForm,
	setCachedPublicForm,
} from '#app/utils/sites/kv-cache.server.ts'
import { getOperatorTenantClient } from '#app/utils/tenant-api.server.ts'

type FieldType = 'text' | 'email' | 'tel' | 'textarea'
type FormField = {
	id: string
	label: string
	type: FieldType
	required: boolean
}
type WebsiteForm = {
	id: string
	name: string
	description: string | null
	fields: FormField[]
	status: 'draft' | 'published'
	submitLabel: string
	successMessage: string
}
type FormSubmission = {
	id: string
	values: Record<string, string>
	createdAt: string | null
}

const fieldSchema = z.object({
	id: z
		.string()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
	label: z.string().trim().min(1).max(100),
	type: z.enum(['text', 'email', 'tel', 'textarea']),
	required: z.boolean(),
})
const updateSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500),
	fields: z.array(fieldSchema).min(1).max(20),
	submitLabel: z.string().trim().min(1).max(50),
	successMessage: z.string().trim().min(1).max(300),
	status: z.enum(['draft', 'published']),
})

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { fetchTenant, orgId } = await getOperatorTenantClient(
		request,
		params.orgSlug || '',
	)
	await requireUserWithOrganizationPermission(
		request,
		orgId,
		ORG_PERMISSIONS.UPDATE_WEBSITE_ANY,
	)
	const response = await fetchTenant(
		`/operator/forms/${encodeURIComponent(params.formId || '')}/submissions`,
	)
	if (!response.ok) {
		throw new Response(
			response.status === 404 ? 'Form not found' : 'Regional forms unavailable',
			{ status: response.status },
		)
	}
	return (await response.json()) as {
		form: WebsiteForm
		submissions: FormSubmission[]
	}
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { fetchTenant, orgId } = await getOperatorTenantClient(
		request,
		params.orgSlug || '',
	)
	await requireUserWithOrganizationPermission(
		request,
		orgId,
		ORG_PERMISSIONS.UPDATE_WEBSITE_ANY,
	)
	const parsed = updateSchema.safeParse(await request.json().catch(() => null))
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0]?.message ?? 'Check the form.' },
			{ status: 400 },
		)
	}
	const response = await fetchTenant(
		`/operator/forms/${encodeURIComponent(params.formId || '')}`,
		{ method: 'PUT', body: JSON.stringify(parsed.data) },
	)
	if (!response.ok) {
		return Response.json(
			{ error: 'Unable to save the form.' },
			{ status: response.status },
		)
	}
	const payload = (await response.json()) as { form: WebsiteForm }
	const projection = toPublicFormProjection(payload.form)
	if (projection) await setCachedPublicForm(orgId, projection)
	else await deleteCachedPublicForm(orgId, payload.form.id)
	return { success: true, form: payload.form }
}

const fieldOptions: Array<{
	type: FieldType
	label: string
	icon: IconName
}> = [
	{ type: 'text', label: 'Short text', icon: 'file-text' },
	{ type: 'email', label: 'Email', icon: 'mail' },
	{ type: 'tel', label: 'Phone', icon: 'smartphone' },
	{ type: 'textarea', label: 'Long text', icon: 'message-square' },
]

function uniqueFieldId(label: string, fields: FormField[]) {
	const base =
		label
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'field'
	let id = base
	let suffix = 2
	while (fields.some((field) => field.id === id)) id = `${base}-${suffix++}`
	return id
}

export default function WebsiteFormBuilderRoute() {
	const initial = useLoaderData<typeof loader>()
	const fetcher = useFetcher<typeof action>()
	const [form, setForm] = useState(initial.form)
	const [selectedId, setSelectedId] = useState(
		initial.form.fields[0]?.id ?? null,
	)
	const [mode, setMode] = useState<'build' | 'preview' | 'responses'>('build')
	const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
	const [testSuccess, setTestSuccess] = useState(false)
	const [savedForm, setSavedForm] = useState(initial.form)
	const pendingSnapshot = useRef('')
	const selected = form.fields.find((field) => field.id === selectedId) ?? null
	const saved =
		fetcher.data && 'success' in fetcher.data && fetcher.data.success

	useEffect(() => {
		if (fetcher.data && 'form' in fetcher.data && fetcher.data.form) {
			const responseForm = fetcher.data.form
			setForm((current) =>
				JSON.stringify(current) === pendingSnapshot.current
					? responseForm
					: current,
			)
			setSavedForm(responseForm)
		}
	}, [fetcher.data])

	const isDirty = useMemo(
		() => JSON.stringify(form) !== JSON.stringify(savedForm),
		[form, savedForm],
	)
	const blocker = useBlocker(isDirty)
	useEffect(() => {
		if (blocker.state !== 'blocked') return
		if (window.confirm('Leave without saving your form changes?')) {
			blocker.proceed()
		} else {
			blocker.reset()
		}
	}, [blocker])
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (!isDirty) return
			event.preventDefault()
		}
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [isDirty])
	const updateField = (id: string, patch: Partial<FormField>) =>
		setForm((current) => ({
			...current,
			fields: current.fields.map((field) =>
				field.id === id ? { ...field, ...patch } : field,
			),
		}))
	const addField = (type: FieldType, label: string) => {
		const id = uniqueFieldId(label, form.fields)
		setForm((current) => ({
			...current,
			fields: [...current.fields, { id, label, type, required: false }],
		}))
		setSelectedId(id)
	}
	const moveField = (index: number, offset: number) => {
		const fields = [...form.fields]
		const target = index + offset
		if (target < 0 || target >= fields.length) return
		;[fields[index], fields[target]] = [fields[target]!, fields[index]!]
		setForm((current) => ({ ...current, fields }))
	}
	const save = () => {
		pendingSnapshot.current = JSON.stringify(form)
		fetcher.submit(form, { method: 'post', encType: 'application/json' })
	}

	const preview = (
		<main className="bg-muted/30 flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
			<div
				className={cn(
					'bg-background border-border w-full rounded-xl border shadow-sm transition-[max-width] duration-200 motion-reduce:transition-none',
					viewport === 'mobile' ? 'max-w-[375px]' : 'max-w-2xl',
				)}
			>
				<div className="border-border border-b px-6 py-5 sm:px-8">
					<h1 className="text-xl font-semibold tracking-tight">{form.name}</h1>
					{form.description ? (
						<p className="text-muted-foreground mt-2 text-sm leading-relaxed">
							{form.description}
						</p>
					) : null}
				</div>
				{testSuccess ? (
					<div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
						<span className="mb-4 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
							<Icon name="check" className="size-5" />
						</span>
						<p className="font-medium">{form.successMessage}</p>
						<Button
							variant="link"
							className="mt-2"
							onClick={() => setTestSuccess(false)}
						>
							<Trans>Test again</Trans>
						</Button>
					</div>
				) : (
					<form
						className="space-y-5 p-6 sm:p-8"
						onSubmit={(event) => {
							event.preventDefault()
							if (event.currentTarget.reportValidity()) setTestSuccess(true)
						}}
					>
						{form.fields.map((field) => (
							<div key={field.id} className="space-y-2">
								<Label htmlFor={`preview-${field.id}`}>
									{field.label}
									{field.required ? (
										<span className="text-destructive ml-1">*</span>
									) : null}
								</Label>
								{field.type === 'textarea' ? (
									<Textarea
										id={`preview-${field.id}`}
										required={field.required}
										rows={4}
										placeholder={`Enter ${field.label.toLowerCase()}`}
									/>
								) : (
									<Input
										id={`preview-${field.id}`}
										type={field.type}
										required={field.required}
										placeholder={`Enter ${field.label.toLowerCase()}`}
									/>
								)}
							</div>
						))}
						<Button type="submit" className="w-full sm:w-auto">
							{form.submitLabel}
						</Button>
						<p className="text-muted-foreground text-center text-xs">
							<Trans>Test mode — responses are not saved</Trans>
						</p>
					</form>
				)}
			</div>
		</main>
	)

	return (
		<div className="bg-muted fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden">
			<header className="border-border bg-background flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
				<div className="flex min-w-0 items-center gap-2">
					<Button
						variant="ghost"
						size="icon-xs"
						render={<Link to=".." relative="path" />}
						aria-label="Back to forms"
					>
						<Icon name="arrow-left" className="size-4" />
					</Button>
					<div className="bg-border hidden h-5 w-px sm:block" aria-hidden />
					<span className="max-w-48 truncate text-sm font-medium">
						{form.name}
					</span>
					<Badge variant="outline" className="hidden sm:inline-flex">
						{form.status === 'published' ? (
							<Trans>Published</Trans>
						) : (
							<Trans>Draft</Trans>
						)}
					</Badge>
				</div>
				<div className="flex items-center gap-2">
					<div className="bg-muted hidden rounded-lg p-0.5 lg:flex">
						<Button
							variant="ghost"
							size="icon-xs"
							className={cn(
								viewport === 'desktop' && 'bg-background shadow-sm',
							)}
							onClick={() => setViewport('desktop')}
							aria-label="Desktop preview"
							aria-pressed={viewport === 'desktop'}
						>
							<Icon name="laptop" className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							className={cn(viewport === 'mobile' && 'bg-background shadow-sm')}
							onClick={() => setViewport('mobile')}
							aria-label="Mobile preview"
							aria-pressed={viewport === 'mobile'}
						>
							<Icon name="smartphone" className="size-3.5" />
						</Button>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							setMode(mode === 'responses' ? 'build' : 'responses')
						}
					>
						<Icon
							name={mode === 'responses' ? 'blocks' : 'file-text'}
							className="size-4"
						/>
						<span className="hidden sm:inline">
							{mode === 'responses' ? (
								<Trans>Builder</Trans>
							) : (
								<Trans>Responses</Trans>
							)}
						</span>
						{mode !== 'responses' ? (
							<Badge variant="secondary" className="ml-1">
								{initial.submissions.length}
							</Badge>
						) : null}
					</Button>
					<Button
						size="sm"
						onClick={save}
						disabled={!isDirty || fetcher.state !== 'idle'}
					>
						{fetcher.state !== 'idle' ? (
							<Trans>Saving…</Trans>
						) : saved && !isDirty ? (
							<Trans>Saved</Trans>
						) : (
							<Trans>Save</Trans>
						)}
					</Button>
				</div>
			</header>
			{fetcher.data && 'error' in fetcher.data && fetcher.data.error ? (
				<p
					className="bg-destructive/10 text-destructive border-destructive/20 border-b px-4 py-2 text-center text-sm"
					role="alert"
				>
					{String(fetcher.data.error)}
				</p>
			) : null}

			<div className="bg-background flex h-11 shrink-0 items-center justify-center border-b lg:hidden">
				<div className="bg-muted flex rounded-lg p-0.5">
					<Button
						variant="ghost"
						size="sm"
						className={cn(mode === 'build' && 'bg-background shadow-sm')}
						onClick={() => setMode('build')}
						aria-pressed={mode === 'build'}
					>
						<Trans>Build</Trans>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className={cn(mode === 'preview' && 'bg-background shadow-sm')}
						onClick={() => setMode('preview')}
						aria-pressed={mode === 'preview'}
					>
						<Trans>Preview</Trans>
					</Button>
				</div>
			</div>

			{mode === 'responses' ? (
				<Responses form={form} submissions={initial.submissions} />
			) : (
				<div className="flex min-h-0 flex-1">
					<BuilderSidebar
						form={form}
						setForm={setForm}
						selected={selected}
						selectedId={selectedId}
						setSelectedId={setSelectedId}
						addField={addField}
						moveField={moveField}
						updateField={updateField}
						className={mode === 'build' ? 'flex' : 'hidden'}
					/>
					<div
						className={cn(
							'min-h-0 min-w-0 flex-1 lg:flex',
							mode === 'preview' ? 'flex' : 'hidden',
						)}
					>
						{preview}
					</div>
				</div>
			)}
		</div>
	)
}

function BuilderSidebar({
	form,
	setForm,
	selected,
	selectedId,
	setSelectedId,
	addField,
	moveField,
	updateField,
	className,
}: {
	form: WebsiteForm
	setForm: React.Dispatch<React.SetStateAction<WebsiteForm>>
	selected: FormField | null
	selectedId: string | null
	setSelectedId: (id: string | null) => void
	addField: (type: FieldType, label: string) => void
	moveField: (index: number, offset: number) => void
	updateField: (id: string, patch: Partial<FormField>) => void
	className?: string
}) {
	return (
		<aside
			className={cn(
				'border-border bg-background min-h-0 w-full shrink-0 flex-col border-r lg:flex lg:w-80',
				className,
			)}
		>
			<div className="border-border flex items-center gap-2 border-b px-4 py-3">
				<span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-md">
					<Icon name="blocks" className="size-4" />
				</span>
				<span className="text-sm font-medium">
					<Trans>Fields</Trans>
				</span>
				<span className="text-muted-foreground text-xs">
					{form.fields.length}
				</span>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-5 p-3">
					<div className="space-y-1.5">
						{form.fields.map((field, index) => (
							<div
								key={field.id}
								className={cn(
									'border-border hover:bg-muted/60 flex items-center gap-1 rounded-lg border px-2 py-1.5',
									selectedId === field.id && 'border-primary bg-primary/5',
								)}
							>
								<button
									type="button"
									onClick={() => setSelectedId(field.id)}
									className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
								>
									<Icon
										name="grip-vertical"
										className="text-muted-foreground size-4"
									/>
									<span className="min-w-0 flex-1 truncate text-sm">
										{field.label}
									</span>
									{field.required ? (
										<span className="text-destructive text-xs">*</span>
									) : null}
								</button>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									disabled={index === 0}
									onClick={() => moveField(index, -1)}
									aria-label="Move field up"
								>
									<Icon name="chevron-up" className="size-3" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									disabled={index === form.fields.length - 1}
									onClick={() => moveField(index, 1)}
									aria-label="Move field down"
								>
									<Icon name="chevron-down" className="size-3" />
								</Button>
							</div>
						))}
					</div>
					<div>
						<p className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
							<Trans>Add a field</Trans>
						</p>
						<div className="grid grid-cols-2 gap-2">
							{fieldOptions.map((option) => (
								<Button
									key={option.type}
									type="button"
									variant="outline"
									className="h-auto justify-start px-3 py-2.5"
									onClick={() => addField(option.type, option.label)}
								>
									<Icon name={option.icon} className="size-4" />
									<span className="text-xs">{option.label}</span>
								</Button>
							))}
						</div>
					</div>
					{selected ? (
						<div className="border-border space-y-4 border-t pt-5">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium">
									<Trans>Field settings</Trans>
								</p>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									disabled={form.fields.length === 1}
									onClick={() => {
										setForm((current) => ({
											...current,
											fields: current.fields.filter(
												(field) => field.id !== selected.id,
											),
										}))
										setSelectedId(
											form.fields.find((field) => field.id !== selected.id)
												?.id ?? null,
										)
									}}
									aria-label="Remove field"
								>
									<Icon name="trash-2" className="size-4" />
								</Button>
							</div>
							<div className="space-y-2">
								<Label htmlFor="field-label">
									<Trans>Label</Trans>
								</Label>
								<Input
									id="field-label"
									value={selected.label}
									onChange={(event) =>
										updateField(selected.id, { label: event.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="field-type">
									<Trans>Type</Trans>
								</Label>
								<select
									id="field-type"
									value={selected.type}
									onChange={(event) =>
										updateField(selected.id, {
											type: event.target.value as FieldType,
										})
									}
									className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
								>
									{fieldOptions.map((option) => (
										<option key={option.type} value={option.type}>
											{option.label}
										</option>
									))}
								</select>
							</div>
							<div className="flex items-center justify-between">
								<Label htmlFor="field-required">
									<Trans>Required</Trans>
								</Label>
								<Switch
									id="field-required"
									checked={selected.required}
									onCheckedChange={(required) =>
										updateField(selected.id, { required })
									}
								/>
							</div>
						</div>
					) : null}
					<div className="border-border space-y-4 border-t pt-5">
						<p className="text-sm font-medium">
							<Trans>Form settings</Trans>
						</p>
						<div className="space-y-2">
							<Label htmlFor="form-name">
								<Trans>Name</Trans>
							</Label>
							<Input
								id="form-name"
								value={form.name}
								onChange={(event) =>
									setForm({ ...form, name: event.target.value })
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="form-description">
								<Trans>Description</Trans>
							</Label>
							<Textarea
								id="form-description"
								value={form.description ?? ''}
								onChange={(event) =>
									setForm({ ...form, description: event.target.value })
								}
								rows={3}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="submit-label">
								<Trans>Button label</Trans>
							</Label>
							<Input
								id="submit-label"
								value={form.submitLabel}
								onChange={(event) =>
									setForm({ ...form, submitLabel: event.target.value })
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="success-message">
								<Trans>Success message</Trans>
							</Label>
							<Textarea
								id="success-message"
								value={form.successMessage}
								onChange={(event) =>
									setForm({ ...form, successMessage: event.target.value })
								}
								rows={3}
							/>
						</div>
						<div className="flex items-center justify-between">
							<Label htmlFor="published">
								<Trans>Published</Trans>
							</Label>
							<Switch
								id="published"
								checked={form.status === 'published'}
								onCheckedChange={(published) =>
									setForm({
										...form,
										status: published ? 'published' : 'draft',
									})
								}
							/>
						</div>
					</div>
				</div>
			</ScrollArea>
		</aside>
	)
}

function Responses({
	form,
	submissions,
}: {
	form: WebsiteForm
	submissions: FormSubmission[]
}) {
	return (
		<ScrollArea className="bg-background min-h-0 flex-1">
			<div className="mx-auto max-w-6xl p-6 sm:p-10">
				<div className="mb-6">
					<h1 className="text-xl font-semibold">
						<Trans>Responses</Trans>
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						<Trans>
							Submissions are stored in this organization’s regional tenant
							database.
						</Trans>
					</p>
				</div>
				<div className="border-border overflow-x-auto rounded-xl border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/50 border-b">
							<tr>
								<th className="px-4 py-3 font-medium">
									<Trans>Submitted</Trans>
								</th>
								{form.fields.map((field) => (
									<th key={field.id} className="px-4 py-3 font-medium">
										{field.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y">
							{submissions.length === 0 ? (
								<tr>
									<td
										colSpan={form.fields.length + 1}
										className="text-muted-foreground px-4 py-16 text-center"
									>
										<Trans>No responses yet.</Trans>
									</td>
								</tr>
							) : (
								submissions.map((submission) => (
									<tr key={submission.id}>
										<td className="px-4 py-3 whitespace-nowrap">
											{submission.createdAt
												? new Date(submission.createdAt).toLocaleString()
												: '—'}
										</td>
										{form.fields.map((field) => (
											<td
												key={field.id}
												className="max-w-sm px-4 py-3 whitespace-pre-wrap"
											>
												{submission.values[field.id] || '—'}
											</td>
										))}
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>
		</ScrollArea>
	)
}
