import { describe, expect, it } from 'vitest'
import { mockCanva } from './mock.server.ts'
import { readPdfPageSize } from './pdf-size.ts'

const encode = (text: string) => new TextEncoder().encode(text)

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
		const pdf = encode(
			[
				'%PDF-1.7',
				'2 0 obj << /Type /Pages /Kids [3 0 R] /MediaBox [0 0 10 10] >> endobj',
				'3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 858.9 1207.56] /TrimBox [8.5 8.5 850.39 1199.06] >> endobj',
			].join('\n'),
		)
		const size = readPdfPageSize(pdf)
		expect(size?.media.widthMm).toBeCloseTo(303, 0)
		expect(size?.trim?.widthMm).toBeCloseTo(297, 0)
		expect(size?.trim?.heightMm).toBeCloseTo(420, 0)
	})

	it('returns null for files that are not readable PDFs', () => {
		expect(readPdfPageSize(encode('<html></html>'))).toBeNull()
		// Boxes inside a compressed object stream cannot be read.
		expect(
			readPdfPageSize(encode('%PDF-1.7\n1 0 obj << /Filter /FlateDecode >>')),
		).toBeNull()
		expect(
			readPdfPageSize(
				encode(
					'%PDF-1.7\n3 0 obj << /Type /Page /MediaBox [0 0 0 0] >> endobj',
				),
			),
		).toBeNull()
	})
})
