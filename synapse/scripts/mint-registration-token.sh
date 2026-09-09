#!/usr/bin/env bash
# Mint a registration token on the Secure Board homeserver.
# Usage: SYNAPSE_URL=https://matrix.example.com ./mint-registration-token.sh
#
# You need:
#   1. The registration_shared_secret (first line of /data/registration.key
#      inside the running container: `cat /data/registration.key` via the
#      Coolify terminal).
#   2. An admin access token. If you don't have one yet, this script can
#      bootstrap the first admin user through the shared-secret nonce flow.
set -euo pipefail

SYNAPSE_URL="${SYNAPSE_URL:-${1:-}}"
if [ -z "$SYNAPSE_URL" ]; then
  echo "Usage: SYNAPSE_URL=https://matrix.example.com $0" >&2
  exit 1
fi
SYNAPSE_URL="${SYNAPSE_URL%/}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need curl
need python3

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "--- Bootstrap: create the first admin user ---"
  echo "Get the shared secret: Coolify terminal -> cat /data/registration.key"
  read -r -s -p "registration_shared_secret: " SHARED_SECRET
  echo
  read -r -p "new admin username (e.g. admin): " ADMIN_USER
  read -r -s -p "new admin password: " ADMIN_PASS
  echo
  NONCE=$(curl -s "$SYNAPSE_URL/_synapse/admin/v1/register" | python3 -c "import sys,json; print(json.load(sys.stdin)['nonce'])")
  MAC=$(python3 -c "import hmac,hashlib; print(hmac.new(b'$SHARED_SECRET', b'$NONCE\x00$ADMIN_USER\x00$ADMIN_PASS\x00admin', hashlib.sha1).hexdigest())")
  ADMIN_TOKEN=$(curl -s -X POST "$SYNAPSE_URL/_synapse/admin/v1/register" \
    -H 'Content-Type: application/json' \
    -d "{\"nonce\": \"$NONCE\", \"username\": \"$ADMIN_USER\", \"password\": \"$ADMIN_PASS\", \"admin\": true, \"mac\": \"$MAC\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
  echo "Admin user '$ADMIN_USER' created. Export ADMIN_TOKEN=$ADMIN_TOKEN to reuse it."
fi

read -r -p "Token uses allowed (blank = unlimited): " USES
read -r -p "Token expiry time, e.g. 2027-01-01T00:00:00Z (blank = never): " EXPIRY
BODY='{}'
[ -n "$USES" ] && BODY=$(python3 -c "import json; print(json.dumps({'uses_allowed': $USES}))")
[ -n "$EXPIRY" ] && BODY=$(python3 -c "import json; d=json.loads('$BODY'); d['expiry_time']='$(echo "$EXPIRY" | sed 's/+0000/Z/')'; print(json.dumps(d))")

echo "--- Minting registration token ---"
curl -s -X POST "$SYNAPSE_URL/_synapse/admin/v1/registration_tokens/new" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
echo
echo "Hand the 'token' value to the user: they enter it in the board's signup form."
