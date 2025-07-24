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
 * Download image from URL and convert to base64
 * @param {string} imageUrl - URL of the image to download
 * @returns {string} Base64 encoded image
 */
const downloadAndEncodeImage = async (imageUrl) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return base64;
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
 * Process image with OpenAI Vision API
 * @param {string} base64Image - Base64 encoded image
 * @returns {Object} OpenAI response with detected items
 */
const processImageWithOpenAI = async (base64Image) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing household items in photos. 
          Analyze the image and return a JSON array of all visible objects with the following structure:
          [
            {
              "name": "Item name",
              "description": "Brief description of the item",
              "estimated_value": 25.50,
              "quantity": 1,
              "accuracy": 0.95,
              "bounding_box": {
                "x": 120,
                "y": 200,
                "width": 300,
                "height": 180
              }
            }
          ]
          
          Guidelines:
          - estimated_value should be in euros (€)
          - quantity should be the number of that specific item visible
          - Be realistic with value estimates
          - Include all significant items you can identify
          - accuracy should be a number between 0 and 1, 1 being the highest accuracy
          - bounding_box must be the coordinates of the item in the image, in pixel values relative to the original image size.
          - bounding_box.x and bounding_box.y are the pixel coordinates of the top-left corner of the item.
          - bounding_box.width and bounding_box.height are the width and height of the item in pixels.
          - Only provide bounding boxes if you are confident about the location; otherwise, set all values to null.
          - Example bounding_box: { "x": 100, "y": 150, "width": 200, "height": 100 }
          - Return ONLY valid JSON, no additional text`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this image and identify all household items. Return the result as a JSON array."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    console.log('OpenAI response content:', content);
    
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error('JSON parse error for extracted array:', parseError);
        throw new Error('Invalid JSON format in OpenAI response');
      }
    }
    
    // If no JSON array found, try to parse the entire response
    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error('JSON parse error for full content:', parseError);
      console.error('Raw content:', content);
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
    const base64Image = await downloadAndEncodeImage(image_url);
    
    // Process with OpenAI Vision
    const items = await processImageWithOpenAI(base64Image);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.json({
      items: items,
      processing_time: processingTime,
      user_id: user_id
    });

  } catch (error) {
    console.error('Error processing image:', error);
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.status(500).json({
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
    version: '1.0.0',
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
      success: true,
      message: response.choices[0].message.content,
      model: response.model
    });
  } catch (error) {
    console.error('OpenAI test error:', error);
    res.status(500).json({
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
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Track My Home API running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

module.exports = app; 