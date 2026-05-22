'use strict';

/**
 * Asset alias map: maps lower-cased full names / common aliases to their
 * canonical ticker symbols.
 */
const ASSET_ALIASES = {
  bitcoin: 'BTC',
  'bitcoin cash': 'BCH',
  ethereum: 'ETH',
  ether: 'ETH',
  'ethereum classic': 'ETC',
  tether: 'USDT',
  solana: 'SOL',
  dogecoin: 'DOGE',
  cardano: 'ADA',
  ripple: 'XRP',
  polkadot: 'DOT',
  chainlink: 'LINK',
  litecoin: 'LTC',
  'binance coin': 'BNB',
  binancecoin: 'BNB',
  'usd coin': 'USDC',
  avalanche: 'AVAX',
  polygon: 'MATIC',
  shiba: 'SHIB',
  'shiba inu': 'SHIB',
  cosmos: 'ATOM',
  monero: 'XMR',
  stellar: 'XLM',
  vechain: 'VET',
  tron: 'TRX',
  filecoin: 'FIL',
  aave: 'AAVE',
  uniswap: 'UNI',
  'wrapped bitcoin': 'WBTC',
  'dai stablecoin': 'DAI',
  dai: 'DAI',
};

/**
 * Transaction type normalization map.
 */
const TYPE_MAP = {
  buy: 'BUY',
  purchase: 'BUY',
  sell: 'SELL',
  sale: 'SELL',
  transfer_in: 'TRANSFER_IN',
  transfer_out: 'TRANSFER_OUT',
  deposit: 'TRANSFER_IN',
  receive: 'TRANSFER_IN',
  received: 'TRANSFER_IN',
  withdrawal: 'TRANSFER_OUT',
  withdraw: 'TRANSFER_OUT',
  send: 'TRANSFER_OUT',
  sent: 'TRANSFER_OUT',
  swap_in: 'TRANSFER_IN',
  swap_out: 'TRANSFER_OUT',
  staking_reward: 'TRANSFER_IN',
  airdrop: 'TRANSFER_IN',
};

/**
 * Normalize a raw asset string to its canonical ticker symbol.
 * - Trims whitespace, uppercases the result.
 * - Checks the alias table before returning.
 * @param {string} raw
 * @returns {string} canonical ticker, or '' if blank
 */
function normalizeAsset(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (ASSET_ALIASES[lower]) return ASSET_ALIASES[lower];

  // Already looks like a ticker (all uppercase, short)
  return trimmed.toUpperCase();
}

/**
 * Normalize a raw transaction type string to an uppercase canonical value.
 * @param {string} raw
 * @returns {string|null} canonical type, or null if unmappable
 */
function normalizeType(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TYPE_MAP[lower] || null;
}

/**
 * Returns true when two transaction types represent the same event from
 * opposite perspectives (e.g. one side sees TRANSFER_OUT, the other TRANSFER_IN).
 * @param {string} userType
 * @param {string} exchangeType
 * @returns {boolean}
 */
function typesArePerspectiveMatch(userType, exchangeType) {
  return (
    (userType === 'TRANSFER_OUT' && exchangeType === 'TRANSFER_IN') ||
    (userType === 'TRANSFER_IN' && exchangeType === 'TRANSFER_OUT')
  );
}

/**
 * Attempt to parse a raw timestamp string into a Date object.
 * Tries, in order: ISO 8601, MM/DD/YYYY HH:mm, MM/DD/YYYY,
 * DD-MM-YYYY, DD/MM/YYYY, and Unix epoch (numeric string).
 * @param {string} raw
 * @returns {Date|null}
 */
function parseTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // 1. ISO 8601 (handles most standard formats)
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;

  // 2. MM/DD/YYYY HH:mm or MM/DD/YYYY HH:mm:ss
  const mmddyyyy =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  let m = s.match(mmddyyyy);
  if (m) {
    const d = new Date(
      parseInt(m[3], 10),
      parseInt(m[1], 10) - 1,
      parseInt(m[2], 10),
      parseInt(m[4] || '0', 10),
      parseInt(m[5] || '0', 10),
      parseInt(m[6] || '0', 10)
    );
    if (!isNaN(d.getTime())) return d;
  }

  // 3. DD-MM-YYYY or DD-MM-YYYY HH:mm
  const ddmmyyyy =
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  m = s.match(ddmmyyyy);
  if (m) {
    const d = new Date(
      parseInt(m[3], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[1], 10),
      parseInt(m[4] || '0', 10),
      parseInt(m[5] || '0', 10),
      parseInt(m[6] || '0', 10)
    );
    if (!isNaN(d.getTime())) return d;
  }

  // 4. DD/MM/YYYY
  const ddmmyyyySlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  m = s.match(ddmmyyyySlash);
  if (m) {
    const d = new Date(
      parseInt(m[3], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[1], 10)
    );
    if (!isNaN(d.getTime())) return d;
  }

  // 5. Unix epoch (numeric string — seconds or milliseconds)
  if (/^\d{10,13}$/.test(s)) {
    const num = parseInt(s, 10);
    const d = new Date(s.length === 13 ? num : num * 1000);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Parse a raw quantity value, stripping commas, currency symbols, and
 * leading/trailing whitespace.
 * @param {string|number} raw
 * @returns {number|null} parsed number, or null if non-numeric
 */
function parseQuantity(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw)
    .trim()
    .replace(/[$£€₹,\s]/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

module.exports = {
  normalizeAsset,
  normalizeType,
  typesArePerspectiveMatch,
  parseTimestamp,
  parseQuantity,
};
