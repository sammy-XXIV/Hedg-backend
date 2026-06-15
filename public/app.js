import { Transaction } from 'https://esm.sh/@mysten/sui@2.17.0/transactions';
import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.11.4';

const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_OBJECT  = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC_PACKAGE   = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a';
const DUSDC_TYPE      = `${DUSDC_PACKAGE}::dusdc::DUSDC`;
const CLOCK           = '0x6';
const SUI_RPC         = 'https://fullnode.testnet.sui.io:443';

// ── State ─────────────────────────────────────────────────────────
let wallet          = null;
let address         = null;
let managerId       = null;
let selectedDuration = 15;
let quoteData       = null;
let quoteExpiry     = null;
let refreshTimer    = null;
let countdownIv     = null;

// ── DOM ───────────────────────────────────────────────────────────
const btnConnect  = document.getElementById('btn-connect');
const btcPriceEl  = document.getElementById('btc-price');
const quotesEl    = document.getElementById('quotes');
const faucetBar   = document.getElementById('faucet-bar');
const posSection  = document.getElementById('positions-section');
const posList     = document.getElementById('positions-list');
const amountInput = document.getElementById('inp-amount');
const expiryEl    = document.getElementById('quote-expiry');
const heroCost    = document.getElementById('hero-cost');
const heroPayout  = document.getElementById('hero-payout');

// ── Wallet detection ──────────────────────────────────────────────
function detectWallets() {
  const found = [];
  const seen  = new Set();

  function add(name, adapter) {
    if (!seen.has(name)) { seen.add(name); found.push({ name, adapter }); }
  }

  // 1. Wallet Standard via getWallets() — detects Slush, Sui Wallet, etc.
  try {
    const stdWallets = getWallets().get();
    for (const w of stdWallets) {
      if (w?.name) add(w.name, w);
    }
  } catch {}

  // 2. Known direct window injections (OKX, Martian, etc.)
  if (window.okxwallet?.sui)  add('OKX Wallet', window.okxwallet.sui);
  if (window.suiWallet)       add('Sui Wallet',  window.suiWallet);
  if (window.martian?.sui)    add('Martian',     window.martian.sui);
  if (window.suiet)           add('Suiet',       window.suiet);
  if (window.nightly?.sui)    add('Nightly',     window.nightly.sui);

  return found;
}

async function connectWallet(adapter) {
  // Wallet Standard (Slush / new Sui Wallet)
  if (adapter.features?.['standard:connect']) {
    const res = await adapter.features['standard:connect'].connect();
    const acc = res.accounts?.[0];
    return { address: acc?.address, adapter };
  }
  // Legacy injection API
  const res = await adapter.connect();
  const addr = res?.address ?? res?.accounts?.[0]?.address ?? res?.accounts?.[0];
  return { address: addr, adapter };
}

// Wallet picker modal
function showWalletModal(wallets) {
  const existing = document.getElementById('wallet-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'wallet-modal';
  modal.innerHTML = `
    <div id="wallet-modal-backdrop"></div>
    <div id="wallet-modal-box">
      <div id="wallet-modal-title">SELECT WALLET</div>
      ${wallets.map((w, i) => `
        <button class="wallet-option" data-index="${i}">${w.name}</button>
      `).join('')}
      <button id="wallet-modal-cancel">CANCEL</button>
    </div>`;
  document.body.appendChild(modal);

  return new Promise((resolve) => {
    modal.querySelectorAll('.wallet-option').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.remove();
        resolve(wallets[parseInt(btn.dataset.index)]);
      });
    });
    document.getElementById('wallet-modal-cancel').addEventListener('click', () => {
      modal.remove();
      resolve(null);
    });
    document.getElementById('wallet-modal-backdrop').addEventListener('click', () => {
      modal.remove();
      resolve(null);
    });
  });
}

