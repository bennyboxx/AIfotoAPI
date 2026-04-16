/**
 * Google Cloud Vision API Service
 * 
 * Uses WEB_DETECTION to identify album covers and other collectible items
 * by performing a reverse image search via the Vision API.
 * 
 * Requires GOOGLE_CLOUD_API_KEY in .env
 * Enable "Cloud Vision API" in Google Cloud Console for the same project as Firebase.
 */

const VISION_API_BASE = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * Perform web detection on a base64 image using Google Cloud Vision API.
 * Returns best-guess labels, web entities, and pages with matching images.
 * @param {string} base64Image - Base64 encoded image (no data: prefix)
 * @returns {Promise<Object|null>} Web detection results or null on failure
 */
async function detectWebEntities(base64Image) {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;

  if (!apiKey) {
    console.warn('[Vision] GOOGLE_CLOUD_API_KEY not configured — skipping web detection fallback');
    return null;
  }

  try {
    const url = `${VISION_API_BASE}?key=${apiKey}`;

    const body = {
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: 'WEB_DETECTION', maxResults: 10 }]
        }
      ]
    };

    console.log('[Vision] Sending image to Google Cloud Vision WEB_DETECTION...');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[Vision] API error: ${response.status} ${response.statusText}`, errorBody);
      return null;
    }

    const data = await response.json();
    const webDetection = data.responses?.[0]?.webDetection;

    if (!webDetection) {
      console.log('[Vision] No web detection results');
      return null;
    }

    console.log('[Vision] Best guess labels:', webDetection.bestGuessLabels?.map(l => l.label).join(', ') || 'none');
    console.log('[Vision] Web entities:', webDetection.webEntities?.slice(0, 5).map(e => `${e.description} (${e.score?.toFixed(2)})`).join(', ') || 'none');

    return webDetection;

  } catch (error) {
    console.error('[Vision] Web detection error:', error.message);
    return null;
  }
}

/**
 * Try to extract artist and album from Vision web detection results.
 * Parses bestGuessLabels, webEntities and matching page URLs.
 * @param {Object} webDetection - Raw webDetection response from Vision API
 * @returns {Object|null} { artist, album, release_year, source } or null
 */
function extractVinylInfoFromWebDetection(webDetection) {
  if (!webDetection) return null;

  const bestGuess = webDetection.bestGuessLabels?.[0]?.label || '';
  const entities = (webDetection.webEntities || [])
    .filter(e => e.description && e.score > 0.3)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`[Vision] Parsing vinyl info from best guess: "${bestGuess}"`);

  // Strategy 1: Parse the bestGuessLabel (often contains "Artist - Album" or "Album by Artist")
  let artist = null;
  let album = null;
  let releaseYear = null;

  // Remove common noise words from best guess
  const cleaned = bestGuess
    .replace(/vinyl|record|lp|album|cover|sleeve|music|disc/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try "Artist - Album" pattern
  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    album = dashMatch[2].trim();
  }

  // Try "Album by Artist" pattern
  if (!artist) {
    const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byMatch) {
      album = byMatch[1].trim();
      artist = byMatch[2].trim();
    }
  }

  // Strategy 2: Use web entities — the highest-scored descriptive entities
  // often represent the artist and/or album
  if (!artist && entities.length >= 2) {
    const topEntities = entities.slice(0, 5).map(e => e.description);
    console.log(`[Vision] Top entities: ${topEntities.join(', ')}`);

    // Heuristic: often the first entity is the artist, second is the album (or vice versa)
    artist = topEntities[0] || null;
    album = topEntities[1] || null;
  } else if (!artist && entities.length === 1) {
    // Single entity — could be either artist or album
    artist = entities[0].description;
  }

  // Try to find a year in the best guess or entities
  const yearMatch = bestGuess.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    releaseYear = parseInt(yearMatch[1], 10);
  }

  if (!artist && !album) {
    console.log('[Vision] Could not extract vinyl info from web detection');
    return null;
  }

  // Check for Discogs URLs in matching pages — strong signal
  const discogsUrl = (webDetection.pagesWithMatchingImages || [])
    .find(p => p.url && p.url.includes('discogs.com'));

  const result = {
    artist: artist || null,
    album: album || null,
    release_year: releaseYear,
    source: 'google_vision_web_detection',
    discogs_page_url: discogsUrl?.url || null,
    confidence: entities[0]?.score || 0.5
  };

  console.log(`[Vision] Extracted vinyl info: ${result.artist} - ${result.album} (${result.release_year || 'unknown year'})`);

  return result;
}

/**
 * Full pipeline: run web detection and extract vinyl info.
 * @param {string} base64Image - Base64 encoded image
 * @returns {Promise<Object|null>} { artist, album, release_year, source } or null
 */
async function identifyVinylFromImage(base64Image) {
  const webDetection = await detectWebEntities(base64Image);
  return extractVinylInfoFromWebDetection(webDetection);
}

module.exports = {
  detectWebEntities,
  extractVinylInfoFromWebDetection,
  identifyVinylFromImage
};
