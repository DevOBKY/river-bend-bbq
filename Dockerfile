# One image that builds the React site, then runs the API, which serves it (S3, lesson 3).

# Stage 1: build the site. The build tools stay in this stage and never reach the final image.
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the API, with only its production packages, plus the built site.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web/dist DB_DIR=/data/db
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY api/ ./
COPY --from=web /app/web/dist /app/web/dist
# The database lives outside the app's files, in /data: mount a volume there, or it's lost
# every time the container is replaced.
RUN mkdir /data && chown node /data
USER node
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://localhost:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.ts"]
