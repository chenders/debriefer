# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/ packages/

RUN npm ci
RUN npx turbo build --filter=@debriefer/server

# Stage 2: Runtime
FROM node:22-alpine AS runtime

ARG INSTALL_BROWSERS=false

WORKDIR /app

RUN if [ "$INSTALL_BROWSERS" = "true" ]; then \
      apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont; \
    fi

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/sources/package.json packages/sources/package.json
COPY --from=builder /app/packages/server/package.json packages/server/package.json

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/sources/dist packages/sources/dist
COPY --from=builder /app/packages/server/dist packages/server/dist

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8090/api/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
