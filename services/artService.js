/**
 * Artwork Enrichment Service
 *
 * Vision-first strategy (same pattern as vinyl in discogsService.js):
 * 1. Google Vision WEB_DETECTION does a reverse image search to identify the artwork.
 * 2. Met Museum, Art Institute of Chicago, and Wikipedia are queried in order
 *    using the identified title/artist.
 *
 * APIs used (all free, no API keys required):
 * - Metropolitan Museum of Art:   https://metmuseum.github.io/
 * - Art Institute of Chicago:     https://api.artic.edu/docs/
 * - Wikipedia REST summary:       https://en.wikipedia.org/api/rest_v1/
 */

const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
const AIC_API_BASE = 'https://api.artic.edu/api/v1';
const WIKIPEDIA_REST = 'https://en.wikipedia.org/api/rest_v1';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'TrackMyHomeAPI/1.0 +https://trackmyhome.app';

/**
 * Search the Metropolitan Museum of Art collection.
 * @param {string} title
 * @param {string|null} artist
 * @returns {Promise<Object|null>}
 */
async function searchMetMuseum(title, artist = null) {
  try {
    if (!title && !artist) return null;

    const q = [title, artist].filter(Boolean).join(' ');
    const searchUrl = `${MET_API_BASE}/search?hasImages=true&q=${encodeURIComponent(q)}`;

    console.log(`[Art/Met] Searching: "${q}"`);

    const searchResp = await fetch(searchUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!searchResp.ok) {
      console.error(`[Art/Met] Search error: ${searchResp.status}`);
      return null;
    }

    const searchData = await searchResp.json();
    if (!searchData.objectIDs || searchData.objectIDs.length === 0) {
      console.log('[Art/Met] No results');
      return null;
    }

    // Try the first few IDs until we find one that actually matches (Met search is very loose)
    const candidates = searchData.objectIDs.slice(0, 5);
    for (const objectId of candidates) {
      const objResp = await fetch(`${MET_API_BASE}/objects/${objectId}`, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        timeout: 5000
      });

      if (!objResp.ok) continue;

      const obj = await objResp.json();

      if (artist && obj.artistDisplayName) {
        const nameLower = obj.artistDisplayName.toLowerCase();
        if (!nameLower.includes(artist.toLowerCase())) continue;
      }

      console.log(`[Art/Met] Found: "${obj.title}" by ${obj.artistDisplayName} (ID: ${obj.objectID})`);

      return {
        title: obj.title || title,
        artist: obj.artistDisplayName || artist,
        artist_nationality: obj.artistNationality || null,
        artist_lifespan: [obj.artistBeginDate, obj.artistEndDate].filter(Boolean).join('–') || null,
        date_created: obj.objectDate || null,
        medium: obj.medium || null,
        dimensions: obj.dimensions || null,
        classification: obj.classification || null,
        museum: 'The Metropolitan Museum of Art',
        museum_url: obj.objectURL || null,
        image_url: obj.primaryImage || obj.primaryImageSmall || null,
        description: obj.creditLine || null,
        country: obj.country || obj.culture || null,
        source: 'met_museum',
        wikipedia_url: null
      };
    }

    console.log('[Art/Met] No candidates matched the artist');
    return null;
  } catch (error) {
    console.error('[Art/Met] Search error:', error.message);
    return null;
  }
}

/**
 * Search the Art Institute of Chicago collection.
 * @param {string} title
 * @param {string|null} artist
 * @returns {Promise<Object|null>}
 */
async function searchArtInstituteChicago(title, artist = null) {
  try {
    if (!title && !artist) return null;

    const q = [title, artist].filter(Boolean).join(' ');
    const fields = [
      'id', 'title', 'artist_display', 'artist_title', 'artist_id',
      'date_display', 'medium_display', 'dimensions',
      'image_id', 'department_title', 'classification_title',
      'place_of_origin', 'credit_line', 'main_reference_number'
    ].join(',');
    const url = `${AIC_API_BASE}/artworks/search?q=${encodeURIComponent(q)}&limit=5&fields=${encodeURIComponent(fields)}`;

    console.log(`[Art/AIC] Searching: "${q}"`);

    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!resp.ok) {
      console.error(`[Art/AIC] Search error: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data.data || data.data.length === 0) {
      console.log('[Art/AIC] No results');
      return null;
    }

    let artwork = data.data[0];
    if (artist) {
      const matched = data.data.find(a =>
        a.artist_display && a.artist_display.toLowerCase().includes(artist.toLowerCase())
      );
      if (matched) artwork = matched;
    }

    const iiifBase = data.config?.iiif_url || 'https://www.artic.edu/iiif/2';
    const imageUrl = artwork.image_id
      ? `${iiifBase}/${artwork.image_id}/full/843,/0/default.jpg`
      : null;

    console.log(`[Art/AIC] Found: "${artwork.title}" by ${artwork.artist_title || artwork.artist_display} (ID: ${artwork.id})`);

    return {
      title: artwork.title || title,
      artist: artwork.artist_title || artwork.artist_display || artist,
      artist_nationality: null,
      artist_lifespan: null,
      date_created: artwork.date_display || null,
      medium: artwork.medium_display || null,
      dimensions: artwork.dimensions || null,
      classification: artwork.classification_title || null,
      museum: 'Art Institute of Chicago',
      museum_url: `https://www.artic.edu/artworks/${artwork.id}`,
      image_url: imageUrl,
      description: artwork.credit_line || null,
      country: artwork.place_of_origin || null,
      source: 'art_institute_chicago',
      wikipedia_url: null
    };
  } catch (error) {
    console.error('[Art/AIC] Search error:', error.message);
    return null;
  }
}

