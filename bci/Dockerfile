# Standalone BCI API image. Independent of the ANATOLIA-Q image/Dockerfile
# at the repo root -- BCI must be deployable and buildable on its own.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
# Scanner binaries live in the isolated worker image. The API must expose the
# worker's persisted health snapshot instead of probing its own filesystem and
# overwriting healthy worker results with false OFFLINE statuses.
ENV BCI_ENGINE_HEALTH_MODE=WORKER
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 8081) + '/api/v1/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
