# MikroTik Hotspot Billing (M-Pesa)

A minimal but complete voucher-billing backend:

1. Customer picks a package on your captive portal / payment page and enters their phone number.
2. Backend triggers an M-Pesa **STK Push** (a PIN prompt on their phone).
3. Once M-Pesa confirms payment via callback, the backend creates a **hotspot user** on your MikroTik router via the RouterOS API and returns a voucher code.
4. Customer logs into the hotspot with that code.

## 1. MikroTik router setup

On the router (Winbox/terminal):

```
/ip service enable api
/ip service set api port=8728

# Create (or confirm) a hotspot server + a user profile your vouchers will use
/ip hotspot user profile print
```

Make sure the `mikrotikProfile` values in `src/packages.js` match real profile names on your router (e.g. `default`). These profiles control speed limits, shared-users, etc. — set those up in `/ip hotspot user profile` however you like; this app only assigns them.

For production, prefer enabling `api-ssl` (port 8729) instead of plaintext `api`, and set `MIKROTIK_TLS=true` in `.env`.

Use a dedicated RouterOS user (not full "admin") with just the permissions this app needs (`api`, `read`, `write` on the hotspot menu), rather than your main admin account.

## 2. M-Pesa (Daraja) setup

1. Create an account at https://developer.safaricom.co.ke and an app under **Lipa Na M-Pesa Online (STK Push)**.
2. Sandbox gives you a test `Shortcode` (usually `174379`) and `Passkey` — use those first.
3. Your `MPESA_CALLBACK_URL` **must be a public HTTPS URL** Safaricom can reach. While developing, run:
   ```
   ngrok http 3000
   ```
   and set `MPESA_CALLBACK_URL=https://<your-ngrok-subdomain>.ngrok-free.app/api/mpesa/callback`.
4. Go live: apply for a production shortcode (Paybill/Till) and swap `MPESA_ENV=production` plus the production credentials.

## 3. Install & run

```bash
cd mikrotik-hotspot-billing
npm install
cp .env.example .env
# edit .env with your router + M-Pesa credentials
npm start
```

The SQLite database is created automatically at `data/billing.sqlite`.

## 4. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vouchers/packages` | List sellable packages |
| POST | `/api/vouchers/purchase` | `{ phone, packageId }` → triggers STK push |
| GET | `/api/vouchers/status/:checkoutRequestId` | Poll for payment/voucher status |
| GET | `/api/vouchers/history/:phone` | Public "welcome back" lookup used by the portal |
| POST | `/api/mpesa/callback` | Safaricom calls this — don't call it yourself |
| GET | `/api/admin/orders` | Recent orders |
| GET | `/api/admin/vouchers` | Issued vouchers |
| GET | `/api/admin/vouchers/expiring-soon` | Vouchers due to expire, soonest first |
| GET | `/api/admin/customers` | Purchase counts + spend per phone number |
| GET | `/api/admin/customers/:phone` | Full order history for one number |
| GET | `/api/admin/router-check` | Verifies router API connectivity |

### Example purchase flow

```bash
curl -X POST http://localhost:3000/api/vouchers/purchase \
  -H "Content-Type: application/json" \
  -d '{"phone": "0712345678", "packageId": "daily-50"}'
# => { "orderId": "...", "checkoutRequestId": "ws_CO_...", "message": "..." }

curl http://localhost:3000/api/vouchers/status/ws_CO_...
# => { "status": "provisioned", "voucherCode": "K7M2QX9P" }
```

## 5. Connecting the captive portal

`hotspot-portal/login.html` is the actual page customers see when they connect to your WiFi. It lists packages, takes a phone number, triggers the M-Pesa STK push, polls for the voucher, and auto-submits MikroTik's login form once payment is confirmed — no manual code entry needed.

**a) Point it at your backend.** Open `hotspot-portal/login.html` and set:
```js
const API_BASE = "https://your-billing-domain.example.com";
```
This must be the public URL where you're running this Node app (e.g. behind nginx + a real domain/HTTPS, or an ngrok URL while testing).

