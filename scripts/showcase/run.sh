#!/bin/bash
# The README's pictures, made again: builds stickie, rebuilds the made-up
# project, and writes docs/images/*.png and *.gif. Stops what it started.
#   pnpm showcase            stills and GIFs
#   pnpm showcase shots      stills only
#   pnpm showcase gifs       GIFs only (loop, refs)
#   pnpm showcase demo       just the made-up project, left running to try out
set -euo pipefail
source "$(dirname "$0")/env.sh"
what=${1:-all}
if [ "$what" = demo ]; then
  (cd "$ROOT" && pnpm build >/dev/null)
  bash "$SHOWCASE/reset.sh" >/dev/null
  echo "the made-up project is at $STICKIE_URL — stop it with:"
  echo "  kill \$(lsof -tiTCP:$PORT -sTCP:LISTEN)"
  exit 0
fi
cleanup() {
  kill $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
  [ -n "${chrome:-}" ] && kill "$chrome" 2>/dev/null || true
}
trap cleanup EXIT
(cd "$ROOT" && pnpm build >/dev/null)
if ! curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null; then
  "$SHOWCASE/start-chrome.sh" > "$WORK/scratch/chrome.log" 2>&1 &
  chrome=$!
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null && break; sleep 0.25; done
fi
if [ "$what" = all ] || [ "$what" = shots ]; then
  bash "$SHOWCASE/reset.sh" >/dev/null
  node "$SHOWCASE/shots.mjs"
fi
if [ "$what" = all ] || [ "$what" = gifs ]; then
  VW=1200 VH=760 node "$SHOWCASE/gifs.mjs"
fi
