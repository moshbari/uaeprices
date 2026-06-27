// Pure-JS file-backed store for the price cache + history. No native modules, so
// it builds anywhere (including drive paths with spaces) and needs no compile step
// on Railway. Survives redeploys when DATA_DIR points at a mounted volume
// (set DATA_DIR=/data on Railway). Locally defaults to ./data.
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'uaeprices.json');

// Keep at most this many fetch batches per product (caps file growth; still
// leaves plenty of points for a price-history trend).
const MAX_BATCHES_PER_QUERY = 60;

// { queries: { [norm]: { raw, last_fetched } },
//   batches: { [norm]: [ { fetched_at, offers: [...] } ] } }
let store = { queries: {}, batches: {} };
try {
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error('Could not read store, starting fresh:', e.message);
}

function persist() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, FILE); // atomic-ish replace
}

// Normalize a free-text product query into a stable cache key.
export function normalizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Persist a fresh batch of offers for a query and stamp the fetch time.
export function saveOffers(rawQuery, offers) {
  const queryNorm = normalizeQuery(rawQuery);
  const now = Date.now();
  const clean = (offers || []).map((o) => ({
    store: o.store || null,
    product_name: o.product_name || null,
    pack_size: o.pack_size || null,
    price_aed: typeof o.price_aed === 'number' ? o.price_aed : null,
    unit_price: typeof o.unit_price === 'number' ? o.unit_price : null,
    unit: o.unit || null,
    in_stock: o.in_stock === false ? false : true,
    source_url: o.source_url || null,
    notes: o.notes || null,
  }));
  if (!store.batches[queryNorm]) store.batches[queryNorm] = [];
  store.batches[queryNorm].push({ fetched_at: now, offers: clean });
  if (store.batches[queryNorm].length > MAX_BATCHES_PER_QUERY) {
    store.batches[queryNorm] = store.batches[queryNorm].slice(-MAX_BATCHES_PER_QUERY);
  }
  store.queries[queryNorm] = { raw: rawQuery, last_fetched: now };
  persist();
  return { queryNorm, fetched_at: now, count: clean.length };
}

// Return the most recent batch of offers for a query if within the TTL window.
export function getCached(rawQuery, ttlMs) {
  const queryNorm = normalizeQuery(rawQuery);
  const q = store.queries[queryNorm];
  if (!q || !q.last_fetched) return null;
  if (ttlMs && Date.now() - q.last_fetched > ttlMs) return null;
  const batches = store.batches[queryNorm] || [];
  const last = batches[batches.length - 1];
  if (!last) return null;
  const offers = [...last.offers].sort((a, b) => (a.price_aed ?? Infinity) - (b.price_aed ?? Infinity));
  return { queryNorm, fetched_at: q.last_fetched, offers, cached: true };
}

// Price history: lowest + average price seen per fetch batch over time.
export function getHistory(rawQuery) {
  const queryNorm = normalizeQuery(rawQuery);
  const batches = store.batches[queryNorm] || [];
  return batches.map((b) => {
    const prices = b.offers.map((o) => o.price_aed).filter((p) => typeof p === 'number');
    const min = prices.length ? Math.min(...prices) : null;
    const avg = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
    return { fetched_at: b.fetched_at, min_price: min, avg_price: avg, offers: prices.length };
  });
}

// Recently searched products (for suggestions).
export function recentQueries(limit = 12) {
  return Object.values(store.queries)
    .sort((a, b) => b.last_fetched - a.last_fetched)
    .slice(0, limit)
    .map((q) => ({ raw_query: q.raw, last_fetched: q.last_fetched }));
}