btnConnect.addEventListener('click', async () => {
  // Disconnect if already connected
  if (address) {
    wallet  = null;
    address = null;
    managerId = null;
    localStorage.removeItem('hedg_wallet');
    btnConnect.textContent = 'Connect Wallet';
    btnConnect.classList.remove('connected');
    btnConnect.title = '';
    faucetBar.classList.add('hidden');
    posSection.classList.add('hidden');
    return;
  }

  // Wait a tick so async wallet registrations have time to complete
  await new Promise(r => setTimeout(r, 80));
  const wallets = detectWallets();

  if (!wallets.length) {
    alert('No Sui wallet detected.\nInstall Slush or OKX Wallet, then refresh the page.');
    return;
  }

  let chosen;
  if (wallets.length === 1) {
    chosen = wallets[0];
  } else {
    chosen = await showWalletModal(wallets);
  }
  if (!chosen) return;

  try {
    btnConnect.textContent = 'Connecting…';
    const { address: addr, adapter } = await connectWallet(chosen.adapter);
    if (!addr) throw new Error('No address returned');
    wallet  = adapter;
    address = addr;
    localStorage.setItem('hedg_wallet', chosen.name);
    btnConnect.textContent = address.slice(0, 6) + '…' + address.slice(-4);
    btnConnect.classList.add('connected');
    btnConnect.title = 'Click to disconnect';
    await onWalletConnected();
  } catch (e) {
    console.error('Wallet connect error', e);
    btnConnect.textContent = 'Connect Wallet';
    alert('Connection failed: ' + (e?.message || 'Unknown error'));
  }
});

async function onWalletConnected() {
  const r = await api('/api/manager?address=' + address);
  managerId = r.managerId;
  if (managerId) localStorage.setItem('hedg_manager_' + address, managerId);
  if (!managerId) {
    const cached = localStorage.getItem('hedg_manager_' + address);
    if (cached) managerId = cached;
  }

  if (managerId) {
    posSection.classList.remove('hidden');
    loadPositions();
  }
  pollPositions();
}


// ── Duration pills ────────────────────────────────────────────────
document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedDuration = parseInt(pill.dataset.minutes);
    loadQuotes();
  });
});

amountInput.addEventListener('input', debounce(loadQuotes, 400));

// ── Quotes ────────────────────────────────────────────────────────
async function loadQuotes() {
  const amount = parseFloat(amountInput.value) || 100;
  // Skeleton
  quotesEl.innerHTML = `
    <div class="quote-skeleton"></div>
    <div class="quote-skeleton"></div>
    <div class="quote-skeleton"></div>`;
  if (expiryEl) expiryEl.textContent = '';
  clearTimeout(refreshTimer);
  clearInterval(countdownIv);

  try {
    quoteData = await api(`/api/quote?duration=${selectedDuration}&amount=${amount}`);
    quoteExpiry = quoteData.expiryMs;
    renderQuotes(quoteData);
    scheduleAutoRefresh();
    updateHeroCost(quoteData);
  } catch {
    quotesEl.innerHTML = `<div class="quote-loading">Failed to load prices — retrying…</div>`;
    refreshTimer = setTimeout(loadQuotes, 5000);
  }
}

function updateHeroCost(data) {
  if (!heroCost || !heroPayout) return;
  const likely = data.levels[1];
  if (!likely) return;
  const amount = parseFloat(amountInput.value) || 100;
  heroCost.textContent   = '$' + likely.premium.toFixed(2);
  heroPayout.textContent = '$' + amount.toFixed(0);
}

function scheduleAutoRefresh() {
  const msLeft = quoteExpiry - Date.now();
  refreshTimer = setTimeout(loadQuotes, Math.max(msLeft - 20_000, 3000));
  startCountdown();
}

function startCountdown() {
  if (!expiryEl) return;
  clearInterval(countdownIv);
  const tick = () => {
    const ms = quoteExpiry - Date.now();
    if (ms <= 0) { expiryEl.textContent = 'REFRESHING'; return; }
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    expiryEl.textContent = `QUOTE EXPIRES ${m}:${s.toString().padStart(2,'0')}`;
  };
  tick();
  countdownIv = setInterval(tick, 1000);
}

