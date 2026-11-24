# Harmony Hub POS – Backend

NestJS backend for the Next.js POS frontend in `../Frontend`.

| Concern | Technology |
|---|---|
| API | NestJS 10 (REST, Swagger at `/docs`) |
| Database / ORM | PostgreSQL 16 + Prisma 5 |
| Real-time | Socket.IO 4 (Redis adapter, multi-instance safe) |
| Cache | Redis 7 |
| Background jobs | BullMQ (print, inventory, notifications, scheduled, search reindex) |
| Event streaming + broker | Apache Kafka (KRaft) via `kafkajs` |
| Search | OpenSearch 2 (typo-tolerant menu/order/reservation search, PostgreSQL fallback) |
| Deployment | Docker + Docker Compose |

## Quick start

**Everything is run from the repo root** with the single `docker-compose.yml` (frontend, api, worker, PostgreSQL, Redis, Kafka, OpenSearch):

```bash
cd WS-POS
cp Backend/.env.docker.example Backend/.env.docker   # set the JWT secrets
docker compose up -d --build
# Frontend http://localhost:8080  ·  API http://localhost:5000/docs
```

Configuration lives with each part, not at the root: `Backend/.env.docker` (api, worker and the Postgres credentials) and `Frontend/.env.production` (public `NEXT_PUBLIC_*` URLs, baked in at build time, so they must be browser-reachable). When deploying behind a domain, change those URLs, add the origin to `CORS_ORIGINS`, and rebuild. Host ports can be overridden from the shell (`API_PORT=5001 docker compose up -d`).

**Backend details:**

```bash
cd Backend && cp .env.example .env  # (host-run API/dev only)
# API:      http://localhost:5000/api/v1      Swagger: http://localhost:5000/docs
# Health:   http://localhost:5000/health
node scripts/smoke.mjs               # 33-step end-to-end check (REST + Kafka + sockets + queues + search)
```

The `api` container applies migrations and seeds on boot (`RUN_SEED=true`). With `DEMO_MODE=true` (default in the example env) the sign-in page shows **one-click demo logins**, and `SEED_DEMO_DATA=true` adds demo data: 14 days of paid orders/bills (~150, for dashboards and reports), 3 open orders in the kitchen/billing flow, 4 reservations, low-stock items, notifications and 2 inactive demo printers. The seed is idempotent. **Turn both flags off in production** – `GET /auth/demo-accounts` returns the credentials only while `DEMO_MODE=true`.

| Seeded login | Password | Role |
|---|---|---|
| `admin@harmonyhub.com` | `Admin@12345` | SUPER_ADMIN |
| `manager@harmonyhub.com` | `Manager@123` | BRANCH_MANAGER |
| `cashier@harmonyhub.com` | `Cashier@123` | CASHIER |
| `waiter@harmonyhub.com` | `Waiter@123` | WAITER |
| `kitchen@harmonyhub.com` | `Kitchen@123` | KITCHEN_STAFF |
| `owner@harmonyhub.com` | `Owner@123` | RESTAURANT_ADMIN |
| `waiter2@harmonyhub.com` | `Waiter@123` | WAITER (second waiter, for staff reports) |

The seeded branch id is `b1c2d3e4-f5a6-7890-bcde-f12345678901`, the same value as the frontend's `NEXT_PUBLIC_BRANCH_ID`.
**Change or remove these accounts before going to production.**

Optional tooling: `docker compose --profile tools up -d` adds Kafka UI (`:8081`) and OpenSearch Dashboards (`:5601`).

### Local development (API on the host, infra in Docker)

```bash
# from the repo root (infra only):
docker compose up -d postgres redis kafka opensearch
cd Backend && npm install
npx prisma migrate deploy && npm run db:seed
npm run start:dev                    # APP_ROLE=all: HTTP + sockets + every consumer in one process
```

