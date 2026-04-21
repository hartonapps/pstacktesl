const crypto = require('crypto');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getHeaders() {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is missing in .env');
  }

  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function paystackRequest(path, payload) {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || data.status === false) {
    const message = data?.message || 'Paystack request failed';
    throw new Error(message);
  }

  return data.data;
}

async function initializeDeposit({ email, amountKobo, reference, metadata }) {
  return paystackRequest('/transaction/initialize', {
    email,
    amount: amountKobo,
    reference,
    metadata
  });
}

async function createTransferRecipient({ accountNumber, bankCode, name }) {
  return paystackRequest('/transferrecipient', {
    type: 'nuban',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN'
  });
}

async function initiateTransfer({ amountKobo, recipientCode, reference, reason }) {
  return paystackRequest('/transfer', {
    source: 'balance',
    amount: amountKobo,
    recipient: recipientCode,
    reason,
    reference
  });
}

function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return false;

  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  return hash === signature;
}

module.exports = {
  initializeDeposit,
  createTransferRecipient,
  initiateTransfer,
  verifyWebhookSignature
};
