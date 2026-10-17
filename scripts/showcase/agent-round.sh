#!/bin/bash
# The demo agent's round on orbit-api's feat/rate-limit: the edits its replies
# in seed.mjs describe, committed on the branch.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$WORK/repos/orbit-api"
python3 - <<'EOF'
p='src/ratelimit.ts'; s=open(p).read()
s=s.replace("""const buckets = new Map<string, Bucket>()
""","""const buckets = new Map<string, Bucket>()

// a bucket back at capacity says nothing a new one would not, so drop it
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.tokens + ((now - bucket.updatedAt) / 1000) * 5 >= 20) buckets.delete(key)
  }
}, 60_000).unref()
""")
s=s.replace(""" * `perSecond`. A request with no token left is answered 429 with Retry-After.
 */""",""" * `perSecond`. A request with no token left is answered 429 with Retry-After,
 * in whole seconds: orbit-web counts it down as it is.
 */""")
s=s.replace("""    const key = String(req.header('x-customer') ?? req.ip)""","""    // TODO: key on the API key once auth lands; x-customer is client-supplied
    const key = String(req.ip)""")
open(p,'w').write(s)
t='test/ratelimit.test.ts'; s=open(t).read()
s=s.replace("""    expect(call(limit).res.status).toHaveBeenCalledWith(429)
  })
})""","""    expect(call(limit).res.status).toHaveBeenCalledWith(429)
  })

  it('lets a request through again after the refill', () => {
    vi.useFakeTimers()
    const limit = rateLimit(1, 1)
    call(limit)
    expect(call(limit).res.status).toHaveBeenCalledWith(429)
    vi.advanceTimersByTime(1000)
    expect(call(limit).next).toHaveBeenCalled()
    vi.useRealTimers()
  })
})""")
s=s.replace("limit({ header: () => 'c1', ip: '::1' } as never","limit({ ip: '::1' } as never")
open(t,'w').write(s)
EOF
git add -A
GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=demo-agent GIT_AUTHOR_EMAIL=agent@example.com \
  GIT_COMMITTER_NAME=demo-agent GIT_COMMITTER_EMAIL=agent@example.com \
  GIT_AUTHOR_DATE=2026-10-13T16:05:00+02:00 GIT_COMMITTER_DATE=2026-10-13T16:05:00+02:00 \
  git commit -q -m "Sweep full buckets, key on req.ip, test the refill"
