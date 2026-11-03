# Build the web app and API, then run both from one production image.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY . .
RUN npm run build
RUN cp server/src/db/schema.sql server/dist/db/schema.sql

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/data ./server/data
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh \
    && mkdir -p server/storage/evidence \
    && chmod 700 server/storage/evidence

EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
