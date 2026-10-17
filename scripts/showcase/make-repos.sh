#!/bin/bash
# Builds the two made-up repositories the showcase reviews: orbit-api, a small
# TypeScript order service, and orbit-web, its React client. All names, code
# and people in them are invented. Re-running starts them over.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$WORK/repos"
rm -rf orbit-api orbit-web

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
day=0
commit() { # commit <author name> <email> <message>
  day=$((day + 1))
  local when="2026-10-0${day}T10:$((10 + day)):00+02:00"
  [ $day -ge 10 ] && when="2026-10-${day}T10:$((10 + day)):00+02:00"
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -q -m "$3"
}
me() { commit "Jane Doe" "jane@doe.com" "$1"; }
agent() { commit "demo-agent" "agent@example.com" "$1"; }

init() {
  git init -q -b main "$1"
  cd "$1"
  git config user.name "Jane Doe"
  git config user.email "jane@doe.com"
}

# ---------------------------------------------------------------- orbit-api
init orbit-api
mkdir -p src/routes test
cat > package.json <<'EOF'
{
  "name": "orbit-api",
  "version": "0.4.0",
  "type": "module",
  "scripts": { "dev": "tsx watch src/server.ts", "test": "vitest run" }
}
EOF
cat > README.md <<'EOF'
# orbit-api

The order service behind orbit-web. `npm run dev` serves it on :8080.
EOF
cat > src/db.ts <<'EOF'
export interface Order {
  id: string
  customer: string
  total: number
  createdAt: string
}

const orders: Order[] = []

export function listOrders(customer: string, limit: number, after?: string) {
  const mine = orders.filter((o) => o.customer === customer)
  const start = after ? mine.findIndex((o) => o.id === after) + 1 : 0
  return mine.slice(start, start + limit)
}

export function addOrder(order: Order) {
  orders.push(order)
  return order
}
EOF
cat > src/routes/orders.ts <<'EOF'
import { Router } from 'express'
import { addOrder, listOrders } from '../db.js'

export const orders = Router()

orders.get('/', (req, res) => {
  const customer = String(req.header('x-customer'))
  const limit = Number(req.query.limit ?? 20)
  res.json(listOrders(customer, limit, req.query.after as string))
})

orders.post('/', (req, res) => {
  const order = addOrder({ ...req.body, createdAt: new Date().toISOString() })
  res.status(201).json(order)
})
EOF
cat > src/server.ts <<'EOF'
import express from 'express'
import { orders } from './routes/orders.js'

const app = express()
app.use(express.json())
app.use('/orders', orders)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(8080, () => console.log('orbit-api on :8080'))
EOF
me "Order service with an in-memory store"

cat > test/orders.test.ts <<'EOF'
import { describe, expect, it } from 'vitest'
import { addOrder, listOrders } from '../src/db.js'

describe('listOrders', () => {
  it('pages by the last id seen', () => {
    for (const id of ['a', 'b', 'c']) addOrder({ id, customer: 'c1', total: 1, createdAt: '' })
    expect(listOrders('c1', 2).map((o) => o.id)).toEqual(['a', 'b'])
    expect(listOrders('c1', 2, 'b').map((o) => o.id)).toEqual(['c'])
  })
})
EOF
me "Test paging"

# the agent's rate limiter
git checkout -q -b feat/rate-limit
cat > src/ratelimit.ts <<'EOF'
import type { NextFunction, Request, Response } from 'express'

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()

/**
 * A token bucket per customer: `capacity` requests at once, refilled at
 * `perSecond`. A request with no token left is answered 429 with Retry-After.
 */
export function rateLimit(capacity = 20, perSecond = 5) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.header('x-customer') ?? req.ip)
    const now = Date.now()
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now }

    const elapsed = (now - bucket.updatedAt) / 1000
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * perSecond)
    bucket.updatedAt = now
    buckets.set(key, bucket)

    if (bucket.tokens < 1) {
      const wait = Math.ceil((1 - bucket.tokens) / perSecond)
      res.setHeader('Retry-After', String(wait))
      return res.status(429).json({ error: 'rate limited', retryAfter: wait })
    }
    bucket.tokens -= 1
    next()
  }
}
EOF
cat > src/server.ts <<'EOF'
import express from 'express'
import { rateLimit } from './ratelimit.js'
import { orders } from './routes/orders.js'

const app = express()
app.use(express.json())
app.use('/orders', rateLimit(20, 5), orders)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(8080, () => console.log('orbit-api on :8080'))
EOF
agent "Rate-limit /orders per customer with a token bucket"

cat > test/ratelimit.test.ts <<'EOF'
import { describe, expect, it, vi } from 'vitest'
import { rateLimit } from '../src/ratelimit.js'

const call = (limit: ReturnType<typeof rateLimit>) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
  const next = vi.fn()
  limit({ header: () => 'c1', ip: '::1' } as never, res as never, next)
  return { res, next }
}

