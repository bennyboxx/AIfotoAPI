/**
 * Pokémon TCG Enrichment Service
 *
 * Uses the free pokemontcg.io v2 API:
 * - Base: https://api.pokemontcg.io/v2/cards
 * - Query syntax docs: https://docs.pokemontcg.io/api-reference/cards/search-cards
 *
 * No API key is required for basic usage, but an optional POKEMONTCG_API_KEY
 * can be set via env to get higher rate limits (send via `X-Api-Key` header).
 *
 * Market prices are returned for TCGPlayer (USD) and CardMarket (EUR).
 */

const POKEMON_API_BASE = 'https://api.pokemontcg.io/v2';
const USER_AGENT = 'TrackMyHomeAPI/1.0 +https://trackmyhome.app';

/**
 * Build request headers, optionally including the API key.
 */
function buildHeaders() {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json'
  };
  const apiKey = process.env.POKEMONTCG_API_KEY;
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

/**
 * Escape a value for safe inclusion in a pokemontcg.io query string.
 * Wraps in quotes if the value contains whitespace or special chars.
 */
function escapeQueryValue(value) {
  const str = String(value).replace(/"/g, '\\"');
  if (/[\s:]/.test(str)) {
    return `"${str}"`;
  }
  return str;
}

/**
 * Pick the "best" card from a list of results.
 * Prefers cards with TCGPlayer market pricing, then highest rarity, then first.
 */
function pickBestCard(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;

  const withPricing = cards.filter(c =>
    c.tcgplayer?.prices || c.cardmarket?.prices?.averageSellPrice
  );

  if (withPricing.length > 0) return withPricing[0];
  return cards[0];
}

/**
 * Extract the best available TCGPlayer market price (in USD) from a card.
 * Prefers "holofoil" / "normal" / whichever variant has "market".
 */
function extractTcgPlayerMarket(tcgplayer) {
  if (!tcgplayer || !tcgplayer.prices) return { market: null, low: null, mid: null, high: null };

  const variants = ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil', 'unlimitedHolofoil'];
  for (const variant of variants) {
    const price = tcgplayer.prices[variant];
    if (price && typeof price.market === 'number') {
      return {
        market: price.market,
        low: price.low ?? null,
        mid: price.mid ?? null,
        high: price.high ?? null
      };
    }
  }

  const firstVariant = Object.values(tcgplayer.prices)[0];
  if (firstVariant && typeof firstVariant.market === 'number') {
    return {
      market: firstVariant.market,
      low: firstVariant.low ?? null,
      mid: firstVariant.mid ?? null,
      high: firstVariant.high ?? null
    };
  }

  return { market: null, low: null, mid: null, high: null };
}

/**
 * Format a pokemontcg.io card into our standard collector_data shape.
 */
function formatCard(card) {
  const tcgMarket = extractTcgPlayerMarket(card.tcgplayer);
  const cmPrices = card.cardmarket?.prices || {};

  return {
    card_name: card.name || null,
    set_name: card.set?.name || null,
    set_series: card.set?.series || null,
    set_id: card.set?.id || null,
    number: card.number || null,
    printed_total: card.set?.printedTotal || null,
    rarity: card.rarity || null,
    types: Array.isArray(card.types) ? card.types : [],
    supertype: card.supertype || null,
    subtypes: Array.isArray(card.subtypes) ? card.subtypes : [],
    hp: card.hp || null,
    image_small: card.images?.small || null,
    image_large: card.images?.large || null,
    artist: card.artist || null,
    release_date: card.set?.releaseDate || null,
    pokemontcg_id: card.id || null,
    tcgplayer_market_usd: tcgMarket.market,
    tcgplayer_low_usd: tcgMarket.low,
    tcgplayer_mid_usd: tcgMarket.mid,
    tcgplayer_high_usd: tcgMarket.high,
    tcgplayer_url: card.tcgplayer?.url || null,
    tcgplayer_updated_at: card.tcgplayer?.updatedAt || null,
    cardmarket_avg_eur: typeof cmPrices.averageSellPrice === 'number' ? cmPrices.averageSellPrice : null,
    cardmarket_trend_eur: typeof cmPrices.trendPrice === 'number' ? cmPrices.trendPrice : null,
    cardmarket_low_eur: typeof cmPrices.lowPrice === 'number' ? cmPrices.lowPrice : null,
    cardmarket_url: card.cardmarket?.url || null,
    cardmarket_updated_at: card.cardmarket?.updatedAt || null
  };
}

/**
 * Search for a Pokémon card on pokemontcg.io.
 * @param {string|null} cardName
 * @param {string|null} setName
 * @param {string|null} cardNumber - The number on the card (e.g. "4" or "4/102")
 * @returns {Promise<Object|null>}
 */
async function searchPokemonCard(cardName, setName = null, cardNumber = null) {
  try {
    const queryParts = [];

    if (cardName) queryParts.push(`name:${escapeQueryValue(cardName)}`);
    if (setName) queryParts.push(`set.name:${escapeQueryValue(setName)}`);
    if (cardNumber) {
      // "4/102" → number:4
      const num = String(cardNumber).split('/')[0].trim();
      if (num) queryParts.push(`number:${escapeQueryValue(num)}`);
    }

    if (queryParts.length === 0) {
      console.log('[Pokemon] No search criteria provided');
      return null;
    }

    const q = queryParts.join(' ');
    const url = `${POKEMON_API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=10`;

    console.log(`[Pokemon] Search: q="${q}"`);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Pokemon] API error: ${response.status} ${response.statusText}`);
      if (response.status === 429) {
        console.error('[Pokemon] Rate limit exceeded');
      }
      return null;
    }

    const data = await response.json();
    console.log(`[Pokemon] Found ${data.data?.length || 0} matching cards`);

    if (!data.data || data.data.length === 0) return null;

    const best = pickBestCard(data.data);
    return formatCard(best);
  } catch (error) {
    console.error('[Pokemon] Search error:', error.message);
    return null;
  }
}

/**
 * Apply Pokémon collector_data to top-level item fields.
 * - name => "{cardName} ({setName} #{number})"
 * - tags merged with types (lowercased)
 * - estimated_value overridden with TCGPlayer market price in EUR approximation
 *   (EUR average if available, else USD value as-is)
 */
function applyPokemonDataToItem(item, cardData) {
  if (!cardData) return item;

  const cardName = cardData.card_name;
  const setName = cardData.set_name;
  const number = cardData.number;

  let name = item.name;
  if (cardName && setName && number) {
    name = `${cardName} (${setName} #${number})`;
  } else if (cardName) {
    name = cardName;
  }

  const collectorDetails = {
    ...(item.collector_details || {}),
    card_name: cardName || null,
    set_name: setName || null,
    card_number: number || null,
    hp: cardData.hp || item.collector_details?.hp || null
  };

  const baseTags = Array.isArray(item.tags) ? item.tags : [];
  const extraTags = [
    ...(Array.isArray(cardData.types) ? cardData.types : []),
    ...(cardData.rarity ? [cardData.rarity] : [])
  ].map(t => String(t).toLowerCase());
  const tags = Array.from(new Set([...baseTags, ...extraTags]));

  let estimatedValue = item.estimated_value;
  if (typeof cardData.cardmarket_avg_eur === 'number' && cardData.cardmarket_avg_eur > 0) {
    estimatedValue = Math.round(cardData.cardmarket_avg_eur * 100) / 100;
  } else if (typeof cardData.tcgplayer_market_usd === 'number' && cardData.tcgplayer_market_usd > 0) {
    estimatedValue = Math.round(cardData.tcgplayer_market_usd * 100) / 100;
  }

  return {
    ...item,
    name,
    collector_details: collectorDetails,
    tags,
    estimated_value: estimatedValue
  };
}

/**
 * Build fallback questions when a Pokémon card can't be identified.
 */
function buildPokemonFallbackQuestions(item) {
  const existing = item.followup_questions || [];
  const existingFields = new Set(existing.map(q => q.field));

  const fallback = [];

  if (!existingFields.has('card_number')) {
    fallback.push({
      field: 'card_number',
      question: 'What is the card number shown in the bottom-right corner? (e.g. 4/102)',
      priority: 'high'
    });
  }

  if (!existingFields.has('set_name')) {
    fallback.push({
      field: 'set_name',
      question: 'What is the set name or symbol on the card? (e.g. Base Set, Evolving Skies)',
      priority: 'high'
    });
  }

  return [...existing, ...fallback];
}

/**
 * Enrich a Pokémon card item with pokemontcg.io data.
 * @param {Object} item - Item from OpenAI
 * @returns {Promise<Object>}
 */
async function enrichPokemonItem(item) {
  try {
    const details = item.collector_details || {};
    const cardName = details.card_name || null;
    const setName = details.set_name || null;
    const cardNumber = details.card_number || null;

    if (!cardName && !cardNumber) {
      console.log('[Pokemon] No card name or number, skipping enrichment');
      return {
        ...item,
        collector_category: 'pokemon',
        collector_data: null,
        collector_warning: 'Insufficient Pokémon card details for enrichment',
        followup_questions: buildPokemonFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    console.log(`[Pokemon] Enriching: name="${cardName}", set="${setName}", number="${cardNumber}"`);

    let cardData = await searchPokemonCard(cardName, setName, cardNumber);

    // Retry without set name if no result (set names are noisy)
    if (!cardData && setName && cardName) {
      console.log('[Pokemon] Retry without set name');
      cardData = await searchPokemonCard(cardName, null, cardNumber);
    }

    // Retry with just card name
    if (!cardData && cardName) {
      console.log('[Pokemon] Retry with just card name');
      cardData = await searchPokemonCard(cardName, null, null);
    }

    if (!cardData) {
      console.log('[Pokemon] No data found');
      return {
        ...item,
        collector_category: 'pokemon',
        collector_data: null,
        collector_warning: 'Pokémon card not found on pokemontcg.io',
        followup_questions: buildPokemonFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    console.log(`[Pokemon] Enriched: ${cardData.card_name} (${cardData.set_name} #${cardData.number})`);
    const enrichedItem = applyPokemonDataToItem(item, cardData);

    return {
      ...enrichedItem,
      collector_category: 'pokemon',
      collector_data: cardData,
      _base64Image: undefined
    };
  } catch (error) {
    console.error('[Pokemon] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'pokemon',
      collector_data: null,
      collector_warning: `Pokémon TCG API error: ${error.message}`,
      _base64Image: undefined
    };
  }
}

/**
 * Re-enrich a Pokémon card using extra info (card number, set name).
 */
async function enrichPokemonWithExtraInfo(collectorDetails, extraInfo) {
  try {
    const cardName = collectorDetails?.card_name || null;
    const setName = extraInfo.set_name || collectorDetails?.set_name || null;
    const cardNumber = extraInfo.card_number || collectorDetails?.card_number || null;

    if (!cardName && !cardNumber) {
      return {
        collector_category: 'pokemon',
        collector_data: null,
        collector_warning: 'No Pokémon card identifying information available'
      };
    }

    const cardData = await searchPokemonCard(cardName, setName, cardNumber);

    return {
      collector_category: 'pokemon',
      collector_data: cardData,
      collector_warning: cardData ? undefined : 'Pokémon card not found even with extra info'
    };
  } catch (error) {
    console.error('[Pokemon] Extra info enrichment error:', error.message);
    return {
      collector_category: 'pokemon',
      collector_data: null,
      collector_warning: `Pokémon TCG API error: ${error.message}`
    };
  }
}

module.exports = {
  searchPokemonCard,
  enrichPokemonItem,
  enrichPokemonWithExtraInfo,
  applyPokemonDataToItem
};
