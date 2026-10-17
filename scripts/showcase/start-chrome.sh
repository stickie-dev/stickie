#!/bin/bash
# A headless Chrome for the captures, on $CDP_PORT, with a profile of its own.
# CHROME names the binary when it is not where macOS or Linux usually put it.
source "$(dirname "$0")/env.sh"
for c in "$CHROME" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$(command -v google-chrome)" "$(command -v chromium)" "$(command -v chromium-browser)"; do
  [ -n "$c" ] && [ -x "$c" ] && { CHROME=$c; break; }
done
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME" >&2; exit 1; }
exec "$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$WORK/scratch/chrome" --window-size=1440,900 --hide-scrollbars \
  --no-first-run --no-default-browser-check --font-render-hinting=none about:blank
