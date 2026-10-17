#!/bin/bash
# The showcase's own stickie, built from this repository: its own port,
# database, config, and git identity (Jane Doe), so nothing of yours shows.
source "$(dirname "$0")/env.sh"
cd "$ROOT"
GIT_CONFIG_GLOBAL=$WORK/scratch/gitconfig GIT_CONFIG_NOSYSTEM=1 \
  STICKIE_CONFIG=$WORK/scratch/config.json STICKIE_DB=$WORK/scratch/showcase.sqlite \
  exec node bin/stickie.js "$WORK/repos/orbit-api" --port "$PORT" --no-open
