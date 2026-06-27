# UAE Prices — Abu Dhabi grocery price comparison

Compare grocery prices across **every Abu Dhabi marketplace** (Lulu, Carrefour, Spinneys,
Union Coop, Abu Dhabi Co-op, Nesto, Grandiose, Viva, Choithrams, Earth, Amazon.ae, Noon,
Kibsons, El Grocer, Talabat/InstaShop) and always buy the cheapest.

Live: **https://uaeprices.up.railway.app**

## How it works
No UAE store has a public price API and most block datacenter IPs, so instead of a fleet of
fragile scrapers, the price engine asks **Claude (on the owner's subscription) with live web
search** to find current prices across all stores, normalize them to a per-unit price, and
return clean JSON. Every result is cached to SQLite (which also builds price history) and
shows a **source link + timestamp** so you can verify.

- `lib/priceEngine.js` — Claude web-search lookup → structured JSON
- `lib/db.js` — SQLite cache + price history (`DATA_DIR`, default `./data`)
- `lib/basket.js` — cheapest single store + optimal store-by-store split
- `adapters/` — pluggable precise direct-store adapters (Carrefour first; fail-soft)
- `server.js` — Express API (`/api/search`, `/api/basket`, `/api/history`)
- `public/` — mobile-first UI

## Run locally
```
npm install
CLAUDE_CODE_OAUTH_TOKEN=... npm start    # http://localhost:3000
```

## Deploy (Railway, push-to-deploy)
- GitHub `moshbari/uaeprices` → Railway auto-deploys on push to `main`.
- Set env `CLAUDE_CODE_OAUTH_TOKEN`; attach a volume and set `DATA_DIR=/data` so the cache
  and price history survive redeploys.

## Notes
- Prices are best-available estimates with a verify link — always confirm at checkout.
- Precision improves per store as direct adapters are added (`adapters/`).
