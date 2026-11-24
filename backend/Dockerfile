FROM node:24.22.3-alpine3.24

ENV NODE_ENV=production
WORKDIR /app

RUN apk update --no-cache && apk upgrade --no-cache

COPY --chown=node:node backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix ./backend && npm cache clean --force

COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node frontend/public ./frontend/public
COPY --chown=node:node database/migrations ./database/migrations
COPY --chown=node:node tests/security ./tests/security

RUN mkdir -p /app/storage/uploads /app/tests/reports/security/evidence \
    && chown -R node:node /app/storage /app/tests/reports \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV PORT=3000
EXPOSE 3000
USER node

CMD ["sh", "-c", "node backend/src/db/migrate.js && node backend/src/db/seed.js && node backend/src/server.js"]
