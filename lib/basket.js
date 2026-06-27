// Basket optimizer: given each shopping-list item's offers, work out the single
// cheapest store for the whole basket and the optimal store-by-store split.

// items: [{ query, offers: [{store, price_aed, ...}] }]
export function optimizeBasket(items) {
  // Best (cheapest in-stock) offer per store, per item.
  const perItem = items.map((item) => {
    const byStore = new Map();
    for (const o of item.offers || []) {
      if (typeof o.price_aed !== 'number') continue;
      if (o.in_stock === false) continue;
      const cur = byStore.get(o.store);
      if (!cur || o.price_aed < cur.price_aed) byStore.set(o.store, o);
    }
    return { query: item.query, byStore };
  });

  // --- Optimal split: cheapest store for each item independently ---
  const split = perItem.map((it) => {
    let best = null;
    for (const o of it.byStore.values()) {
      if (!best || o.price_aed < best.price_aed) best = o;
    }
    return { query: it.query, pick: best };
  });
  const splitTotal = split.reduce((s, x) => s + (x.pick?.price_aed || 0), 0);
  const splitMissing = split.filter((x) => !x.pick).map((x) => x.query);

  // --- Cheapest single store: store that covers the most items, cheapest total ---
  const allStores = new Set();
  perItem.forEach((it) => it.byStore.forEach((_, store) => allStores.add(store)));

  const storeTotals = [];
  for (const store of allStores) {
    let total = 0;
    let have = 0;
    const lines = [];
    for (const it of perItem) {
      const o = it.byStore.get(store);
      if (o) { total += o.price_aed; have += 1; lines.push({ query: it.query, offer: o }); }
      else lines.push({ query: it.query, offer: null });
    }
    storeTotals.push({ store, total, have, missing: items.length - have, lines });
  }
  // Prefer stores that carry the most items, then the cheapest total.
  storeTotals.sort((a, b) => (b.have - a.have) || (a.total - b.total));
  const cheapestStore = storeTotals[0] || null;

  // Savings: cheapest single full-basket store vs the most expensive one.
  const fullStores = storeTotals.filter((s) => s.have === items.length);
  let singleStoreSavings = null;
  if (fullStores.length >= 2) {
    const cheap = Math.min(...fullStores.map((s) => s.total));
    const pricey = Math.max(...fullStores.map((s) => s.total));
    singleStoreSavings = +(pricey - cheap).toFixed(2);
  }
  // Savings of the split vs the cheapest single full-basket store.
  let splitSavings = null;
  if (fullStores.length >= 1 && splitMissing.length === 0) {
    const cheapestFull = Math.min(...fullStores.map((s) => s.total));
    splitSavings = +(cheapestFull - splitTotal).toFixed(2);
  }

  return {
    split: { lines: split, total: +splitTotal.toFixed(2), missing: splitMissing },
    cheapestStore,
    storeTotals,
    savings: { singleStoreSavings, splitSavings },
  };
}
