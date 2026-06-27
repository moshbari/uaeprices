// Pluggable precise-adapter registry. Each adapter does a direct store lookup and
// returns offers in the same shape as the AI engine. Adapters augment the AI
// results (precise prices override estimates for the same store). Every adapter
// is fail-soft, so a broken store never breaks a search.
import * as carrefour from './carrefour.js';

const ADAPTERS = [carrefour];

// Run every adapter for a query and return the merged offer list (fail-soft).
export async function enrich(query) {
  const results = await Promise.allSettled(ADAPTERS.map((a) => a.fetchOffers(query)));
  const offers = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) offers.push(...r.value);
  }
  return offers;
}

// Merge AI offers with precise adapter offers; adapter price wins for its store.
export function merge(aiOffers, adapterOffers) {
  if (!adapterOffers.length) return aiOffers;
  const out = [...aiOffers];
  for (const a of adapterOffers) {
    const idx = out.findIndex(
      (o) => o.store && a.store && o.store.toLowerCase() === a.store.toLowerCase(),
    );
    if (idx >= 0) out[idx] = { ...out[idx], ...a };
    else out.push(a);
  }
  out.sort((x, y) => (x.price_aed ?? Infinity) - (y.price_aed ?? Infinity));
  return out;
}
