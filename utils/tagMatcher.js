/**
 * Tag Matching Utilities
 * 
 * Helper functions for matching items with collector tags
 * and determining enrichment requirements
 */

const SYSTEM_TAGS = {
  wine: ['wine', 'wijn', 'vin', 'vino', 'wein'],
  vinyl: ['vinyl', 'plaat', 'lp', 'record', 'album', 'schijf'],
  book: ['book', 'boek', 'livre', 'libro', 'buch', 'novel', 'roman'],
  pokemon: ['pokemon', 'pokémon', 'pokemonkaart', 'pokemon card', 'tcg', 'trading card'],
  art: ['art', 'kunst', 'kunstwerk', 'schilderij', 'painting', 'print', 'artwork', 'poster']
};

/**
 * Check if tags array contains an enrichable tag for a specific category
 * @param {Array<string>} tags - Array of tags to check
 * @param {string} category - Category to check ('wine' or 'vinyl')
 * @returns {boolean} True if tags contain enrichable tag for category
 */
function hasEnrichableTag(tags, category) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return false;
  }
  
  const categoryTags = SYSTEM_TAGS[category];
  if (!categoryTags) {
    return false;
  }
  
  return tags.some(tag => 
    categoryTags.includes(tag.toLowerCase())
  );
}

/**
 * Determine which enrichment type is needed based on tags
 * @param {Array<string>} tags - Array of tags
 * @returns {string|null} Enrichment type ('wine', 'vinyl', 'book', 'pokemon', 'art') or null
 */
function getEnrichmentType(tags) {
  if (hasEnrichableTag(tags, 'wine')) return 'wine';
  if (hasEnrichableTag(tags, 'vinyl')) return 'vinyl';
  if (hasEnrichableTag(tags, 'book')) return 'book';
  if (hasEnrichableTag(tags, 'pokemon')) return 'pokemon';
  if (hasEnrichableTag(tags, 'art')) return 'art';
  return null;
}

/**
 * Get all system tags as a flat array
 * @returns {Array<string>} All system tags
 */
function getAllSystemTags() {
  return Object.values(SYSTEM_TAGS).flat();
}

/**
 * Merge user tags with system tags (remove duplicates, case-insensitive)
 * @param {Array<string>} userTags - User provided tags
 * @returns {Array<string>} Merged unique tags
 */
function mergeTagsWithSystem(userTags = []) {
  const systemTags = getAllSystemTags();
  const allTags = [...systemTags, ...userTags];
  
  // Remove duplicates (case-insensitive)
  const uniqueTags = [];
  const lowerCaseSeen = new Set();
  
  allTags.forEach(tag => {
    const lowerTag = tag.toLowerCase();
    if (!lowerCaseSeen.has(lowerTag)) {
      lowerCaseSeen.add(lowerTag);
      uniqueTags.push(tag);
    }
  });
  
  return uniqueTags;
}

module.exports = {
  SYSTEM_TAGS,
  hasEnrichableTag,
  getEnrichmentType,
  getAllSystemTags,
  mergeTagsWithSystem
};