describe('rateLimit', () => {
  it('answers 429 once the bucket is empty', () => {
    const limit = rateLimit(2, 1)
    expect(call(limit).next).toHaveBeenCalled()
    expect(call(limit).next).toHaveBeenCalled()
    expect(call(limit).res.status).toHaveBeenCalledWith(429)
  })
})
EOF
agent "Test the rate limiter"
git checkout -q main

# a second branch, still being written
git checkout -q -b fix/pagination
cat > src/db.ts <<'EOF'
export interface Order {
  id: string
  customer: string
  total: number
  createdAt: string
}

const orders: Order[] = []

/** Newest first; `after` is the id of the last order on the previous page. */
export function listOrders(customer: string, limit: number, after?: string) {
  const mine = orders
    .filter((o) => o.customer === customer)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const start = after ? mine.findIndex((o) => o.id === after) + 1 : 0
  return mine.slice(start, start + Math.min(limit, 100))
}

export function addOrder(order: Order) {
  orders.push(order)
  return order
}
EOF
agent "Page orders newest first and cap a page at 100"
git checkout -q main
cd ..

# ---------------------------------------------------------------- orbit-web
init orbit-web
mkdir -p src/components src/hooks
cat > package.json <<'EOF'
{
  "name": "orbit-web",
  "version": "0.4.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" }
}
EOF
cat > src/api.ts <<'EOF'
export interface Order {
  id: string
  total: number
  createdAt: string
}

const base = import.meta.env.VITE_API ?? 'http://localhost:8080'

export async function fetchOrders(customer: string, after?: string) {
  const url = new URL('/orders', base)
  if (after) url.searchParams.set('after', after)
  const res = await fetch(url, { headers: { 'x-customer': customer } })
  if (!res.ok) throw new Error(`orders: ${res.status}`)
  return (await res.json()) as Order[]
}
EOF
cat > src/hooks/useOrders.ts <<'EOF'
import { useEffect, useState } from 'react'
import { fetchOrders, type Order } from '../api'

export function useOrders(customer: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetchOrders(customer).then(setOrders, setError)
  }, [customer])

  return { orders, error }
}
EOF
cat > src/components/OrderList.tsx <<'EOF'
import { useOrders } from '../hooks/useOrders'

export function OrderList({ customer }: { customer: string }) {
  const { orders, error } = useOrders(customer)
  if (error) return <p className="error">Could not load your orders.</p>
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>
          {o.id} · {o.total.toFixed(2)} €
        </li>
      ))}
    </ul>
  )
}
EOF
me "Order list for a customer"

git checkout -q -b feat/retry-banner
cat > src/api.ts <<'EOF'
export interface Order {
  id: string
  total: number
  createdAt: string
}

export class RateLimited extends Error {
  constructor(public retryAfter: number) {
    super(`rate limited, retry in ${retryAfter}s`)
  }
}

const base = import.meta.env.VITE_API ?? 'http://localhost:8080'

export async function fetchOrders(customer: string, after?: string) {
  const url = new URL('/orders', base)
  if (after) url.searchParams.set('after', after)
  const res = await fetch(url, { headers: { 'x-customer': customer } })
  if (res.status === 429) {
    throw new RateLimited(Number(res.headers.get('Retry-After') ?? 1))
  }
  if (!res.ok) throw new Error(`orders: ${res.status}`)
  return (await res.json()) as Order[]
}
EOF
cat > src/components/RetryBanner.tsx <<'EOF'
import { useEffect, useState } from 'react'

export function RetryBanner({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const [left, setLeft] = useState(seconds)

  useEffect(() => {
    if (left <= 0) return onRetry()
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left, onRetry])

  return <p className="banner">Too many requests — trying again in {left}s</p>
}
EOF
cat > src/components/OrderList.tsx <<'EOF'
import { RateLimited } from '../api'
import { useOrders } from '../hooks/useOrders'
import { RetryBanner } from './RetryBanner'

export function OrderList({ customer }: { customer: string }) {
  const { orders, error, reload } = useOrders(customer)
  if (error instanceof RateLimited) {
    return <RetryBanner seconds={error.retryAfter} onRetry={reload} />
  }
  if (error) return <p className="error">Could not load your orders.</p>
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>
          {o.id} · {o.total.toFixed(2)} €
        </li>
      ))}
    </ul>
  )
}
EOF
cat > src/hooks/useOrders.ts <<'EOF'
import { useCallback, useEffect, useState } from 'react'
import { fetchOrders, type Order } from '../api'

export function useOrders(customer: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(() => {
    setError(null)
    fetchOrders(customer).then(setOrders, setError)
  }, [customer])

  useEffect(reload, [reload])

  return { orders, error, reload }
}
EOF
agent "Show a retry banner when the API rate-limits the order list"
git checkout -q main

git checkout -q -b chore/currency
sed -i '' 's/{o.total.toFixed(2)} €/{euros.format(o.total)}/' src/components/OrderList.tsx
sed -i '' "1i\\
const euros = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })\\

" src/components/OrderList.tsx
agent "Format order totals with Intl.NumberFormat"
git checkout -q main
cd ..

for r in orbit-api orbit-web; do echo "== $r"; git -C $r log --all --format='%h %an %s' | head -8; done
