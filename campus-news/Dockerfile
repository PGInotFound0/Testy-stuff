# Campus News — statische Auslieferung via nginx
# Build:  docker build -t campus-news .
# Run:    docker run --rm -p 8080:80 campus-news   ->  http://localhost:8080

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Campus News" \
      org.opencontainers.image.description="PoC Nachrichten-Website Campus Technicus Bernburg" \
      org.opencontainers.image.licenses="MIT"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY assets /usr/share/nginx/html/assets

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
