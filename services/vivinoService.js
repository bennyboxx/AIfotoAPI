/**
 * Wine Enrichment Service
 *
 * Enriches wine items with a lightweight text-only GPT-4o call.
 * Only invoked when a wine tag/item_type is detected (~5% of requests),
 * keeping the main vision prompt small and cheap for non-wine items.
 */

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VIVINO_SEARCH_BASE = 'https://www.vivino.com/search/wines';

/**
 * Build a Vivino search URL from wine name and optional vintage
 * @param {string|null} wineName
 * @param {number|null} vintage
 * @returns {string|null}
 */
function buildVivinoSearchUrl(wineName, vintage) {
  if (!wineName) return null;
  const query = vintage ? `${wineName} ${vintage}` : wineName;
  return `${VIVINO_SEARCH_BASE}?q=${encodeURIComponent(query)}`;
}

/**
 * Call GPT-4o (text-only, no image) to get rich wine details.
 * @param {string} wineName
 * @param {string|null} winery
 * @param {number|null} vintage
 * @returns {Promise<Object|null>} Wine enrichment data
 */
async function fetchWineDetails(wineName, winery, vintage) {
  const wineQuery = [wineName, winery, vintage].filter(Boolean).join(', ');

  console.log(`[Wine] Fetching details via text-only GPT-4o for: ${wineQuery}`);

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: `You are a wine expert. Given the following wine, return detailed information as JSON.\n\nWine: ${wineQuery}\n\nReturn ONLY a JSON object (no prose) with these fields:\n- grape_variety (string): primary grape varieties, e.g. "Cabernet Sauvignon, Merlot"\n- region (string): wine region, e.g. "Margaux, Bordeaux"\n- country (string): country of origin\n- wine_type (string): one of "Red wine", "White wine", "Rosé wine", "Sparkling wine", "Dessert wine", "Fortified wine"\n- food_pairing (array of strings): 3-5 food pairing suggestions\n- estimated_rating (number): estimated Vivino-style rating 0.0-5.0 based on your knowledge, or null if unknown`
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'wine_details',
          schema: {
            type: 'object',
            properties: {
              grape_variety: { type: ['string', 'null'] },
              region: { type: ['string', 'null'] },
              country: { type: ['string', 'null'] },
              wine_type: { type: ['string', 'null'] },
              food_pairing: { type: 'array', items: { type: 'string' } },
              estimated_rating: { type: ['number', 'null'] }
            },
            required: ['grape_variety', 'region', 'country', 'wine_type', 'food_pairing', 'estimated_rating'],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_output_tokens: 500
    });

    const content = (response.output_text || '').trim();
    const parsed = JSON.parse(content);

    const usage = response.usage || {};
    const totalTokens = usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0));
    console.log(`[Wine] GPT-4o-mini enrichment used ${totalTokens} tokens`);

    return parsed;
  } catch (error) {
    console.error('[Wine] Text enrichment failed:', error.message);
    return null;
  }
}

/**
 * Enrich a wine item with a separate text-only GPT-4o call.
 * @param {Object} item - Item from OpenAI response (with collector_details)
 * @returns {Promise<Object>} Enriched item with collector_data
 */
async function enrichWineItem(item) {
  if (!item.collector_details || !item.collector_details.wine_name) {
    console.log('[Wine] No wine details provided, skipping enrichment');
    return {
      ...item,
      collector_category: 'wine',
      collector_data: null,
      collector_warning: 'Insufficient wine details for enrichment'
    };
  }

  const { wine_name, winery, vintage } = item.collector_details;
  const details = await fetchWineDetails(wine_name, winery, vintage);

  const collectorData = {
    winery: winery || null,
    vintage: vintage || null,
    wine_name: wine_name || null,
    grape_variety: details?.grape_variety || null,
    region: details?.region || null,
    country: details?.country || null,
    wine_type: details?.wine_type || null,
    food_pairing: Array.isArray(details?.food_pairing) ? details.food_pairing : [],
    estimated_rating: details?.estimated_rating || null,
    vivino_search_url: buildVivinoSearchUrl(wine_name, vintage)
  };

  console.log(`[Wine] Enriched: ${collectorData.winery} - ${collectorData.wine_name} (${collectorData.vintage})`);

  return {
    ...item,
    collector_category: 'wine',
    collector_data: collectorData
  };
}

/**
 * Re-enrich wine with extra info supplied by the user (barcode, vintage, etc.)
 * @param {Object} collectorDetails - Original collector_details from AI
 * @param {Object} extraInfo - User-provided extra info
 * @returns {Promise<Object>} { collector_category, collector_data, collector_warning? }
 */
async function enrichWineWithExtraInfo(collectorDetails, extraInfo) {
  const wineName = collectorDetails?.wine_name || collectorDetails?.winery || null;
  const winery = collectorDetails?.winery || null;
  const vintage = extraInfo.vintage_year || collectorDetails?.vintage || null;

  if (!wineName) {
    return {
      collector_category: 'wine',
      collector_data: null,
      collector_warning: 'No wine name available for enrichment'
    };
  }

  const details = await fetchWineDetails(wineName, winery, vintage);

  const collectorData = {
    winery: winery,
    vintage: vintage,
    wine_name: wineName,
    grape_variety: details?.grape_variety || null,
    region: details?.region || null,
    country: details?.country || null,
    wine_type: details?.wine_type || null,
    food_pairing: Array.isArray(details?.food_pairing) ? details.food_pairing : [],
    estimated_rating: details?.estimated_rating || null,
    vivino_search_url: buildVivinoSearchUrl(wineName, vintage)
  };

  console.log(`[Wine] Re-enriched with extra info: ${collectorData.wine_name} (${collectorData.vintage})`);

  return {
    collector_category: 'wine',
    collector_data: collectorData
  };
}

module.exports = {
  enrichWineItem,
  enrichWineWithExtraInfo
};
