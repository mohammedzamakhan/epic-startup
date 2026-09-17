/**
 * Declarative Workers Builds config (consumed by setup-workers-builds.mjs).
 * @see docs/workers-builds.md
 */

/** @type {readonly string[]} */
export const SHARED_WATCH_PATHS = [
	'packages/**',
	'scripts/cf-workers-ci.mjs',
	'scripts/patch-wrangler.mjs',
	'scripts/staging-hostnames.mjs',
	'package.json',
	'package-lock.json',
]

/**
 * @type {readonly {
 *   app: string,
 *   bindingKey: string,
 *   triggerVar: string,
 *   watchPaths: string[],
 * }[]}
 */
export const WORKERS_BUILDS_MANIFEST = [
	{
		app: 'jobs-cron',
		bindingKey: 'jobs_cron',
		triggerVar: 'CF_BUILD_TRIGGER_JOBS_CRON',
		watchPaths: ['apps/jobs-cron/**', ...SHARED_WATCH_PATHS],
	},
	{
		app: 'app',
		bindingKey: 'app',
		triggerVar: 'CF_BUILD_TRIGGER_APP',
		watchPaths: ['apps/app/**', ...SHARED_WATCH_PATHS],
	},
	{
		app: 'admin',
		bindingKey: 'admin',
		triggerVar: 'CF_BUILD_TRIGGER_ADMIN',
		watchPaths: ['apps/admin/**', ...SHARED_WATCH_PATHS],
	},
	{
		app: 'web',
		bindingKey: 'web',
		triggerVar: 'CF_BUILD_TRIGGER_WEB',
		watchPaths: ['apps/web/**', ...SHARED_WATCH_PATHS],
	},
	{
		app: 'sites',
		bindingKey: 'sites',
		triggerVar: 'CF_BUILD_TRIGGER_SITES',
		watchPaths: ['apps/sites/**', ...SHARED_WATCH_PATHS],
	},
	{
		app: 'tenant-api',
		bindingKey: 'tenant_api',
		triggerVar: 'CF_BUILD_TRIGGER_TENANT_API',
		watchPaths: [
			'apps/tenant-api/**',
			'packages/tenant-db/**',
			...SHARED_WATCH_PATHS,
		],
	},
	{
		app: 'docs',
		bindingKey: 'docs',
		triggerVar: 'CF_BUILD_TRIGGER_DOCS',
		watchPaths: ['apps/docs/**', ...SHARED_WATCH_PATHS],
	},
]
