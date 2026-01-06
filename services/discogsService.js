/**
 * Discogs API Service
 * 
 * Official Discogs API documentation: https://www.discogs.com/developers
 * Uses OAuth 1.0a authentication with Consumer Key and Consumer Secret
 * 
 * OAuth endpoints:
 * - Request Token: https://api.discogs.com/oauth/request_token
 * - Authorize: https://www.discogs.com/oauth/authorize
 * - Access Token: https://api.discogs.com/oauth/access_token
 * 
 * For simple database queries, Consumer Key and Secret are sufficient
 */

const DISCOGS_API_BASE = 'https://api.discogs.com';
const USER_AGENT = 'TrackMyHomeAPI/1.0 +https://trackmyhome.app';

/**
 * Search for vinyl/record on Discogs
 * @param {string} artist - Artist name
 * @param {string} album - Album title
 * @param {number} releaseYear - Optional release year
 * @returns {Promise<Object|null>} Vinyl data or null if not found
 */
async function searchVinyl(artist, album, releaseYear = null) {
  try {
    // Using Consumer Key and Consumer Secret (OAuth credentials)
    const consumerKey = process.env.DISCOGS_API_KEY;
    const consumerSecret = process.env.DISCOGS_API_SECRET;
    
    // Check if API credentials are configured
    if (!consumerKey || !consumerSecret) {
      console.warn('[Discogs] Consumer Key/Secret not configured. Set DISCOGS_API_KEY and DISCOGS_API_SECRET in .env');
      return null;
    }

    // Build search query
    let searchQuery = `artist:"${artist}" release_title:"${album}"`;
    if (releaseYear) {
      searchQuery += ` year:${releaseYear}`;
    }
    
    console.log(`[Discogs] Searching for: ${artist} - ${album}`);
    
    // Build URL with Consumer Key and Secret for authentication
    const url = `${DISCOGS_API_BASE}/database/search?q=${encodeURIComponent(searchQuery)}&type=release&format=vinyl&key=${consumerKey}&secret=${consumerSecret}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      timeout: 5000 // 5 second timeout
    });

    if (!response.ok) {
      console.error(`[Discogs] API error: ${response.status} ${response.statusText}`);
      
      // Handle rate limiting
      if (response.status === 429) {
        console.error('[Discogs] Rate limit exceeded');
      }
      
      return null;
    }

    const data = await response.json();
    
    // Check if we have results
    if (!data.results || data.results.length === 0) {
      console.log('[Discogs] No results found');
      return null;
    }

    // Get the first (best) match
    const topResult = data.results[0];

    // Get detailed information about the release
    const detailedData = await getDetailedRelease(topResult.id, consumerKey, consumerSecret);
    
    if (!detailedData) {
      // Fallback to basic search result data
      return formatSearchResult(topResult);
    }

    return detailedData;

  } catch (error) {
    console.error('[Discogs] Search error:', error.message);
    return null;
  }
}

/**
 * Get detailed release information
 * @param {number} releaseId - Discogs release ID
 * @param {string} consumerKey - Consumer Key
 * @param {string} consumerSecret - Consumer Secret
 * @returns {Promise<Object|null>} Detailed vinyl data
 */
async function getDetailedRelease(releaseId, consumerKey, consumerSecret) {
  try {
    const url = `${DISCOGS_API_BASE}/releases/${releaseId}?key=${consumerKey}&secret=${consumerSecret}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Discogs] Release details error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Extract pricing information if available
    const pricing = await getReleasePricing(releaseId, consumerKey, consumerSecret);

    const vinylData = {
      discogs_url: data.uri ? `https://www.discogs.com${data.uri}` : null,
      discogs_id: data.id,
      artist: formatArtists(data.artists),
      album: data.title,
      release_year: data.year || null,
      label: formatLabels(data.labels),
      catalog_number: formatCatalogNumbers(data.labels),
      genres: data.genres || [],
      styles: data.styles || [],
      format: formatFormats(data.formats),
      country: data.country || 'Unknown',
      tracklist: data.tracklist?.length || 0,
      discogs_rating: data.community?.rating?.average || null,
      discogs_votes: data.community?.rating?.count || 0,
      discogs_have: data.community?.have || 0,
      discogs_want: data.community?.want || 0,
      image_url: data.images?.[0]?.uri || null,
      ...pricing
    };

    console.log(`[Discogs] Found vinyl: ${vinylData.artist} - ${vinylData.album} (${vinylData.release_year})`);
    
    return vinylData;

  } catch (error) {
    console.error('[Discogs] Release details error:', error.message);
    return null;
  }
}

/**
 * Get pricing information for a release
 * @param {number} releaseId - Discogs release ID
 * @param {string} consumerKey - Consumer Key
 * @param {string} consumerSecret - Consumer Secret
 * @returns {Promise<Object>} Pricing data
 */
