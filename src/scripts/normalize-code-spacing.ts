import { sql } from "drizzle-orm"

import { db } from "../db/client"

type CountRow = {
	count: string
}

const whitespacePattern = "[[:space:]]+"
const whitespaceMatchPattern = "[[:space:]]"

const countRowsWithSpaces = async (): Promise<number> => {
	const result = await db.execute<CountRow>(
		sql`select count(*)::text as count from code where code ~ ${whitespaceMatchPattern}`,
	)

	return Number(result.rows[0]?.count ?? 0)
}

const countNormalizationConflicts = async (): Promise<number> => {
	const result = await db.execute<CountRow>(
		sql`
			select count(*)::text as count
			from code current_code
			where current_code.code ~ ${whitespaceMatchPattern}
				and exists (
					select 1
					from code other_code
					where other_code.id <> current_code.id
						and other_code.code = regexp_replace(current_code.code, ${whitespacePattern}, '', 'g')
				)
		`,
	)

	return Number(result.rows[0]?.count ?? 0)
}

const normalizeCodes = async (): Promise<number> => {
	const result = await db.execute<CountRow>(
		sql`
			with updated_rows as (
				update code
				set
					code = regexp_replace(code, ${whitespacePattern}, '', 'g'),
					updated_at = now()
				where code ~ ${whitespaceMatchPattern}
				returning 1
			)
			select count(*)::text as count from updated_rows
		`,
	)

	return Number(result.rows[0]?.count ?? 0)
}

const main = async () => {
	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not set. Add it to your environment or .env file.")
	}

	const rowsWithSpacesBefore = await countRowsWithSpaces()

	console.log(`Rows with whitespace before normalization: ${rowsWithSpacesBefore}`)

	if (rowsWithSpacesBefore === 0) {
		console.log("No rows require normalization.")
		return
	}

	const conflictCount = await countNormalizationConflicts()

	if (conflictCount > 0) {
		throw new Error(
			`Normalization aborted: found ${conflictCount} rows whose space-free code already exists.`,
		)
	}

	const updatedCount = await normalizeCodes()
	const rowsWithSpacesAfter = await countRowsWithSpaces()

	console.log(`Rows updated: ${updatedCount}`)
	console.log(`Rows with whitespace after normalization: ${rowsWithSpacesAfter}`)
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	console.error(`Normalization failed: ${message}`)
	process.exit(1)
})
