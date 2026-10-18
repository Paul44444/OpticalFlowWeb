#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.local/bin/cloudflared"

if [[ ! -x "$BIN" ]]; then
    printf 'Missing executable: %s\n' "$BIN" >&2
    exit 1
fi

coproc TUNNEL { "$BIN" tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8010 2>&1; }
TUNNEL_PID="${TUNNEL_PID}"
published=0

while IFS= read -r line <&"${TUNNEL[0]}"; do
    printf '%s\n' "$line"
    if [[ "$published" -eq 0 && "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
        published=1
        if ! "$ROOT/scripts/publish-quick-tunnel.sh" "${BASH_REMATCH[1]}"; then
            printf 'Tunnel is running, but its URL could not be published automatically.\n' >&2
        fi
    fi
done

wait "$TUNNEL_PID"