> The example env maps PostgreSQL to host port **5433** (so it does not clash with a local PostgreSQL on 5432); keep `POSTGRES_PORT` and the port in `DATABASE_URL` in sync.
> To run without Kafka / OpenSearch set `KAFKA_ENABLED=false` / `OPENSEARCH_ENABLED=false`: events are dispatched in-process and search falls back to PostgreSQL.

## Architecture

```
 Next.js ──REST──▶  API (APP_ROLE=api) ──▶ PostgreSQL (Prisma)
    ▲                │   │                    ▲
    │ Socket.IO      │   └─ Redis: cache, sequences, Socket.IO adapter
    │                ▼
    │         Kafka topics  pos.order | pos.table | pos.kot | pos.bill | pos.menu |
    │                       pos.inventory | pos.reservation | pos.notification | pos.print | pos.user
    │                │
    │   ┌────────────┼──────────────────────────┬──────────────────┐
    │   ▼            ▼                          ▼                  ▼
    └─ group:realtime   group:workflows      group:search-indexer  group:audit
       (API)            (worker)             (worker)              (worker)
       emits socket     enqueues BullMQ      indexes OpenSearch    writes audit_logs
       events           jobs
                          │
                          ▼
              BullMQ (Redis): print · inventory · notifications · scheduled · search-reindex
```

* **Write path**: a service commits to PostgreSQL, then publishes a domain event (with an entity snapshot) to Kafka, keyed by `branchId` so one branch's events stay ordered. Publishing never fails the request: if Kafka is unreachable the event is dispatched in-process.
* **Consumers** are separate Kafka consumer groups, so each concern scales and fails independently. Handlers are idempotent (Kafka is at-least-once) and failed messages are retried 3× then parked on `pos.dlq`.
* **`APP_ROLE`**: `all` (dev), `api` (HTTP + sockets + realtime consumer) or `worker` (consumers + BullMQ processors, no port). Run `docker compose up -d --scale worker=3` to scale workers; scale `api` behind a load balancer (the Redis adapter keeps sockets in sync).

### What happens when a waiter places an order

1. `POST /orders` prices every line **server-side** (variants/add-ons, tax and service charge from the restaurant settings), creates the order, a numbered KOT, and marks the table `occupied` – all in one transaction with a row lock on the table.
2. Events `order.created`, `kot.created`, `table.status_changed` go to Kafka.
3. `realtime` consumer → Socket.IO: `order:created`, `order:new` + `kot:new` (kitchen room), `table:updated`.
4. `workflows` consumer → BullMQ: **print** the KOT (ESC/POS over TCP:9100 to network printers, routed per category; USB printers get a `print:job` socket event for the local terminal) and **deduct recipe ingredients** from inventory (idempotent per KOT; low-stock alerts when crossing the minimum).
5. `search-indexer` updates OpenSearch, `audit` records the event.
6. A second order on a table that already has an open order **appends** to the running order (one bill per table).

Paying (`/billing/...`) completes the bill, marks order(s) paid + served, moves the table to `cleaning`, auto-prints the receipt (if a bill printer exists) and notifies the floor.

## Frontend ⇄ backend connection (CORS + token)

