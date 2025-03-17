<?php
// Enable detailed errors (remove in production)
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Modified CORS handling for file:// support
$allowedOrigins = [
    'https://tesla.x10.mx',
    'null' // Add this for file:// protocol
];

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($requestOrigin, $allowedOrigins) || in_array('null', $allowedOrigins)) {
    header("Access-Control-Allow-Origin: $requestOrigin");
}

header('Access-Control-Allow-Headers: X-API-Key, Content-Type');
header('Content-Type: application/json');

// Add OPTIONS handling for CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('HTTP/1.1 204 No Content');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    exit;
}

try {
    // Validate request method
    $allowedMethods = ['GET', 'POST'];
    if (!in_array($_SERVER['REQUEST_METHOD'], $allowedMethods)) {
        throw new Exception("Method not allowed", 405);
    }

    // Get and validate API key
    $clientApiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if (!str_starts_with($clientApiKey, 'r8_')) {
        throw new Exception("Invalid Replicate API key format", 401);
    }

    // Get and validate endpoint
    $endpoint = $_GET['endpoint'] ?? '';
    if (empty($endpoint)) {
        throw new Exception("Missing endpoint parameter", 400);
    }

    // Build Replicate API URL
    $replicateUrl = "https://api.replicate.com/v1/{$endpoint}";
    
    // Initialize cURL
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $replicateUrl,
        CURLOPT_HTTPHEADER => [
            'Authorization: Token ' . $clientApiKey,
            'Content-Type: application/json'
        ],
        CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HEADER => true // Include headers in output
    ]);

    // Handle POST data
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
    }

    // Execute request
    $response = curl_exec($ch);
    
    // Check for cURL errors
    if (curl_errno($ch)) {
        throw new Exception("cURL error: " . curl_error($ch), 500);
    }

    // Get response details
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headers = substr($response, 0, $headerSize);
    $body = substr($response, $headerSize);

    curl_close($ch);

    // Forward headers except security-sensitive ones
    foreach (explode("\r\n", $headers) as $header) {
        if (stripos($header, 'Access-Control-') === false 
            && stripos($header, 'Content-Type:') === false) {
            header($header);
        }
    }

    http_response_code($statusCode);
    echo $body;

} catch (Exception $e) {
    http_response_code($e->getCode() ?: 500);
    echo json_encode([
        'error' => $e->getMessage(),
        'debug' => [
            'endpoint' => $endpoint ?? null,
            'method' => $_SERVER['REQUEST_METHOD'] ?? null,
            'client_key' => !empty($clientApiKey)
        ]
    ]);
}
?>
