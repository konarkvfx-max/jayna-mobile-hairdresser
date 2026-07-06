# Security Upgrade — Deploy Steps

## What changed

| # | Fix | Files |
|---|-----|-------|
| 1 | Bearer-token auth on all API routes, timing-safe, fails closed if unconfigured | `middleware/auth.js`, `server.js` |
| 2 | WebSocket upgrade handshake now requires `?token=` — unauthenticated sockets rejected pre-upgrade | `lib/websocket.js` |
| 3 | PIN gate in the app: Jayna enters the access code once, stored on device, auto-locks on 401 | `public/index.html` (AuthGate) |
| 4 | `PATCH /customers/:id/notes` no longer proxies raw bodies — accepts `{ notes }` only, server maps to the Waitwhile field ID | `routes/customers.js`, `lib/fields.js` |
| 5 | Create/edit bookings take semantic `{ address, price, notes }` — field IDs live server-side only, whitelisted | `routes/bookings.js`, `lib/fields.js`, frontend |
| 6 | Webhook HMAC-SHA256 signature verification (raw body preserved) | `routes/webhook.js`, `server.js` |
| 7 | Rate limiting: 120 req/min general + 30/15min brute-force limiter on auth failures | `server.js` |
| 8 | helmet security headers + CSP | `server.js` |
| 9 | CORS locked (`ALLOWED_ORIGIN` env; default: no cross-origin at all) | `server.js` |
| 10 | Generic error responses everywhere — upstream Waitwhile details log server-side only | all routes |
| 11 | Full input validation: dates, times, IDs, durations, string lengths on `/block`, `/bookings/*`, `/customers/*` | `routes/block.js`, `routes/bookings.js`, `routes/customers.js` |
| 12 | DST-correct timezone offsets via `Intl` — replaces the day-of-year approximation that was wrong in transition weeks. `TZ_NAME` configurable (Brisbane = no DST) | `lib/tz.js`, `routes/block.js`, `routes/bookings.js` |
| 13 | Price now persists to the Waitwhile price field on edit — localStorage price hack removed | frontend, `routes/bookings.js` |
| 14 | PII request-body logging gated behind `DEBUG=true` | `routes/bookings.js` |
| 15 | `alert()` replaced with styled toast notifications | frontend (ToastHost) |
| 16 | JSON body size capped at 100kb | `server.js` |

## Deploy (Railway)

1. **Generate the token:**
   ```
   openssl rand -hex 32
   ```
2. **Set env vars in Railway:**
   - `APP_AUTH_TOKEN` = the generated token (this is Jayna's "access code" — send it to her via a secure channel, not SMS ideally)
   - `ALLOWED_ORIGIN` = your Railway URL, e.g. `https://jayna.up.railway.app`
   - `TZ_NAME` = `Australia/Adelaide` (or `Australia/Brisbane` — confirm where Jayna operates; Brisbane has no DST)
   - `WAITWHILE_WEBHOOK_SECRET` = from Waitwhile's webhook settings
   - `DEBUG` = leave unset
3. **Install new deps:** `npm install` (adds `helmet`, `express-rate-limit`) — Railway does this on deploy.
4. **Deploy.** Server refuses API traffic (503) if `APP_AUTH_TOKEN` is missing — that's intentional.
5. **Verify:**
   ```
   curl https://your-app/customers                       # → 401
   curl -H "Authorization: Bearer <token>" https://your-app/customers  # → 200
   ```
6. **Jayna's side:** she opens the app, sees the unlock screen once, enters the code, done. Token persists on her device.
7. **Webhook signature header:** the code checks `x-waitwhile-signature`, `x-webhook-signature`, and `x-signature`. Confirm the exact header name in Waitwhile's webhook docs/dashboard and check Railway logs on the first real webhook — if it logs "Rejected: invalid signature", adjust the header name or HMAC encoding (hex vs base64) to match what Waitwhile actually sends.

## Rollout order matters

Deploy backend + frontend together (they're in the same repo, so one deploy). The old frontend can't talk to the new backend (no auth header) and vice versa isn't an issue.

## The one remaining item: build step

Frontend still uses Babel-standalone + unpkg CDN. Interim CSP restricts scripts to unpkg only. Proper fix (next session, ~1hr):
1. `npm create vite@latest` → move the JSX out of index.html into `src/App.jsx`
2. Build to `public/`, serve static as now
3. Remove `'unsafe-inline'` and `unpkg.com` from the CSP in `server.js`
4. This also cuts mobile load time significantly (no in-browser compilation) and unlocks the PWA/offline work.

## Threat model after this upgrade

- Leaked URL → attacker gets a login wall + rate-limited brute force against a 256-bit token. Effectively closed.
- Compromised CDN → still possible until the build step lands (only remaining meaningful vector).
- Token theft from Jayna's device → rotate by changing `APP_AUTH_TOKEN` in Railway; her app re-prompts automatically on the next 401.
