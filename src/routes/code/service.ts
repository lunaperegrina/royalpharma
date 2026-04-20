import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { code as codeTable } from "@/db/schema"
import { AppError } from "@/error"

type VerifyCodeInput = {
	uuid: string
	code: string
}

type VerifyCodeResponse = {
	success: true
	message: "Produto validado com sucesso."
}

/** biome-ignore lint/complexity/noStaticOnlyClass: service pattern */
export abstract class CodeService {
	static async verify({
		uuid,
		code,
	}: VerifyCodeInput): Promise<VerifyCodeResponse> {
		const normalizedCode = code.trim()

		return db.transaction(async (tx) => {
			const existingCode = await tx.query.code.findFirst({
				where: eq(codeTable.id, uuid),
				columns: {
					id: true,
					code: true,
					used: true,
				},
			})

			if (!existingCode || existingCode.code !== normalizedCode) {
				throw new AppError(
					"CODE_NOT_FOUND",
					404,
					"Codigo ou identificador invalido.",
				)
			}

			if (existingCode.used) {
				throw new AppError("CODE_ALREADY_USED", 409, "Produto ja foi usado.")
			}

			const [updatedCode] = await tx
				.update(codeTable)
				.set({
					used: true,
					updatedAt: new Date(),
				})
				.where(and(eq(codeTable.id, uuid), eq(codeTable.used, false)))
				.returning({
					id: codeTable.id,
				})

			if (!updatedCode) {
				throw new AppError("CODE_ALREADY_USED", 409, "Produto ja foi usado.")
			}

			return {
				success: true,
				message: "Produto validado com sucesso.",
			}
		})
	}
}
