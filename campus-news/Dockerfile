# Campus News — Node-Server (statische Auslieferung + Redaktions-API)
#
# Bewusst ohne npm-Abhängigkeiten: nur Node-Bordmittel (node:http, node:sqlite).
# Build:  docker build -t campus-news .
# Run:    docker run --rm -p 8080:3000 -v campus-data:/data campus-news
#
# In Coolify: Base Directory /campus-news, Port 3000, Volume auf /data.

FROM node:24-alpine

LABEL org.opencontainers.image.title="Campus News" \
      org.opencontainers.image.description="Nachrichten-PoC Campus Technicus Bernburg mit Redaktions-Login" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

COPY package.json ./package.json
COPY server ./server
COPY public ./public

# /data hält SQLite-DB und hochgeladene Bilder -> als Volume mounten
RUN mkdir -p /data/uploads
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
