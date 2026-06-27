// Price engine: asks Claude (on Mosh's subscription) to search the live web for
// current prices across every Abu Dhabi marketplace, normalize them, and return
// strict JSON. Auth uses the subscription OAuth token (CLAUDE_CODE_OAUTH_TOKEN)
// with the oauth beta header; falls back to ANTHROPIC_API_KEY if that's set.
import Anthropic from '@anthropic-ai/sdk';

// Sonnet by default: a price lookup doesn't need Opus, and Sonnet has much higher
// subscription rate limits (Opus caps are tight on Pro/Max). Override with PRICE_MODEL.
const MODEL = process.env.PRICE_MODEL || 'claude-sonnet-4-6';

// Every Abu Dhabi marketplace we want covered. Edit this list to add stores.
export const MARKETPLACES = [
  'Lulu Hypermarket', 'Carrefour', 'Spinneys', 'Union Coop',
  'Abu Dhabi Co-op (ADCOOPS)', 'Nesto Hypermarket', 'Grandiose',
  'Viva (by Lulu)', 'Choithrams', 'Earth Supermarket',
  'Amazon.ae', 'Noon', 'Kibsons', 'El Grocer', 'Talabat / InstaShop',
];

function makeClient() {
  const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
  if (oauth) {
    return new Anthropic({
      authToken: oauth,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  throw new Error('No Claude credentials. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).');
}

const OFFER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          store: { type: 'string', description: 'Marketplace name' },
          product_name: { type: 'string', description: 'Exact product/brand as listed' },
          pack_size: { type: 'string', description: 'e.g. "2 L", "1 kg", "12 x 200 ml"' },
          price_aed: { type: 'number', description: 'Current price in AED' },
          unit_price: { type: 'number', description: 'Price per base unit (per kg / L / piece) for fair comparison' },
          unit: { type: 'string', description: 'The base unit unit_price is measured in, e.g. "per kg", "per L", "each"' },
          in_stock: { type: 'boolean' },
          source_url: { type: 'string', description: 'Direct link to the product/price page used' },
          notes: { type: 'string', description: 'Promo, delivery, or confidence caveat. Keep short.' },
        },
        required: ['store', 'product_name', 'price_aed', 'source_url'],
      },
    },
  },
  required: ['offers'],
};

function buildPrompt(query) {
  return `You are a grocery price researcher for shoppers in **Abu Dhabi, UAE**. The user wants the cheapest place to buy: "${query}".

Use web search to find the CURRENT price of this product (and close equivalents / common pack sizes) across these Abu Dhabi marketplaces:
${MARKETPLACES.map((m) => `- ${m}`).join('\n')}

Rules:
- Abu Dhabi only. Ignore Dubai-only or other-emirate-only pricing if it differs.
- Prices in AED. Search each store you reasonably can; it's fine to return fewer if some have no online price.
- Always include a real source_url you actually saw the price on.
- Compute unit_price (per kg, per L, or each) so different pack sizes are comparable, and set "unit".
- If a price might be slightly stale, say so briefly in "notes". Never invent a price or a URL.
- Return between 1 and ~15 offers, the best/cheapest options first.

Return ONLY the structured JSON.`;
}

// Extract the JSON object from the model's final text content.
function parseResult(message) {
  if (message.parsed_output) return message.parsed_output;
  const text = (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) return { offers: [] };
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Could not parse price JSON from model output.');
  }
}

// Run a live multi-store price lookup. Returns { offers: [...] }.
export async function searchPrices(query) {
  const client = makeClient();
  const baseParams = {
    model: MODEL,
    max_tokens: 8000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }],
    output_config: { format: { type: 'json_schema', schema: OFFER_SCHEMA } },
  };

  let messages = [{ role: 'user', content: buildPrompt(query) }];
  let message;
  // Server-side web search can pause after its iteration cap; resume until done.
  for (let i = 0; i < 6; i++) {
    message = await client.messages.create({ ...baseParams, messages });
    if (message.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: message.content }];
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('The price lookup was declined. Try rephrasing the product.');
  }

  const result = parseResult(message);
  const offers = Array.isArray(result.offers) ? result.offers : [];
  // Sort cheapest first; in-stock ahead of out-of-stock.
  offers.sort((a, b) => {
    if (!!a.in_stock !== !!b.in_stock) return a.in_stock ? -1 : 1;
    return (a.price_aed ?? Infinity) - (b.price_aed ?? Infinity);
  });
  return { offers };
}
