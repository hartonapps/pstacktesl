require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

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
  appendAuditLog
} = require('./db');

const {
  initializeDeposit,
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
      metadata: { userId }
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Wallet simulation API running on http://localhost:${port}`);
});
