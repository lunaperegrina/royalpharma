import {
	boolean,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"

export const code = pgTable(
	"code",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		code: text("code").notNull(),
		used: boolean("used").default(false).notNull(),
		usedBy: text("used_by"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		codeUniqueIdx: uniqueIndex("code_code_unique").on(table.code),
	}),
)
