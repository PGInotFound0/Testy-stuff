#!/usr/bin/env python3
"""Secure Board Synapse entrypoint (stdlib only).

First boot: pins SYNAPSE_SERVER_NAME (permanent once the DB exists),
generates and persists secrets + the ed25519 signing key in /data,
renders homeserver.yaml from the template, then hands off to the stock
`/start.py run`. Later boots re-render deterministically and refuse to
start if SYNAPSE_SERVER_NAME changed.
"""
import os
import secrets as pysecrets
import subprocess
import sys
from typing import NoReturn

DATA = "/data"
TEMPLATE = "/secure-board/homeserver.yaml.template"
CONFIG = os.environ.get("SYNAPSE_CONFIG_PATH", f"{DATA}/homeserver.yaml")


def fail(msg: str) -> NoReturn:
    print(f"secure-board: error: {msg}", file=sys.stderr)
    sys.exit(2)


server = os.environ.get("SYNAPSE_SERVER_NAME", "").strip().lower().rstrip(".")
if (
    not server
    or "://" in server
    or "/" in server
    or " " in server
    or ":" in server
):
    fail(
        "SYNAPSE_SERVER_NAME must be a bare hostname "
        "(no scheme/port/path), e.g. matrix.example.com"
    )

public = os.environ.get("PUBLIC_BASEURL", "").strip().rstrip("/") or f"https://{server}"
if "://" not in public:
    fail("PUBLIC_BASEURL must be a full URL, e.g. https://matrix.example.com")

os.makedirs(DATA, exist_ok=True)
os.makedirs(f"{DATA}/media", exist_ok=True)

stamp = f"{DATA}/.server_name"
if os.path.exists(stamp):
    with open(stamp) as handle:
        stored = handle.read().strip()
    if stored != server:
        fail(
            f"SYNAPSE_SERVER_NAME changed ({stored} -> {server}); "
            "server_name is permanent once the database exists. "
            "Restore the old value."
        )
else:
    with open(stamp, "w") as handle:
        handle.write(server + "\n")


def secret(name: str) -> str:
    path = f"{DATA}/{name}.key"
    if os.path.exists(path):
        with open(path) as handle:
            value = handle.read().strip()
        if value:
            return value
    value = pysecrets.token_hex(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(value + "\n")
    return value


macaroon = secret("macaroon")
registration = secret("registration")
pepper = secret("pepper")

with open(TEMPLATE) as handle:
    rendered = handle.read()
rendered = (
    rendered.replace("%%SERVER_NAME%%", server)
    .replace("%%PUBLIC_BASEURL%%", public)
    .replace("%%MACAROON_SECRET_KEY%%", macaroon)
    .replace("%%REGISTRATION_SHARED_SECRET%%", registration)
    .replace("%%PASSWORD_PEPPER%%", pepper)
)
if "%%" in rendered:
    fail("template has unsubstituted %%TOKENS%%")

fd = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(rendered)

# /conf/log.config in the stock image is a Jinja template, not a usable
# logging config — pointing log_config at it crashes Synapse on boot.
# Write a static console-only config instead.
with open(f"{DATA}/log.config", "w") as handle:
    handle.write(
        """\
version: 1
formatters:
  precise:
    format: '%(asctime)s - %(name)s - %(lineno)d - %(levelname)s - %(request)s - %(message)s'
handlers:
  console:
    class: logging.StreamHandler
    formatter: precise
root:
  level: INFO
  handlers: [console]
disable_existing_loggers: false
"""
    )

# Generate the ed25519 signing key if missing (stock Synapse code path).
subprocess.run(
    [
        sys.executable,
        "-m",
        "synapse.app.homeserver",
        "--config-path",
        CONFIG,
        "--keys-directory",
        DATA,
        "--generate-keys",
    ],
    check=True,
)

# /start.py drops privileges to 991:991 (or $UID:$GID) via gosu when we run
# as root, so /data must belong to that user — a fresh named volume is
# root-owned, which otherwise crashes Synapse with permission errors.
uid = os.environ.get("UID", "991")
gid = os.environ.get("GID", "991")
if os.getuid() == 0:
    subprocess.run(["chown", "-R", f"{uid}:{gid}", DATA], check=True)

os.execv("/start.py", ["/start.py", "run"])
