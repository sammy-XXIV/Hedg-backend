import { PREDICT_SERVER, PREDICT_OBJECT, PRICE_SCALE } from '../config.js';

const get = async (path) => {
  const res = await fetch(`${PREDICT_SERVER}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const fmt = (v) => (Number(BigInt(v)) / Number(PRICE_SCALE)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtTime = (ms) => new Date(Number(ms)).toISOString();

const oracles = await get(`/predicts/${PREDICT_OBJECT}/oracles`);
const all = Array.isArray(oracles) ? oracles : (oracles.oracles ?? []);
const now = Date.now();
const live = all
  .filter(o => o.status === 'active' && Number(o.expiry) > now && o.settlement_price == null)
  .sort((a, b) => Number(a.expiry) - Number(b.expiry));

console.log(`Live markets: ${live.length} of ${all.length} total\n`);
for (const o of live.slice(0, 10)) {
  const state = await get(`/oracles/${o.oracle_id}/state`);
  const spot = state.latest_price?.spot;
  console.log(`${o.underlying_asset}  exp=${fmtTime(o.expiry)}  spot=$${spot ? fmt(spot) : '?'}  oracle=${o.oracle_id}`);
}
