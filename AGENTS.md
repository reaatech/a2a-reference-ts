# AGENTS.md — a2a-reference-ts

> Agent-focused guidance for contributing to this codebase.

## Project Structure

This is a **pnpm workspace monorepo** managed with Turborepo.

```
packages/
  core/         — Canonical A2A types, Zod schemas, error classes, signature verification
  server/       — A2A server framework (Express + Hono adapters)
  client/       — A2A client SDK
  auth/         — Authentication strategies (OAuth2, JWT, API key)
  persistence/  — Task store abstractions (InMemory, Redis, Postgres, FileSystem)
  mcp-bridge/   — A2A ↔ MCP bidirectional adapter
  observability/ — Logging, tracing, metrics, telemetry
  cli/          — Agent scaffolding CLI (a2a init)
```

## Build System

- **Package manager:** pnpm (required)
- **Build tool:** tsup (per-package) + Turborepo (orchestration)
- **Format/Lint:** Biome (not Prettier/ESLint)
- **Test:** Vitest
- **TypeScript:** Strict mode, ESM + CJS dual output

### Common Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build everything
pnpm test             # Run all tests
pnpm test:coverage    # Run tests with coverage (>90% required)
pnpm lint             # Lint & format check
pnpm lint:fix         # Auto-fix lint issues
pnpm typecheck        # Type-check without emit
pnpm docs             # Generate TypeDoc API docs
```

## Coding Conventions

1. **Runtime validation:** Use Zod for all external-facing data. Never trust raw JSON.
2. **Logging:** Use Pino (from `packages/observability`). Never `console.log` in library code.
3. **Error handling:** Use typed `A2AError` subclasses from `packages/core`. Include error codes.
4. **Types:** Prefer `type` over `interface` for data shapes. Keep `interface` for class contracts.
5. **No `any`:** Biome is configured to error on `any`. Use `unknown` + narrowing instead.
6. **Exports:** Always provide ESM + CJS dual output with `types` condition first in `exports`.
7. **Coverage:** All packages must maintain >90% statement coverage.

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Use `@reaatech/a2a-reference-core` for shared types. Do not duplicate schemas.
3. Run `pnpm install` from the package directory

## Testing

- Unit tests live next to source files: `src/foo.test.ts`
- E2E tests live in `e2e/`
- Always run `pnpm test` and verify `pnpm test:coverage` before committing

## Protocol Compliance

When modifying types or schemas, cross-reference the A2A spec proto in `proto/`.
The spec is normative — our Zod schemas are derived from it.
