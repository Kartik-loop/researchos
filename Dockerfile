# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# The worker and migration runner execute TypeScript with tsx.
RUN npm ci --include=dev

FROM dependencies AS build
COPY . .
RUN mkdir -p public && npm run build

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS worker
ENV NODE_ENV=production
COPY --chown=node:node server ./server
COPY --chown=node:node worker ./worker
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node tsconfig.json ./tsconfig.json
USER node
CMD ["node", "--import", "tsx", "worker/index.ts"]
