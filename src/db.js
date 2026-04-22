const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STORE_PATH = process.env.STORE_PATH || path.join(DATA_DIR, 'store.json');
const TRANSACTION_LOG_PATH =
  process.env.TRANSACTION_LOG_PATH || path.join(DATA_DIR, 'transactions.log');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ wallets: {}, bankDetails: {}, transactions: {} }, null, 2)
    );
  }

  if (!fs.existsSync(TRANSACTION_LOG_PATH)) {
    fs.writeFileSync(TRANSACTION_LOG_PATH, '');
  }
}

function readStore() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function appendAuditLog(entry) {
  fs.appendFileSync(TRANSACTION_LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function ensureWallet(userId) {
  const store = readStore();

  if (!store.wallets[userId]) {
    store.wallets[userId] = {
      user_id: userId,
      available_balance_kobo: 0,
      frozen_balance_kobo: 0,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    writeStore(store);
  }
}

function getWallet(userId) {
  ensureWallet(userId);
  const store = readStore();
  return store.wallets[userId];
}

function setBankDetails(userId, accountNumber, bankCode) {
  ensureWallet(userId);
  const store = readStore();
  const existing = store.bankDetails[userId] || { created_at: nowIso() };

  store.bankDetails[userId] = {
    ...existing,
    user_id: userId,
    account_number: accountNumber,
    bank_code: bankCode,
    updated_at: nowIso()
  };

  writeStore(store);
}

function patchBankDetails(userId, patch) {
  const store = readStore();
  const current = store.bankDetails[userId];
  if (!current) return;

  store.bankDetails[userId] = {
    ...current,
    ...patch,
    updated_at: nowIso()
  };

  writeStore(store);
}

function getBankDetails(userId) {
  const store = readStore();
  return store.bankDetails[userId] || null;
}

function createTransaction({ userId, type, status, amountKobo, reference, metadata = null }) {
  const store = readStore();
  if (store.transactions[reference]) {
    throw new Error(`Transaction reference already exists: ${reference}`);
  }

  const txn = {
    id: Object.keys(store.transactions).length + 1,
    user_id: userId,
    type,
    status,
    amount_kobo: amountKobo,
    reference,
    paystack_transfer_code: null,
    metadata_json: metadata,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  store.transactions[reference] = txn;
  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'transaction_created', transaction: txn });
}

function updateTransactionStatus(reference, status, details = {}) {
  const store = readStore();
  const txn = store.transactions[reference];
  if (!txn) return;

  txn.status = status;
  if (details.transferCode) txn.paystack_transfer_code = details.transferCode;
  if (details.metadata) txn.metadata_json = details.metadata;
  txn.updated_at = nowIso();

  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'transaction_updated', reference, status, details });
}

function getTransactionByReference(reference) {
  const store = readStore();
  return store.transactions[reference] || null;
}

function listTransactions(userId) {
  const store = readStore();
  return Object.values(store.transactions)
    .filter((txn) => txn.user_id === userId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function creditDeposit(reference, amountKobo) {
  const store = readStore();
  const txn = store.transactions[reference];
  if (!txn || txn.type !== 'deposit' || txn.status === 'success') return;

  const wallet = store.wallets[txn.user_id];
  wallet.available_balance_kobo += amountKobo;
  wallet.updated_at = nowIso();

  txn.status = 'success';
  txn.updated_at = nowIso();

  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'deposit_credited', reference, amount_kobo: amountKobo });
}

function markDepositFailed(reference, metadata) {
  const txn = getTransactionByReference(reference);
  if (!txn || txn.type !== 'deposit' || txn.status === 'success') return;
  updateTransactionStatus(reference, 'failed', { metadata });
}

function freezeForWithdrawal({ userId, reference, amountKobo }) {
  ensureWallet(userId);
  const store = readStore();
  const wallet = store.wallets[userId];

  if (amountKobo < 10000) {
    throw new Error('Minimum withdrawal is ₦100 (10000 kobo).');
  }

  if (wallet.available_balance_kobo < amountKobo) {
    throw new Error('Insufficient wallet balance.');
  }

  wallet.available_balance_kobo -= amountKobo;
  wallet.frozen_balance_kobo += amountKobo;
  wallet.updated_at = nowIso();

  if (store.transactions[reference]) {
    throw new Error('Duplicate withdrawal reference.');
  }

  const txn = {
    id: Object.keys(store.transactions).length + 1,
    user_id: userId,
    type: 'withdrawal',
    status: 'pending',
    amount_kobo: amountKobo,
    reference,
    paystack_transfer_code: null,
    metadata_json: { stage: 'frozen' },
    created_at: nowIso(),
    updated_at: nowIso()
  };

  store.transactions[reference] = txn;
  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'withdrawal_frozen', reference, amount_kobo: amountKobo });
}

function completeWithdrawal(reference, transferCode) {
  const store = readStore();
  const txn = store.transactions[reference];
  if (!txn || txn.type !== 'withdrawal' || txn.status === 'success') return;

  const wallet = store.wallets[txn.user_id];
  wallet.frozen_balance_kobo = Math.max(wallet.frozen_balance_kobo - txn.amount_kobo, 0);
  wallet.updated_at = nowIso();

  txn.status = 'success';
  txn.paystack_transfer_code = transferCode || txn.paystack_transfer_code;
  txn.updated_at = nowIso();

  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'withdrawal_completed', reference, transferCode });
}

function rollbackWithdrawal(reference, metadata) {
  const store = readStore();
  const txn = store.transactions[reference];
  if (!txn || txn.type !== 'withdrawal' || txn.status === 'success') return;

  const wallet = store.wallets[txn.user_id];
  wallet.available_balance_kobo += txn.amount_kobo;
  wallet.frozen_balance_kobo = Math.max(wallet.frozen_balance_kobo - txn.amount_kobo, 0);
  wallet.updated_at = nowIso();

  txn.status = 'failed';
  txn.metadata_json = metadata;
  txn.updated_at = nowIso();

  writeStore(store);
  appendAuditLog({ at: nowIso(), action: 'withdrawal_rolled_back', reference, metadata });
}

module.exports = {
  ensureWallet,
  getWallet,
  setBankDetails,
  patchBankDetails,
  getBankDetails,
  createTransaction,
  getTransactionByReference,
  listTransactions,
  creditDeposit,
  markDepositFailed,
  freezeForWithdrawal,
  completeWithdrawal,
  rollbackWithdrawal,
  appendAuditLog,
  STORE_PATH,
  TRANSACTION_LOG_PATH
};
