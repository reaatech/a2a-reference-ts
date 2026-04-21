FROM node:22-alpine AS base
RUN npm install -g pnpm@10

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json biome.json ./
COPY packages/ ./packages/
COPY examples/ ./examples/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/turbo.json ./turbo.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/biome.json ./biome.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/examples ./examples
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["node", "examples/01-hello-agent/dist/index.js"]
