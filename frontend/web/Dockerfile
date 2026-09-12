# El contexto de build es frontend/ (no frontend/web/), porque la web
# depende de shared/ y Docker no puede copiar fuera del contexto.
# Ver docker-compose.yml.
FROM node:20-alpine

WORKDIR /app

# Primero solo los manifiestos, para que npm ci quede en caché mientras
# no cambien las dependencias.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
RUN npm ci

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=web"]
