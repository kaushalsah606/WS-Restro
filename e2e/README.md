# Browser end-to-end checks

Drives the real frontend (http://localhost:8080) in headless Chromium against the running stack and fails on any
CORS error, failed request, HTTP >= 400, console error or page error.

```bash
docker compose up -d --build      # from the repo root
cd e2e && npm install && npm run install:browser
npm run screens        # sign in through the UI, open every sidebar screen, check Bearer token + CORS header on API calls
npm run order-flow     # take an order on a table, see it in Kitchen, start it, see it in Billing
npm run demo-login    # every one-click demo login lands on a working dashboard
npm run pay-qr-roles   # cashier pays, anonymous QR guest orders and sees live status, waiter/kitchen role views
```
Screenshots are written next to the scripts (git-ignored). Run `order-flow` before `pay-qr-roles` (it pays that order).
