FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY dashboard ./dashboard
RUN npm ci && npm run build

FROM node:22-alpine AS runtime
RUN addgroup -S ain && adduser -S ain -G ain
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard ./dashboard
RUN npm ci --omit=dev && npm cache clean --force && chown -R ain:ain /app

USER ain
EXPOSE 8100

# By default the proxy binds to localhost. For container use, set AINONYMITY_HOST=0.0.0.0
# and be aware that this opens the proxy to any network the container attaches to.
ENV AINONYMITY_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8100/health || exit 1

CMD ["node", "dist/cli/index.js", "start"]
