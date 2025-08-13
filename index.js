const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const OpenAI = require('openai');
require('dotenv').config();

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

/**
 * Normalize bbox values to image bounds and integers
 * @param {Array} items
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Array}
 */
const normalizeBoundingBoxes = (items, imageWidth, imageHeight) => {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    const b = item?.bbox;
    if (!b || typeof b !== 'object') return { ...item, bbox: null };

    let x = Number(b.x), y = Number(b.y), w = Number(b.width), h = Number(b.height);
    if (![x, y, w, h].every((n) => Number.isFinite(n))) return { ...item, bbox: null };

    x = Math.max(0, Math.min(Math.floor(x), imageWidth - 1));
    y = Math.max(0, Math.min(Math.floor(y), imageHeight - 1));
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));

    if (x + w > imageWidth) w = Math.max(1, imageWidth - x);
    if (y + h > imageHeight) h = Math.max(1, imageHeight - y);

    return { ...item, bbox: { x, y, width: w, height: h } };
  });
};

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
 * @returns {Object} OpenAI response with detected items and token usage
 */
const processImageWithOpenAI = async (base64Image) => {
  // Compress image to reduce token usage
  const compressedImage = await compressImage(base64Image, 1024, 1024);
  
  // Get image dimensions
  const { width: imageWidth, height: imageHeight } = getImageDimensions(compressedImage);
  
  try {
    const response = await openai.responses.create({
      model: "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `You are an expert in visually analyzing household scenes. Return ONLY a JSON array. For each clearly visible and identifiable household item, return:\n\n[\n  {\n    \"name\": \"Item name\",\n    \"description\": \"Brief description\",\n    \"estimated_value\": 25.50,\n    \"quantity\": 1,\n    \"accuracy\": 0.95,\n    \"bbox\": { \"x\": 100, \"y\": 200, \"width\": 300, \"height\": 150 }\n  }\n]\n\nStrict rules:\n- Output must be ONLY a JSON array (no prose).\n- Prices in euros as numbers (no currency symbol).\n- accuracy: 0.0–1.0\n- bbox is REQUIRED and must be pixel coordinates relative to the provided image (top-left origin (0,0)), integers only, kept fully inside the image.\n- If an item cannot be confidently localized, omit that item.\n\nAnalyze this image (dimensions: ${imageWidth}x${imageHeight} pixels) and return the items.`
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${compressedImage}`
            }
          ]
        }
      ],
      text: { format: "json" },
      max_output_tokens: 10000
    });

    const content = response.output_text || "";
    console.log('OpenAI response content:', content);
    
    // Clean possible code fences to improve JSON parsing robustness
    const contentClean = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    
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
    const jsonMatch = contentClean.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const rawItems = JSON.parse(jsonMatch[0]);
        const items = normalizeBoundingBoxes(rawItems, imageWidth, imageHeight);
        
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
        console.error('JSON parse error for extracted array:', parseError);
        throw new Error('Invalid JSON format in OpenAI response');
      }
    }
    
    // If no JSON array found, try to parse the entire response
    try {
      const rawItems = JSON.parse(contentClean);
      const items = normalizeBoundingBoxes(rawItems, imageWidth, imageHeight);
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
      console.error('JSON parse error for full content:', parseError);
      console.error('Raw content:', contentClean);
      throw new Error('OpenAI response is not valid JSON');
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
 * POST /process - Process image and detect household items
 * Body: { "image_url": "string", "user_id": "string" }
 * Headers: Authorization: Bearer <Firebase_ID_Token>
 */
app.post('/process', verifyFirebaseToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { image_url, user_id } = req.body;
    
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

    console.log(`Processing image for user ${user_id}`);

    // Download and encode image
    const { base64: base64Image, filePath } = await downloadAndEncodeImage(image_url);
    
    // Process with OpenAI Vision
    const result = await processImageWithOpenAI(base64Image);
    
    // Delete image from Firebase Storage after processing
    const deleteSuccess = await deleteImageFromFirebase(filePath);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.json({
      version: API_VERSION,
      items: result.items,
      token_usage: result.token_usage,
      warnings: result.warnings || [],
      processing_time: processingTime,
      user_id: user_id,
      image_deleted: deleteSuccess
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
      'POST /process': 'Process image and detect household items',
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
      model: "gpt-3.5-turbo",
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