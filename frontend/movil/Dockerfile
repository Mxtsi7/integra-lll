# El contexto de build es frontend/ (no frontend/movil/), porque la app móvil
# depende de shared/ y Docker no puede copiar fuera del contexto.
# Ver docker-compose.yml.
FROM node:20-alpine

WORKDIR /app

# Primero solo los manifiestos, para que npm ci quede en caché mientras
# no cambien las dependencias.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY movil/package.json movil/
RUN npm ci

COPY . .

# Expo busca metro.config.js y .env desde aquí; docker-start.sh vive en esta carpeta.
WORKDIR /app/movil

# Metro (el celular se conecta a este puerto)
EXPOSE 8081
CMD ["sh", "docker-start.sh"]
