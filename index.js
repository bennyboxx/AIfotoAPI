const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const OpenAI = require('openai');
require('dotenv').config();

// Import collector services
const { processCollectorItems, processCollectorItem, getCollectorStats } = require('./services/collectorService');
const { registerAssistantWebhook } = require('./services/assistantWebhook');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = '1.0.4';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Firebase Admin
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

/**
 * Middleware to verify Firebase ID token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No valid authorization header found' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Register Assistant webhook
registerAssistantWebhook(app, admin);

/**
 * Extract file path from Firebase Storage URL
 * @param {string} imageUrl - Firebase Storage URL
 * @returns {string} File path in Firebase Storage
 */
const extractFilePathFromUrl = (imageUrl) => {
  try {
    // Firebase Storage URL format: https://firebasestorage.googleapis.com/v0/b/PROJECT_ID/o/PATH%2FTO%2FFILE?alt=media&token=...
    const url = new URL(imageUrl);
    const pathMatch = url.pathname.match(/\/o\/(.+)/);
    if (pathMatch) {
      // Decode the URL-encoded path
      return decodeURIComponent(pathMatch[1]);
    }
    throw new Error('Could not extract file path from URL');
  } catch (error) {
    console.error('Error extracting file path:', error);
    throw new Error('Invalid Firebase Storage URL format');
  }
};

/**
 * Delete image from Firebase Storage
 * @param {string} filePath - File path in Firebase Storage
 * @returns {boolean} Success status
 */
const deleteImageFromFirebase = async (filePath) => {
  try {
    const bucket = admin.storage().bucket();
    await bucket.file(filePath).delete();
    console.log(`Successfully deleted image: ${filePath}`);
    return true;
  } catch (error) {
    console.error('Error deleting image from Firebase Storage:', error);
    // Don't throw error here, just log it - we don't want to fail the whole request
    return false;
  }
};

/**
 * Download image from URL and convert to base64
 * @param {string} imageUrl - URL of the image to download
 * @returns {Object} { base64: string, filePath: string }
 */
const downloadAndEncodeImage = async (imageUrl) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filePath = extractFilePathFromUrl(imageUrl);
    
    return { base64, filePath };
  } catch (error) {
    console.error('Error downloading image:', error);
    
    if (error.message.includes('fetch')) {
      throw new Error(`Failed to download image from URL: ${error.message}`);
    } else if (error.message.includes('arrayBuffer')) {
      throw new Error('Failed to convert image to buffer');
    } else {
      throw new Error(`Image processing error: ${error.message}`);
    }
  }
};

/**
 * Get image dimensions from base64 image
 * @param {string} base64Image - Base64 encoded image
 * @returns {Object} Image dimensions {width, height}
 */
const getImageDimensions = (base64Image) => {
  try {
    // Create a buffer from base64
    const buffer = Buffer.from(base64Image, 'base64');
    
    // Simple check for common image formats to get dimensions
    // This is a basic implementation - for production, consider using a proper image library
    let width = 1920; // Default fallback
    let height = 1080; // Default fallback
    
    // For JPEG, we can try to extract dimensions from the header
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) { // JPEG signature
      let i = 2;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xC0) { // SOF0 marker
          height = (buffer[i + 5] << 8) | buffer[i + 6];
          width = (buffer[i + 7] << 8) | buffer[i + 8];
          break;
        }
        i++;
      }
    }
    
    return { width, height };
  } catch (error) {
    console.warn('Could not determine image dimensions, using defaults:', error.message);
    return { width: 1920, height: 1080 }; // Default fallback
  }
};

// bbox support removed; normalization helper deleted

/**
 * Compress image to reduce token usage
 * @param {string} base64Image - Base64 encoded image
 * @param {number} maxWidth - Maximum width (default: 1024)
 * @param {number} maxHeight - Maximum height (default: 1024)
 * @returns {string} Compressed base64 image
 */
