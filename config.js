// DeepBook Predict testnet constants
export const NETWORK = 'testnet';
export const FULLNODE = 'https://fullnode.testnet.sui.io:443';
export const PREDICT_SERVER = 'https://predict-server.testnet.mystenlabs.com';

export const PREDICT_PACKAGE  = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
export const PREDICT_OBJECT   = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const DUSDC_PACKAGE    = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a';
export const DUSDC_TYPE       = `${DUSDC_PACKAGE}::dusdc::DUSDC`;
export const CLOCK            = '0x6';

export const PRICE_SCALE = 1_000_000_000n; // 1e9 — strikes/prices
export const DUSDC_SCALE = 1_000_000n;     // 1e6 — quantities

// App wallet (generated for this project)
export const APP_ADDRESS = '0xf44e6ba54c8a89e7aeb560e1136d38e18618d15486897fb5dd2608f4ceea1912';
// SECRET_KEY loaded from .env — never hardcode