const TIER = {
  Risky:  { cls: 'tier-high',   label: 'SAFE HEDGE' },
  Likely: { cls: 'tier-medium', label: 'BALANCED' },
  Safe:   { cls: 'tier-low',    label: 'MOON SHOT' },
};

function renderQuotes(data) {
  btcPriceEl.textContent = `BTC $${Number(data.spot.toFixed(0)).toLocaleString()}`;
  const expStr = new Date(data.expiryMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const amount = parseFloat(amountInput.value) || 100;

  quotesEl.innerHTML = data.levels.map((lvl, i) => {
    const t   = TIER[lvl.label] || TIER.Likely;
    const rec = i === 1 ? `<span class="tier-rec">recommended</span>` : '';
    return `
    <div class="quote-card${i===1?' recommended':''}" data-index="${i}">
      <div class="card-tier">
        <span class="${t.cls}">${t.label}</span>
        ${rec}
      </div>
      <div class="card-main">
        <div class="card-drop">−${lvl.drop}%</div>
        <div class="card-condition">BTC below $${Number(lvl.strike).toLocaleString()}</div>
        <div class="card-odds">${lvl.description}</div>
        <hr class="card-rule"/>
      </div>
      <div class="card-data">
        <div class="card-row">
          <span class="card-row-k">Payout</span>
          <span class="card-row-v payout">$${amount.toFixed(2)}</span>
        </div>
        <div class="card-row">
          <span class="card-row-k">Premium</span>
          <span class="card-row-v">$${lvl.premium.toFixed(4)}</span>
        </div>
        <div class="card-row">
          <span class="card-row-k">Expires</span>
          <span class="card-row-v">${expStr}</span>
        </div>
      </div>
      <button class="btn-buy" data-index="${i}">
        Protect $${amount.toFixed(0)} for $${lvl.premium.toFixed(2)}
      </button>
    </div>`;
  }).join('');

  quotesEl.querySelectorAll('.btn-buy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await buyProtection(data, parseInt(btn.dataset.index));
    });
  });
}