const compressImage = async (base64Image, maxWidth = 1024, maxHeight = 1024) => {
  try {
    // For now, we'll use a simple approach to reduce image size
    // In production, you might want to use a proper image processing library like sharp
    const buffer = Buffer.from(base64Image, 'base64');
    
    // Check if image is already small enough
    const { width, height } = getImageDimensions(base64Image);
    
    if (width <= maxWidth && height <= maxHeight) {
      console.log(`Image already within size limits: ${width}x${height}`);
      return base64Image;
    }
    
    // Calculate new dimensions while maintaining aspect ratio
    const aspectRatio = width / height;
    let newWidth = maxWidth;
    let newHeight = maxHeight;
    
    if (aspectRatio > 1) {
      // Landscape image
      newHeight = Math.round(maxWidth / aspectRatio);
    } else {
      // Portrait image
      newWidth = Math.round(maxHeight * aspectRatio);
    }
    
    console.log(`Compressing image from ${width}x${height} to ${newWidth}x${newHeight}`);
    
    // For now, return the original image with a warning
    // In a real implementation, you would resize the image here
    console.warn('Image compression not implemented - using original image');
    return base64Image;
    
  } catch (error) {
    console.error('Error compressing image:', error);
    return base64Image; // Return original if compression fails
  }
};

/**
 * Process image with OpenAI Vision API
 * @param {string} base64Image - Base64 encoded image
 * @param {string} language - Language for the output (default: 'en' for English)
 * @param {Array<string>} userTags - Optional array of user tags for classification
 * @returns {Object} OpenAI response with detected items and token usage
 */
