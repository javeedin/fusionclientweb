#!/usr/bin/env node
// MCP stdio wrapper for GL MCP Server
// Communicates with our HTTP-based GL MCP server
// Converts JSON-RPC stdio to HTTP POST requests

const https = require('https');
const readline = require('readline');

const GL_MCP_URL = process.env.GL_MCP_URL || 'https://localhost:3001';

// Ignore self-signed certificate warnings for localhost
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [GL MCP STDIO ${level}] ${message}`);
}

log('INFO', 'GL MCP stdio wrapper starting...');
log('INFO', `Connecting to GL MCP server at: ${GL_MCP_URL}`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

async function callGLMCP(request) {
  return new Promise((resolve, reject) => {
    const url = new URL(GL_MCP_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname || '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      rejectUnauthorized: false // Allow self-signed certificates
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          log('ERROR', `Failed to parse response: ${e.message}`);
          reject(e);
        }
      });
    });

    req.on('error', (error) => {
      log('ERROR', `HTTP request error: ${error.message}`);
      reject(error);
    });

    req.write(JSON.stringify(request));
    req.end();
  });
}

rl.on('line', async (line) => {
  try {
    if (!line.trim()) return;

    const request = JSON.parse(line);
    log('DEBUG', `Received request: ${request.method}`);

    const response = await callGLMCP(request);
    console.log(JSON.stringify(response));
  } catch (error) {
    log('ERROR', `Error processing request: ${error.message}`);
    const errorResponse = {
      jsonrpc: '2.0',
      error: { code: -32603, message: error.message },
      id: null
    };
    console.log(JSON.stringify(errorResponse));
  }
});

rl.on('close', () => {
  log('INFO', 'stdin closed, shutting down');
  process.exit(0);
});

log('INFO', 'stdio wrapper ready, waiting for requests...');
