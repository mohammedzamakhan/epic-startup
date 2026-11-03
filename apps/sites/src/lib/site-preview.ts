/** Applies a live preview payload from the site editor without an inline script. */
export function initSitePreview() {
	window.addEventListener('message', async (event) => {
		if (event.data?.type !== 'epic-preview-update') return
		try {
			const res = await fetch(window.location.href, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sections: event.data.sections,
					theme: event.data.theme,
				}),
			})
			const html = await res.text()
			const doc = new DOMParser().parseFromString(html, 'text/html')
			const newHtml = doc.documentElement
			document.documentElement.className = newHtml.className
			for (const key of ['siteTheme', 'siteBase', 'headingFont', 'bodyFont']) {
				const value = newHtml.dataset[key]
				if (value) document.documentElement.dataset[key] = value
				else delete document.documentElement.dataset[key]
			}
			const updateStyle = (id: string) => {
				const current = document.getElementById(id)
				const next = doc.getElementById(id)
				if (current && next) {
					current.textContent = next.textContent
				} else if (!current && next) {
					document.head.appendChild(next.cloneNode(true))
				} else if (current && !next) {
					current.remove()
				}
			}
			updateStyle('org-site-theme')
			updateStyle('org-site-fonts')
			const currentContainer = document.querySelector('div.bg-background')
			const newContainer = doc.querySelector('div.bg-background')
			if (currentContainer && newContainer) {
				const clone = newContainer.cloneNode(true)
				currentContainer.replaceChildren(...Array.from(clone.childNodes))
				document.dispatchEvent(new Event('sites:content-updated'))
			}
		} catch (error) {
			console.error('Failed to update preview', error)
		}
	})
}