* **CORS**: the API only answers browsers from `CORS_ORIGINS` (default `http://localhost:8080,http://localhost:3000`), with credentials and the custom `X-Response-Case` header allowed. Any other origin gets no `Access-Control-Allow-Origin` header and the browser blocks it. Socket.IO uses the same allow-list. For a real domain, set `CORS_ORIGINS` in `Backend/.env.docker` and the public URLs in `Frontend/.env.production`, then rebuild.
* **Token auth**: `POST /auth/login` returns `accessToken` (15 min) + `refreshToken` (7 days). The frontend's axios client sends `Authorization: Bearer <accessToken>` on every call; on a 401 it calls `POST /auth/refresh-token` once and retries, and only sends the user back to `/auth` if that fails (login failures and the public QR page never redirect). The Socket.IO connection authenticates with the same token (`auth: { token }`, WebSocket transport) and is dropped on sign-out. The refresh token is not rotated (the client stores only the new access token); logout and deactivating a user revoke it.
* **Roles**: the token carries the user's roles and branches; every endpoint is role- and branch-scoped, and the sidebar is filtered by role in the UI. Public sign-up may only pick CASHIER / WAITER / KITCHEN_STAFF; the first account ever created becomes SUPER_ADMIN (`ALLOW_PUBLIC_REGISTRATION=false` disables self sign-up).
* **Public (no token)**: the QR ordering page uses `/public/*`, plus read-only `/menu`, `/tables` and `/restaurants/default-branch`.
* **Response shape**: `{ success, data, meta? }`; errors are `{ success:false, statusCode, message }` with a string `message` (the UI shows it in toasts). Money is numeric, enums use the frontend's strings. Responses are camelCase; screens written against the old row shapes ask for snake_case with `X-Response-Case: snake` (`apiClient.snake.*`), and request bodies may be either case.
* **Rate limiting**: the API itself no longer rate-limits (the in-app throttler was removed); put rate limits on login/register at your reverse proxy / gateway in production. `THROTTLE_LIMIT` in the env files is now unused.
* **Verified in a browser**: the `e2e/` folder runs the real UI in headless Chromium – login, every screen, taking an order, the kitchen, paying, the QR guest page with live status, and the waiter/kitchen/cashier role views.

## API overview (`/api/v1`, interactive docs at `/docs`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login · register · refresh-token · logout · change-password`, `GET/PUT /auth/profile`, `GET /auth/roles`, `GET/POST /auth/users`, `PUT/DELETE /auth/users/:id`, `POST/DELETE /auth/users/:id/roles[/:roleId]` |
| Restaurant | `GET /restaurants`, `/restaurants/default-branch` (public), `/restaurants/stats`, `GET/PUT /restaurants/:id`, `GET/POST/PUT/DELETE /branches` |
| Tables | `GET /tables`, `GET/PUT/DELETE /tables/:id`, `POST /tables`, `PATCH /tables/:id/status`, `POST /tables/:id/merge · unmerge · shift · split`, `PATCH /tables/layout`, `GET /tables/:id/qr` |
| Menu | `GET /menu` (grouped), `GET/POST/PUT/DELETE /menu/categories`, `/menu/items`, `PATCH /menu/items/:id/availability`, `GET/PUT /menu/items/:id/recipe` |
| Orders | `GET/POST /orders`, `GET/PUT /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/items`, `PATCH/DELETE /orders/:id/items/:itemId`, `POST /orders/:id/kot/reprint`, `GET /orders/items` |
| Kitchen | `GET /kitchen/kots`, `PATCH /kitchen/kots/:id/status` |
| Billing | `GET /billing`, `GET /billing/:id`, `POST /billing/orders/:orderId/generate · checkout · split`, `POST /billing/:id/payments · discount · refund`, `POST /billing/partial · merge`, `GET /billing/reports`, `GET /payments` |
| Reports | `GET /reports/dashboard · summary · sales · top-items · categories · payment-methods · staff · peak-hours · order-types · inventory · overview` |
| Inventory | `GET/POST/PUT/DELETE /inventory`, `GET /inventory/low-stock`, `POST /inventory/:id/stock`, `GET /inventory/:id/transactions` |
| Reservations | `GET/POST /reservations`, `GET/PUT/DELETE /reservations/:id`, `PATCH /reservations/:id/status`, `GET /reservations/availability` |
| Printing | `GET/POST /printers`, `PUT/DELETE /printers/:id`, `POST /printers/:id/test · open-drawer`, `GET /printers/jobs`, `POST /printers/jobs/:id/retry · cancel`, `PATCH /printers/jobs/:id/ack`, `POST /printers/print/bill · kot`, `GET/PUT /printers/templates` |
| Search | `GET /search?q=`, `/search/menu`, `/search/orders`, `/search/reservations`, `POST /search/reindex` (admin) |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |
| Customer (no auth) | `/public/*` (see above) |
| Ops | `GET /health` (readiness), `GET /health/live` |

