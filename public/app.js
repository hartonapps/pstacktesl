const state = {
  lastDepositReference: null,
  lastAuthUrl: null,
  lastWithdrawalReference: null
};

const $ = (id) => document.getElementById(id);

function getUserId() {
  return $('userId').value.trim();
}

function setStatus(message, isError = false) {
  $('status').textContent = isError ? `❌ ${message}` : `✅ ${message}`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

async function refreshWallet() {
  const data = await api(`/wallets/${getUserId()}`);
  $('walletView').textContent = JSON.stringify(data, null, 2);
}

async function loadTransactions() {
  const data = await api(`/wallets/${getUserId()}/transactions`);
  $('txView').textContent = JSON.stringify(data, null, 2);
}

$('refreshWallet').onclick = async () => {
  try {
    await refreshWallet();
    setStatus('Wallet refreshed.');
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('loadTx').onclick = async () => {
  try {
    await loadTransactions();
    setStatus('Transactions loaded.');
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('initDeposit').onclick = async () => {
  try {
    const data = await api(`/wallets/${getUserId()}/deposit/initialize`, 'POST', {
      email: $('email').value.trim(),
      amountNaira: Number($('depositAmount').value)
    });

    state.lastDepositReference = data.reference;
    state.lastAuthUrl = data.authorizationUrl;

    $('depositOutput').textContent = JSON.stringify(data, null, 2);
    $('openAuthUrl').disabled = !data.authorizationUrl;
    $('simulateDepositSuccess').disabled = !data.reference;

    setStatus('Deposit initialized. Open Paystack URL or simulate success.');
    await loadTransactions();
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('openAuthUrl').onclick = () => {
  if (state.lastAuthUrl) {
    window.open(state.lastAuthUrl, '_blank');
    setStatus('Opened Paystack payment page in a new tab.');
  }
};

$('simulateDepositSuccess').onclick = async () => {
  try {
    await api('/interactive/simulate/charge-success', 'POST', {
      reference: state.lastDepositReference
    });
    setStatus('Simulated charge.success and credited wallet.');
    await refreshWallet();
    await loadTransactions();
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('saveBank').onclick = async () => {
  try {
    await api(`/wallets/${getUserId()}/bank-details`, 'POST', {
      accountNumber: $('accountNumber').value.trim(),
      bankCode: $('bankCode').value.trim()
    });
    setStatus('Bank details saved.');
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('requestWithdrawal').onclick = async () => {
  try {
    const data = await api(`/wallets/${getUserId()}/withdrawals`, 'POST', {
      amountNaira: Number($('withdrawAmount').value)
    });

    state.lastWithdrawalReference = data.reference;
    $('withdrawOutput').textContent = JSON.stringify(data, null, 2);
    $('simulateTransferSuccess').disabled = !data.reference;
    $('simulateTransferFailed').disabled = !data.reference;

    setStatus('Withdrawal requested. Wait for webhook or simulate transfer result.');
    await refreshWallet();
    await loadTransactions();
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('simulateTransferSuccess').onclick = async () => {
  try {
    await api('/interactive/simulate/transfer-success', 'POST', {
      reference: state.lastWithdrawalReference
    });
    setStatus('Simulated transfer.success.');
    await refreshWallet();
    await loadTransactions();
  } catch (e) {
    setStatus(e.message, true);
  }
};

$('simulateTransferFailed').onclick = async () => {
  try {
    await api('/interactive/simulate/transfer-failed', 'POST', {
      reference: state.lastWithdrawalReference
    });
    setStatus('Simulated transfer.failed with rollback.');
    await refreshWallet();
    await loadTransactions();
  } catch (e) {
    setStatus(e.message, true);
  }
};

refreshWallet().catch(() => {});
loadTransactions().catch(() => {});


(function handleRedirectMessage() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const reference = params.get('reference');
  const message = params.get('message');
  if (!payment) return;

  if (payment === 'success') {
    setStatus(`Paystack redirected back: payment success (${reference}).`);
  } else if (payment === 'failed') {
    setStatus(`Paystack redirected back: payment not successful (${reference}).`, true);
  } else {
    setStatus(`Redirect received but verification failed: ${message || 'unknown error'}`, true);
  }

  refreshWallet().catch(() => {});
  loadTransactions().catch(() => {});

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanUrl);
})();