**b) Upload it to the router.** In Winbox: **Files** → drag `login.html` into the `hotspot` folder (this overwrites the default login page; the router's other default hotspot assets can stay). Alternatively, from a terminal with FTP/SFTP enabled on the router:
```bash
scp hotspot-portal/login.html admin@192.168.88.1:/hotspot/login.html
```

**c) Open the walled garden.** Before a customer pays, their device isn't authenticated yet — so by default the router blocks it from reaching your billing API. Add a walled-garden rule allowing that traffic:
```
/ip hotspot walled-garden add dst-host=your-billing-domain.example.com action=allow
```
If your Daraja/M-Pesa callback and the portal are on the same domain, one rule covers both directions since the callback is server-to-server (router doesn't need to allow that one — only the *customer's device → your API* path needs the walled-garden entry).

**d) Test it.** Connect a device to the hotspot SSID; it should be redirected to your new page instead of MikroTik's default one. Use `/api/admin/router-check` to confirm the backend can reach the router, and watch the Node server logs while a test device runs through a purchase.

## 7. Automatic disconnection on expiry

Two mechanisms work together:

1. **RouterOS `limit-uptime` (built-in, instant).** Every voucher is created with `limit-uptime` set from the package (e.g. `24h`). RouterOS tracks each user's *actual connected minutes* and force-disconnects them the moment that's used up — no extra code needed, this happens on the router itself.

2. **Calendar expiry job (this app, runs every minute).** `limit-uptime` alone doesn't stop someone from buying a "24 Hour Access" pass and reconnecting with it a week later if they barely used it — RouterOS has no concept of "time since purchase." `src/jobs/expireVouchers.js` covers that: it computes an `expires_at` timestamp when the voucher is provisioned (purchase time + package duration), and every minute checks for vouchers past that timestamp. For each one it:
   - Kicks any live session (`/ip/hotspot/active/remove`)
   - Removes the hotspot user record so the code can't be used to log in again (`/ip/hotspot/user/remove`)
   - Marks the voucher `disconnected` in the database so it isn't retried

This starts automatically with `npm start` — no separate process to run. Check `/api/admin/vouchers/expiring-soon` to see what's queued up next.

If you'd rather *disable* a voucher instead of deleting it (e.g. to keep a record of "expired" vs a purged row), swap the `/ip/hotspot/user/remove` call in `disconnectAndRemoveUser` for `/ip/hotspot/user/set` with `disabled=yes` — removal was chosen here so old codes can't accidentally collide with future randomly-generated ones.

## 9. Expired customers and repeat purchases

There's no persistent "customer account" — only orders and vouchers, keyed loosely by phone number. What actually happens:

- **On expiry**, the job in section 7 deletes the MikroTik hotspot user entirely (not disabled). Nothing on the router still references that code afterward.
- **On repurchase**, the customer goes through the exact same flow as a first-time visitor — new voucher code, new password, new `orders`/`vouchers` rows. There's no discount, block, or special-casing based on having bought before.

Three small things now tie purchases to a phone number, without building a full account system:

- **Voucher codes are now collision-checked.** `generateUniqueVoucherCode()` in `src/routes/vouchers.js` checks the database before accepting a code, retrying if (extremely rarely) it collides with one already issued.
- **Phone numbers are normalized on write and read** (`normalizePhone()`, e.g. `0712345678` → `254712345678`), so the same customer's history matches up regardless of how they typed their number.
- **`GET /api/vouchers/history/:phone`** — public, called automatically by the portal when the phone field loses focus. Returns only a non-sensitive summary (purchase count, last package, whether their last voucher expired) so the portal can show a "Welcome back!" note. This endpoint is unauthenticated by design (it runs pre-login), so it deliberately excludes amounts, receipts, or anything sensitive. If phone-number enumeration ever becomes a concern, add rate-limiting here.
- **`GET /api/admin/customers`** — one row per phone number with total orders and lifetime spend (only counting paid/provisioned orders).
- **`GET /api/admin/customers/:phone`** — full order history for one number.

## 10. Editing packages/pricing

Edit `src/packages.js`. Each entry needs:
- `priceKes` — what M-Pesa charges
- `limitUptime` — RouterOS duration string (`"1h"`, `"24h"`, `"7d"`)
- `mikrotikProfile` — must exist under `/ip hotspot user profile` on the router

## 11. What's not included (next steps)

- **Multiple routers** — currently one router via `.env`. For several routers, add a `routers` table and pass connection details per request instead of reading from `config.js`.
- **Retry/idempotency hardening** — Safaricom can retry callbacks; the current code doesn't dedupe by receipt number, so add a unique constraint on `mpesa_receipt` if double-provisioning is a concern.
- **Auth on `/api/admin/*`** — currently unauthenticated; add an API key or login before exposing this publicly.