const processImageWithOpenAI = async (base64Image, language = 'en', userTags = []) => {
  // Compress image to reduce token usage
  const compressedImage = await compressImage(base64Image, 1024, 1024);
  
  // Get image dimensions
  const { width: imageWidth, height: imageHeight } = getImageDimensions(compressedImage);
  
  // Merge user tags with system tags
  const { mergeTagsWithSystem } = require('./utils/tagMatcher');
  const allTags = mergeTagsWithSystem(userTags);
  
  // Log tags info
  console.log('[Tags] User provided:', userTags.length, 'tags -', userTags.join(', ') || 'none');
  console.log('[Tags] Merged with system:', allTags.length, 'tags -', allTags.join(', '));
  
  // Create tags instruction for AI
  const tagsInstruction = allTags.length > 0
    ? `\n- Available tags: ${allTags.join(', ')}\n- Assign relevant tags to each item using semantic matching (e.g., "bottle" → "wine", "LP" → "vinyl")\n- Add assigned tags to the "tags" array field`
    : '';
  
  // Determine language instruction
  let languageInstruction = '';
  if (language && language !== 'en') {
    const languageNames = {
      'nl': 'Dutch',
      'fr': 'French',
      'de': 'German',
      'es': 'Spanish',
      'it': 'Italian',
      'pt': 'Portuguese'
    };
    const languageName = languageNames[language.toLowerCase()] || language;
    languageInstruction = `\n- IMPORTANT: All text fields (name and description) MUST be in ${languageName}.`;
  }
  
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `You are an expert in visually analyzing household scenes, with special attention to collectible items. Return ONLY a JSON object with an 'items' array. For each clearly visible and identifiable household item, include:\n\n{\n  \"items\": [\n    {\n      \"name\": \"Item name\",\n      \"description\": \"Brief description\",\n      \"estimated_value\": 25.50,\n      \"quantity\": 1,\n      \"accuracy\": 0.95,\n      \"item_type\": \"wine\" or \"vinyl\" or \"general\",\n      \"tags\": [\"relevant\", \"tags\", \"here\"],\n      \"collector_details\": {\n        \"winery\": \"Château Name\" or null,\n        \"vintage\": 2015 or null,\n        \"wine_name\": \"Full wine name\" or null,\n        \"artist\": \"Artist Name\" or null,\n        \"album\": \"Album Title\" or null,\n        \"release_year\": 1973 or null\n      }\n    }\n  ]\n}\n\nStrict rules:\n- Output must be ONLY a JSON object with key 'items' (no prose).\n- Prices in euros as numbers (no currency symbol).\n- accuracy: 0.0–1.0\n- Do NOT include any bounding boxes or coordinates.\n- item_type: Use "wine" for wine bottles, "vinyl" for vinyl records/LPs, "general" for other items.\n- tags: Array of relevant tags assigned to this item${tagsInstruction}\n- collector_details: ALWAYS include this object.\n  - For WINE: set winery, vintage, wine_name (set others to null)\n  - For VINYL: set artist, album, release_year (set others to null)\n  - For GENERAL: set ALL fields to null${languageInstruction}\n\nAnalyze this image (dimensions: ${imageWidth}x${imageHeight} pixels) and return the JSON object.`
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${compressedImage}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "items_response",
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "name",
                    "description",
                    "estimated_value",
                    "quantity",
                    "accuracy",
                    "item_type",
                    "tags",
                    "collector_details"
                  ],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    estimated_value: { type: "number" },
                    quantity: { type: "integer", minimum: 1 },
                    accuracy: { type: "number", minimum: 0, maximum: 1 },
                    item_type: { type: "string", enum: ["wine", "vinyl", "general"] },
                    tags: {
                      type: "array",
                      items: { type: "string" }
                    },
                    collector_details: {
                      type: "object",
                      properties: {
                        winery: { type: ["string", "null"] },
                        vintage: { type: ["integer", "null"] },
                        wine_name: { type: ["string", "null"] },
                        artist: { type: ["string", "null"] },
                        album: { type: ["string", "null"] },
                        release_year: { type: ["integer", "null"] }
                      },
                      required: ["winery", "vintage", "wine_name", "artist", "album", "release_year"],
                      additionalProperties: false
                    }
                  },
                  additionalProperties: false
                }
              }
            },
            required: ["items"],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_output_tokens: 10000
    });

    // format: {
    //   type: "json_schema",
    //   name: "math_response",
    //   schema: {
    //     type: "object",
    //     properties: {
    //       steps: {
    //         type: "array",
    //         items: {
    //           type: "object",
    //           properties: {
    //             explanation: {
    //               type: "string"
    //             },
    //             output: {
    //               type: "string"
    //             },
    //           },
    //           required: ["explanation", "output"],
    //           additionalProperties: false,
    //         },
    //       },
    //       final_answer: {
    //         type: "string"
    //       },
    //     },
    //     required: ["steps", "final_answer"],
    //     additionalProperties: false,
    //   },
    //   strict: true,
    // }

    const content = response.output_text || "";
    
    // Clean possible code fences to improve JSON parsing robustness
    const contentClean = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    
    console.log('[OpenAI] Response length:', contentClean.length, 'characters');
    console.log('[OpenAI] First 200 chars:', contentClean.substring(0, 200));
    
    // Extract token usage information (Responses API: input_tokens/output_tokens)
    const tokenUsage = response.usage || {};
    const promptTokens = tokenUsage.input_tokens || tokenUsage.prompt_tokens || 0;
    const completionTokens = tokenUsage.output_tokens || tokenUsage.completion_tokens || 0;
    const totalTokens = tokenUsage.total_tokens || (promptTokens + completionTokens);
    
    // Log detailed token usage
    const estimatedImageTokens = Math.ceil((imageWidth * imageHeight) / 768);
    
    console.log('Token usage details:', {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      image_dimensions: `${imageWidth}x${imageHeight}`,
      estimated_image_tokens: estimatedImageTokens
    });
    
    // Warn if token usage is high
    if (totalTokens > 15000) {
      console.warn(`High token usage detected: ${totalTokens} tokens. Consider using smaller images.`);
    }
    
    // Try to extract JSON from the response
    const jsonMatch = contentClean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
        const items = rawItems;
        
        console.log(`[OpenAI] Successfully parsed JSON with ${items.length} items`);
        
        return {
          items: items,
          token_usage: {
            // Keep backward compatible fields
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            // Also expose new fields
            input_tokens: promptTokens,
            output_tokens: completionTokens
          },
          warnings: totalTokens > 15000 ? [`High token usage: ${totalTokens} tokens. Consider using smaller images to reduce costs.`] : []
        };
      } catch (parseError) {
        console.error('[OpenAI] JSON parse error for extracted JSON:', parseError.message);
        console.error('[OpenAI] Attempted to parse:', jsonMatch[0].substring(0, 500));
        throw new Error(`Invalid JSON format in OpenAI response: ${parseError.message}`);
      }
    }
    
    // If no JSON found with regex, try to parse the entire response
    try {
      const parsed = JSON.parse(contentClean);
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
      const items = rawItems;
      
      console.log(`[OpenAI] Successfully parsed full content with ${items.length} items`);
      
      return {
        items: items,
        token_usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          input_tokens: promptTokens,
          output_tokens: completionTokens
        },
        warnings: totalTokens > 15000 ? [`High token usage: ${totalTokens} tokens. Consider using smaller images to reduce costs.`] : []
      };
    } catch (parseError) {
      console.error('[OpenAI] JSON parse error for full content:', parseError.message);
      console.error('[OpenAI] Full raw content (first 1000 chars):', contentClean.substring(0, 1000));
      console.error('[OpenAI] Content ends with:', contentClean.substring(contentClean.length - 100));
      throw new Error(`OpenAI response is not valid JSON: ${parseError.message}. Response preview: ${contentClean.substring(0, 200)}`);
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    // Log more specific error details
    if (error.response) {
      console.error('OpenAI API response error:', error.response.data);
      throw new Error(`OpenAI API error: ${error.response.data.error?.message || error.response.statusText}`);
    } else if (error.request) {
      console.error('OpenAI API request error:', error.request);
      throw new Error('OpenAI API request failed - no response received');
    } else {
      console.error('OpenAI API setup error:', error.message);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
};

/**
 * Process single item with OpenAI Vision API
 * @param {string} base64Image - Base64 encoded image
 * @param {string|null} itemDescription - Optional description of the item to focus on
 * @param {string} language - Language for the output (default: 'en' for English)
 * @param {Array<string>} userTags - Optional array of user tags for classification
 * @returns {Object} OpenAI response with single item details and token usage
 */
const processSingleItemWithOpenAI = async (base64Image, itemDescription = null, language = 'en', userTags = []) => {
  // Compress image to reduce token usage
  const compressedImage = await compressImage(base64Image, 1024, 1024);
  
  // Get image dimensions
  const { width: imageWidth, height: imageHeight } = getImageDimensions(compressedImage);
  
  // Merge user tags with system tags
  const { mergeTagsWithSystem } = require('./utils/tagMatcher');
  const allTags = mergeTagsWithSystem(userTags);
  
  // Log tags info
  console.log('[Tags Single] User provided:', userTags.length, 'tags -', userTags.join(', ') || 'none');
  console.log('[Tags Single] Merged with system:', allTags.length, 'tags -', allTags.join(', '));
  
  // Create tags instruction for AI
  const tagsInstruction = allTags.length > 0
    ? `\n- Available tags: ${allTags.join(', ')}\n- Assign relevant tags to this item using semantic matching (e.g., "bottle" → "wine", "LP" → "vinyl")\n- Add assigned tags to the "tags" array field`
    : '';
  
  // Determine language instruction
  let languageInstruction = '';
  if (language && language !== 'en') {
    const languageNames = {
      'nl': 'Dutch',
      'fr': 'French',
      'de': 'German',
      'es': 'Spanish',
      'it': 'Italian',
      'pt': 'Portuguese'
    };
    const languageName = languageNames[language.toLowerCase()] || language;
    languageInstruction = `\n- IMPORTANT: All text fields (name and description) MUST be in ${languageName}.`;
  }
  
  // Create prompt based on whether item description is provided
  let promptText;
  if (itemDescription) {
    promptText = `You are an expert in visually analyzing household items, with special attention to collectible items. Focus ONLY on this item: "${itemDescription}". Return ONLY a JSON object with a single 'item' object:\n\n{\n  "item": {\n    "name": "Item name",\n    "description": "Detailed description including: condition (Good/Excellent/Fair/Poor), brand (if visible), model (if identifiable), and any other relevant details",\n    "estimated_value": 25.50,\n    "quantity": 1,\n    "accuracy": 0.95,\n    "item_type": "wine" or "vinyl" or "general",\n    "tags": [\"relevant\", \"tags\"],\n    "collector_details": {\n      "winery": "Château Name" or null,\n      "vintage": 2015 or null,\n      "wine_name": "Full wine name" or null,\n      "artist": "Artist Name" or null,\n      "album": "Album Title" or null,\n      "release_year": 1973 or null\n    }\n  }\n}\n\nStrict rules:\n- Output must be ONLY a JSON object with key 'item' (no prose).\n- Focus exclusively on "${itemDescription}".\n- Prices in euros as numbers (no currency symbol).\n- accuracy: 0.0–1.0 (confidence in identification).\n- If the item is not found or unclear, set accuracy to 0 and provide best estimate.\n- Include ALL details (condition, brand, model, materials, etc.) in the description field.\n- Make the description comprehensive and detailed.\n- item_type: Use "wine" for wine bottles, "vinyl" for vinyl records/LPs, "general" for other items.\n- tags: Array of relevant tags assigned to this item${tagsInstruction}\n- collector_details: ALWAYS include this object.\n  - For WINE: set winery, vintage, wine_name (set others to null)\n  - For VINYL: set artist, album, release_year (set others to null)\n  - For GENERAL: set ALL fields to null${languageInstruction}\n\nAnalyze this image (dimensions: ${imageWidth}x${imageHeight} pixels) and return the JSON object.`;
  } else {
    promptText = `You are an expert in visually analyzing household items, with special attention to collectible items. Identify and analyze the MOST PROMINENT or VALUABLE item in this image. Return ONLY a JSON object with a single 'item' object:\n\n{\n  "item": {\n    "name": "Item name",\n    "description": "Detailed description including: condition (Good/Excellent/Fair/Poor), brand (if visible), model (if identifiable), and any other relevant details",\n    "estimated_value": 25.50,\n    "quantity": 1,\n    "accuracy": 0.95,\n    "item_type": "wine" or "vinyl" or "general",\n    "tags": [\"relevant\", \"tags\"],\n    "collector_details": {\n      "winery": "Château Name" or null,\n      "vintage": 2015 or null,\n      "wine_name": "Full wine name" or null,\n      "artist": "Artist Name" or null,\n      "album": "Album Title" or null,\n      "release_year": 1973 or null\n    }\n  }\n}\n\nStrict rules:\n- Output must be ONLY a JSON object with key 'item' (no prose).\n- Choose the most prominent, valuable, or significant item in the image.\n- Prices in euros as numbers (no currency symbol).\n- accuracy: 0.0–1.0 (confidence in identification).\n- Include ALL details (condition, brand, model, materials, etc.) in the description field.\n- Make the description comprehensive and detailed.\n- item_type: Use "wine" for wine bottles, "vinyl" for vinyl records/LPs, "general" for other items.\n- tags: Array of relevant tags assigned to this item${tagsInstruction}\n- collector_details: ALWAYS include this object.\n  - For WINE: set winery, vintage, wine_name (set others to null)\n  - For VINYL: set artist, album, release_year (set others to null)\n  - For GENERAL: set ALL fields to null${languageInstruction}\n\nAnalyze this image (dimensions: ${imageWidth}x${imageHeight} pixels) and return the JSON object.`;
  }
  
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: promptText
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${compressedImage}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "single_item_response",
          schema: {
            type: "object",
            properties: {
              item: {
                type: "object",
                required: [
                  "name",
                  "description",
                  "estimated_value",
                  "quantity",
                  "accuracy",
                  "item_type",
                  "tags",
                  "collector_details"
                ],
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  estimated_value: { type: "number" },
                  quantity: { type: "integer", minimum: 1 },
                  accuracy: { type: "number", minimum: 0, maximum: 1 },
                  item_type: { type: "string", enum: ["wine", "vinyl", "general"] },
                  tags: {
                    type: "array",
                    items: { type: "string" }
                  },
                  collector_details: {
                    type: "object",
                    properties: {
                      winery: { type: ["string", "null"] },
                      vintage: { type: ["integer", "null"] },
                      wine_name: { type: ["string", "null"] },
                      artist: { type: ["string", "null"] },
                      album: { type: ["string", "null"] },
                      release_year: { type: ["integer", "null"] }
                    },
                    required: ["winery", "vintage", "wine_name", "artist", "album", "release_year"],
                    additionalProperties: false
                  }
                },
                additionalProperties: false
              }
            },
            required: ["item"],
            additionalProperties: false
          },
          strict: true
        }
      },
      max_output_tokens: 10000
    });

    const content = response.output_text || "";
    
    // Clean possible code fences
    const contentClean = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    
    console.log('[OpenAI Single] Response length:', contentClean.length, 'characters');
    console.log('[OpenAI Single] First 200 chars:', contentClean.substring(0, 200));
    
    // Extract token usage information
    const tokenUsage = response.usage || {};
    const promptTokens = tokenUsage.input_tokens || tokenUsage.prompt_tokens || 0;
    const completionTokens = tokenUsage.output_tokens || tokenUsage.completion_tokens || 0;
    const totalTokens = tokenUsage.total_tokens || (promptTokens + completionTokens);
    
    // Log detailed token usage
    const estimatedImageTokens = Math.ceil((imageWidth * imageHeight) / 768);
    
    console.log('Token usage details:', {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      image_dimensions: `${imageWidth}x${imageHeight}`,
      estimated_image_tokens: estimatedImageTokens
    });
    
    // Warn if token usage is high
    if (totalTokens > 15000) {
      console.warn(`High token usage detected: ${totalTokens} tokens. Consider using smaller images.`);
    }
    
    // Parse JSON response
    const jsonMatch = contentClean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.item) {
          throw new Error('Response missing "item" field');
        }
        
        console.log('[OpenAI Single] Successfully parsed JSON');
        
        return {
          item: parsed.item,
          token_usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            input_tokens: promptTokens,
            output_tokens: completionTokens
          },
          warnings: totalTokens > 15000 ? [`High token usage: ${totalTokens} tokens. Consider using smaller images to reduce costs.`] : []
        };
      } catch (parseError) {
        console.error('[OpenAI Single] JSON parse error:', parseError.message);
        console.error('[OpenAI Single] Attempted to parse:', jsonMatch[0].substring(0, 500));
        throw new Error(`Invalid JSON format in OpenAI response: ${parseError.message}`);
      }
    }
    
    // Try to parse entire response
    try {
      const parsed = JSON.parse(contentClean);
      if (!parsed.item) {
        throw new Error('Response missing "item" field');
      }
      
      console.log('[OpenAI Single] Successfully parsed full content');
      
      return {
        item: parsed.item,
        token_usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          input_tokens: promptTokens,
          output_tokens: completionTokens
        },
        warnings: totalTokens > 15000 ? [`High token usage: ${totalTokens} tokens. Consider using smaller images to reduce costs.`] : []
      };
    } catch (parseError) {
      console.error('[OpenAI Single] JSON parse error for full content:', parseError.message);
      console.error('[OpenAI Single] Full raw content (first 1000 chars):', contentClean.substring(0, 1000));
      console.error('[OpenAI Single] Content ends with:', contentClean.substring(contentClean.length - 100));
      throw new Error(`OpenAI response is not valid JSON: ${parseError.message}. Response preview: ${contentClean.substring(0, 200)}`);
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    if (error.response) {
      console.error('OpenAI API response error:', error.response.data);
      throw new Error(`OpenAI API error: ${error.response.data.error?.message || error.response.statusText}`);
    } else if (error.request) {
      console.error('OpenAI API request error:', error.request);
      throw new Error('OpenAI API request failed - no response received');
    } else {
      console.error('OpenAI API setup error:', error.message);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
};

/**
 * POST /process - Process image and detect household items
 * Body: { "image_url": "string", "user_id": "string", "language": "string (optional, default: 'en')" }
 * Headers: Authorization: Bearer <Firebase_ID_Token>
 */
app.post('/process', verifyFirebaseToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { image_url, user_id, language, tags } = req.body;
    
    // Validate input
    if (!image_url || !user_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: image_url and user_id are required' 
      });
    }

    // Validate user_id matches the authenticated user
    if (req.user.uid !== user_id) {
      return res.status(403).json({ 
        error: 'User ID does not match authenticated user' 
      });
    }

    const requestedLanguage = language || 'en';
    const userTags = Array.isArray(tags) ? tags : [];
    
    console.log(`Processing image for user ${user_id} in language: ${requestedLanguage}`);
    if (userTags.length > 0) {
      console.log(`[Tags] User provided ${userTags.length} tags:`, userTags);
    }

    // Download and encode image
    const { base64: base64Image, filePath } = await downloadAndEncodeImage(image_url);
    
    // Process with OpenAI Vision
    const result = await processImageWithOpenAI(base64Image, requestedLanguage, userTags);
    
    // Enrich collector items with external API data
    const enrichedItems = await processCollectorItems(result.items);
    
    // Get collector statistics
    const collectorStats = getCollectorStats(enrichedItems);
    
    // Delete image from Firebase Storage after processing
    const deleteSuccess = await deleteImageFromFirebase(filePath);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.json({
      version: API_VERSION,
      items: enrichedItems,
      token_usage: result.token_usage,
      warnings: result.warnings || [],
      processing_time: processingTime,
      user_id: user_id,
      image_deleted: deleteSuccess,
      collector_stats: collectorStats
    });

  } catch (error) {
    console.error('Error processing image:', error);
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.status(500).json({
      version: API_VERSION,
      error: 'Failed to process image',
      processing_time: processingTime,
      details: error.message
    });
  }
});

