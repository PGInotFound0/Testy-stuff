FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Default to the placeholder so builds succeed without a build-arg.
# Pass --build-arg SECURE_BOARD_HOMESERVER_URL=https://matrix.example.org
# to bake the real URL in, or set the same env var at runtime (see entrypoint).
ARG SECURE_BOARD_HOMESERVER_URL=https://replace-me.invalid
ENV SECURE_BOARD_HOMESERVER_URL=$SECURE_BOARD_HOMESERVER_URL
RUN npm run build

FROM nginx:1.30.4-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.d/15-secure-board-config.sh /docker-entrypoint.d/15-secure-board-config.sh
RUN chmod +x /docker-entrypoint.d/15-secure-board-config.sh
# Runtime defaults: entrypoint overwrites /config.json and MATRIX_CONNECT_SRC
# when SECURE_BOARD_HOMESERVER_URL is set to a real URL.
ENV SECURE_BOARD_HOMESERVER_URL=https://replace-me.invalid
ENV MATRIX_CONNECT_SRC=https://replace-me.invalid
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
