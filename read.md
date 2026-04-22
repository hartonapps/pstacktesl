# Paystack Wallet Simulator (Interactive UI)

You can now use this project from the browser — no Postman needed.

## 1) Setup

1. Install packages:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Add your Paystack TEST keys in `.env`:
   ```env
   PAYSTACK_PUBLIC_KEY=pk_test_xxx
   PAYSTACK_SECRET_KEY=sk_test_xxx
   APP_BASE_URL=http://localhost:3000
   ```
4. Start server:
   ```bash
   npm start
   ```
5. Open UI:
   ```
   http://localhost:3000
   ```

---

## 2) Why “Cannot resolve account” happens

If withdrawal fails with `Cannot resolve account`, the bank details could not be verified by Paystack.

Common causes:
- Wrong bank code
- Random/non-resolvable account number
- Account details not resolvable in Paystack test context

Your Paystack Starter tier can affect **live transfer availability**, but this specific error is usually from account resolution failure.

---

## 3) New bank validation flow (fixed)

Before saving bank details, use **Resolve Bank Account** button in UI.

It calls:
- `GET /banks/resolve?accountNumber=XXXXXXXXXX&bankCode=YYY`

Only resolved accounts should be used for real transfer tests.

If you are doing local-only simulation, you can tick:
- **Save without resolve (simulation only)**

---

## 4) Deposit/redirect flow

- Click **Initialize Deposit**.
- Open Paystack payment page.
- On completion, Paystack redirects to:
  - `http://localhost:3000/paystack/callback?reference=...`
- Server verifies transaction and redirects you back to `/` with status.

---

## 5) Full interactive steps

1. Set User ID + Email
2. Initialize deposit (₦100)
3. Complete test payment
4. Resolve bank account
5. Save bank details
6. Request withdrawal
7. Use **Refresh Wallet** + **Load Transactions** to confirm

Simulation buttons are still available for local testing:
- Simulate Deposit Success
- Simulate Transfer Success
- Simulate Transfer Failed

---

## 6) Real webhooks (optional but recommended)

Set Paystack webhook URL to:
- `https://your-domain/webhooks/paystack`

Webhook events handled:
- `charge.success`
- `charge.failed`
- `transfer.success`
- `transfer.failed`
- `transfer.reversed`

---

## 7) Data files

- `data/store.json`
- `data/transactions.log`

---

## 8) Safety

- Use TEST MODE keys during testing.
- Don’t use live keys unless you truly want real money movement.
