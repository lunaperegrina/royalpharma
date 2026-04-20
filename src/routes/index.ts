import { Elysia } from "elysia"
import { CodeController } from "./code/controller"

export const apiRoutes = new Elysia({ prefix: "/api" }).use(CodeController)
