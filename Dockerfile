# syntax=docker.io/docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Placeholder DATABASE_URL только для prisma generate.
# prisma.config.ts на module-load делает new URL(process.env.DATABASE_URL!)
# для построения SSL-параметров CLI. Сам prisma generate сетевых запросов
# не делает, URL нужен только для парсинга.
# Реальный DATABASE_URL приходит в runtime через Yandex Lockbox secrets.
# npm run build НЕ требует placeholder благодаря lazy init в lib/prisma.ts.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN mkdir -p /home/node/.postgresql
COPY scripts/yandex-root.crt /home/node/.postgresql/root.crt
RUN chown -R node:node /home/node/.postgresql

USER node

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

COPY --from=builder --chown=node:node /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=builder --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client

EXPOSE 3000

CMD ["node", "server.js"]
