import fs from "node:fs"
import path from "node:path"

import * as XLSX from "xlsx"

import { db } from "../db/client"
import { code } from "../db/schema"

const DEFAULT_BATCH_SIZE = 500
const TARGET_HEADERS = new Set(["codigo completo", "código completo"])

type ParseResult = {
	codes: string[]
	sheetCount: number
}

const normalize = (value: unknown): string => String(value ?? "").trim().toLowerCase()

const findHeader = (
	rows: unknown[][],
	sheetName: string,
): { headerRowIndex: number; codeColumnIndex: number } => {
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex] ?? []
		const hasAnyValue = row.some((cell) => normalize(cell) !== "")

		if (!hasAnyValue) {
			continue
		}

		const codeColumnIndex = row.findIndex((cell) => TARGET_HEADERS.has(normalize(cell)))
		if (codeColumnIndex !== -1) {
			return { headerRowIndex: rowIndex, codeColumnIndex }
		}
	}

	throw new Error(`Sheet "${sheetName}" does not contain the required "codigo completo" column.`)
}

const parseCodesFromWorkbook = (filePath: string): ParseResult => {
	if (!fs.existsSync(filePath)) {
		throw new Error(`XLSX file not found at: ${filePath}`)
	}

	const workbook = XLSX.readFile(filePath, { raw: false })
	const deduplicatedCodes = new Set<string>()

	for (const sheetName of workbook.SheetNames) {
		const worksheet = workbook.Sheets[sheetName]

		if (!worksheet) {
			throw new Error(`Sheet "${sheetName}" is missing in workbook.`)
		}

		const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
			header: 1,
			raw: false,
			defval: "",
		})

		const { headerRowIndex, codeColumnIndex } = findHeader(rows, sheetName)

		for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
			const row = rows[rowIndex] ?? []
			const codeValue = String(row[codeColumnIndex] ?? "").trim()

			if (codeValue !== "") {
				deduplicatedCodes.add(codeValue)
			}
		}
	}

	return { codes: Array.from(deduplicatedCodes), sheetCount: workbook.SheetNames.length }
}

const resolveBatchSize = (): number => {
	const value = process.env.IMPORT_CODES_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE)
	const parsed = Number.parseInt(value, 10)

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error("IMPORT_CODES_BATCH_SIZE must be a positive integer.")
	}

	return parsed
}

const resolveWorkbookPath = (): string => {
	const configuredPath = process.env.IMPORT_CODES_FILE_PATH?.trim()
	if (!configuredPath) {
		return path.resolve(process.cwd(), "valid-codes.xlsx")
	}

	return path.resolve(process.cwd(), configuredPath)
}

const insertCodesInBatches = async (codes: string[], batchSize: number) => {
	let insertedCount = 0

	for (let index = 0; index < codes.length; index += batchSize) {
		const batch = codes.slice(index, index + batchSize).map((value) => ({ code: value }))
		const inserted = await db
			.insert(code)
			.values(batch)
			.onConflictDoNothing({ target: code.code })
			.returning({ id: code.id })

		insertedCount += inserted.length

		console.log(
			`Processed ${Math.min(index + batchSize, codes.length)}/${codes.length} codes. Inserted so far: ${insertedCount}.`,
		)
	}

	return insertedCount
}

const main = async () => {
	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not set. Add it to your environment or .env file.")
	}

	const workbookPath = resolveWorkbookPath()

	console.log(`Reading XLSX from: ${workbookPath}`)
	const { codes, sheetCount } = parseCodesFromWorkbook(workbookPath)
	const batchSize = resolveBatchSize()

	if (codes.length === 0) {
		throw new Error('No values were found in column "codigo completo".')
	}

	console.log(`Found ${codes.length} unique codes across ${sheetCount} sheets. Batch size: ${batchSize}.`)

	const insertedCount = await insertCodesInBatches(codes, batchSize)

	console.log(`Import complete. Inserted: ${insertedCount}. Skipped (already exists): ${codes.length - insertedCount}.`)
}

main().catch((error: unknown) => {
	const isError = error instanceof Error
	const baseMessage = isError ? error.message : String(error)
	const message =
		baseMessage.startsWith("Failed query:")
			? isError && error.cause instanceof Error
				? `Database insert failed: ${error.cause.message}`
				: "Database insert failed."
			: baseMessage

	console.error(`Import failed: ${message}`)
	process.exit(1)
})
