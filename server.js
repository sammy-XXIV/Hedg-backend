import 'dotenv/config';
import express from 'express';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { CoreClient } from '@mysten/sui/client';

import {
  FULLNODE, PREDICT_SERVER, PREDICT_PACKAGE, PREDICT_OBJECT,
  DUSDC_TYPE, CLOCK, PRICE_SCALE, DUSDC_SCALE
} from './config.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const suiClient = new CoreClient({ url: FULLNODE });
const keypair = Ed25519Keypair.fromSecretKey(process.env.SECRET_KEY);
const APP_ADDRESS = keypair.toSuiAddress();
console.log('App wallet:', APP_ADDRESS);

// ── Raw RPC helper ────────────────────────────────────────────────
async function rpc(method, params = []) {
  const res = await fetch(FULLNODE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
  return d.result;
}

async function getCoins(owner, coinType) {
  const r = await rpc('suix_getCoins', [owner, coinType, null, 50]);
  return r.data || [];
}

async function getOwnedObjects(owner, structType) {
  const r = await rpc('suix_getOwnedObjects', [
    owner,
    { filter: { StructType: structType }, options: { showType: true, showContent: false } },
    null, 10,
  ]);
  return r.data || [];
}

// ── Indexer helper ────────────────────────────────────────────────
const indexer = async (path) => {
  const res = await fetch(`${PREDICT_SERVER}${path}`);
  if (!res.ok) throw new Error(`Indexer ${path} → ${res.status}`);
  return res.json();
};

// ── SVI pricing ───────────────────────────────────────────────────
function normalCDF(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-ax*ax);
  return 0.5 * (1 + sign * y);
}

// a, b, sigma scale by 1e8; rho and m scale by 1e9 (rho must stay in (-1,1))
function sviTotalVariance(k, svi) {
  const a   = svi.a     / 1e8;
  const b   = svi.b     / 1e8;
  const rho = (svi.rho_negative ? -1 : 1) * svi.rho / 1e9;
  const m   = (svi.m_negative   ? -1 : 1) * svi.m   / 1e9;
  const sig = svi.sigma / 1e8;
  return a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sig ** 2));
}

function binaryDownPrice(spot, strike, svi) {
  const k  = Math.log(strike / spot);          // negative when strike < spot
  const w  = Math.max(sviTotalVariance(k, svi), 1e-10);
  const d2 = (-k - 0.5 * w) / Math.sqrt(w);   // standard BS d2
  return Math.min(Math.max(normalCDF(-d2), 0.001), 0.999); // binary put = N(-d2)
}

// ── Get best oracle for a target duration ─────────────────────────
async function getBestOracle(durationMinutes) {
  const oracles = await indexer(`/predicts/${PREDICT_OBJECT}/oracles`);
  const now = Date.now();
  const targetExpiry = now + durationMinutes * 60 * 1000;
  const live = oracles
    .filter(o => o.status === 'active' && Number(o.expiry) > now + 60_000 && o.settlement_price == null)
    .sort((a, b) => Math.abs(Number(a.expiry) - targetExpiry) - Math.abs(Number(b.expiry) - targetExpiry));
  if (!live.length) throw new Error('No live oracles');
  const oracle = live[0];
  const state = await indexer(`/oracles/${oracle.oracle_id}/state`);
  return { oracle, state };
}

function nearestStrike(target, minStrike, tickSize) {
  const n = Math.max(0, Math.round((target - minStrike) / tickSize));
  return minStrike + n * tickSize;
}

