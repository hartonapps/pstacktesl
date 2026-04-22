# Paystack Wallet Simulation (How to Use It Now)

This project is a **backend API** for testing wallet deposit/withdrawal logic with **Paystack TEST MODE only**.

It uses files (not SQLite):
- `data/store.json` → current state (wallets, bank details, transactions)
- `data/transactions.log` → append-only audit/events log

---

## 1) Quick setup

### A. Install dependencies
```bash
npm install
```

### B. Create your env file
```bash
cp .env.example .env
```

Open `.env` and set your real Paystack **test** keys:
```env
PORT=3000
DATA_DIR=./data
STORE_PATH=./data/store.json
TRANSACTION_LOG_PATH=./data/transactions.log
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
```

### C. Start server
```bash
npm start
```

You should see:
```text
Wallet simulation API running on http://localhost:3000
```

---

## 2) API endpoints you will use

Base URL: `http://localhost:3000`

1. `GET /wallets/:userId` → check balance
2. `POST /wallets/:userId/deposit/initialize` → start deposit
3. `POST /wallets/:userId/bank-details` → save account number + bank code
4. `POST /wallets/:userId/withdrawals` → request withdrawal
5. `GET /wallets/:userId/transactions` → list transactions
6. `POST /webhooks/paystack` → webhook receiver

---

## 3) Exact test flow (₦100 deposit then ₦100 withdrawal)

Use any user id, e.g. `user123`.

### Step 1: Initialize a ₦100 deposit
```bash
curl -X POST http://localhost:3000/wallets/user123/deposit/initialize \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","amountNaira":100}'
```

Response includes:
- `authorizationUrl`
- `reference`

Open `authorizationUrl` and complete payment with Paystack test payment method.

---

### Step 2: Confirm deposit via webhook
In production/test dashboard, Paystack calls your webhook URL automatically.

Local note:
- If your local server is not public, use a tunnel (for example ngrok/cloudflared) and set webhook URL in Paystack dashboard to:
  - `https://<your-public-url>/webhooks/paystack`

When `charge.success` arrives, wallet is credited.

Check wallet:
```bash
curl http://localhost:3000/wallets/user123
```

Expected after successful deposit:
```text
availableBalanceNaira: 100
```

---

### Step 3: Save bank details
```bash
curl -X POST http://localhost:3000/wallets/user123/bank-details \
  -H "Content-Type: application/json" \
  -d '{"accountNumber":"0123456789","bankCode":"058"}'
```

Rules:
- `accountNumber` must be exactly 10 digits
- `bankCode` must be numeric (from Paystack bank list)

---

### Step 4: Request ₦100 withdrawal
```bash
curl -X POST http://localhost:3000/wallets/user123/withdrawals \
  -H "Content-Type: application/json" \
  -d '{"amountNaira":100}'
```

What happens internally:
1. Balance is frozen first
2. Transfer recipient is created (if missing)
3. Transfer is initiated with Paystack
4. Final balance update waits for webhook result

---

### Step 5: Confirm transfer result by webhook
- `transfer.success` → frozen funds removed permanently
- `transfer.failed` or `transfer.reversed` → frozen funds restored

Check wallet:
```bash
curl http://localhost:3000/wallets/user123
```

Expected outcomes:
- If success: `availableBalanceNaira` becomes `0`
- If failed: `availableBalanceNaira` returns to `100`

---

## 4) See transaction history and raw logs

### API transaction history
```bash
curl http://localhost:3000/wallets/user123/transactions
```

Statuses are:
- `pending`
- `success`
- `failed`

### Raw append-only log file
```bash
tail -f data/transactions.log
```

---

## 5) Common problems

### "Invalid signature" on webhook
- Ensure Paystack uses the same `PAYSTACK_SECRET_KEY` as your `.env`.

### Withdrawal says "Insufficient wallet balance"
- Deposit may still be pending (webhook not received yet).

### Local webhook not hitting your server
- Expose local server with a public URL and update Paystack webhook URL.

---

## 6) Safety reminder

- Use **TEST MODE keys only**.
- Do **not** perform real/live transfers with this setup.
