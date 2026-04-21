const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || 'wallet.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    available_balance_kobo INTEGER NOT NULL DEFAULT 0,
    frozen_balance_kobo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bank_details (
    user_id TEXT PRIMARY KEY,
    account_number TEXT NOT NULL,
    bank_code TEXT NOT NULL,
    account_name TEXT,
    recipient_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES wallets(user_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
    amount_kobo INTEGER NOT NULL,
    reference TEXT UNIQUE NOT NULL,
    paystack_transfer_code TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES wallets(user_id)
  );
`);

function ensureWallet(userId) {
  db.prepare(
    `INSERT INTO wallets (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`
  ).run(userId);
}

function getWallet(userId) {
  ensureWallet(userId);
  return db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
}

function setBankDetails(userId, accountNumber, bankCode) {
  ensureWallet(userId);
  db.prepare(
    `
    INSERT INTO bank_details (user_id, account_number, bank_code, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id)
    DO UPDATE SET account_number = excluded.account_number,
                  bank_code = excluded.bank_code,
                  updated_at = CURRENT_TIMESTAMP
  `
  ).run(userId, accountNumber, bankCode);
}

function getBankDetails(userId) {
  return db.prepare('SELECT * FROM bank_details WHERE user_id = ?').get(userId);
}

function createTransaction({ userId, type, status, amountKobo, reference, metadata = null }) {
  db.prepare(
    `
      INSERT INTO transactions (user_id, type, status, amount_kobo, reference, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(userId, type, status, amountKobo, reference, metadata ? JSON.stringify(metadata) : null);
}

function updateTransactionStatus(reference, status, details = {}) {
  db.prepare(
    `
    UPDATE transactions
    SET status = ?,
        paystack_transfer_code = COALESCE(?, paystack_transfer_code),
        metadata_json = COALESCE(?, metadata_json),
        updated_at = CURRENT_TIMESTAMP
    WHERE reference = ?
  `
  ).run(
    status,
    details.transferCode || null,
    details.metadata ? JSON.stringify(details.metadata) : null,
    reference
  );
}

function getTransactionByReference(reference) {
  return db.prepare('SELECT * FROM transactions WHERE reference = ?').get(reference);
}

function listTransactions(userId) {
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC').all(userId);
}

function creditDeposit(reference, amountKobo) {
  const tx = db.transaction(() => {
    const txn = getTransactionByReference(reference);
    if (!txn || txn.type !== 'deposit' || txn.status === 'success') return;

    db.prepare(
      `
      UPDATE wallets
      SET available_balance_kobo = available_balance_kobo + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `
    ).run(amountKobo, txn.user_id);

    updateTransactionStatus(reference, 'success');
  });
  tx();
}

function markDepositFailed(reference, metadata) {
  const txn = getTransactionByReference(reference);
  if (!txn || txn.type !== 'deposit' || txn.status === 'success') return;
  updateTransactionStatus(reference, 'failed', { metadata });
}

function freezeForWithdrawal({ userId, reference, amountKobo }) {
  const tx = db.transaction(() => {
    ensureWallet(userId);
    const wallet = getWallet(userId);

    if (amountKobo < 10000) {
      throw new Error('Minimum withdrawal is ₦100 (10000 kobo).');
    }

    if (wallet.available_balance_kobo < amountKobo) {
      throw new Error('Insufficient wallet balance.');
    }

    db.prepare(
      `
      UPDATE wallets
      SET available_balance_kobo = available_balance_kobo - ?,
          frozen_balance_kobo = frozen_balance_kobo + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `
    ).run(amountKobo, amountKobo, userId);

    createTransaction({
      userId,
      type: 'withdrawal',
      status: 'pending',
      amountKobo,
      reference,
      metadata: { stage: 'frozen' }
    });
  });
  tx();
}

function completeWithdrawal(reference, transferCode) {
  const tx = db.transaction(() => {
    const txn = getTransactionByReference(reference);
    if (!txn || txn.type !== 'withdrawal' || txn.status === 'success') return;

    db.prepare(
      `
      UPDATE wallets
      SET frozen_balance_kobo = MAX(frozen_balance_kobo - ?, 0),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `
    ).run(txn.amount_kobo, txn.user_id);

    updateTransactionStatus(reference, 'success', { transferCode });
  });
  tx();
}

function rollbackWithdrawal(reference, metadata) {
  const tx = db.transaction(() => {
    const txn = getTransactionByReference(reference);
    if (!txn || txn.type !== 'withdrawal' || txn.status === 'success') return;

    db.prepare(
      `
      UPDATE wallets
      SET available_balance_kobo = available_balance_kobo + ?,
          frozen_balance_kobo = MAX(frozen_balance_kobo - ?, 0),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `
    ).run(txn.amount_kobo, txn.amount_kobo, txn.user_id);

    updateTransactionStatus(reference, 'failed', { metadata });
  });
  tx();
}

module.exports = {
  db,
  ensureWallet,
  getWallet,
  setBankDetails,
  getBankDetails,
  createTransaction,
  getTransactionByReference,
  listTransactions,
  creditDeposit,
  markDepositFailed,
  freezeForWithdrawal,
  completeWithdrawal,
  rollbackWithdrawal
};
