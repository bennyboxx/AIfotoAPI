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

// Generic music-related terms that are NOT artist/album names
const GENERIC_MUSIC_TERMS = new Set([
  'album', 'album cover', 'albumcover', 'cover', 'sleeve',
  'vinyl', 'record', 'lp', 'lp record', 'phonograph record',
  'music', 'song', 'single', 'ep', 'extended play',
  'compact disc', 'cd', 'disc', 'dvd',
  'pop music', 'rock music', 'rock', 'pop', 'hip hop music',
  'musician', 'band', 'artist', 'song writer'
]);

/**
 * Check if a term is a generic music-related term (not an actual artist/album).
 */
function isGenericTerm(term) {
  if (!term) return true;
  return GENERIC_MUSIC_TERMS.has(term.toLowerCase().trim());
}

/**
 * Try to extract Discogs release ID from a URL.
 * Example: https://www.discogs.com/de/release/32298072-Linkin-Park-From-Zero → 32298072
 * @param {string} url
 * @returns {number|null}
 */
function extractDiscogsReleaseId(url) {
  if (!url) return null;
  const match = url.match(/\/release\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Try to extract artist and album from Vision web detection results.
 * Parses bestGuessLabels, webEntities and matching page URLs.
 * @param {Object} webDetection - Raw webDetection response from Vision API
 * @returns {Object|null} { artist, album, release_year, source, discogs_release_id } or null
 */
function extractVinylInfoFromWebDetection(webDetection) {
  if (!webDetection) return null;

  const bestGuess = webDetection.bestGuessLabels?.[0]?.label || '';

  // Dedupe entities by description (Vision can return duplicates), keep highest score
  const entityMap = new Map();
  (webDetection.webEntities || []).forEach(e => {
    if (!e.description || e.score <= 0.3 || isGenericTerm(e.description)) return;
    const key = e.description.toLowerCase();
    if (!entityMap.has(key) || (entityMap.get(key).score || 0) < (e.score || 0)) {
      entityMap.set(key, e);
    }
  });
  const entities = Array.from(entityMap.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`[Vision] Parsing vinyl info from best guess: "${bestGuess}"`);
  console.log(`[Vision] Filtered entities: ${entities.slice(0, 5).map(e => e.description).join(', ')}`);

  // Strongest signal: a direct Discogs release URL in matching pages
  const discogsPage = (webDetection.pagesWithMatchingImages || [])
    .find(p => p.url && /\/release\/\d+/.test(p.url));
  const discogsReleaseId = discogsPage ? extractDiscogsReleaseId(discogsPage.url) : null;

  if (discogsReleaseId) {
    console.log(`[Vision] Found direct Discogs release ID: ${discogsReleaseId}`);
  }

  let artist = null;
  let album = null;
  let releaseYear = null;

  // Strategy 1: Parse bestGuessLabel — remove trailing "album cover/sleeve/etc."
  const cleanedGuess = bestGuess
    .replace(/\b(album cover|album|cover|sleeve|vinyl|lp|record|music|disc|cd)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try "Artist - Album" pattern
  const dashMatch = cleanedGuess.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    album = dashMatch[2].trim();
  }

  // Try "Album by Artist" pattern
  if (!artist) {
    const byMatch = cleanedGuess.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byMatch) {
      album = byMatch[1].trim();
      artist = byMatch[2].trim();
    }
  }

  // Strategy 2: Match entities against the cleaned best guess
  // If best guess is "linkin park from zero" and entities contain "Linkin Park" and "From Zero",
  // we can match them as artist and album respectively.
  if (!artist && cleanedGuess && entities.length >= 1) {
    const guessLower = cleanedGuess.toLowerCase();
    const matchedEntities = entities.filter(e =>
      guessLower.includes(e.description.toLowerCase())
    );

    if (matchedEntities.length >= 2) {
      // Sort matched entities by position in the best guess (first occurrence = artist usually)
      matchedEntities.sort((a, b) =>
        guessLower.indexOf(a.description.toLowerCase()) - guessLower.indexOf(b.description.toLowerCase())
      );
      artist = matchedEntities[0].description;
      album = matchedEntities[1].description;
    } else if (matchedEntities.length === 1) {
      // Single match — could be artist; try to extract album from what's left of best guess
      artist = matchedEntities[0].description;
      const leftover = cleanedGuess
        .replace(new RegExp(artist, 'i'), '')
        .trim();
      if (leftover) album = leftover;
    }
  }

  // Strategy 3: Fallback to top 2 entities (only if strategies 1 and 2 failed)
  if (!artist && entities.length >= 2) {
    artist = entities[0].description;
    album = entities[1].description;
  } else if (!artist && entities.length === 1) {
    artist = entities[0].description;
  }

  // Try to find a year
  const yearMatch = bestGuess.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    releaseYear = parseInt(yearMatch[1], 10);
  }

  if (!artist && !album && !discogsReleaseId) {
    console.log('[Vision] Could not extract vinyl info from web detection');
    return null;
  }

  const result = {
    artist: artist || null,
    album: album || null,
    release_year: releaseYear,
    source: 'google_vision_web_detection',
    discogs_page_url: discogsPage?.url || null,
    discogs_release_id: discogsReleaseId,
    confidence: entities[0]?.score || 0.5
  };

  console.log(`[Vision] Extracted vinyl info: ${result.artist} - ${result.album} (${result.release_year || 'unknown year'})${discogsReleaseId ? ` [Discogs ID: ${discogsReleaseId}]` : ''}`);

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

// Generic art-related terms that are NOT actual artwork titles or artist names
const GENERIC_ART_TERMS = new Set([
  'art', 'artwork', 'fine art', 'visual art', 'modern art', 'contemporary art',
  'painting', 'oil painting', 'acrylic painting', 'watercolor', 'watercolour',
  'print', 'art print', 'poster', 'canvas', 'illustration', 'drawing', 'sketch',
  'picture', 'image', 'photo', 'photograph', 'photography',
  'frame', 'picture frame', 'wall art', 'wall decor',
  'museum', 'gallery', 'exhibition',
  'landscape', 'portrait', 'still life'
]);

function isGenericArtTerm(term) {
  if (!term) return true;
  return GENERIC_ART_TERMS.has(term.toLowerCase().trim());
}

/**
 * Try to extract artwork title and artist from Vision web detection.
 * @param {Object} webDetection
 * @returns {Object|null} { title, artist, confidence, source, wikipedia_url } or null
 */
function extractArtworkInfoFromWebDetection(webDetection) {
  if (!webDetection) return null;

  const bestGuess = webDetection.bestGuessLabels?.[0]?.label || '';

  // Dedupe entities, drop generic art terms
  const entityMap = new Map();
  (webDetection.webEntities || []).forEach(e => {
    if (!e.description || e.score <= 0.3 || isGenericArtTerm(e.description)) return;
    const key = e.description.toLowerCase();
    if (!entityMap.has(key) || (entityMap.get(key).score || 0) < (e.score || 0)) {
      entityMap.set(key, e);
    }
  });
  const entities = Array.from(entityMap.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`[Vision] Parsing artwork info from best guess: "${bestGuess}"`);
  console.log(`[Vision] Filtered art entities: ${entities.slice(0, 5).map(e => e.description).join(', ')}`);

  // Strong signal: Wikipedia page about the artwork in matching pages
  const wikipediaPage = (webDetection.pagesWithMatchingImages || [])
    .find(p => p.url && /wikipedia\.org\/wiki\//.test(p.url));
  const wikipediaUrl = wikipediaPage?.url || null;

  let title = null;
  let artist = null;

  // Strategy 1: "Title by Artist" pattern in best guess
  const cleanedGuess = bestGuess
    .replace(/\b(painting|oil painting|art print|artwork|print|poster|canvas)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const byMatch = cleanedGuess.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    title = byMatch[1].trim();
    artist = byMatch[2].trim();
  }

  // Strategy 2: "Artist - Title" pattern
  if (!title) {
    const dashMatch = cleanedGuess.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dashMatch) {
      artist = dashMatch[1].trim();
      title = dashMatch[2].trim();
    }
  }

  // Strategy 3: Top 2 entities — heuristic: artist is often a known person name (2 words),
  // title is more distinctive. We try to detect "person-like" entity ordering.
  if (!title && entities.length >= 2) {
    // Usually the first entity is the most specific match (the artwork), second is the artist
    title = entities[0].description;
    artist = entities[1].description;
  } else if (!title && entities.length === 1) {
    title = entities[0].description;
  }

  if (!title && !artist && !wikipediaUrl) {
    console.log('[Vision] Could not extract artwork info from web detection');
    return null;
  }

  const result = {
    title: title || null,
    artist: artist || null,
    source: 'google_vision_web_detection',
    wikipedia_url: wikipediaUrl,
    confidence: entities[0]?.score || 0.5
  };

  console.log(`[Vision] Extracted artwork info: "${result.title}" by "${result.artist}"${wikipediaUrl ? ' [Wikipedia match]' : ''}`);

  return result;
}

/**
 * Full pipeline: run web detection and extract artwork info.
 * @param {string} base64Image - Base64 encoded image
 * @returns {Promise<Object|null>}
 */
async function identifyArtworkFromImage(base64Image) {
  const webDetection = await detectWebEntities(base64Image);
  return extractArtworkInfoFromWebDetection(webDetection);
}

module.exports = {
  detectWebEntities,
  extractVinylInfoFromWebDetection,
  identifyVinylFromImage,
  extractArtworkInfoFromWebDetection,
  identifyArtworkFromImage
};
