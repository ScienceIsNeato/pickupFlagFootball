# syntax=docker/dockerfile:1
# Next.js standalone server for Cloud Run. Mirrors the Node 22-alpine multi-stage
# pattern used by the other Neon apps (ChronicChronicler, loopcloser).

# ---- deps: install once, cache on lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: produce .next/standalone ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they must be
# present here (not just at runtime). Passed via --build-arg from the workflow.
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL}
# Sentry environment label for the browser SDK (inlined at build — the browser
# has no runtime env). Server/edge get theirs at runtime via SENTRY_ENVIRONMENT.
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
# Surfaces Sentry's source-map upload logs during the CI build (withSentryConfig
# is silent unless CI is set); harmless when unset for local docker builds.
ARG CI
ENV CI=${CI}
ENV NEXT_TELEMETRY_DISABLED=1
# The DB clients only check DATABASE_URL is non-empty at import (the pool is lazy
# — no connection is opened at build time), and `next build` imports route modules
# while collecting page data. A credential-less placeholder satisfies that check.
# Real values are injected from Secret Manager at runtime, never baked into the image.
ENV DATABASE_URL=postgresql://localhost:5432/build
ENV DATABASE_URL_UNPOOLED=postgresql://localhost:5432/build
# SENTRY_AUTH_TOKEN lets withSentryConfig upload source maps during the build.
# Mounted as a BuildKit secret (required=false) so it's only present for this
# RUN and never lands in an image layer — and so builds without it (local, or
# before the secret exists) still succeed, just skipping the upload.
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build

# ---- production: minimal runtime ----
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Standalone bundles a pruned node_modules + server.js; static/ and public/ are
# served by that server and must be copied alongside it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER appuser
EXPOSE 8080
# Cloud Run injects PORT; the standalone server honors PORT + HOSTNAME.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
