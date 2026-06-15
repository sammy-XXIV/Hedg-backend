import { APP_ADDRESS } from '../config.js';

const res = await fetch('https://faucet.testnet.sui.io/v1/gas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ FixedAmountRequest: { recipient: APP_ADDRESS } }),
});
const text = await res.text();
console.log(res.status, text);
