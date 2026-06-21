#!/usr/bin/env bash
#
# register-mycelium.sh
#
# Registers Crate as an OAuth2 client in the already-deployed mycelium API and
# creates an OAUTH2 "proof-of-tap" link mapping pointing at Crate's OAuth client.
# Optionally assigns that mapping to a tag or a collection so a tag scan flows:
#
#   tag scan -> mycelium OAUTH2 mapping -> 302 https://<HOST>/auth/callback?code=...
#
# This script ONLY calls the public mycelium management API. It does not modify
# mycelium code. The management endpoints are OIDC-protected (Authelia), so you
# must supply a valid Bearer token (an Authelia OIDC access/ID token).
#
# Verified against mycelium source:
#   oauth/handlers.go    CreateClient  -> POST /oauth/clients   (JSON, OIDC-authed)
#                        ExchangeToken -> POST /oauth/token     (form-encoded, client_secret_post)
#   mappings/handlers.go CreateMapping -> POST /mappings        (JSON, OIDC-authed)
#   mappings/mapping.go  OAUTH2 type requires oauth_client_id; token_delivery defaults to COOKIE
#   tags/handlers.go     PATCH /tags/:id        accepts link_mapping_id
#   collections/handlers PATCH /collections/:id accepts default_link_mapping_id
#
# Token exchange note (for crate-auth): mycelium /oauth/token expects
#   grant_type=authorization_code, code, client_id, client_secret, redirect_uri
# as application/x-www-form-urlencoded (client_secret_post). It returns
#   { "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600 }.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment or flags)
# ---------------------------------------------------------------------------
# MYCELIUM_BASE_URL : base URL of the mycelium API (management endpoints).
#                     Use the EXTERNAL/public URL here, because client + mapping
#                     registration is a one-time admin action from your laptop.
# HOST              : the public hostname Crate is served from (controls the
#                     redirect_uri). e.g. crate.example.com
# MYCELIUM_TOKEN    : Authelia OIDC Bearer token for the mycelium admin user.
# CLIENT_NAME       : display name for the OAuth client (default: crate).
# TAG_ID            : (optional) tag UUID to assign the mapping to.
# COLLECTION_ID     : (optional) collection UUID to set as default mapping.
# ---------------------------------------------------------------------------
MYCELIUM_BASE_URL="${MYCELIUM_BASE_URL:-}"
HOST="${HOST:-}"
MYCELIUM_TOKEN="${MYCELIUM_TOKEN:-}"
CLIENT_NAME="${CLIENT_NAME:-crate}"
TAG_ID="${TAG_ID:-}"
COLLECTION_ID="${COLLECTION_ID:-}"

usage() {
  cat <<'EOF'
Usage: register-mycelium.sh [options]

Registers Crate as a mycelium OAuth2 client and creates an OAUTH2 link mapping.

Required (flag or env var):
  --base-url URL     MYCELIUM_BASE_URL  mycelium API base, e.g. https://api.mycelium.example.com
  --host HOST        HOST               Crate public hostname, e.g. crate.example.com
  --token TOKEN      MYCELIUM_TOKEN     Authelia OIDC Bearer token (admin)

Optional:
  --name NAME        CLIENT_NAME        OAuth client display name (default: crate)
  --tag-id UUID      TAG_ID             assign mapping to this tag (PATCH /tags/:id)
  --collection-id U  COLLECTION_ID      set mapping as collection default (PATCH /collections/:id)
  -h, --help                            show this help

Output: prints client_id, client_secret (shown ONCE), and mapping_id.
Save client_id / client_secret into the crate-auth Secret immediately.

Example:
  ./register-mycelium.sh \
    --base-url https://api.mycelium.example.com \
    --host crate.example.com \
    --token "$(cat ~/.mycelium-token)" \
    --tag-id 11111111-2222-3333-4444-555555555555
EOF
}

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)      MYCELIUM_BASE_URL="$2"; shift 2 ;;
    --host)          HOST="$2"; shift 2 ;;
    --token)         MYCELIUM_TOKEN="$2"; shift 2 ;;
    --name)          CLIENT_NAME="$2"; shift 2 ;;
    --tag-id)        TAG_ID="$2"; shift 2 ;;
    --collection-id) COLLECTION_ID="$2"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "Error: curl is required" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "Error: jq is required"   >&2; exit 1; }

missing=()
[[ -z "$MYCELIUM_BASE_URL" ]] && missing+=("MYCELIUM_BASE_URL/--base-url")
[[ -z "$HOST" ]]              && missing+=("HOST/--host")
[[ -z "$MYCELIUM_TOKEN" ]]    && missing+=("MYCELIUM_TOKEN/--token")
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: missing required values: ${missing[*]}" >&2
  echo >&2
  usage
  exit 1
fi

# Strip any trailing slash from the base URL for clean concatenation.
MYCELIUM_BASE_URL="${MYCELIUM_BASE_URL%/}"
REDIRECT_URI="https://${HOST}/auth/callback"

# ---------------------------------------------------------------------------
# api: thin curl wrapper. Sends JSON, captures body + HTTP status, fails on >=400.
#   $1 = HTTP method, $2 = path, $3 = JSON body (optional)
# Echoes the response body to stdout on success.
# ---------------------------------------------------------------------------
api() {
  local method="$1" path="$2" body="${3:-}"
  local url="${MYCELIUM_BASE_URL}${path}"
  local resp status payload

  if [[ -n "$body" ]]; then
    resp="$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer ${MYCELIUM_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$body")"
  else
    resp="$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer ${MYCELIUM_TOKEN}")"
  fi

  status="${resp##*$'\n'}"
  payload="${resp%$'\n'*}"

  if [[ "$status" -ge 400 ]]; then
    echo "Error: ${method} ${path} returned HTTP ${status}" >&2
    echo "$payload" >&2
    exit 1
  fi
  printf '%s' "$payload"
}