async function getReleasePricing(releaseId, consumerKey, consumerSecret) {
  try {
    // Marketplace statistics endpoint
    const url = `${DISCOGS_API_BASE}/marketplace/stats/${releaseId}?curr=EUR&key=${consumerKey}&secret=${consumerSecret}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      timeout: 5000
    });

    if (!response.ok) {
      return {
        discogs_avg_price: null,
        discogs_min_price: null,
        discogs_max_price: null,
        discogs_currency: 'EUR'
      };
    }

    const data = await response.json();
    
    return {
      discogs_avg_price: data.lowest_price?.value || null,
      discogs_min_price: data.lowest_price?.value || null,
      discogs_max_price: null, // Not available in basic stats
      discogs_currency: data.lowest_price?.currency || 'EUR',
      discogs_num_for_sale: data.num_for_sale || 0
    };

  } catch (error) {
    console.log('[Discogs] Pricing not available:', error.message);
    return {
      discogs_avg_price: null,
      discogs_min_price: null,
      discogs_max_price: null,
      discogs_currency: 'EUR'
    };
  }
}

/**
 * Format search result data (fallback)
 * @param {Object} result - Search result from Discogs
 * @returns {Object} Formatted vinyl data
 */
function formatSearchResult(result) {
  return {
    discogs_url: result.uri ? `https://www.discogs.com${result.uri}` : null,
    discogs_id: result.id,
    artist: result.title?.split(' - ')?.[0] || 'Unknown',
    album: result.title?.split(' - ')?.[1] || result.title || 'Unknown',
    release_year: result.year || null,
    label: result.label?.[0] || 'Unknown',
    catalog_number: result.catno || null,
    genres: result.genre || [],
    styles: result.style || [],
    format: result.format?.[0] || 'Vinyl',
    country: result.country || 'Unknown',
    image_url: result.thumb || result.cover_image || null,
    discogs_avg_price: null,
    discogs_currency: 'EUR'
  };
}

/**
 * Format artists array
 * @param {Array} artists - Artists array from Discogs
 * @returns {string} Formatted artist string
 */
function formatArtists(artists) {
  if (!artists || artists.length === 0) return 'Unknown';
  return artists.map(a => a.name).join(', ');
}

/**
 * Format labels array
 * @param {Array} labels - Labels array from Discogs
 * @returns {string} Formatted label string
 */
function formatLabels(labels) {
  if (!labels || labels.length === 0) return 'Unknown';
  return labels.map(l => l.name).join(', ');
}

/**
 * Format catalog numbers
 * @param {Array} labels - Labels array from Discogs
 * @returns {string} Formatted catalog number string
 */
function formatCatalogNumbers(labels) {
  if (!labels || labels.length === 0) return null;
  const catNos = labels.map(l => l.catno).filter(c => c);
  return catNos.length > 0 ? catNos.join(', ') : null;
}

/**
 * Format formats array
 * @param {Array} formats - Formats array from Discogs
 * @returns {string} Formatted format string
 */
function formatFormats(formats) {
  if (!formats || formats.length === 0) return 'Vinyl';
  
  const format = formats[0];
  const parts = [format.name];
  
  if (format.qty && format.qty > 1) {
    parts.push(`${format.qty}x`);
  }
  
  if (format.descriptions) {
    parts.push(...format.descriptions);
  }
  
  return parts.join(', ');
}

/**
 * Enrich vinyl item with Discogs data
 * @param {Object} item - Item from OpenAI with vinyl_details
 * @returns {Promise<Object>} Enriched item with collector_data
 */
async function enrichVinylItem(item) {
  try {
    // Check if we have vinyl details from OpenAI
    if (!item.vinyl_details) {
      console.log('[Discogs] No vinyl details provided, skipping enrichment');
      return {
        ...item,
        collector_category: 'vinyl',
        collector_data: null,
        collector_warning: 'Insufficient vinyl details for enrichment'
      };
    }

    const { artist, album, release_year } = item.vinyl_details;
    
    // Search Discogs
    const discogsData = await searchVinyl(artist, album, release_year);

    if (!discogsData) {
      console.log('[Discogs] No Discogs data found for vinyl');
      return {
        ...item,
        collector_category: 'vinyl',
        collector_data: null,
        collector_warning: 'Vinyl not found on Discogs'
      };
    }

    // Merge OpenAI data with Discogs data
    return {
      ...item,
      collector_category: 'vinyl',
      collector_data: discogsData
    };

  } catch (error) {
    console.error('[Discogs] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'vinyl',
      collector_data: null,
      collector_warning: `Discogs API error: ${error.message}`
    };
  }
}

module.exports = {
  searchVinyl,
  enrichVinylItem,
  getDetailedRelease
};


