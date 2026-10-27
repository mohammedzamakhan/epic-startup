import { describe, expect, it } from 'vitest'
import { mockCanva } from './mock.server.ts'
import { readPdfPageSize } from './pdf-size.ts'

const encode = (text: string) => new TextEncoder().encode(text)

const MM = 72 / 25.4
const pt = (mm: number) => (mm * MM).toFixed(2)

/** A PDF from object bodies (1-based), with a classic trailer. */
function pdf(objects: string[], root = 1) {
	return encode(
		[
			'%PDF-1.7',
			...objects.map((body, index) => `${index + 1} 0 obj\n${body}\nendobj`),
			`trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>`,
			'%%EOF',
		].join('\n'),
	)
}

describe('readPdfPageSize', () => {
	it('reads the first page MediaBox in millimetres', async () => {
		const { bytes } = await mockCanva.download(
			'mock-canva://export/MOCK-POSTER.pdf',
		)
		const size = readPdfPageSize(bytes)
		expect(size?.media.widthMm).toBeCloseTo(303, 1)
		expect(size?.media.heightMm).toBeCloseTo(426, 1)
		expect(size?.trim).toBeNull()
	})

	it('reads a TrimBox and ignores the page tree box', () => {
		const size = readPdfPageSize(
			pdf([
				'<< /Type /Catalog /Pages 2 0 R >>',
				'<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 10 10] >>',
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(303)} ${pt(426)}] /TrimBox [${pt(3)} ${pt(3)} ${pt(300)} ${pt(423)}] >>`,
			]),
		)
		expect(size?.media.widthMm).toBeCloseTo(303, 1)
		expect(size?.trim?.widthMm).toBeCloseTo(297, 1)
		expect(size?.trim?.heightMm).toBeCloseTo(420, 1)
	})

	it('follows the page tree to the first page, not the first box in the file', () => {
		// Object 3 (a larger page, listed second) comes first in the file.
		const size = readPdfPageSize(
			pdf([
				'<< /Type /Catalog /Pages 2 0 R >>',
				'<< /Type /Pages /Kids [5 0 R 3 0 R] /Count 2 >>',
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(420)} ${pt(594)}] >>`,
				`<< /Subtype /Form /BBox [0 0 1 1] /MediaBox [0 0 1 1] >>`,
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(148)} ${pt(210)}] >>`,
			]),
		)
		expect(size?.media.widthMm).toBeCloseTo(148, 1)
		expect(size?.media.heightMm).toBeCloseTo(210, 1)
	})

	it('inherits the MediaBox and Rotate, and turns a rotated page', () => {
		const size = readPdfPageSize(
			pdf([
				'<< /Type /Catalog /Pages 2 0 R >>',
				`<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 /MediaBox 4 0 R >>`,
				'<< /Type /Page /Parent 2 0 R >>',
				`[0 0 ${pt(420)} ${pt(297)}]`,
			]),
		)
		expect(size?.rotate).toBe(90)
		expect(size?.media.widthMm).toBeCloseTo(297, 1)
		expect(size?.media.heightMm).toBeCloseTo(420, 1)
	})

	it('fails closed when the page tree cannot be read', () => {
		expect(readPdfPageSize(encode('<html></html>'))).toBeNull()
		// A page box but no catalog: not taken as page 1.
		expect(
			readPdfPageSize(
				encode(
					`%PDF-1.7\n3 0 obj\n<< /Type /Page /MediaBox [0 0 ${pt(297)} ${pt(420)}] >>\nendobj`,
				),
			),
		).toBeNull()
		// The pages live in a compressed object stream.
		expect(
			readPdfPageSize(
				pdf([
					'<< /Type /Catalog /Pages 9 0 R >>',
					'<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>',
				]),
			),
		).toBeNull()
		// A loop in the tree, and an empty box.
		expect(
			readPdfPageSize(
				pdf([
					'<< /Type /Catalog /Pages 2 0 R >>',
					'<< /Type /Pages /Kids [2 0 R] >>',
				]),
			),
		).toBeNull()
		expect(
			readPdfPageSize(
				pdf([
					'<< /Type /Catalog /Pages 2 0 R >>',
					'<< /Type /Pages /Kids [3 0 R] >>',
					'<< /Type /Page /MediaBox [0 0 0 0] >>',
				]),
			),
		).toBeNull()
	})
})