/**
 * Search Wikipedia for an artwork article as last-resort fallback.
 * @param {string} title
 * @param {string|null} artist
 * @returns {Promise<Object|null>}
 */
async function searchWikipedia(title, artist = null) {
  try {
    if (!title) return null;

    const q = [title, artist].filter(Boolean).join(' ');
    const searchUrl = `${WIKIPEDIA_API}?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1&origin=*`;

    console.log(`[Art/Wiki] Searching: "${q}"`);

    const searchResp = await fetch(searchUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!searchResp.ok) {
      console.error(`[Art/Wiki] Search error: ${searchResp.status}`);
      return null;
    }

    const searchData = await searchResp.json();
    const topHit = searchData.query?.search?.[0];
    if (!topHit) {
      console.log('[Art/Wiki] No results');
      return null;
    }

    const pageTitle = topHit.title;
    const summaryUrl = `${WIKIPEDIA_REST}/page/summary/${encodeURIComponent(pageTitle)}`;
    const summaryResp = await fetch(summaryUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!summaryResp.ok) {
      console.error(`[Art/Wiki] Summary error: ${summaryResp.status}`);
      return null;
    }

    const summary = await summaryResp.json();

    console.log(`[Art/Wiki] Found Wikipedia article: "${summary.title}"`);

    return {
      title: summary.title || title,
      artist: artist,
      artist_nationality: null,
      artist_lifespan: null,
      date_created: null,
      medium: null,
      dimensions: null,
      classification: null,
      museum: null,
      museum_url: null,
      image_url: summary.thumbnail?.source || summary.originalimage?.source || null,
      description: summary.extract || null,
      country: null,
      source: 'wikipedia',
      wikipedia_url: summary.content_urls?.desktop?.page || null
    };
  } catch (error) {
    console.error('[Art/Wiki] Search error:', error.message);
    return null;
  }
}

/**
 * Apply artwork collector_data to top-level item fields.
 * - name => "{Title} — {Artist}"
 * - tags merged with classification/country (lowercased)
 * - estimated_value kept from AI (museum pieces aren't priced; prints vary)
 */
function applyArtworkDataToItem(item, artData) {
  if (!artData) return item;

  const title = artData.title || null;
  const artist = artData.artist || null;

  let name = item.name;
  if (title && artist) {
    name = `${title} — ${artist}`;
  } else if (title) {
    name = title;
  }

  const collectorDetails = {
    ...(item.collector_details || {}),
    artwork_title: title,
    artwork_artist: artist,
    year_created: artData.date_created || null
  };

  const baseTags = Array.isArray(item.tags) ? item.tags : [];
  const extraTags = [
    artData.classification,
    artData.country,
    artData.medium
  ].filter(Boolean).map(t => String(t).toLowerCase());
  const tags = Array.from(new Set([...baseTags, ...extraTags]));

  return {
    ...item,
    name,
    collector_details: collectorDetails,
    tags
  };
}

/**
 * Build fallback questions when an artwork cannot be identified.
 */
function buildArtworkFallbackQuestions(item) {
  const existing = item.followup_questions || [];
  const existingFields = new Set(existing.map(q => q.field));

  const fallback = [];

  if (!existingFields.has('artist_name')) {
    fallback.push({
      field: 'artist_name',
      question: 'Who is the artist? Check the signature on the artwork or any label/certificate.',
      priority: 'high'
    });
  }

  if (!existingFields.has('artwork_title')) {
    fallback.push({
      field: 'artwork_title',
      question: 'What is the title of the artwork? (Often found on a plaque or the back of the frame)',
      priority: 'high'
    });
  }

  return [...existing, ...fallback];
}

/**
 * Enrich an artwork item.
 *
 * Strategy: Vision-first (reverse image search), then search Met / AIC / Wikipedia
 * using the identified title+artist.
 *
 * @param {Object} item - Item from OpenAI (with collector_details and _base64Image)
 * @returns {Promise<Object>}
 */
