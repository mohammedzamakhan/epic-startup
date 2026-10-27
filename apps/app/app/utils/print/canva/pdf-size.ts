/**
 * Reads a PDF's first page size without a PDF library: the `/MediaBox` (and
 * `/TrimBox` when present) of the first page object, in millimetres. Returns
 * null when the boxes sit in a compressed object stream, which some writers
 * use; callers then fall back to the provider's own size information.
 */

const POINTS_PER_MM = 72 / 25.4

type Box = { widthMm: number; heightMm: number }

function readBox(source: string, name: 'MediaBox' | 'TrimBox'): Box | null {
	const match = source.match(
		new RegExp(
			`/${name}\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]`,
		),
	)
	if (!match) return null
	const [x0, y0, x1, y1] = match.slice(1).map(Number) as [
		number,
		number,
		number,
		number,
	]
	const width = Math.abs(x1 - x0) / POINTS_PER_MM
	const height = Math.abs(y1 - y0) / POINTS_PER_MM
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		!width ||
		!height
	) {
		return null
	}
	return { widthMm: width, heightMm: height }
}

export function readPdfPageSize(bytes: Uint8Array): {
	media: Box
	trim: Box | null
} | null {
	if (
		bytes.length < 5 ||
		new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
	) {
		return null
	}
	// Latin-1 keeps every byte as one character, so offsets stay meaningful.
	const text = new TextDecoder('latin1').decode(bytes)
	// The first page object (a `/Type /Page` that is not `/Pages`).
	const page = text.match(/\/Type\s*\/Page(?!s)[\s\S]*?endobj/)
	const scope = page?.[0] ?? text
	const media = readBox(scope, 'MediaBox') ?? readBox(text, 'MediaBox')
	if (!media) return null
	return { media, trim: readBox(scope, 'TrimBox') }
}
