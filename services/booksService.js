/**
 * Books Enrichment Service
 *
 * Enriches book items with data from:
 * - Google Books API (primary): https://developers.google.com/books/docs/v1/using
 *   `https://www.googleapis.com/books/v1/volumes?q=...` (no API key required)
 * - Open Library Search API (secondary/fallback): https://openlibrary.org/developers/api
 *   `https://openlibrary.org/search.json?q=...` (no API key required)
 */

const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_BASE = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_COVERS = 'https://covers.openlibrary.org/b';
const USER_AGENT = 'TrackMyHomeAPI/1.0 +https://trackmyhome.app';

/**
 * Build a Google Books web URL for a volume ID.
 */
function buildGoogleBooksUrl(volumeId) {
  if (!volumeId) return null;
  return `https://books.google.com/books?id=${encodeURIComponent(volumeId)}`;
}

/**
 * Build an Open Library work URL from a key (e.g. "/works/OL12345W").
 */
function buildOpenLibraryUrl(workKey) {
  if (!workKey) return null;
  return `https://openlibrary.org${workKey.startsWith('/') ? '' : '/'}${workKey}`;
}

/**
 * Extract ISBN-10 and ISBN-13 from a Google Books industryIdentifiers array.
 */
function extractIsbns(industryIdentifiers) {
  if (!Array.isArray(industryIdentifiers)) return { isbn_10: null, isbn_13: null };
  const isbn10 = industryIdentifiers.find(i => i.type === 'ISBN_10')?.identifier || null;
  const isbn13 = industryIdentifiers.find(i => i.type === 'ISBN_13')?.identifier || null;
  return { isbn_10: isbn10, isbn_13: isbn13 };
}

/**
 * Format a Google Books volume result into our standard collector_data shape.
 */
function formatGoogleBooksVolume(volume) {
  const info = volume.volumeInfo || {};
  const saleInfo = volume.saleInfo || {};
  const accessInfo = volume.accessInfo || {};
  const { isbn_10, isbn_13 } = extractIsbns(info.industryIdentifiers);

  return {
    title: info.title || null,
    subtitle: info.subtitle || null,
    authors: Array.isArray(info.authors) ? info.authors : [],
    publisher: info.publisher || null,
    published_date: info.publishedDate || null,
    page_count: info.pageCount || null,
    categories: Array.isArray(info.categories) ? info.categories : [],
    description: info.description || null,
    cover_image_url: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null,
    isbn_10: isbn_10,
    isbn_13: isbn_13,
    language: info.language || null,
    average_rating: typeof info.averageRating === 'number' ? info.averageRating : null,
    ratings_count: typeof info.ratingsCount === 'number' ? info.ratingsCount : 0,
    google_books_id: volume.id || null,
    google_books_url: buildGoogleBooksUrl(volume.id),
    preview_url: info.previewLink || accessInfo.webReaderLink || null,
    list_price: saleInfo.listPrice?.amount || null,
    list_price_currency: saleInfo.listPrice?.currencyCode || null,
    open_library_url: null
  };
}

/**
 * Format an Open Library doc (from /search.json) into our standard collector_data shape.
 */
function formatOpenLibraryDoc(doc) {
  const isbns = Array.isArray(doc.isbn) ? doc.isbn : [];
  const isbn10 = isbns.find(i => i.replace(/[^0-9Xx]/g, '').length === 10) || null;
  const isbn13 = isbns.find(i => i.replace(/[^0-9Xx]/g, '').length === 13) || null;

  const coverId = doc.cover_i;
  const coverUrl = coverId ? `${OPEN_LIBRARY_COVERS}/id/${coverId}-L.jpg` : null;

  return {
    title: doc.title || null,
    subtitle: doc.subtitle || null,
    authors: Array.isArray(doc.author_name) ? doc.author_name : [],
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : null,
    published_date: doc.first_publish_year ? String(doc.first_publish_year) : null,
    page_count: doc.number_of_pages_median || null,
    categories: Array.isArray(doc.subject) ? doc.subject.slice(0, 10) : [],
    description: null,
    cover_image_url: coverUrl,
    isbn_10: isbn10,
    isbn_13: isbn13,
    language: Array.isArray(doc.language) ? doc.language[0] : null,
    average_rating: typeof doc.ratings_average === 'number' ? doc.ratings_average : null,
    ratings_count: typeof doc.ratings_count === 'number' ? doc.ratings_count : 0,
    google_books_id: null,
    google_books_url: null,
    preview_url: null,
    list_price: null,
    list_price_currency: null,
    open_library_url: buildOpenLibraryUrl(doc.key)
  };
}

