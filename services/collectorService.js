const { enrichWineItem } = require('./vivinoService');
const { enrichVinylItem } = require('./discogsService');
const { enrichBookItem } = require('./booksService');
const { enrichPokemonItem } = require('./pokemonService');
const { enrichArtworkItem } = require('./artService');

/**
 * Central Collector Service
 * 
 * Orchestrates the enrichment of collector items with data from external APIs
 */

/**
 * Process a single item and enrich if it's a collector item
 * @param {Object} item - Item from OpenAI response
 * @returns {Promise<Object>} Enriched item
 */
async function processCollectorItem(item) {
  try {
    const { getEnrichmentType } = require('../utils/tagMatcher');
    
    // Check tags first (new tag-based system)
    const tags = item.tags || [];
    const enrichmentType = getEnrichmentType(tags);
    
    console.log(`[Collector] Processing item: ${item.name} (tags: ${tags.join(', ') || 'none'})`);
    
    // Route based on tags
    if (enrichmentType === 'wine') {
      console.log(`[Collector] Detected wine via tags, enriching with wine data`);
      return await enrichWineItem(item);
    }
    
    if (enrichmentType === 'vinyl') {
      console.log(`[Collector] Detected vinyl via tags, enriching with Discogs`);
      return await enrichVinylItem(item);
    }

    if (enrichmentType === 'book') {
      console.log(`[Collector] Detected book via tags, enriching with Google Books + Open Library`);
      return await enrichBookItem(item);
    }

    if (enrichmentType === 'pokemon') {
      console.log(`[Collector] Detected Pokémon card via tags, enriching with pokemontcg.io`);
      return await enrichPokemonItem(item);
    }

    if (enrichmentType === 'art') {
      console.log(`[Collector] Detected artwork via tags, enriching with Vision + museum APIs`);
      return await enrichArtworkItem(item);
    }

    // Fallback: check old item_type for backwards compatibility
    if (item.item_type === 'wine') {
      console.log(`[Collector] Detected wine via item_type (legacy), enriching with wine data`);
      return await enrichWineItem(item);
    }
    
    if (item.item_type === 'vinyl') {
      console.log(`[Collector] Detected vinyl via item_type (legacy), enriching with Discogs`);
      return await enrichVinylItem(item);
    }

    if (item.item_type === 'book') {
      console.log(`[Collector] Detected book via item_type (legacy), enriching with Google Books`);
      return await enrichBookItem(item);
    }

    if (item.item_type === 'pokemon') {
      console.log(`[Collector] Detected Pokémon via item_type (legacy), enriching with pokemontcg.io`);
      return await enrichPokemonItem(item);
    }

    if (item.item_type === 'art') {
      console.log(`[Collector] Detected artwork via item_type (legacy), enriching with Vision + museum APIs`);
      return await enrichArtworkItem(item);
    }
    
    // Item has custom tags but no enrichment available
    if (tags.length > 0) {
      console.log(`[Collector] Item has tags but no enrichment available: ${tags.join(', ')}`);
      return {
        ...item,
        collector_category: null
      };
    }
    
    // Regular item, no enrichment needed
    return {
      ...item,
      collector_category: null
    };

  } catch (error) {
    console.error('[Collector] Error processing item:', error.message);
    
    // Return item with error but don't fail the whole request
    return {
      ...item,
      collector_category: null,
      collector_warning: `Failed to enrich item: ${error.message}`
    };
  }
}

/**
 * Process multiple items
 * @param {Array<Object>} items - Array of items from OpenAI
 * @returns {Promise<Array<Object>>} Array of enriched items
 */
async function processCollectorItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  console.log(`[Collector] Processing ${items.length} items for collector enrichment`);

  // Process all items in parallel for better performance
  const enrichedItems = await Promise.all(
    items.map(item => processCollectorItem(item))
  );

  // Count collector items found
  const collectorCount = enrichedItems.filter(item => item.collector_category !== null).length;
  console.log(`[Collector] Found ${collectorCount} collector items out of ${items.length} total items`);

  return enrichedItems;
}

/**
 * Get collector statistics from processed items
 * @param {Array<Object>} items - Array of processed items
 * @returns {Object} Statistics about collector items
 */
function getCollectorStats(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      total_items: 0,
      collector_items: 0,
      wine_items: 0,
      vinyl_items: 0,
      book_items: 0,
      pokemon_items: 0,
      art_items: 0,
      general_items: 0
    };
  }

  const stats = {
    total_items: items.length,
    collector_items: 0,
    wine_items: 0,
    vinyl_items: 0,
    book_items: 0,
    pokemon_items: 0,
    art_items: 0,
    general_items: 0,
    enrichment_failures: 0
  };

  items.forEach(item => {
    if (item.collector_category === 'wine') {
      stats.collector_items++;
      stats.wine_items++;
    } else if (item.collector_category === 'vinyl') {
      stats.collector_items++;
      stats.vinyl_items++;
    } else if (item.collector_category === 'book') {
      stats.collector_items++;
      stats.book_items++;
    } else if (item.collector_category === 'pokemon') {
      stats.collector_items++;
      stats.pokemon_items++;
    } else if (item.collector_category === 'art') {
      stats.collector_items++;
      stats.art_items++;
    } else {
      stats.general_items++;
    }

    if (item.collector_warning) {
      stats.enrichment_failures++;
    }
  });

  return stats;
}

/**
 * Clean up item response (remove internal fields if needed)
 * @param {Object} item - Processed item
 * @returns {Object} Cleaned item for API response
 */
function cleanItemForResponse(item) {
  const { _base64Image, ...cleanedItem } = item;
  return cleanedItem;
}

/**
 * Clean up multiple items for response
 * @param {Array<Object>} items - Array of processed items
 * @returns {Array<Object>} Array of cleaned items
 */
function cleanItemsForResponse(items) {
  return items.map(item => cleanItemForResponse(item));
}

module.exports = {
  processCollectorItem,
  processCollectorItems,
  getCollectorStats,
  cleanItemForResponse,
  cleanItemsForResponse
};

