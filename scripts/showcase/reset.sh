#!/bin/bash
# Rebuilds the made-up project from nothing — repositories, scratch database,
# reviews — and leaves the showcase's stickie running on $PORT.
set -euo pipefail
source "$(dirname "$0")/env.sh"
# nothing may be reading the reviews while they are seeded
node "$SHOWCASE/blank.mjs" 2>/dev/null || true
kill $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
sleep 1
rm -f "$WORK"/scratch/showcase.sqlite*
printf '[user]\n\tname = Jane Doe\n\temail = jane@doe.com\n' > "$WORK/scratch/gitconfig"
bash "$SHOWCASE/make-repos.sh" >/dev/null
git -C "$WORK/repos/orbit-api" checkout -q feat/rate-limit
git -C "$WORK/repos/orbit-web" checkout -q feat/retry-banner
nohup "$SHOWCASE/start-stickie.sh" > "$WORK/scratch/server.log" 2>&1 &
for _ in $(seq 1 40); do curl -sf "$STICKIE_URL/api/repos" >/dev/null && break; sleep 0.25; done
node "$SHOWCASE/seed.mjs"
