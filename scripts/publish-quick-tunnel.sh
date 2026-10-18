#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-}"

if [[ ! "$URL" =~ ^https://[a-z0-9-]+\.trycloudflare\.com/?$ ]]; then
    printf 'Usage: %s https://your-quick-tunnel.trycloudflare.com\n' "$0" >&2
    exit 2
fi

cd "$ROOT"
if [[ -n "$(git status --porcelain -- frontend/public/backend.json)" ]]; then
    printf 'frontend/public/backend.json has uncommitted changes; refusing automatic publish.\n' >&2
    exit 1
fi

URL="${URL%/}"
printf '{"url":"%s"}\n' "$URL" > frontend/public/backend.json
git add -- frontend/public/backend.json
if git diff --cached --quiet -- frontend/public/backend.json; then
    printf 'Tunnel URL is already published.\n'
    exit 0
fi

git commit -m "Point frontend to current backend tunnel" -- frontend/public/backend.json
git push origin main
printf 'Published %s; Vercel deployment will follow.\n' "$URL"
