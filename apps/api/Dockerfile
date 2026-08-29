# Build multi-estagio: compila o TypeScript num estagio, roda so o
# resultado (dist/ + node_modules) no estagio final - imagem final menor,
# sem o compilador TypeScript nem os fontes .ts dentro dela.

FROM node:22-alpine AS builder
WORKDIR /app

# So os package.json primeiro (cache de layer: so reinstala se dependencia mudou,
# nao a cada mudanca de codigo). Workspace exige que os 2 apps existam aqui,
# mesmo so buildando a api.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api
EXPOSE 3000

CMD ["node", "dist/server.js"]
