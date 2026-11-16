FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-alpine AS compilacion
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS ejecucion
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=compilacion /app/dist ./dist
COPY sql ./sql

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node dist/verificar-salud.js || exit 1

CMD ["node", "dist/worker.js"]
