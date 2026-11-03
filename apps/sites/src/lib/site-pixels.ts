type Fbq = ((...args: unknown[]) => void) & {
	callMethod?: (...args: unknown[]) => void
	queue: unknown[]
	loaded: boolean
	version: string
	push: Fbq
}

type TikTokQueue = {
	methods: string[]
	setAndDefer: (target: TikTokQueue, method: string) => void
	instance: (id: string) => TikTokQueue
	load: (id: string, options?: { partner?: string }) => void
	page: () => void
	_i: Record<string, TikTokQueue & { _u?: string }>
	_t: Record<string, number>
	_o: Record<string, unknown>
	push: (args: unknown[]) => void
}

function bootFacebook(pixelId: string) {
	const w = window as Window & { fbq?: Fbq; _fbq?: Fbq }
	if (!w.fbq) {
		const fbq = function (this: Fbq, ...args: unknown[]) {
			if (fbq.callMethod) fbq.callMethod.apply(fbq, args)
			else fbq.queue.push(args)
		} as Fbq
		fbq.queue = []
		fbq.loaded = true
		fbq.version = '2.0'
		fbq.push = fbq
		w.fbq = fbq
		w._fbq = fbq
		const script = document.createElement('script')
		script.async = true
		script.src = 'https://connect.facebook.net/en_US/fbevents.js'
		document.head.appendChild(script)
	}
	w.fbq('init', pixelId)
	w.fbq('track', 'PageView')
}

function bootTikTok(pixelId: string) {
	const w = window as Window & {
		TiktokAnalyticsObject?: string
		ttq?: TikTokQueue
	}
	w.TiktokAnalyticsObject = 'ttq'
	const ttq = (w.ttq = w.ttq || ({} as TikTokQueue))
	ttq.methods = [
		'page',
		'track',
		'identify',
		'instances',
		'debug',
		'on',
		'off',
		'once',
		'ready',
		'alias',
		'group',
		'enableCookie',
		'disableCookie',
		'holdConsent',
		'revokeConsent',
		'grantConsent',
	]
	ttq.setAndDefer = (target, method) => {
		;(target as unknown as Record<string, (...args: unknown[]) => void>)[
			method
		] = (...args: unknown[]) => {
			target.push([method, ...args])
		}
	}
	for (const method of ttq.methods) ttq.setAndDefer(ttq, method)
	ttq.instance = (id) => {
		const queue = ttq._i[id] || ({} as TikTokQueue)
		for (const method of ttq.methods) ttq.setAndDefer(queue, method)
		return queue
	}
	ttq.load = (id, options) => {
		const src = 'https://analytics.tiktok.com/i18n/pixel/events.js'
		ttq._i = ttq._i || {}
		const queue = [] as unknown as TikTokQueue & { _u?: string }
		queue._u = src
		ttq._i[id] = queue
		ttq._t = ttq._t || {}
		ttq._t[id] = Date.now()
		ttq._o = ttq._o || {}
		ttq._o[id] = options || {}
		const script = document.createElement('script')
		script.async = true
		script.src = `${src}?sdkid=${encodeURIComponent(id)}&lib=ttq`
		const first = document.getElementsByTagName('script')[0]
		first?.parentNode?.insertBefore(script, first)
	}
	ttq.push = () => {}
	ttq.load(pixelId)
	ttq.page()
}

function bootTagManager(containerId: string) {
	const w = window as Window & { dataLayer?: unknown[] }
	w.dataLayer = w.dataLayer || []
	w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
	const script = document.createElement('script')
	script.async = true
	script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`
	document.head.appendChild(script)
}

/** Loads pixels from data attributes. The script itself is bundled. */
export function bootSitePixels(root: HTMLElement) {
	const facebook = root.dataset.facebookPixel
	if (facebook && /^\d{5,20}$/.test(facebook)) bootFacebook(facebook)
	const tiktok = root.dataset.tiktokPixel
	if (tiktok && /^[A-Z0-9]{10,30}$/.test(tiktok)) bootTikTok(tiktok)
	const tagManager = root.dataset.googleTagManager
	if (tagManager && /^GTM-[A-Z0-9]+$/.test(tagManager))
		bootTagManager(tagManager)
}
