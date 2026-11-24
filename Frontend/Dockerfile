# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
# NEXT_PUBLIC_* values come from Frontend/.env.production (read by `next build`)
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl tini && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
RUN npm ci --omit=dev --no-audit --no-fund && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD curl -fsS http://localhost:8080/ > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
