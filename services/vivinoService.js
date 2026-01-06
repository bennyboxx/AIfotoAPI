/**
 * Vivino API Service
 * 
 * Note: Vivino doesn't have an official public API, so we use their internal API
 * which may change without notice. This is a best-effort implementation.
 */

const VIVINO_SEARCH_URL = 'https://www.vivino.com/api/wines/search';
const VIVINO_BASE_URL = 'https://www.vivino.com';

/**
 * Search for wine on Vivino
 * @param {string} query - Search query (wine name, winery, etc.)
 * @param {number} vintage - Optional vintage year
 * @returns {Promise<Object|null>} Wine data or null if not found
 */
async function searchWine(query, vintage = null) {
  try {
    // Build search query
    const searchQuery = vintage ? `${query} ${vintage}` : query;
    
    console.log(`[Vivino] Searching for: ${searchQuery}`);
    
    // Vivino's internal API endpoint
    const url = `https://www.vivino.com/api/wines/search?q=${encodeURIComponent(searchQuery)}&language=en`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 5000 // 5 second timeout
    });

    if (!response.ok) {
      console.error(`[Vivino] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    // Check if we have results
    if (!data.explore_vintage?.records || data.explore_vintage.records.length === 0) {
      console.log('[Vivino] No results found');
      return null;
    }

    // Get the first (best) match
    const topResult = data.explore_vintage.records[0];
    const wine = topResult.vintage?.wine;
    const vintageData = topResult.vintage;

    if (!wine) {
      console.log('[Vivino] Invalid result structure');
      return null;
    }

    // Extract wine data
    const wineData = {
      vivino_url: `${VIVINO_BASE_URL}/wines/${wine.id}`,
      vivino_rating: wine.statistics?.ratings_average || 0,
      vivino_reviews_count: wine.statistics?.ratings_count || 0,
      winery: wine.winery?.name || 'Unknown',
      vintage: vintageData?.year || vintage || null,
      grape_variety: wine.style?.varietal_name || wine.style?.description || 'Unknown',
      region: formatRegion(wine.region),
      country: wine.region?.country?.name || 'Unknown',
      food_pairing: extractFoodPairing(wine),
      wine_type: wine.type_id ? getWineType(wine.type_id) : 'Unknown',
      image_url: wine.image?.location || null,
      price_estimate: vintageData?.price?.amount || null,
      price_currency: vintageData?.price?.currency?.code || 'EUR'
    };

    console.log(`[Vivino] Found wine: ${wineData.winery} - ${wine.name} (${wineData.vintage})`);
    console.log(`[Vivino] Rating: ${wineData.vivino_rating}/5 (${wineData.vivino_reviews_count} reviews)`);

    return wineData;

  } catch (error) {
    console.error('[Vivino] Search error:', error.message);
    return null;
  }
}

/**
 * Format region information
 * @param {Object} region - Vivino region object
 * @returns {string} Formatted region string
 */
function formatRegion(region) {
  if (!region) return 'Unknown';
  
  const parts = [];
  if (region.name) parts.push(region.name);
  if (region.area?.name) parts.push(region.area.name);
  if (region.country?.name) parts.push(region.country.name);
  
  return parts.join(', ') || 'Unknown';
}

/**
 * Extract food pairing suggestions
 * @param {Object} wine - Wine object
 * @returns {Array<string>} Food pairing suggestions
 */
function extractFoodPairing(wine) {
  const defaultPairings = ['Red meat', 'Cheese', 'Pasta'];
  
  // Vivino doesn't always provide food pairing in search results
  // We can make educated guesses based on wine type
  if (wine.type_id === 1) { // Red wine
    return ['Red meat', 'Game', 'Mature cheese', 'Pasta with red sauce'];
  } else if (wine.type_id === 2) { // White wine
    return ['Fish', 'Seafood', 'Poultry', 'Soft cheese'];
  } else if (wine.type_id === 3) { // Sparkling
    return ['Appetizers', 'Seafood', 'Celebration dishes'];
  } else if (wine.type_id === 4) { // Rosé
    return ['Salads', 'Light pasta', 'Grilled vegetables', 'Mediterranean dishes'];
  } else if (wine.type_id === 24) { // Dessert wine
    return ['Desserts', 'Foie gras', 'Blue cheese'];
  }
  
  return defaultPairings;
}

/**
 * Get wine type name from type ID
 * @param {number} typeId - Wine type ID
 * @returns {string} Wine type name
 */
function getWineType(typeId) {
  const types = {
    1: 'Red wine',
    2: 'White wine',
    3: 'Sparkling wine',
    4: 'Rosé wine',
    7: 'Dessert wine',
    24: 'Fortified wine'
  };
  
  return types[typeId] || 'Wine';
}

/**
 * Enrich wine item with Vivino data
 * @param {Object} item - Item from OpenAI with wine_details
 * @returns {Promise<Object>} Enriched item with collector_data
 */
async function enrichWineItem(item) {
  try {
    // Check if we have wine details from OpenAI (now in collector_details)
    if (!item.collector_details || !item.collector_details.wine_name) {
      console.log('[Vivino] No wine details provided, skipping enrichment');
      return {
        ...item,
        collector_category: 'wine',
        collector_data: null,
        collector_warning: 'Insufficient wine details for enrichment'
      };
    }

    const { wine_name, winery, vintage } = item.collector_details;
    
    // Search Vivino
    const searchQuery = wine_name || `${winery}`;
    const vivinoData = await searchWine(searchQuery, vintage);

    if (!vivinoData) {
      console.log('[Vivino] No Vivino data found for wine');
      return {
        ...item,
        collector_category: 'wine',
        collector_data: null,
        collector_warning: 'Wine not found on Vivino'
      };
    }

    // Merge OpenAI data with Vivino data
    return {
      ...item,
      collector_category: 'wine',
      collector_data: vivinoData
    };

  } catch (error) {
    console.error('[Vivino] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'wine',
      collector_data: null,
      collector_warning: `Vivino API error: ${error.message}`
    };
  }
}

module.exports = {
  searchWine,
  enrichWineItem
};