// ── API: BTC spot price ───────────────────────────────────────────
app.get('/api/price', async (req, res) => {
  try {
    const oracles = await indexer(`/predicts/${PREDICT_OBJECT}/oracles`);
    const now = Date.now();
    const live = oracles.filter(o => o.status === 'active' && Number(o.expiry) > now && !o.settlement_price);
    if (!live.length) return res.json({ spot: null });
    const state = await indexer(`/oracles/${live[0].oracle_id}/state`);
    const spot = Number(state.latest_price?.spot) / Number(PRICE_SCALE);
    res.json({ spot: +spot.toFixed(2) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Find strike where binary put price ≈ targetUnit via bisection
function findStrikeForPrice(spot, targetUnit, svi, minStrike, tickSize) {
  // Search from ATM downward; binary put price decreases as strike decreases
  let lo = minStrike, hi = spot * 0.9999;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const price = binaryDownPrice(spot, mid, svi);
    if (price > targetUnit) hi = mid; else lo = mid;
  }
  return nearestStrike((lo + hi) / 2, minStrike, tickSize);
}

// ── API: quote ────────────────────────────────────────────────────
app.get('/api/quote', async (req, res) => {
  try {
    const duration = parseInt(req.query.duration) || 15;
    const face     = parseFloat(req.query.amount)  || 100;
    const { oracle, state } = await getBestOracle(duration);
    const spot      = Number(state.latest_price?.spot) / Number(PRICE_SCALE);
    const svi       = state.latest_svi;
    const minStrike = Number(oracle.min_strike) / Number(PRICE_SCALE);
    const tickSize  = Number(oracle.tick_size)  / Number(PRICE_SCALE);

    if (!svi) throw new Error('No SVI data for oracle');

    // Target premium rates: find strikes that give these probabilities
    // Higher premium = higher chance of payout (closer to ATM)
    const targets = [
      { label: 'Risky',  targetUnit: 0.25, description: 'High chance · ~4x payout' },
      { label: 'Likely', targetUnit: 0.10, description: 'Medium chance · ~10x payout' },
      { label: 'Safe',   targetUnit: 0.03, description: 'Low chance · ~33x payout' },
    ];

    const levels = targets.map(({ label, targetUnit, description }) => {
      const strike  = findStrikeForPrice(spot, targetUnit, svi, minStrike, tickSize);
      const unit    = binaryDownPrice(spot, strike, svi);
      const premium = +(face * unit).toFixed(4);
      const drop    = (((spot - strike) / spot) * 100).toFixed(2);
      return {
        label,
        description,
        strike:    +strike.toFixed(2),
        drop,
        premium,
        face,
        unitPrice: +unit.toFixed(6),
        odds:      Math.round(1 / unit),
      };
    });

    res.json({
      spot:      +spot.toFixed(2),
      oracleId:  oracle.oracle_id,
      expiryMs:  Number(oracle.expiry),
      levels,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: find user's PredictManager ──────────────────────────────
app.get('/api/manager', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });

    // Try indexer first
    try {
      const managers = await indexer(`/managers?owner=${address}`);
      if (Array.isArray(managers) && managers.length > 0) {
        const id = managers[0].manager_id || managers[0].id || managers[0].object_id;
        if (id) return res.json({ managerId: id });
      }
    } catch {}

    // Fallback: owned objects via RPC
    const objects = await getOwnedObjects(address, `${PREDICT_PACKAGE}::predict_manager::PredictManager`);
    const obj = objects.find(o => o.data?.objectId);
    res.json({ managerId: obj?.data?.objectId || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: dUSDC balance ────────────────────────────────────────────
app.get('/api/balance', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });
    const coins = await getCoins(address, DUSDC_TYPE);
    const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
    res.json({ balance: Number(total) / 1e6 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: dUSDC faucet ─────────────────────────────────────────────
app.post('/api/faucet', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    const SEND = 500n * DUSDC_SCALE; // $500
    const coins = await getCoins(APP_ADDRESS, DUSDC_TYPE);
    if (!coins.length) return res.status(503).json({ error: 'App wallet has no dUSDC yet — form not approved yet' });

    const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
    if (total < SEND) return res.status(503).json({ error: `App wallet low on dUSDC ($${Number(total)/1e6})` });

    const tx = new Transaction();
    const primary = tx.object(coins[0].coinObjectId);
    if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
    const [coin] = tx.splitCoins(primary, [tx.pure.u64(SEND)]);
    tx.transferObjects([coin], tx.pure.address(address));

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== 'success') {
      return res.status(500).json({ error: 'Transfer failed' });
    }
    res.json({ ok: true, amount: 500, digest: result.digest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: permissionless redeem ────────────────────────────────────
app.post('/api/redeem', async (req, res) => {
  try {
    const { managerId, oracleId, expiry, strike, direction, quantity } = req.body;
    if (!managerId || !oracleId) return res.status(400).json({ error: 'missing fields' });

    const strikeBig   = BigInt(Math.round(strike   * Number(PRICE_SCALE)));
    const quantityBig = BigInt(Math.round(quantity * Number(DUSDC_SCALE)));
    const expiryBig   = BigInt(expiry);

    const tx = new Transaction();
    const keyFn = direction === 'up' ? 'up' : 'down';
    const key = tx.moveCall({
      target: `${PREDICT_PACKAGE}::market_key::${keyFn}`,
      arguments: [tx.pure.id(oracleId), tx.pure.u64(expiryBig), tx.pure.u64(strikeBig)],
    });
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::predict::redeem_permissionless`,
      typeArguments: [DUSDC_TYPE],
      arguments: [
        tx.object(PREDICT_OBJECT),
        tx.object(managerId),
        tx.object(oracleId),
        key,
        tx.pure.u64(quantityBig),
        tx.object(CLOCK),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== 'success') {
      return res.status(500).json({ error: 'Redeem failed', details: result.effects?.status });
    }
    res.json({ ok: true, digest: result.digest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: oracle state (for win/loss detection) ────────────────────
app.get('/api/oracle/:id', async (req, res) => {
  try {
    const state = await indexer(`/oracles/${req.params.id}/state`);
    res.json({
      settlement_price: state.settlement_price ?? null,
      spot: Number(state.latest_price?.spot) / Number(PRICE_SCALE),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: user positions ───────────────────────────────────────────
app.get('/api/positions', async (req, res) => {
  try {
    const { managerId } = req.query;
    if (!managerId) return res.status(400).json({ error: 'managerId required' });
    const positions = await indexer(`/managers/${managerId}/positions/summary`);
    res.json(positions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hedg → http://localhost:${PORT}`));