Role model: `SUPER_ADMIN` and `RESTAURANT_ADMIN` manage everything; `BRANCH_MANAGER` manages their branch; `CASHIER` bills; `WAITER` takes orders; `KITCHEN_STAFF` works the KDS and sold-out toggles. Every query is scoped to the branches the caller's roles allow.

## Socket.IO

Connect with `io(SOCKET_URL, { auth: { token: accessToken } })`.

| Client → server | Notes |
|---|---|
| `join:branch` / `leave:branch` `<branchId>` | needs a role on that branch |
| `join:kitchen` / `leave:kitchen` `<branchId>` | staff roles only |
| `join:table` / `join:order` `<id>` | open to anonymous QR customers |
| `ping` → `pong` | |

| Server → client | Rooms |
|---|---|
| `order:created`, `order:updated`, `order:deleted`, `order:status:changed` | branch (+ kitchen, order, table) |
| `order:new`, `kot:new`, `kot:created`, `kot:updated` | kitchen (+ branch for `kot:*`) |
| `table:updated`, `table:status:changed`, `table:deleted` | branch |
| `bill:created`, `bill:updated` | branch |
| `menu:updated`, `menu:availability:changed` | branch |
| `inventory:updated`, `inventory:low_stock`, `reservation:created`, `reservation:updated` | branch |
| `notification` | user (targeted) or branch |
| `print:job` `{ jobId, printerId, base64 }` | branch – a terminal with a USB printer prints it and calls `PATCH /printers/jobs/:id/ack` |

Payloads always include `branchId`, which the existing hooks filter on.

## Data model (Prisma)

`restaurants → branches → tables, categories → menu_items (variants, add-ons, recipe ingredients), orders → order_items, kots, bills → payments (+ bill_orders for merged bills), inventory (+ transactions), reservations, printers (+ print_jobs, print_templates), notifications, audit_logs`, plus `users`, `user_roles`, `refresh_tokens`.
Document numbers (`ORD-20261124-0001`, `KOT-…`, `BILL-…`) are per branch per day from Redis `INCR`, re-seeded from the database so a Redis flush can't create duplicates.

Migrations live in `prisma/migrations`. Change `schema.prisma`, then `npx prisma migrate dev --name <change>`.

## Configuration

See `.env.example` – every variable is validated at boot (the app refuses to start on a bad config). Notable ones:

| Variable | Purpose |
|---|---|
| `APP_ROLE` | `all` · `api` · `worker` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 16 chars, **must** be changed in production |
| `KAFKA_ENABLED`, `OPENSEARCH_ENABLED` | turn off for a lightweight dev setup |
| `TZ` | reservation times are wall-clock; set the restaurant's timezone |
| `ALLOW_PUBLIC_REGISTRATION` | allow the sign-up form to create floor staff |
| `ENABLE_SWAGGER` | Swagger is on in development; set `true` to expose it in production |

## Operations notes

* **Production hardening**: use strong secrets, put the API behind TLS (reverse proxy), enable the OpenSearch security plugin / Kafka auth (compose runs both open for private networks), use managed Postgres/Redis, and raise Kafka/`pos.*` topic replication & partitions (compose creates 3 partitions, replication factor 1).
* **Backups**: PostgreSQL is the source of truth. Redis and OpenSearch can be rebuilt (`POST /search/reindex`, and the API backfills an empty index automatically at boot).
* **Audit log retention**: `audit_logs` grows with every event; add a retention job for long-running installs.
* **Stock restoration**: ingredients are deducted when a KOT is created and restored only if the order is cancelled while still `pending`.
* **Not included**: payment-gateway integration (payments are recorded, not charged), e-mail/SMS delivery, and file uploads (images are stored as URLs).

## Scripts

`npm run start:dev` · `build` · `test` (unit) · `db:seed` · `prisma:migrate` · `prisma:studio` · `node scripts/smoke.mjs`
