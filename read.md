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

## 2) About inline Paystack vs redirect

- Current UI uses **redirect flow** (opens Paystack payment page).
- After payment, Paystack now redirects back to:
  - `http://localhost:3000/paystack/callback?reference=...`
- Server verifies the transaction and redirects you back to homepage with status.

So yes — you are returned to localhost automatically on successful/failed payment callback.

---

## 3) Use the buttons (interactive flow)

### A. Deposit
1. Enter `User ID`, `Email`, and amount (e.g. `100`).
2. Click **Initialize Deposit**.
3. Click **Open Paystack Payment Page**.
4. Complete test payment.
5. You get redirected back to localhost and wallet/transactions refresh.

If you want local-only testing (no Paystack payment), click **Simulate Deposit Success**.

### B. Add bank details
1. Enter account number (10 digits) and bank code.
2. Click **Save Bank Details**.

### C. Withdraw
1. Enter amount (minimum ₦100).
2. Click **Request Withdrawal**.
3. For local testing, click:
   - **Simulate Transfer Success** OR
   - **Simulate Transfer Failed**

### D. Verify results
- Use **Refresh Wallet** to see balances.
- Use **Load Transactions** to see all logs/statuses.

---

## 4) Real webhook mode (optional)

If using real Paystack test webhooks:
- Set dashboard webhook URL to `https://your-domain/webhooks/paystack`.
- `charge.success` credits deposit.
- `transfer.success` finalizes withdrawal.
- `transfer.failed`/`transfer.reversed` roll back frozen funds.

> Note: callback verification works for browser redirect flow, while webhooks are still recommended for full reliability.

---

## 5) Data files

The app stores data locally in:
- `data/store.json`
- `data/transactions.log`

---

## 6) Safety

- Use **Paystack TEST MODE** keys only while testing.
- Don’t use live keys unless you intend real money movement.
