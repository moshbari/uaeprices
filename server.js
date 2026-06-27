import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchPrices, MARKETPLACES } from './lib/priceEngine.js';
import { enrich, merge } from './adapters/index.js';
import { saveOffers, getCached, getHistory, recentQueries } from './lib/db.js';
import { optimizeBasket } from './lib/basket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 12 * 60 * 60 * 1000; // 12h

// Get offers for one product: serve fresh cache, else do a live lookup + cache it.
async function getOffersFor(query, { fresh = false } = {}) {
  if (!fresh) {
    const cached = getCached(query, CACHE_TTL_MS);
    if (cached) return { offers: cached.offers, fetched_at: cached.fetched_at, cached: true };
  }
  const [ai, adapter] = await Promise.all([
    searchPrices(query),
    enrich(query),
  ]);
  const offers = merge(ai.offers, adapter);
  const saved = saveOffers(query, offers);
  return { offers, fetched_at: saved.fetched_at, cached: false };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasClaude: !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) });
});

app.get('/api/marketplaces', (_req, res) => res.json({ marketplaces: MARKETPLACES }));

app.get('/api/recent', (_req, res) => res.json({ recent: recentQueries(12) }));

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Add a product to search, e.g. "Almarai milk 2L".' });
  try {
    const result = await getOffersFor(q, { fresh: req.query.fresh === '1' });
    res.json({ query: q, ...result });
  } catch (err) {
    console.error('search error:', err);
    res.status(500).json({ error: err.message || 'Price lookup failed. Try again in a moment.' });
  }
});

app.get('/api/history', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing product.' });
  res.json({ query: q, history: getHistory(q) });
});

app.post('/api/basket', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.map((s) => String(s).trim()).filter(Boolean) : [];
  if (!items.length) return res.status(400).json({ error: 'Add at least one item to your list.' });
  if (items.length > 25) return res.status(400).json({ error: 'Max 25 items per list for now.' });
  try {
    const withOffers = [];
    for (const query of items) {
      const r = await getOffersFor(query); // sequential: keeps token use sane + reuses cache
      withOffers.push({ query, offers: r.offers });
    }
    const plan = optimizeBasket(withOffers);
    res.json({ items: withOffers, plan });
  } catch (err) {
    console.error('basket error:', err);
    res.status(500).json({ error: err.message || 'Basket lookup failed. Try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`UAE Prices running on :${PORT}`));
