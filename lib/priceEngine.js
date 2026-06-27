// Price engine: asks Claude (on Mosh's SUBSCRIPTION) to search the live web for
// current prices across every Abu Dhabi marketplace and return strict JSON.
//
// Auth path matters: the subscription OAuth token is meant for the `claude` CLI /
// Agent SDK, NOT raw api.anthropic.com calls (those get 429'd). So we drive the
// Claude Agent SDK's query(), which uses CLAUDE_CODE_OAUTH_TOKEN natively and has
// the WebSearch tool built in.
import { query } from '@anthropic-ai/claude-agent-sdk';

const MODEL = process.env.PRICE_MODEL || 'claude-sonnet-4-6';

// Every Abu Dhabi marketplace we want covered. Edit this list to add stores.
export const MARKETPLACES = [
  'Lulu Hypermarket', 'Carrefour', 'Spinneys', 'Union Coop',
  'Abu Dhabi Co-op (ADCOOPS)', 'Nesto Hypermarket', 'Grandiose',
  'Viva (by Lulu)', 'Choithrams', 'Earth Supermarket',
  'Amazon.ae', 'Noon', 'Kibsons', 'El Grocer', 'Talabat / InstaShop',
];

function buildPrompt(q) {
  return `You are a grocery price researcher for shoppers in **Abu Dhabi, UAE**. Find the cheapest place to buy: "${q}".

Use the WebSearch tool to find the CURRENT price of this product (and common pack sizes / close equivalents) across these Abu Dhabi marketplaces:
${MARKETPLACES.map((m) => `- ${m}`).join('\n')}

Rules:
- Abu Dhabi only. Prices in AED.
- BUDGET: do AT MOST 6 web searches total. A single search (e.g. "<product> price UAE Carrefour Lulu Noon") usually surfaces several retailers at once — extract every store/price you can from each result page instead of searching one store at a time.
- After ~6 searches (or sooner), STOP searching and output the JSON with whatever you found. Returning 4-8 good offers fast beats exhaustively covering every store.
- Always include a real source_url you actually saw the price on. Never invent a price or URL.
- Compute unit_price (per kg, per L, or each) so different pack sizes compare fairly, and set "unit".
- If a price might be slightly stale, note it briefly. Cheapest first.

Respond with ONLY a JSON object, no prose, no markdown fences, in exactly this shape:
{"offers":[{"store":"","product_name":"","pack_size":"","price_aed":0,"unit_price":0,"unit":"","in_stock":true,"source_url":"","notes":""}]}`;
}

// Pull the final assistant text out of the Agent SDK message stream.
async function runAgent(prompt) {
  let finalText = '';
  let lastAssistant = '';
  const stream = query({
    prompt,
    options: {
      model: MODEL,
      allowedTools: ['WebSearch'],
      permissionMode: 'bypassPermissions',
      settingSources: [],
      maxTurns: 28,
    },
  });
  for await (const msg of stream) {
    if (msg.type === 'assistant') {
      const t = (msg.message?.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (t.trim()) lastAssistant = t;
    } else if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string') {
      finalText = msg.result;
    }
  }
  // On max_turns the result isn't "success" but the last assistant turn often
  // still holds the JSON — salvage it rather than failing the whole lookup.
  return finalText || lastAssistant;
}

function parseOffers(text) {
  if (!text) return [];
  let raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    obj = JSON.parse(m[0]);
  }
  return Array.isArray(obj?.offers) ? obj.offers : [];
}

// Run a live multi-store price lookup. Returns { offers: [...] }.
export async function searchPrices(query_) {
  const text = await runAgent(buildPrompt(query_));
  const offers = parseOffers(text)
    .map((o) => ({
      store: o.store,
      product_name: o.product_name,
      pack_size: o.pack_size || null,
      price_aed: typeof o.price_aed === 'number' ? o.price_aed : Number(o.price_aed) || null,
      unit_price: typeof o.unit_price === 'number' ? o.unit_price : Number(o.unit_price) || null,
      unit: o.unit || null,
      in_stock: o.in_stock === false ? false : true,
      source_url: o.source_url || null,
      notes: o.notes || null,
    }))
    .filter((o) => o.store && o.price_aed);
  offers.sort((a, b) => {
    if (!!a.in_stock !== !!b.in_stock) return a.in_stock ? -1 : 1;
    return (a.price_aed ?? Infinity) - (b.price_aed ?? Infinity);
  });
  return { offers };
}
