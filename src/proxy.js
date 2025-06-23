const http = require('http');
const https = require('https');
const url = require('url');

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '*';
    res.writeHead(200, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end();
    return;
  }

  try {
    // Select target based on path
    const targetUrl = req.url.startsWith('/check-tx') || req.url.startsWith('/send-tx')
      ? 'https://service-v1.raydium.io'
      : 'https://api.mainnet-beta.solana.com';

    console.log(`🔄 Proxying ${req.method} ${req.url} to ${targetUrl}`);

    // Parse the target URL
    const parsedUrl = url.parse(targetUrl);
    const targetPath = req.url;

    // Prepare headers for the target request
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://raydium.io/',
      'Host': parsedUrl.host,
      'Content-Type': req.headers['content-type'] || 'application/json',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'X-Requested-With': 'XMLHttpRequest',
    };

    console.log(`📤 Request headers:`, headers);

    // Copy relevant headers from the original request
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['x-api-key']) {
      headers['X-API-Key'] = req.headers['x-api-key'];
    }

    // Prepare request options
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers: headers,
      timeout: 30000,
    };

    // Make the request to the target
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`✅ Response received: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
      console.log(`📋 Response headers:`, proxyRes.headers);

      // Set CORS headers
      const origin = req.headers.origin || '*';
      const responseHeaders = {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
      };

      // Clean up problematic headers
      delete responseHeaders['access-control-allow-origin'];
      delete responseHeaders['access-control-allow-headers'];
      delete responseHeaders['access-control-allow-methods'];

      res.writeHead(proxyRes.statusCode, responseHeaders);

      // Pipe the response
      proxyRes.pipe(res);
    });

    // Handle request errors
    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end(JSON.stringify({
          error: 'Proxy error',
          message: err.message,
          code: err.code
        }));
      }
    });

    // Handle timeout
    proxyReq.setTimeout(30000, () => {
      console.error('Proxy request timeout');
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end(JSON.stringify({
          error: 'Gateway Timeout',
          message: 'Request timed out'
        }));
      }
    });

    // Pipe the request body if it exists
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }

  } catch (error) {
    console.error('Server error:', error);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end(JSON.stringify({
        error: 'Server error',
        message: error.message
      }));
    }
  }
});

server.listen(3000, () => {
  console.log('🔥 Enhanced CORS proxy running on http://localhost:3000');
  console.log('📡 Forwarding to Raydium service and Solana RPC');
  console.log('🛡️  Optimized for Cloudflare bypass');
});

