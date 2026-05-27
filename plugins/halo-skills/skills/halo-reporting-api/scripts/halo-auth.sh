#!/usr/bin/env bash
# Halo API bearer-token helper. Exchanges Auth0 client credentials for an
# access token via the client-credentials grant and caches the result for
# 55 minutes (Auth0 tokens are valid for ~60 min).
#
# Inputs (env): AUTH0_URL, AUTH0_AUDIENCE, CLIENT_ID, CLIENT_SECRET
# Output: bearer token on stdout (no trailing newline).
# Exit codes: 0 on success, 1 on failure (no usable token).
#
# Cache:
#   ${XDG_CACHE_HOME:-$HOME/.cache}/halo-reporting-api/token   (mode 600)
#
# Optional override:
#   HALO_TOKEN_CACHE   alternate cache file path
#   HALO_TOKEN_MAX_AGE seconds before refresh (default 3300 = 55 min)

set -euo pipefail

: "${AUTH0_URL:?AUTH0_URL not set}"
: "${AUTH0_AUDIENCE:?AUTH0_AUDIENCE not set}"
: "${CLIENT_ID:?CLIENT_ID not set}"
: "${CLIENT_SECRET:?CLIENT_SECRET not set}"

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "halo-auth: required tool '$bin' not found in PATH" >&2
    exit 1
  fi
done

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/halo-reporting-api"
cache_file="${HALO_TOKEN_CACHE:-$cache_dir/token}"
max_age="${HALO_TOKEN_MAX_AGE:-3300}"

mkdir -p "$cache_dir"
chmod 700 "$cache_dir"

# Reuse cache if fresh.
if [ -f "$cache_file" ]; then
  if mtime=$(stat -c%Y "$cache_file" 2>/dev/null) \
       || mtime=$(stat -f%m "$cache_file" 2>/dev/null); then
    age=$(( $(date +%s) - mtime ))
    if [ "$age" -lt "$max_age" ]; then
      cat "$cache_file"
      exit 0
    fi
  fi
fi

# Build the JSON body via jq (NOT shell interpolation) so that JSON-special
# characters in secrets (`"`, `\`) don't malform the request.
body=$(jq -n \
  --arg cid "$CLIENT_ID" \
  --arg cs  "$CLIENT_SECRET" \
  --arg aud "$AUTH0_AUDIENCE" \
  '{client_id:$cid, client_secret:$cs, audience:$aud, grant_type:"client_credentials"}')

# `--fail-with-body` returns non-zero on HTTP >=400 while still printing the
# response so we can surface the Auth0 error message instead of an opaque exit.
resp=$(curl -sS --fail-with-body --max-time 30 \
  -X POST "${AUTH0_URL%/}/oauth/token" \
  -H 'Content-Type: application/json' \
  -d "$body" 2>&1) || {
  echo "halo-auth: Auth0 request failed" >&2
  echo "$resp" >&2
  exit 1
}

tok=$(printf '%s' "$resp" | jq -r '.access_token // empty')

# Guard: never cache empty / "null" / obviously-malformed tokens — a transient
# Auth0 failure would otherwise poison the cache for the full TTL and every
# subsequent call would silently 401.
if [ -z "$tok" ] || [ "$tok" = "null" ] || [ "${#tok}" -lt 20 ]; then
  echo "halo-auth: Auth0 returned no usable token — not caching." >&2
  exit 1
fi

# Write atomically so a concurrent reader never sees a half-written file.
tmp=$(mktemp "${cache_file}.XXXXXX")
printf '%s' "$tok" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$cache_file"
printf '%s' "$tok"
