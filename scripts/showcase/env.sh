# Sourced by the showcase's shell scripts: where it keeps its throwaway state,
# and the ports it uses — none of them stickie's own 4870/5173.
SHOWCASE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SHOWCASE/../.." && pwd)
WORK=${STICKIE_SHOWCASE_WORK:-$SHOWCASE/.work}
PORT=${SHOWCASE_PORT:-4879}
export CDP_PORT=${CDP_PORT:-9341}
export STICKIE_URL=http://localhost:$PORT
mkdir -p "$WORK/repos" "$WORK/scratch"
