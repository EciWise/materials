# ---------- STAGE 1: Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copiamos únicamente package.json + lock para instalar dependencias rápido
COPY package*.json ./

# Copiar carpeta Prisma ANTES de instalar dependencias (postinstall necesita schema.prisma)
COPY prisma ./prisma

# Instalar TODAS las dependencias sin postinstall (evita fallo de prisma generate sin DB real)
# Luego generar el cliente Prisma con una URL dummy válida (solo necesita formato correcto)
RUN npm ci --ignore-scripts && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    node node_modules/prisma/build/index.js generate

# Copiar el resto del código
COPY . .

# Compilar NestJS
RUN npm run build


# ---------- STAGE 2: Production ----------
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema necesarias para Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Variables de entorno para Puppeteer en Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiamos package.json y lock para instalar dependencias de producción
COPY package*.json ./

# Copiar otra vez Prisma → necesario para generar el cliente en runtime
COPY prisma ./prisma

# Instalar solo dependencias de producción y generar cliente Prisma
# DATABASE_URL real se provee en runtime; la URL dummy aquí solo es para generate
RUN npm ci --omit=dev --ignore-scripts && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    node node_modules/prisma/build/index.js generate

# Copiar build generado en el stage anterior
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