/**
 * POST /process-single - Process image and analyze a single specific item
 * Body: { "image_url": "string", "user_id": "string", "item_name": "string (optional)", "language": "string (optional, default: 'en')" }
 * Headers: Authorization: Bearer <Firebase_ID_Token>
 */
app.post('/process-single', verifyFirebaseToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { image_url, user_id, item_name, language, tags } = req.body;
    
    // Validate input - item_name, language, and tags are optional
    if (!image_url || !user_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: image_url and user_id are required' 
      });
    }

    // Validate user_id matches the authenticated user
    if (req.user.uid !== user_id) {
      return res.status(403).json({ 
        error: 'User ID does not match authenticated user' 
      });
    }

    const requestedLanguage = language || 'en';
    const userTags = Array.isArray(tags) ? tags : [];
    
    if (item_name) {
      console.log(`Processing single item "${item_name}" for user ${user_id} in language: ${requestedLanguage}`);
    } else {
      console.log(`Processing most prominent item for user ${user_id} in language: ${requestedLanguage}`);
    }
    
    if (userTags.length > 0) {
      console.log(`[Tags] User provided ${userTags.length} tags:`, userTags);
    }

    // Download and encode image
    const { base64: base64Image, filePath } = await downloadAndEncodeImage(image_url);
    
    // Process with OpenAI Vision - single item focus
    const result = await processSingleItemWithOpenAI(base64Image, item_name, requestedLanguage, userTags);
    
    // Enrich collector item with external API data
    const enrichedItem = await processCollectorItem(result.item);
    
    // Delete image from Firebase Storage after processing
    const deleteSuccess = await deleteImageFromFirebase(filePath);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    const response = {
      version: API_VERSION,
      item: enrichedItem,
      token_usage: result.token_usage,
      warnings: result.warnings || [],
      processing_time: processingTime,
      user_id: user_id,
      image_deleted: deleteSuccess
    };
    
    // Only include searched_for if item_name was provided
    if (item_name) {
      response.searched_for = item_name;
    }
    
    res.json(response);

  } catch (error) {
    console.error('Error processing single item:', error);
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.status(500).json({
      version: API_VERSION,
      error: 'Failed to process single item',
      processing_time: processingTime,
      details: error.message
    });
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    version: API_VERSION,
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Track My Home API'
  });
});

/**
 * GET / - Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Track My Home API',
    version: API_VERSION,
    endpoints: {
      'POST /assistant/webhook': 'Google Assistant Actions Builder webhook',
      'POST /process': 'Process image and detect all household items',
      'POST /process-single': 'Process image and analyze a specific item',
      'GET /health': 'Health check',
      'GET /test-openai': 'Test OpenAI API connection'
    }
  });
});

/**
 * GET /test-openai - Test OpenAI API connection
 */
app.get('/test-openai', async (req, res) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: "Say 'Hello from Track My Home API'"
        }
      ],
      max_tokens: 10
    });
    
    res.json({
      version: API_VERSION,
      success: true,
      message: response.choices[0].message.content,
      model: response.model
    });
  } catch (error) {
    console.error('OpenAI test error:', error);
    res.status(500).json({
      version: API_VERSION,
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    version: API_VERSION,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    version: API_VERSION,
    error: 'Endpoint not found' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Track My Home API running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

module.exports = app; 