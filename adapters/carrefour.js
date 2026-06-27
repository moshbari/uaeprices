// Best-effort precise adapter for Carrefour UAE (Majid Al Futtaim storefront).
// Carrefour is the most reachable UAE store from a datacenter IP, so it's the
// first store to get a direct adapter for extra accuracy. This is intentionally
// fail-soft: any error returns [] and the AI engine remains the source of truth.
//
// NOTE: the exact storefront API (host, appId, store/area headers) shifts over
// time. When verified against live network traffic, fill in ENDPOINT + headers.
// Until then this returns [] and never blocks a search.

const ENABLED = process.env.CARREFOUR_ADAPTER === 'on';

export const name = 'Carrefour';

export async function fetchOffers(query) {
  if (!ENABLED) return [];
  try {
    const url = `https://www.carrefouruae.com/api/v8/search?keyword=${encodeURIComponent(query)}&lang=en&store=` +
      (process.env.CARREFOUR_STORE_ID || '');
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        ...(process.env.CARREFOUR_APP_ID ? { appId: process.env.CARREFOUR_APP_ID } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const products = data?.products || data?.data?.products || [];
    return products.slice(0, 5).map((p) => ({
      store: 'Carrefour',
      product_name: p.name || p.title,
      pack_size: p.size || p.weight || null,
      price_aed: Number(p.price?.value ?? p.price) || null,
      in_stock: p.stock !== 0,
      source_url: p.url ? `https://www.carrefouruae.com${p.url}` : 'https://www.carrefouruae.com',
      notes: 'Direct from Carrefour storefront',
    })).filter((o) => o.price_aed);
  } catch {
    return [];
  }
}
