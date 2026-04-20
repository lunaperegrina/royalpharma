import { Elysia } from "elysia"
import { AppError } from "@/error"
import { apiRoutes } from "@/routes"
import indexHtml from "../public/index.html"

const port = Number(process.env.PORT ?? 3000)

export const app = new Elysia()
	.onError(({ error, set }) => {
		if (error instanceof AppError) {
			set.status = error.statusCode
			return {
				error: error.message,
				code: error.code,
				...(error.details ? { details: error.details } : {}),
			}
		}
	})
	.use(apiRoutes)
	.get("/health", () => "OK")

if (import.meta.main) {
	const server = Bun.serve({
		port,
		development: process.env.NODE_ENV !== "production",
		routes: {
			"/": indexHtml,
		},
		fetch(request) {
			return app.fetch(request)
		},
	})

	console.log(`Server is running at ${server.url}`)
}
