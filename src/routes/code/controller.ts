import { Elysia, t } from "elysia"
import { CodeService } from "./service"

export const CodeController = new Elysia({ prefix: "/code" }).post(
	"/verify",
	async ({ body }) => {
		return CodeService.verify(body)
	},
	{
		body: t.Object({
			uuid: t.String(),
			code: t.String(),
		}),
		detail: {
			summary: "Verify and burn a product code",
			tags: ["Code"],
		},
	},
)
