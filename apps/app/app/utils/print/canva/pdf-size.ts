/**
 * Reads a PDF's first page size without a PDF library. It walks the real
 * page tree (trailer `/Root`, the catalog's `/Pages`, the first `/Kids`
 * entry down to a `/Type /Page`), with `/MediaBox` and `/Rotate` inherited
 * from parent nodes as the PDF spec allows, and returns the boxes in
 * millimetres as the page is shown (rotated by 90 or 270 degrees, width and
 * height swap).
 *
 * It fails closed: when an object it needs sits in a compressed object
 * stream (which some writers use), the tree is malformed, or a box is
 * missing, it returns null and callers fall back to the provider's own size
 * information. Every scan is linear (object offsets are indexed once, and
 * each dictionary read is capped), so a large or hostile file cannot make it
 * backtrack.
 */

const POINTS_PER_MM = 72 / 25.4
/** A page dictionary is small; streams after it are never read. */
const MAX_DICT_CHARS = 64 * 1024
const MAX_TREE_DEPTH = 32

type Box = { widthMm: number; heightMm: number }

type ObjectIndex = Map<number, number>

function indexObjects(text: string): ObjectIndex {
	const index: ObjectIndex = new Map()
	const header = /(\d+)\s+\d+\s+obj\b/g
	for (let match = header.exec(text); match; match = header.exec(text)) {
		// A later definition (an incremental update) wins.
		index.set(Number(match[1]), match.index + match[0].length)
	}
	return index
}

/** The object's dictionary (or value), up to its stream or `endobj`. */
function objectBody(text: string, index: ObjectIndex, id: number) {
	const start = index.get(id)
	if (start === undefined) return null
	const window = text.slice(start, start + MAX_DICT_CHARS)
	const ends = [window.indexOf('endobj'), window.indexOf('stream')].filter(
		(at) => at !== -1,
	)
	return ends.length ? window.slice(0, Math.min(...ends)) : null
}

const NAME = /^[^\s/<>[\]()]+/
const VALUE = /^\s*(\d+\s+\d+\s+R|\[[^\]]*\]|\/[^\s/<>[\]()]+|-?[\d.]+)/

/**
 * The value of `/Key` in a dictionary at its own level (nested dictionaries
 * skipped), as raw text: a number, a name, an array or an `N G R` reference.
 * Keys and values alternate, so a name used as a value is never taken for a
 * key.
 */
function dictValue(dict: string, key: string): string | null {
	let depth = 0
	for (let at = 0; at < dict.length; at += 1) {
		if (dict.startsWith('<<', at)) {
			depth += 1
			at += 1
			continue
		}
		if (dict.startsWith('>>', at)) {
			depth -= 1
			at += 1
			continue
		}
		if (depth !== 1 || dict[at] !== '/') continue
		const name = dict.slice(at + 1, at + 200).match(NAME)?.[0]
		if (!name) continue
		const after = at + 1 + name.length
		const value = dict.slice(after, after + 4096).match(VALUE)
		if (name === key) return value ? value[1]!.trim() : null
		// Skip a simple value; a nested dictionary is skipped by depth.
		if (value) at = after + value[0].length - 1
		else at = after - 1
	}
	return null
}

function refId(value: string | null): number | null {
	const match = value?.match(/^(\d+)\s+\d+\s+R$/)
	return match ? Number(match[1]) : null
}

/** A value, following one indirect reference. */
function resolve(text: string, index: ObjectIndex, value: string | null) {
	const id = refId(value)
	if (id === null) return value
	return objectBody(text, index, id)?.trim() ?? null
}

function toBox(value: string | null): Box | null {
	const numbers = value
		?.match(/^\[\s*([^\]]*)\]$/)?.[1]
		?.trim()
		.split(/\s+/)
	if (!numbers || numbers.length !== 4) return null
	const [x0, y0, x1, y1] = numbers.map(Number) as [
		number,
		number,
		number,
		number,
	]
	const width = Math.abs(x1 - x0) / POINTS_PER_MM
	const height = Math.abs(y1 - y0) / POINTS_PER_MM
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null
	if (!width || !height) return null
	return { widthMm: width, heightMm: height }
}

function rootId(text: string): number | null {
	// Classic trailers and cross-reference streams both carry `/Root N G R`
	// in a plain dictionary; the last one describes the current file.
	let last: number | null = null
	for (const match of text.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)) {
		last = Number(match[1])
	}
	return last
}

export function readPdfPageSize(bytes: Uint8Array): {
	media: Box
	trim: Box | null
	rotate: number
} | null {
	if (
		bytes.length < 5 ||
		new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
	) {
		return null
	}
	// Latin-1 keeps every byte as one character, so offsets stay meaningful.
	const text = new TextDecoder('latin1').decode(bytes)
	const index = indexObjects(text)
	const root = rootId(text)
	const catalog = root === null ? null : objectBody(text, index, root)
	let nodeId = catalog ? refId(dictValue(catalog, 'Pages')) : null

	let mediaValue: string | null = null
	let rotateValue: string | null = null
	const visited = new Set<number>()
	for (let depth = 0; nodeId !== null && depth < MAX_TREE_DEPTH; depth += 1) {
		if (visited.has(nodeId)) return null
		visited.add(nodeId)
		const node = objectBody(text, index, nodeId)
		if (!node) return null
		// Inheritable: the nearest node that sets them wins.
		mediaValue = resolve(text, index, dictValue(node, 'MediaBox')) ?? mediaValue
		rotateValue = resolve(text, index, dictValue(node, 'Rotate')) ?? rotateValue
		const type = dictValue(node, 'Type')
		if (type === '/Page') {
			const media = toBox(mediaValue)
			if (!media) return null
			const rotate = ((Number(rotateValue ?? 0) % 360) + 360) % 360
			const turned = rotate === 90 || rotate === 270
			const shown = (box: Box): Box =>
				turned ? { widthMm: box.heightMm, heightMm: box.widthMm } : box
			const trim = toBox(resolve(text, index, dictValue(node, 'TrimBox')))
			return { media: shown(media), trim: trim ? shown(trim) : null, rotate }
		}
		if (type !== '/Pages') return null
		const kids = resolve(text, index, dictValue(node, 'Kids'))
		nodeId = refId(kids?.match(/^\[\s*(\d+\s+\d+\s+R)/)?.[1] ?? null)
	}
	return null
}
