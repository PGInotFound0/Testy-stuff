FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG SECURE_BOARD_HOMESERVER_URL
ENV SECURE_BOARD_HOMESERVER_URL=$SECURE_BOARD_HOMESERVER_URL
RUN npm run build

FROM nginx:1.30.4-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
