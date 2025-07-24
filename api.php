<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Your Node.js API URL (you'll need to host this separately)
$nodeApiUrl = 'https://your-nodejs-api.vercel.app'; // or ngrok URL

$path = $_SERVER['REQUEST_URI'];
$path = str_replace('/AIfotoAPI/', '', $path);

// Forward the request to your Node.js API
$url = $nodeApiUrl . $path;

// Get request method
$method = $_SERVER['REQUEST_METHOD'];

// Get headers
$headers = [];
foreach (getallheaders() as $name => $value) {
    $headers[] = "$name: $value";
}

// Get request body
$body = file_get_contents('php://input');

// Initialize cURL
$ch = curl_init();

// Set cURL options
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

// Execute request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// Check for errors
if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to connect to API',
        'details' => curl_error($ch)
    ]);
    exit;
}

curl_close($ch);

// Set response code
http_response_code($httpCode);

// Return response
echo $response;
?> 