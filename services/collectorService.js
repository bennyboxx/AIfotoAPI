const { enrichWineItem } = require('./vivinoService');
const { enrichVinylItem } = require('./discogsService');

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
    // Check item_type from OpenAI
    const itemType = item.item_type;

    console.log(`[Collector] Processing item: ${item.name} (type: ${itemType})`);

    // Route to appropriate enrichment service
    switch (itemType) {
      case 'wine':
        return await enrichWineItem(item);
      
      case 'vinyl':
        return await enrichVinylItem(item);
      
      case 'general':
      default:
        // Regular item, no enrichment needed
        return {
          ...item,
          collector_category: null
        };
    }

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
      general_items: 0
    };
  }

  const stats = {
    total_items: items.length,
    collector_items: 0,
    wine_items: 0,
    vinyl_items: 0,
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
  // Remove the raw OpenAI wine_details and vinyl_details
  // since we now have collector_data
  const cleanedItem = { ...item };
  
  // Keep wine_details and vinyl_details for reference, but they're optional
  // The main enriched data is in collector_data
  
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

