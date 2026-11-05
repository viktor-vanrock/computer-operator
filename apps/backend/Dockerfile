# ---- Build stage ----
FROM registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24:24.17.0 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/

RUN npm ci --workspace=apps/backend --include-workspace-root

COPY apps/backend/prisma/ apps/backend/prisma/
COPY apps/backend/src/ apps/backend/src/
COPY apps/backend/tsconfig.json apps/backend/
COPY tsconfig.base.json ./

WORKDIR /app/apps/backend
RUN npx prisma generate && npx tsc && npx tsc-alias

# ---- Runtime stage ----
FROM registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24:24.17.0

# GigaChat uses the Russian Trusted CA chain. Extend the system trust store
# before switching to the application working directory.
COPY apps/backend/pki/*.crt /tmp/pki/
RUN { echo ""; cat /tmp/pki/*.crt; } >> /etc/ssl/certs/ca-certificates.crt && rm -r /tmp/pki
ENV NODE_OPTIONS=--use-openssl-ca

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/

RUN npm --prefix /usr/local/lib/node_modules/npm/node_modules/tinyglobby install picomatch@4.0.4 && \
    npm ci --workspace=apps/backend --include-workspace-root --omit=dev

COPY --from=builder /app/apps/backend/dist/ apps/backend/dist/
COPY --from=builder /app/apps/backend/prisma/ apps/backend/prisma/
COPY --from=builder /app/node_modules/.prisma/ node_modules/.prisma/

WORKDIR /app/apps/backend
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
