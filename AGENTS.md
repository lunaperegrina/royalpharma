# Royal Pharma - Backend Guidelines

## Stack

Bun, Elysia, Drizzle ORM, PostgreSQL

---

## 1. Package Manager

- **SEMPRE** usar `bun` para instalar dependências e rodar scripts
- **NUNCA** usar `npm` ou `pnpm`
- Instalar pacotes: `bun add <pkg>`
- Rodar scripts: `bun run <script>`

## 2. Database (Drizzle)

- **SEMPRE** usar `bunx drizzle-kit push` para sincronizar schema com o banco
- **NUNCA** gerar ou rodar migrations (`drizzle-kit generate`, `drizzle-kit migrate`)
- Schema atual em `src/db/schema.ts`
- Client do banco em `src/db/client.ts`
- Config em `drizzle.config.ts`

## 3. Server - Controller + Service

**Controller (Elysia):** só recebe a request, valida params e delega para o Service.

```ts
export const xxxController = new Elysia({ prefix: "/xxx" }).get("/:id", async ({ params }) => {
	return xxxService.findById(params.id)
})
```

**Service:** abstract class com static methods. Toda lógica de negócio fica aqui.

```ts
/** biome-ignore lint/complexity/noStaticOnlyClass: service pattern */
export abstract class XxxService {
	static async findById(id: string) {
		// lógica aqui
	}
}
```

- **NUNCA** colocar lógica de negócio no controller
- Controller é apenas roteamento e validação de entrada
- Regras de domínio, acesso a banco e orquestração ficam no service

## 4. Exports

- **SEMPRE** usar named exports
- **NUNCA** usar `export default`

```ts
export function createApp() {}
```

## 5. Types

- **SEMPRE** usar `type`
- **NUNCA** usar `interface`

```ts
type CreateCodeInput = {
	code: string
}
```

## 6. Nomenclatura de Arquivos

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Controllers | `controller.ts` | `controller.ts` |
| Services | `service.ts` | `service.ts` |
| Utils | `-utils.ts` | `-utils.ts` |
| Tipos | `-types.ts` | `-types.ts` |
| Testes | `*.test.ts` | `service.test.ts` |

Arquivos com prefixo `-` são módulos colocalizados de apoio, não entrypoints.

## 7. Sem Duplicação de Código

- **ANTES** de criar código novo, buscar se algo similar já existe no projeto
- Lógica compartilhada deve ser extraída para `src/lib/` ou utilitários locais
- Se dois arquivos tiverem código igual ou muito parecido, refatorar para um lugar só

## 8. Imports

- `@/` para imports absolutos entre módulos
- Imports relativos para arquivos do mesmo diretório

```ts
import { db } from "@/db/client"
import { code } from "./schema"
```

## 9. Formatação

- **SEMPRE** usar `biome check` para lint e format quando o projeto tiver Biome configurado
- **NUNCA** usar eslint ou prettier em paralelo para o mesmo papel
- Convenções do guia original: tabs, double quotes, sem semicolons

## 10. Frontend (Tailwind)

- **SEMPRE** usar Tailwind para layout, espaçamento, tipografia, cores, estados visuais e responsividade
- **NUNCA** criar CSS autoral para componentes ou páginas quando Tailwind resolver o caso
- Arquivos `.css` devem ficar restritos ao bootstrap do Tailwind e, se indispensável, tokens/globais compatíveis com Tailwind v4
- Preferir utilitários inline no JSX/TSX ou constantes locais de classes para trechos repetidos

## 11. Testes

- Preferir Vitest para testes de services e utilitários
- Colocar testes ao lado do código quando fizer sentido
- Padrão: `describe` / `it` / `beforeEach`

## 12. Estrutura de Pastas

Estrutura atual:

```txt
src/
├── index.ts
├── db/
│   ├── client.ts
│   └── schema.ts
└── scripts/
    └── import-codes.ts
```

Estrutura alvo para expansão do backend:

```txt
src/
├── index.ts
├── db/
│   ├── client.ts
│   └── schema.ts
├── lib/
├── server/
│   ├── index.ts
│   ├── error.ts
│   └── routes/
│       └── [entity]/
│           ├── controller.ts
│           └── service.ts
└── scripts/
```
