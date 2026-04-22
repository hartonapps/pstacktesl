require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const {
  ensureWallet,
  getWallet,
  setBankDetails,
  getBankDetails,
  createTransaction,
  listTransactions,
  creditDeposit,
  markDepositFailed,
  freezeForWithdrawal,
  completeWithdrawal,
  rollbackWithdrawal,
  patchBankDetails,
  appendAuditLog,
  getTransactionByReference
} = require('./db');

const {
  initializeDeposit,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  verifyWebhookSignature
} = require('./paystack');

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function toKobo(naira) {
  return Math.round(Number(naira) * 100);
}

function generateRef(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

app.get('/wallets/:userId', (req, res) => {
  const wallet = getWallet(req.params.userId);
  res.json({
    userId: wallet.user_id,
    availableBalanceNaira: wallet.available_balance_kobo / 100,
    frozenBalanceNaira: wallet.frozen_balance_kobo / 100
  });
});

app.post('/wallets/:userId/deposit/initialize', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amountNaira, email } = req.body;

    const amountKobo = toKobo(amountNaira);
    if (!email || amountKobo <= 0) {
      return res.status(400).json({ error: 'email and positive amountNaira are required.' });
    }

    ensureWallet(userId);
    const reference = generateRef('dep');

    createTransaction({
      userId,
      type: 'deposit',
      status: 'pending',
      amountKobo,
      reference,
      metadata: { source: 'paystack_initialize' }
    });

    const result = await initializeDeposit({
      email,
      amountKobo,
      reference,
      metadata: { userId },
      callbackUrl: `${appBaseUrl}/paystack/callback`
    });

    return res.json({
      message: 'Deposit initialized. Complete payment using authorization_url.',
      reference,
      authorizationUrl: result.authorization_url,
      accessCode: result.access_code
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/wallets/:userId/bank-details', (req, res) => {
  const { userId } = req.params;
  const { accountNumber, bankCode } = req.body;

  if (!/^\d{10}$/.test(accountNumber || '')) {
    return res.status(400).json({ error: 'accountNumber must be exactly 10 digits.' });
  }

  if (!/^\d+$/.test(bankCode || '')) {
    return res.status(400).json({ error: 'bankCode should be numeric as provided by Paystack.' });
  }

  setBankDetails(userId, accountNumber, bankCode);
  return res.json({ message: 'Bank details saved.' });
});

app.post('/wallets/:userId/withdrawals', async (req, res) => {
  const { userId } = req.params;
  const { amountNaira } = req.body;
  const amountKobo = toKobo(amountNaira);
  const reference = generateRef('wd');

  try {
    const bank = getBankDetails(userId);
    if (!bank) {
      return res.status(400).json({ error: 'Add bank details first.' });
    }

    freezeForWithdrawal({ userId, reference, amountKobo });

    let recipientCode = bank.recipient_code;
    if (!recipientCode) {
      const recipient = await createTransferRecipient({
        accountNumber: bank.account_number,
        bankCode: bank.bank_code,
        name: `wallet-${userId}`
      });

      recipientCode = recipient.recipient_code;
      patchBankDetails(userId, {
        recipient_code: recipientCode,
        account_name: recipient.details?.account_name || null
      });
    }

    const transfer = await initiateTransfer({
      amountKobo,
      recipientCode,
      reference,
      reason: `Wallet withdrawal for ${userId}`
    });

    appendAuditLog({
      at: new Date().toISOString(),
      action: 'withdrawal_transfer_initiated',
      reference,
      transferCode: transfer.transfer_code || null
    });

    return res.json({
      message: 'Withdrawal request accepted. Await webhook confirmation.',
      reference,
      transferCode: transfer.transfer_code,
      status: transfer.status
    });
  } catch (error) {
    rollbackWithdrawal(reference, { error: error.message, source: 'initiation' });
    return res.status(400).json({ error: error.message, reference });
  }
});

app.get('/wallets/:userId/transactions', (req, res) => {
  const { userId } = req.params;
  const transactions = listTransactions(userId);
  return res.json(transactions);
});


app.get('/paystack/callback', async (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).send('Missing transaction reference in callback URL.');
  }

  try {
    const verified = await verifyTransaction(reference);

    if (verified.status === 'success') {
      creditDeposit(reference, verified.amount);
      return res.redirect(`/?payment=success&reference=${encodeURIComponent(reference)}`);
    }

    markDepositFailed(reference, { source: 'callback_verify', status: verified.status });
    return res.redirect(`/?payment=failed&reference=${encodeURIComponent(reference)}`);
  } catch (error) {
    return res.redirect(
      `/?payment=verify_error&reference=${encodeURIComponent(reference)}&message=${encodeURIComponent(error.message)}`
    );
  }
});

app.post('/webhooks/paystack', (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!verifyWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event.event;

  if (eventType === 'charge.success') {
    const reference = event.data.reference;
    creditDeposit(reference, event.data.amount);
  }

  if (eventType === 'charge.failed') {
    markDepositFailed(event.data.reference, event.data);
  }

  if (eventType === 'transfer.success') {
    completeWithdrawal(event.data.reference, event.data.transfer_code);
  }

  if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
    rollbackWithdrawal(event.data.reference, event.data);
  }

  return res.sendStatus(200);
});

// Interactive helper routes for local UI testing without Postman.
app.post('/interactive/simulate/charge-success', (req, res) => {
  const { reference } = req.body;
  const txn = getTransactionByReference(reference);

  if (!txn || txn.type !== 'deposit') {
    return res.status(404).json({ error: 'Deposit transaction not found.' });
  }

  creditDeposit(reference, txn.amount_kobo);
  return res.json({ message: 'Deposit marked success and wallet credited.', reference });
});

app.post('/interactive/simulate/transfer-success', (req, res) => {
  const { reference } = req.body;
  const txn = getTransactionByReference(reference);

  if (!txn || txn.type !== 'withdrawal') {
    return res.status(404).json({ error: 'Withdrawal transaction not found.' });
  }

  completeWithdrawal(reference, `sim_transfer_${Date.now()}`);
  return res.json({ message: 'Withdrawal marked success.', reference });
});

app.post('/interactive/simulate/transfer-failed', (req, res) => {
  const { reference } = req.body;
  const txn = getTransactionByReference(reference);

  if (!txn || txn.type !== 'withdrawal') {
    return res.status(404).json({ error: 'Withdrawal transaction not found.' });
  }

  rollbackWithdrawal(reference, { source: 'interactive', reason: 'Simulated transfer failure' });
  return res.json({ message: 'Withdrawal marked failed and rolled back.', reference });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Wallet simulation API running on http://localhost:${port}`);
});
