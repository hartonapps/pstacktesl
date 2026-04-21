# Paystack Wallet Simulation (Test Mode)

This project simulates a wallet that supports deposits and withdrawals through **Paystack TEST MODE**.

## 1) Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template and add your keys:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and replace placeholders with your test keys:
   - `PAYSTACK_PUBLIC_KEY=pk_test_...`
   - `PAYSTACK_SECRET_KEY=sk_test_...`
4. Start server:
   ```bash
   npm start
   ```

## 2) API Flow

### Initialize deposit
```bash
curl -X POST http://localhost:3000/wallets/user123/deposit/initialize \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","amountNaira":100}'
```

Complete payment using returned `authorizationUrl`.

### Save bank details
```bash
curl -X POST http://localhost:3000/wallets/user123/bank-details \
  -H "Content-Type: application/json" \
  -d '{"accountNumber":"0123456789","bankCode":"058"}'
```

### Request withdrawal (minimum ₦100)
```bash
curl -X POST http://localhost:3000/wallets/user123/withdrawals \
  -H "Content-Type: application/json" \
  -d '{"amountNaira":100}'
```

### Check wallet
```bash
curl http://localhost:3000/wallets/user123
```

### View transaction log
```bash
curl http://localhost:3000/wallets/user123/transactions
```

## 3) Webhook endpoint

Set Paystack webhook URL to:

`POST /webhooks/paystack`

Handled events:
- `charge.success` → credits wallet and marks deposit success
- `charge.failed` → marks deposit failed
- `transfer.success` → finalizes withdrawal and removes frozen funds
- `transfer.failed` / `transfer.reversed` → rollback frozen funds to available balance

## 4) Test scenario requested

1. Deposit ₦100 in test mode.
2. Confirm wallet shows available balance ₦100.
3. Add test bank details (10-digit account number + Paystack bank code).
4. Withdraw ₦100.
5. On transfer success: balance is ₦0.
6. On transfer failed: funds are restored automatically.

## Important

- Use **Paystack TEST MODE keys only**.
- Do **not** run real transfers while testing.