/**
 * Normalize a title for comparison (lowercase, collapse whitespace, strip edition markers).
 */
function normalizeTitle(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a candidate result against the requested title/author.
 * Higher is better. Used to pick the best match when multiple volumes come back.
 *
 * Important: Google Books often returns box sets, omnibus editions, or series
 * compilations as the top result. We want to prefer the canonical single volume
 * whose title exactly matches what was requested.
 *
 * @param {string} candidateTitle - Title from the API result
 * @param {Array<string>} candidateAuthors - Authors from the API result
 * @param {string|number|null} ratingsCount - Number of ratings on the result
 * @param {string} searchTitle - The title we're searching for
 * @param {string|null} searchAuthor - The author we're searching for
 * @returns {number} Score
 */
function scoreBookMatch(candidateTitle, candidateAuthors, ratingsCount, searchTitle, searchAuthor) {
  let score = 0;
  const candidate = normalizeTitle(candidateTitle);
  const search = normalizeTitle(searchTitle);

  if (!candidate) return -1000;

  // Title matching
  if (candidate === search) {
    score += 100;
  } else if (candidate.startsWith(`${search}:`) || candidate.startsWith(`${search} -`)) {
    score += 60;
  } else if (candidate.startsWith(search)) {
    score += 30;
  } else if (candidate.includes(search)) {
    score += 10;
  }

  // Heavy penalty for box sets / collections / omnibus editions
  if (/\b(box set|collection|complete series|complete collection|omnibus|bundle|paperback set|hardcover set|\d+-book|\d+ book set)\b/i.test(candidate)) {
    score -= 200;
  }

  // Penalty for a trailing series-volume number ("A Court of Thorns and Roses 7")
  // This is the common case where Google Books returns a series entry
  const trailing = candidate.replace(search, '').trim();
  if (search && /^\d+$/.test(trailing)) {
    score -= 150;
  }

  // Penalty if title is much longer than search and doesn't have a subtitle separator
  if (search && candidate.length > search.length * 2 && !candidate.includes(':') && !candidate.includes(' - ')) {
    score -= 30;
  }

  // Small bonus for results with many ratings (usually the canonical edition)
  const rc = typeof ratingsCount === 'number' ? ratingsCount : 0;
  if (rc > 1000) score += 20;
  else if (rc > 100) score += 10;
  else if (rc > 10) score += 5;

  // Author matching bonus
  if (searchAuthor && Array.isArray(candidateAuthors)) {
    const searchA = normalizeTitle(searchAuthor);
    const anyMatch = candidateAuthors.some(a => normalizeTitle(a).includes(searchA) || searchA.includes(normalizeTitle(a)));
    if (anyMatch) score += 15;
  }

  return score;
}

/**
 * Pick the best Google Books volume from a list of results.
 */
function pickBestGoogleBooksVolume(volumes, searchTitle, searchAuthor) {
  if (!Array.isArray(volumes) || volumes.length === 0) return null;
  if (volumes.length === 1) return volumes[0];

  let best = volumes[0];
  let bestScore = -Infinity;
  for (const v of volumes) {
    const info = v.volumeInfo || {};
    const score = scoreBookMatch(
      info.title,
      info.authors,
      info.ratingsCount,
      searchTitle,
      searchAuthor
    );
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  console.log(`[Books] Picked best Google Books match with score ${bestScore}: "${best.volumeInfo?.title}"`);
  return best;
}

/**
 * Pick the best Open Library doc from a list of results.
 */
function pickBestOpenLibraryDoc(docs, searchTitle, searchAuthor) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  if (docs.length === 1) return docs[0];

  let best = docs[0];
  let bestScore = -Infinity;
  for (const d of docs) {
    const score = scoreBookMatch(
      d.title,
      d.author_name,
      d.ratings_count,
      searchTitle,
      searchAuthor
    );
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  console.log(`[Books] Picked best Open Library match with score ${bestScore}: "${best.title}"`);
  return best;
}

/**
 * Merge two collector_data objects, preferring non-null/non-empty values from primary.
 */
function mergeBookData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const merged = { ...primary };
  for (const key of Object.keys(secondary)) {
    const primaryVal = merged[key];
    const secondaryVal = secondary[key];
    const isEmpty = primaryVal == null
      || (Array.isArray(primaryVal) && primaryVal.length === 0)
      || primaryVal === '';
    if (isEmpty && secondaryVal != null) {
      merged[key] = secondaryVal;
    }
  }
  return merged;
}

/**
 * Search Google Books by ISBN.
 * @param {string} isbn
 * @returns {Promise<Object|null>}
 */
async function searchBookByIsbn(isbn) {
  try {
    const cleanIsbn = String(isbn).replace(/[^0-9Xx]/g, '');
    if (!cleanIsbn) return null;

    const url = `${GOOGLE_BOOKS_BASE}?q=isbn:${encodeURIComponent(cleanIsbn)}&maxResults=1`;
    console.log(`[Books] Google Books ISBN search: ${cleanIsbn}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Books] Google Books ISBN error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      console.log('[Books] No Google Books results for ISBN');
      return null;
    }

    return formatGoogleBooksVolume(data.items[0]);
  } catch (error) {
    console.error('[Books] Google Books ISBN search error:', error.message);
    return null;
  }
}

/**
 * Search Google Books by title/author.
 * @param {string} title
 * @param {string|null} author
 * @returns {Promise<Object|null>}
 */
async function searchBookByQuery(title, author = null) {
  try {
    if (!title && !author) return null;

    const parts = [];
    if (title) parts.push(`intitle:${title}`);
    if (author) parts.push(`inauthor:${author}`);
    const q = parts.join('+');

    // Fetch several results so we can score and pick the best match.
    // Google Books sometimes ranks box sets or series-entries above the canonical
    // single volume, so we can't just blindly take the top result.
    const url = `${GOOGLE_BOOKS_BASE}?q=${encodeURIComponent(q)}&maxResults=10&orderBy=relevance`;
    console.log(`[Books] Google Books query search: "${q}"`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Books] Google Books query error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      console.log('[Books] No Google Books results for query');
      return null;
    }

    console.log(`[Books] Google Books returned ${data.items.length} candidates`);
    const best = pickBestGoogleBooksVolume(data.items, title, author);
    return formatGoogleBooksVolume(best);
  } catch (error) {
    console.error('[Books] Google Books query search error:', error.message);
    return null;
  }
}

/**
 * Search Open Library as a fallback/secondary source.
 * @param {string} title
 * @param {string|null} author
 * @param {string|null} isbn
 * @returns {Promise<Object|null>}
 */
async function searchBookOpenLibrary(title, author = null, isbn = null) {
  try {
    const params = new URLSearchParams();
    if (isbn) {
      params.set('isbn', String(isbn).replace(/[^0-9Xx]/g, ''));
      params.set('limit', '1');
    } else {
      if (title) params.set('title', title);
      if (author) params.set('author', author);
      // Fetch more than one so we can pick the best — Open Library can also return
      // box sets or unrelated entries at the top.
      params.set('limit', '10');
    }

    const url = `${OPEN_LIBRARY_BASE}?${params.toString()}`;
    console.log(`[Books] Open Library search: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      console.error(`[Books] Open Library error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.docs || data.docs.length === 0) {
      console.log('[Books] No Open Library results');
      return null;
    }

    console.log(`[Books] Open Library returned ${data.docs.length} candidates`);
    const best = isbn ? data.docs[0] : pickBestOpenLibraryDoc(data.docs, title, author);
    return formatOpenLibraryDoc(best);
  } catch (error) {
    console.error('[Books] Open Library search error:', error.message);
    return null;
  }
}

/**
 * Apply book collector_data to top-level item fields.
 * - name => "Title" or "Title — Author"
 * - tags merged with categories (lowercased)
 * - estimated_value kept from AI (books don't have universal market price)
 */
function applyBookDataToItem(item, bookData) {
  if (!bookData) return item;

  const title = bookData.title || null;
  const primaryAuthor = Array.isArray(bookData.authors) && bookData.authors.length > 0
    ? bookData.authors[0]
    : null;

  let name = item.name;
  if (title && primaryAuthor) {
    name = `${title} — ${primaryAuthor}`;
  } else if (title) {
    name = title;
  }

  const collectorDetails = {
    ...(item.collector_details || {}),
    title: title,
    author: primaryAuthor,
    isbn: bookData.isbn_13 || bookData.isbn_10 || item.collector_details?.isbn || null
  };

  const baseTags = Array.isArray(item.tags) ? item.tags : [];
  const extraTags = (Array.isArray(bookData.categories) ? bookData.categories : [])
    .map(t => String(t).toLowerCase());
  const tags = Array.from(new Set([...baseTags, ...extraTags]));

  return {
    ...item,
    name,
    collector_details: collectorDetails,
    tags
  };
}

/**
 * Build fallback follow-up questions when no book data was found.
 */
function buildBookFallbackQuestions(item) {
  const existing = item.followup_questions || [];
  const existingFields = new Set(existing.map(q => q.field));

  const fallback = [];

  if (!existingFields.has('isbn')) {
    fallback.push({
      field: 'isbn',
      question: 'What is the ISBN number on the back cover or copyright page? (10 or 13 digits)',
      priority: 'high'
    });
  }

  return [...existing, ...fallback];
}

/**
 * Enrich a book item with Google Books + Open Library data.
 * @param {Object} item - Item from OpenAI (with collector_details)
 * @returns {Promise<Object>} Enriched item
 */
async function enrichBookItem(item) {
  try {
    const details = item.collector_details || {};
    const title = details.title || null;
    const author = details.author || null;
    const isbn = details.isbn || null;

    if (!title && !author && !isbn) {
      console.log('[Books] No identifying details provided, skipping enrichment');
      return {
        ...item,
        collector_category: 'book',
        collector_data: null,
        collector_warning: 'Insufficient book details for enrichment',
        followup_questions: buildBookFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    console.log(`[Books] Enriching: title="${title}", author="${author}", isbn="${isbn}"`);

    let googleData = null;
    if (isbn) {
      googleData = await searchBookByIsbn(isbn);
    }
    if (!googleData && (title || author)) {
      googleData = await searchBookByQuery(title, author);
    }

    const openLibraryData = await searchBookOpenLibrary(title, author, isbn);

    const merged = mergeBookData(googleData, openLibraryData);

    if (!merged) {
      console.log('[Books] No data found in Google Books or Open Library');
      return {
        ...item,
        collector_category: 'book',
        collector_data: null,
        collector_warning: 'Book not found in Google Books or Open Library',
        followup_questions: buildBookFallbackQuestions(item),
        _base64Image: undefined
      };
    }

    console.log(`[Books] Enriched: ${merged.title} by ${(merged.authors || []).join(', ')}`);
    const enrichedItem = applyBookDataToItem(item, merged);

    return {
      ...enrichedItem,
      collector_category: 'book',
      collector_data: merged,
      _base64Image: undefined
    };
  } catch (error) {
    console.error('[Books] Enrichment error:', error.message);
    return {
      ...item,
      collector_category: 'book',
      collector_data: null,
      collector_warning: `Books API error: ${error.message}`,
      _base64Image: undefined
    };
  }
}

/**
 * Re-enrich a book item using extra info from the user (ISBN, title, author).
 * @param {Object} collectorDetails - Original collector_details
 * @param {Object} extraInfo - User-provided extra info
 */
async function enrichBookWithExtraInfo(collectorDetails, extraInfo) {
  try {
    const title = extraInfo.artwork_title || collectorDetails?.title || null;
    const author = extraInfo.artist_name || collectorDetails?.author || null;
    const isbn = extraInfo.isbn || collectorDetails?.isbn || null;

    if (!title && !author && !isbn) {
      return {
        collector_category: 'book',
        collector_data: null,
        collector_warning: 'No book identifying information available for enrichment'
      };
    }

    let googleData = null;
    if (isbn) {
      googleData = await searchBookByIsbn(isbn);
    }
    if (!googleData && (title || author)) {
      googleData = await searchBookByQuery(title, author);
    }
    const openLibraryData = await searchBookOpenLibrary(title, author, isbn);
    const merged = mergeBookData(googleData, openLibraryData);

    return {
      collector_category: 'book',
      collector_data: merged,
      collector_warning: merged ? undefined : 'Book not found even with extra info'
    };
  } catch (error) {
    console.error('[Books] Extra info enrichment error:', error.message);
    return {
      collector_category: 'book',
      collector_data: null,
      collector_warning: `Books API error: ${error.message}`
    };
  }
}

module.exports = {
  searchBookByIsbn,
  searchBookByQuery,
  searchBookOpenLibrary,
  enrichBookItem,
  enrichBookWithExtraInfo,
  applyBookDataToItem
};
