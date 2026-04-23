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
 * Build a valid Discogs URL from a uri returned by the API.
 * The Discogs API sometimes returns a full URL and sometimes a relative path.
 */
function buildDiscogsUrl(uri) {
  if (!uri) return null;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  return `https://www.discogs.com${uri.startsWith('/') ? '' : '/'}${uri}`;
}

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

    // Build search query - try strict format first
    let searchQuery = `artist:"${artist}" release_title:"${album}"`;
    if (releaseYear) {
      searchQuery += ` year:${releaseYear}`;
    }
    
    console.log(`[Discogs] Searching for: ${artist} - ${album}`);
    console.log(`[Discogs] Search query (strict): "${searchQuery}"`);
    
    // Build URL with Consumer Key and Secret for authentication
    const url = `${DISCOGS_API_BASE}/database/search?q=${encodeURIComponent(searchQuery)}&type=release&format=vinyl&key=${consumerKey}&secret=${consumerSecret}`;
    console.log(`[Discogs] Full URL: ${url.replace(consumerKey, 'KEY').replace(consumerSecret, 'SECRET')}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      timeout: 5000 // 5 second timeout
    });

    console.log(`[Discogs] Response status: ${response.status}`);

    if (!response.ok) {
      console.error(`[Discogs] API error: ${response.status} ${response.statusText}`);
      
      // Handle rate limiting
      if (response.status === 429) {
        console.error('[Discogs] Rate limit exceeded');
      }
      
      // Try to log error body
      try {
        const errorBody = await response.text();
        console.error(`[Discogs] Error body: ${errorBody}`);
      } catch (e) {
        // Ignore
      }
      
      return null;
    }

    const data = await response.json();
    
    console.log(`[Discogs] Found ${data.results?.length || 0} results (strict search)`);
    
    // If no results with strict search, try a simpler search
    if (!data.results || data.results.length === 0) {
      console.log('[Discogs] No results with strict search, trying simple search...');
      
      // Simple search: just artist and album name
      const simpleQuery = `${artist} ${album}`;
      const simpleUrl = `${DISCOGS_API_BASE}/database/search?q=${encodeURIComponent(simpleQuery)}&type=release&format=vinyl&key=${consumerKey}&secret=${consumerSecret}`;
      
      console.log(`[Discogs] Simple query: "${simpleQuery}"`);
      
      const simpleResponse = await fetch(simpleUrl, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        timeout: 5000
      });
      
      if (simpleResponse.ok) {
        const simpleData = await simpleResponse.json();
        console.log(`[Discogs] Found ${simpleData.results?.length || 0} results (simple search)`);
        
        if (simpleData.results && simpleData.results.length > 0) {
          // Use simple search results
          const topResult = simpleData.results[0];
          console.log(`[Discogs] Top result: ${topResult.title} (ID: ${topResult.id})`);
          
          const detailedData = await getDetailedRelease(topResult.id, consumerKey, consumerSecret);
          
          if (!detailedData) {
            return formatSearchResult(topResult);
          }
          
          return detailedData;
        }
      }
      
      console.log('[Discogs] No results found even with simple search');
      return null;
    }

    // Get the first (best) match
    const topResult = data.results[0];
    console.log(`[Discogs] Top result: ${topResult.title} (ID: ${topResult.id})`);

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
      discogs_url: buildDiscogsUrl(data.uri),
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
    discogs_url: buildDiscogsUrl(result.uri),
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
 * Search for vinyl by catalog number (much more precise than artist+album)
 * @param {string} catalogNumber - Catalog number from the record label
 * @param {string} artist - Optional artist to narrow results
 * @returns {Promise<Object|null>} Vinyl data or null
 */
async function searchVinylByCatalogNumber(catalogNumber, artist = null) {
  try {
    const consumerKey = process.env.DISCOGS_API_KEY;
    const consumerSecret = process.env.DISCOGS_API_SECRET;

    if (!consumerKey || !consumerSecret) {
      console.warn('[Discogs] Consumer Key/Secret not configured');
      return null;
    }

    console.log(`[Discogs] Searching by catalog number: ${catalogNumber}`);

    let url = `${DISCOGS_API_BASE}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release&key=${consumerKey}&secret=${consumerSecret}`;
    if (artist) {
      url += `&artist=${encodeURIComponent(artist)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Discogs] Catalog search error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[Discogs] Catalog search found ${data.results?.length || 0} results`);

    if (!data.results || data.results.length === 0) return null;

    const topResult = data.results[0];
    console.log(`[Discogs] Catalog match: ${topResult.title} (ID: ${topResult.id})`);

    const detailedData = await getDetailedRelease(topResult.id, consumerKey, consumerSecret);
    return detailedData || formatSearchResult(topResult);

  } catch (error) {
    console.error('[Discogs] Catalog search error:', error.message);
    return null;
  }
}

/**
 * Search for vinyl by barcode
 * @param {string} barcode - Barcode from the record sleeve
 * @returns {Promise<Object|null>} Vinyl data or null
 */
async function searchVinylByBarcode(barcode) {
  try {
    const consumerKey = process.env.DISCOGS_API_KEY;
    const consumerSecret = process.env.DISCOGS_API_SECRET;

    if (!consumerKey || !consumerSecret) {
      console.warn('[Discogs] Consumer Key/Secret not configured');
      return null;
    }

    console.log(`[Discogs] Searching by barcode: ${barcode}`);

    const url = `${DISCOGS_API_BASE}/database/search?barcode=${encodeURIComponent(barcode)}&type=release&key=${consumerKey}&secret=${consumerSecret}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Discogs] Barcode search error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[Discogs] Barcode search found ${data.results?.length || 0} results`);

    if (!data.results || data.results.length === 0) return null;

    const topResult = data.results[0];
    console.log(`[Discogs] Barcode match: ${topResult.title} (ID: ${topResult.id})`);

    const detailedData = await getDetailedRelease(topResult.id, consumerKey, consumerSecret);
    return detailedData || formatSearchResult(topResult);

  } catch (error) {
    console.error('[Discogs] Barcode search error:', error.message);
    return null;
  }
}

/**
 * Enrich vinyl using extra info from user follow-up (catalog number, barcode, etc.)
 * @param {Object} collectorDetails - Original collector_details from AI
 * @param {Object} extraInfo - User-provided extra info (catalog_number, barcode, etc.)
 * @returns {Promise<Object>} Enriched collector data
 */
async function enrichVinylWithExtraInfo(collectorDetails, extraInfo) {
  try {
    let discogsData = null;

    if (extraInfo.catalog_number) {
      discogsData = await searchVinylByCatalogNumber(
        extraInfo.catalog_number,
        collectorDetails?.artist || null
      );
    }

    if (!discogsData && extraInfo.barcode) {
      discogsData = await searchVinylByBarcode(extraInfo.barcode);
    }

    if (!discogsData && collectorDetails?.artist) {
      discogsData = await searchVinyl(
        collectorDetails.artist,
        collectorDetails.album,
        collectorDetails.release_year
      );
    }

    return {
      collector_category: 'vinyl',
      collector_data: discogsData,
      collector_warning: discogsData ? undefined : 'Vinyl not found on Discogs even with extra info'
    };

  } catch (error) {
    console.error('[Discogs] Extra info enrichment error:', error.message);
    return {
      collector_category: 'vinyl',
      collector_data: null,
      collector_warning: `Discogs API error: ${error.message}`
    };
  }
}

/**
 * Enrich vinyl item with Discogs data.
 *
 * Strategy: Vision-first.
 * Google Cloud Vision WEB_DETECTION does a reverse image search on the
 * actual internet and is more reliable than GPT-4o for album identification
 * (GPT-4o often hallucinates with high confidence). We use GPT-4o's
 * artist/album guess only as a last-resort fallback when Vision fails.
 *
 * @param {Object} item - Item from OpenAI (with collector_details and _base64Image)
 * @returns {Promise<Object>} Enriched item with collector_data
 */
async function enrichVinylItem(item) {
  try {
    // DEFENSIVE: ignore GPT-4o's vinyl guesses — they're unreliable and cause hallucinations.
    // Vision handles all vinyl identification. GPT-4o only classifies + describes condition.
    if (item.collector_details) {
      if (item.collector_details.artist || item.collector_details.album || item.collector_details.release_year) {
        console.log(`[Discogs] Ignoring GPT-4o vinyl guess (${item.collector_details.artist} - ${item.collector_details.album}) — Vision handles identification`);
      }
      item.collector_details.artist = null;
      item.collector_details.album = null;
      item.collector_details.release_year = null;
    }
    // Strip any followup questions GPT-4o added for vinyl — we only use ours
    item.followup_questions = [];

    let artist = null;
    let album = null;
    let releaseYear = null;
    let source = null;
    let discogsReleaseIdFromVision = null;

    // --- PRIMARY: Google Vision WEB_DETECTION (reverse image search) ---
    if (item._base64Image) {
      console.log('[Discogs] Vinyl detected — running Google Vision WEB_DETECTION as primary identifier...');
      const { identifyVinylFromImage } = require('./googleVisionService');
      const visionResult = await identifyVinylFromImage(item._base64Image);

      if (visionResult && (visionResult.artist || visionResult.album)) {
        artist = visionResult.artist;
        album = visionResult.album;
        releaseYear = visionResult.release_year;
        discogsReleaseIdFromVision = visionResult.discogs_release_id || null;
        source = 'vision';
        console.log(`[Discogs] Vision identified: ${artist} - ${album}${discogsReleaseIdFromVision ? ` [direct release ID: ${discogsReleaseIdFromVision}]` : ''}`);
      } else {
        console.log('[Discogs] Vision could not identify the vinyl');
      }
    } else {
      console.log('[Discogs] No image available for Vision — skipping primary identification');
    }

    // --- FAST PATH: direct Discogs release lookup via Vision's matching pages ---
    if (discogsReleaseIdFromVision) {
      const consumerKey = process.env.DISCOGS_API_KEY;
      const consumerSecret = process.env.DISCOGS_API_SECRET;
      if (consumerKey && consumerSecret) {
        console.log(`[Discogs] Using direct release lookup for ID ${discogsReleaseIdFromVision}`);
        const directData = await getDetailedRelease(discogsReleaseIdFromVision, consumerKey, consumerSecret);
        if (directData) {
          return {
            ...item,
            collector_category: 'vinyl',
            collector_data: directData,
            identification_source: 'vision_direct_release',
            _base64Image: undefined
          };
        }
      }
    }

    // --- VISION FAILED: ask the user for catalog number / barcode ---
    if (!artist && !album) {
      console.log('[Discogs] Vision could not identify the vinyl — asking user for catalog number / barcode');

      const fallbackQuestions = buildVinylFallbackQuestions(item);

      return {
        ...item,
        collector_category: 'vinyl',
        collector_data: null,
        collector_warning: 'Could not identify vinyl from image. Please provide catalog number or barcode.',
        followup_questions: fallbackQuestions,
        identification_source: 'none',
        _base64Image: undefined
      };
    }

    // --- Discogs search with identified artist/album ---
    console.log(`[Discogs] Enriching vinyl: Artist="${artist}", Album="${album}", Year=${releaseYear} (source: ${source})`);
    
    const discogsData = await searchVinyl(artist, album, releaseYear);

    if (!discogsData) {
      console.log('[Discogs] No Discogs data found for vinyl');
      return {
        ...item,
        collector_category: 'vinyl',
        collector_data: null,
        collector_warning: 'Vinyl not found on Discogs',
        identification_source: source,
        followup_questions: buildVinylFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    return {
      ...item,
      collector_category: 'vinyl',
      collector_data: discogsData,
      identification_source: source,
      _base64Image: undefined
    };

  } catch (error) {
    console.error('[Discogs] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'vinyl',
      collector_data: null,
      collector_warning: `Discogs API error: ${error.message}`,
      _base64Image: undefined
    };
  }
}

/**
 * Build fallback followup questions when vinyl could not be identified.
 * Merges with any existing followup_questions on the item.
 * @param {Object} item - The item being processed
 * @returns {Array} Array of followup question objects
 */
function buildVinylFallbackQuestions(item) {
  const existing = item.followup_questions || [];
  const existingFields = new Set(existing.map(q => q.field));

  const fallback = [];

  if (!existingFields.has('catalog_number')) {
    fallback.push({
      field: 'catalog_number',
      question: 'What is the catalog number on the record label or spine? (e.g. CBS 85224)',
      priority: 'high'
    });
  }

  if (!existingFields.has('barcode')) {
    fallback.push({
      field: 'barcode',
      question: 'Is there a barcode on the sleeve? Please enter the number below it.',
      priority: 'high'
    });
  }

  return [...existing, ...fallback];
}

module.exports = {
  searchVinyl,
  searchVinylByCatalogNumber,
  searchVinylByBarcode,
  enrichVinylItem,
  enrichVinylWithExtraInfo,
  getDetailedRelease
};