async function enrichArtworkItem(item) {
  try {
    // DEFENSIVE: ignore GPT-4o guesses — Vision handles art identification
    if (item.collector_details) {
      if (item.collector_details.artwork_title || item.collector_details.artwork_artist) {
        console.log(`[Art] Ignoring GPT-4o artwork guess (${item.collector_details.artwork_artist} - ${item.collector_details.artwork_title}) — Vision handles identification`);
      }
      item.collector_details.artwork_title = null;
      item.collector_details.artwork_artist = null;
      item.collector_details.year_created = null;
    }
    item.followup_questions = [];

    let title = null;
    let artist = null;
    let wikipediaUrl = null;
    let source = null;

    // --- PRIMARY: Google Vision WEB_DETECTION ---
    if (item._base64Image) {
      console.log('[Art] Running Google Vision WEB_DETECTION as primary identifier...');
      const { identifyArtworkFromImage } = require('./googleVisionService');
      const visionResult = await identifyArtworkFromImage(item._base64Image);

      if (visionResult && (visionResult.title || visionResult.artist)) {
        title = visionResult.title;
        artist = visionResult.artist;
        wikipediaUrl = visionResult.wikipedia_url;
        source = 'vision';
        console.log(`[Art] Vision identified: "${title}" by "${artist}"`);
      } else {
        console.log('[Art] Vision could not identify the artwork');
      }
    } else {
      console.log('[Art] No image available for Vision — skipping primary identification');
    }

    // --- Vision failed: ask user for artist/title ---
    if (!title && !artist) {
      console.log('[Art] Vision could not identify the artwork — asking user');
      return {
        ...item,
        collector_category: 'art',
        collector_data: null,
        collector_warning: 'Could not identify artwork from image. Please provide artist and title.',
        followup_questions: buildArtworkFallbackQuestions(item),
        identification_source: 'none',
        _base64Image: undefined
      };
    }

    // --- Query museum APIs in order ---
    console.log(`[Art] Enriching with: title="${title}", artist="${artist}" (source: ${source})`);

    let artData = await searchMetMuseum(title, artist);
    if (!artData) {
      artData = await searchArtInstituteChicago(title, artist);
    }
    if (!artData) {
      artData = await searchWikipedia(title, artist);
    }

    // Fallback: if nothing found but we have Wikipedia URL from Vision, attach minimal data
    if (!artData && wikipediaUrl) {
      artData = {
        title: title || null,
        artist: artist || null,
        artist_nationality: null,
        artist_lifespan: null,
        date_created: null,
        medium: null,
        dimensions: null,
        classification: null,
        museum: null,
        museum_url: null,
        image_url: null,
        description: null,
        country: null,
        source: 'google_vision_web_detection',
        wikipedia_url: wikipediaUrl
      };
    }

    if (!artData) {
      console.log('[Art] No data found in any source');
      return {
        ...item,
        collector_category: 'art',
        collector_data: null,
        collector_warning: 'Artwork not found in Met / AIC / Wikipedia',
        identification_source: source,
        followup_questions: buildArtworkFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    const enrichedItem = applyArtworkDataToItem(item, artData);
    return {
      ...enrichedItem,
      collector_category: 'art',
      collector_data: artData,
      identification_source: source,
      _base64Image: undefined
    };
  } catch (error) {
    console.error('[Art] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'art',
      collector_data: null,
      collector_warning: `Artwork enrichment error: ${error.message}`,
      _base64Image: undefined
    };
  }
}

/**
 * Re-enrich artwork using extra info (artist name, artwork title).
 */
async function enrichArtworkWithExtraInfo(collectorDetails, extraInfo) {
  try {
    const title = extraInfo.artwork_title || collectorDetails?.artwork_title || null;
    const artist = extraInfo.artist_name || collectorDetails?.artwork_artist || null;

    if (!title && !artist) {
      return {
        collector_category: 'art',
        collector_data: null,
        collector_warning: 'No artwork identifying information available'
      };
    }

    let artData = await searchMetMuseum(title, artist);
    if (!artData) {
      artData = await searchArtInstituteChicago(title, artist);
    }
    if (!artData) {
      artData = await searchWikipedia(title, artist);
    }

    return {
      collector_category: 'art',
      collector_data: artData,
      collector_warning: artData ? undefined : 'Artwork not found even with extra info'
    };
  } catch (error) {
    console.error('[Art] Extra info enrichment error:', error.message);
    return {
      collector_category: 'art',
      collector_data: null,
      collector_warning: `Artwork API error: ${error.message}`
    };
  }
}

module.exports = {
  searchMetMuseum,
  searchArtInstituteChicago,
  searchWikipedia,
  enrichArtworkItem,
  enrichArtworkWithExtraInfo,
  applyArtworkDataToItem
};
