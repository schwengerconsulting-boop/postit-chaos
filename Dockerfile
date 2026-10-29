# Post-it Chaos: build and run in one image (Node 24, see .nvmrc)
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1337 \
    ASSETS_DIR=/data/assets
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data/assets && chown -R node:node /data
USER node
WORKDIR /app/backend
EXPOSE 1337
VOLUME ["/data"]
CMD ["node", "--enable-source-maps", "dist/backend/src/server.js"]
