# Secure Board homeserver: stock Synapse image plus a first-boot entrypoint
# that renders homeserver.yaml from a template and persists secrets/keys
# in /data. No secrets are baked into the image.
FROM matrixdotorg/synapse:v1.160.0

COPY conf/homeserver.yaml.template /secure-board/homeserver.yaml.template
COPY entrypoint.py /secure-board/entrypoint.py
RUN chmod +x /secure-board/entrypoint.py

# The entrypoint must start as root: it writes /data (root-owned on a fresh
# named volume) and chowns it to 991:991 before /start.py drops privileges.
USER root

VOLUME ["/data"]
EXPOSE 8008

ENTRYPOINT ["/secure-board/entrypoint.py"]