// ── Buy ───────────────────────────────────────────────────────────
async function buyProtection(data, levelIdx) {
  if (!address) { alert('Connect your wallet first.'); return; }

  const lvl        = data.levels[levelIdx];
  const btn        = quotesEl.querySelectorAll('.btn-buy')[levelIdx];
  const face       = parseFloat(amountInput.value) || 100;
  const premium    = lvl.premium;

  btn.disabled = true;
  btn.textContent = 'Confirm in wallet…';

  try {
    const coinsRes = await api(`/api/balance?address=${address}`);
    if (coinsRes.balance < premium) {
      alert(`Not enough dUSDC. You have $${coinsRes.balance.toFixed(2)}, need $${premium.toFixed(4)}.`);
      btn.disabled = false;
      btn.textContent = `Protect $${face.toFixed(0)} for $${premium.toFixed(2)}`;
      return;
    }

    const suiCoins = await fetchCoins(address, DUSDC_TYPE);
    if (!suiCoins.length) {
      alert('No dUSDC coins found in your wallet.');
      btn.disabled = false;
      btn.textContent = `Protect $${face.toFixed(0)} for $${premium.toFixed(2)}`;
      return;
    }

    const strikeBig  = BigInt(Math.round(lvl.strike * 1e9));
    const expiryBig  = BigInt(data.expiryMs);
    const faceBig    = BigInt(Math.round(face * 1e6));
    const premiumBig = BigInt(Math.round(premium * 1e6)) + 1000n;

    const tx = new Transaction();

    let mgr;
    if (!managerId) {
      mgr = tx.moveCall({ target: `${PREDICT_PACKAGE}::predict::create_manager`, arguments: [] });
    } else {
      mgr = tx.object(managerId);
    }

    const primary = tx.object(suiCoins[0].coinObjectId);
    if (suiCoins.length > 1) {
      tx.mergeCoins(primary, suiCoins.slice(1).map(c => tx.object(c.coinObjectId)));
    }
    const [depositCoin] = tx.splitCoins(primary, [tx.pure.u64(premiumBig)]);

    tx.moveCall({
      target: `${PREDICT_PACKAGE}::predict_manager::deposit`,
      typeArguments: [DUSDC_TYPE],
      arguments: [mgr, depositCoin],
    });

    const key = tx.moveCall({
      target: `${PREDICT_PACKAGE}::market_key::down`,
      arguments: [tx.pure.id(data.oracleId), tx.pure.u64(expiryBig), tx.pure.u64(strikeBig)],
    });

    tx.moveCall({
      target: `${PREDICT_PACKAGE}::predict::mint`,
      typeArguments: [DUSDC_TYPE],
      arguments: [
        tx.object(PREDICT_OBJECT), mgr, tx.object(data.oracleId),
        key, tx.pure.u64(faceBig), tx.object(CLOCK),
      ],
    });

    if (!managerId) {
      tx.transferObjects([mgr], address);
    }

    // Try all signing APIs in order
    let result;
    if (wallet.features?.['sui:signAndExecuteTransaction']) {
      // Wallet Standard (Slush, new Sui Wallet)
      result = await wallet.features['sui:signAndExecuteTransaction'].signAndExecuteTransaction({
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
    } else {
      try {
        result = await wallet.signAndExecuteTransaction({
          transaction: tx,
          options: { showEffects: true, showObjectChanges: true },
        });
      } catch {
        result = await wallet.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
    }

    if (result.effects?.status?.status !== 'success') {
      throw new Error(JSON.stringify(result.effects?.status));
    }

    if (!managerId) {
      const created = result.objectChanges?.find(c =>
        c.type === 'created' && c.objectType?.includes('PredictManager')
      );
      if (created) {
        managerId = created.objectId;
        localStorage.setItem('hedg_manager_' + address, managerId);
      }
    }

    savePosition({ oracleId: data.oracleId, expiryMs: data.expiryMs, strike: lvl.strike, direction: 'down', quantity: face, premium, managerId });

    btn.textContent = 'Position opened';
    btn.style.color = 'var(--green-lt)';
    btn.style.borderTopColor = 'rgba(42,122,82,0.3)';
    posSection.classList.remove('hidden');
    loadPositions();
    setTimeout(loadQuotes, 3000);

  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.textContent = `Pay $${lvl.premium.toFixed(2)} → Collect $${face.toFixed(0)}`;
    alert('Transaction failed: ' + (e?.message || e).toString().slice(0, 300));
  }
}

// ── Fetch coins from Sui RPC ──────────────────────────────────────
async function fetchCoins(addr, coinType) {
  const r = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins', params: [addr, coinType, null, 50] }),
  });
  return (await r.json()).result?.data || [];
}

// ── Positions ─────────────────────────────────────────────────────
function savePosition(pos) {
  const key = 'hedg_positions_' + address;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.push({ ...pos, savedAt: Date.now() });
  localStorage.setItem(key, JSON.stringify(existing));
}

function getPositions() {
  if (!address) return [];
  return JSON.parse(localStorage.getItem('hedg_positions_' + address) || '[]');
}

async function loadPositions() {
  const positions = getPositions();
  if (!positions.length) { posSection.classList.add('hidden'); return; }
  posSection.classList.remove('hidden');

  let currentSpot = null;
  try { currentSpot = (await api('/api/price')).spot; } catch {}

  posList.innerHTML = positions.map((p, i) => {
    const now     = Date.now();
    const expired = now > p.expiryMs;
    const belowNow = currentSpot && currentSpot < p.strike;

    let statusHtml;
    if (p.redeemed) {
      statusHtml = p.outcome === 'won'
        ? `<span class="pos-status-won">✓ WON $${p.quantity.toFixed(2)}</span>`
        : `<span class="pos-status-lost">✗ EXPIRED WORTHLESS</span>`;
    } else if (expired) {
      statusHtml = `<span class="pos-status-live">AWAITING SETTLEMENT</span>`;
    } else {
      const ms = p.expiryMs - now;
      statusHtml = `<span class="pos-status-live" data-pos="${i}">⏱ ${formatMs(ms)}</span>`;
    }

    const itmHtml = belowNow && !expired
      ? `<div class="pos-itm">IN THE MONEY ↓ $${currentSpot.toLocaleString()}</div>`
      : '';

    const expTime = new Date(p.expiryMs).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return `
    <div class="position-card">
      <div>
        <div class="pos-label">BTC ↓ $${Number(p.strike).toLocaleString()}</div>
        <div class="pos-sub">Binary Put · Down${itmHtml ? ' · IN THE MONEY' : ''}</div>
      </div>
      <div class="pos-right" style="display:contents">
        <span class="pos-payout" style="font-family:var(--mono);font-size:12px;color:var(--danger)">$${p.premium.toFixed(2)}</span>
        <span class="pos-payout">$${p.quantity.toFixed(2)}</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${expTime}</span>
        ${statusHtml}
      </div>
    </div>`;
  }).join('');

  // Live countdown ticks
  posList.querySelectorAll('[data-pos]').forEach(el => {
    const i = parseInt(el.dataset.pos);
    setInterval(() => {
      const p = getPositions()[i];
      if (!p) return;
      const ms = p.expiryMs - Date.now();
      el.textContent = ms <= 0 ? 'AWAITING SETTLEMENT' : '⏱ ' + formatMs(ms);
    }, 1000);
  });
}

function formatMs(ms) {
  if (ms <= 0) return 'EXPIRED';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ── Auto-redeem ───────────────────────────────────────────────────
async function pollPositions() {
  setInterval(async () => {
    const positions = getPositions();
    let changed = false;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      if (p.redeemed || !p.managerId || Date.now() < p.expiryMs + 30_000) continue;
      try {
        const r = await api('/api/redeem', 'POST', {
          managerId: p.managerId, oracleId: p.oracleId,
          expiry: p.expiryMs, strike: p.strike, direction: p.direction, quantity: p.quantity,
        });
        if (r.ok) {
          positions[i].redeemed = true;
          try {
            const oracle = await api(`/api/oracle/${p.oracleId}`);
            positions[i].outcome = oracle.settlement_price && oracle.settlement_price < p.strike * 1e9 ? 'won' : 'lost';
          } catch { positions[i].outcome = 'settled'; }
          changed = true;
        }
      } catch {}
    }
    if (changed) localStorage.setItem('hedg_positions_' + address, JSON.stringify(positions));
    loadPositions();
  }, 15_000);
}

// ── Helpers ───────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return (await fetch(path, opts)).json();
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── Init ──────────────────────────────────────────────────────────
loadQuotes();
setInterval(async () => {
  try {
    const r = await api('/api/price');
    if (r.spot) btcPriceEl.textContent = `BTC $${r.spot.toLocaleString()}`;
  } catch {}
}, 15_000);

// Auto-reconnect on page load
(async () => {
  const savedWallet = localStorage.getItem('hedg_wallet');
  if (!savedWallet) return;
  await new Promise(r => setTimeout(r, 300)); // wait for wallet extensions to inject
  const wallets = detectWallets();
  const match = wallets.find(w => w.name === savedWallet);
  if (!match) return;
  try {
    const { address: addr, adapter } = await connectWallet(match.adapter);
    if (!addr) return;
    wallet  = adapter;
    address = addr;
    btnConnect.textContent = address.slice(0, 6) + '…' + address.slice(-4);
    btnConnect.classList.add('connected');
    btnConnect.title = 'Click to disconnect';
    await onWalletConnected();
  } catch {}
})();