echo "==> mycelium: ${MYCELIUM_BASE_URL}"
echo "==> Crate host: ${HOST}"
echo "==> redirect_uri: ${REDIRECT_URI}"
echo

# ---------------------------------------------------------------------------
# Step 1: Register the OAuth client.
#   POST /oauth/clients { name, redirect_uris }
#   Response includes client_secret EXACTLY ONCE.
# ---------------------------------------------------------------------------
echo "==> [1/3] Creating OAuth client '${CLIENT_NAME}'..."
client_body="$(jq -n \
  --arg name "$CLIENT_NAME" \
  --arg redirect "$REDIRECT_URI" \
  '{name: $name, description: "Crate music player (proof-of-tap)", redirect_uris: [$redirect]}')"

client_resp="$(api POST /oauth/clients "$client_body")"
CLIENT_ID="$(printf '%s' "$client_resp" | jq -r '.client_id')"
CLIENT_SECRET="$(printf '%s' "$client_resp" | jq -r '.client_secret')"

if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" || -z "$CLIENT_SECRET" || "$CLIENT_SECRET" == "null" ]]; then
  echo "Error: failed to parse client_id/client_secret from response:" >&2
  printf '%s\n' "$client_resp" >&2
  exit 1
fi
echo "    client_id:     ${CLIENT_ID}"
echo "    client_secret: ${CLIENT_SECRET}   <-- shown ONCE, save it now"
echo

# ---------------------------------------------------------------------------
# Step 2: Create the OAUTH2 link mapping referencing this client.
#   POST /mappings { name, mapping_type: "OAUTH2", oauth_client_id }
#   token_delivery defaults to COOKIE server-side; OAUTH2 only requires
#   oauth_client_id (mappings/mapping.go Validate()).
# ---------------------------------------------------------------------------
echo "==> [2/3] Creating OAUTH2 link mapping..."
mapping_body="$(jq -n \
  --arg name "${CLIENT_NAME}-oauth2" \
  --arg cid "$CLIENT_ID" \
  '{name: $name, description: "OAUTH2 proof-of-tap entry for Crate", mapping_type: "OAUTH2", oauth_client_id: $cid}')"

mapping_resp="$(api POST /mappings "$mapping_body")"
MAPPING_ID="$(printf '%s' "$mapping_resp" | jq -r '.mapping_id')"

if [[ -z "$MAPPING_ID" || "$MAPPING_ID" == "null" ]]; then
  echo "Error: failed to parse mapping_id from response:" >&2
  printf '%s\n' "$mapping_resp" >&2
  exit 1
fi
echo "    mapping_id:    ${MAPPING_ID}"
echo

# ---------------------------------------------------------------------------
# Step 3: Optionally assign the mapping to a tag or collection.
#   Tag:        PATCH /tags/:id        { link_mapping_id }
#   Collection: PATCH /collections/:id { default_link_mapping_id }  (applies to all tags in it)
# ---------------------------------------------------------------------------
echo "==> [3/3] Assigning mapping..."
if [[ -n "$TAG_ID" ]]; then
  echo "    Assigning mapping ${MAPPING_ID} to tag ${TAG_ID}..."
  api PATCH "/tags/${TAG_ID}" "$(jq -n --arg m "$MAPPING_ID" '{link_mapping_id: $m}')" >/dev/null
  echo "    Tag updated."
fi
if [[ -n "$COLLECTION_ID" ]]; then
  echo "    Setting default mapping ${MAPPING_ID} on collection ${COLLECTION_ID}..."
  api PATCH "/collections/${COLLECTION_ID}" "$(jq -n --arg m "$MAPPING_ID" '{default_link_mapping_id: $m}')" >/dev/null
  echo "    Collection updated."
fi
if [[ -z "$TAG_ID" && -z "$COLLECTION_ID" ]]; then
  echo "    (skipped: no --tag-id or --collection-id given)"
  echo "    To assign later, run one of:"
  echo "      curl -X PATCH ${MYCELIUM_BASE_URL}/tags/<TAG_ID> \\"
  echo "        -H 'Authorization: Bearer \$MYCELIUM_TOKEN' -H 'Content-Type: application/json' \\"
  echo "        -d '{\"link_mapping_id\":\"${MAPPING_ID}\"}'"
  echo "      curl -X PATCH ${MYCELIUM_BASE_URL}/collections/<COLLECTION_ID> \\"
  echo "        -H 'Authorization: Bearer \$MYCELIUM_TOKEN' -H 'Content-Type: application/json' \\"
  echo "        -d '{\"default_link_mapping_id\":\"${MAPPING_ID}\"}'"
fi
echo

# ---------------------------------------------------------------------------
# Summary — copy these into the crate-auth Secret.
# ---------------------------------------------------------------------------
cat <<EOF
=========================================================================
 Registration complete. Add these to the crate-auth Secret (see manifests):

   OAUTH_CLIENT_ID=${CLIENT_ID}
   OAUTH_CLIENT_SECRET=${CLIENT_SECRET}
   REDIRECT_URI=${REDIRECT_URI}

 mapping_id (mycelium-side reference): ${MAPPING_ID}

 The client_secret is NOT retrievable again. If lost, rotate via:
   POST ${MYCELIUM_BASE_URL}/oauth/clients/${CLIENT_ID}/rotate-secret
=========================================================================
EOF
