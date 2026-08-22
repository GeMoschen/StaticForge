# Builds the StaticForge Angular SPA and serves it behind nginx.
#
# Build context is the repository root (see infra/docker/docker-compose.yml,
# `context: ../..`), so this file reaches both `ui/` and `infra/nginx/`.

# --- Stage 1: build the Angular app ---
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci

COPY ui/ ./

# `build` is expected to be an npm script producing a production bundle. The output path
# below is the Angular 18 application-builder default (`dist/<project>/browser`); adjust
# if ui/angular.json configures a different outputPath.
RUN npm run build

# --- Stage 2: serve with nginx ---
FROM nginx:alpine

# staticforge-ui SPA + /api reverse proxy (see infra/nginx/default.conf).
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/staticforge-ui/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
