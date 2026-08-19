import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;

// CORS configuration
app.use(cors());
app.use(express.json());

// OAuth token storage (in production, use database)
interface OAuthTokens {
  [serverId: string]: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    requestToken?: string;
  };
}

const oauthTokens: OAuthTokens = {};

// Store MCP client connections by server URL
interface ServerConnection {
  client: Client;
  transport: any;
  tools: Tool[];
  lastUpdated: Date;
}

const connections = new Map<string, ServerConnection>();

/**
 * Connect to an MCP server using proper MCP protocol
 * Supports both stdio and HTTP transports
 */
async function connectToMcpServer(serverUrl: string): Promise<Client> {
  console.log(`[MCP Bridge] Connecting to MCP server: ${serverUrl}`);

  try {
    // For HTTP-based MCP servers (SSE transport)
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      console.log(`[MCP Bridge] Using HTTP/SSE transport for ${serverUrl}`);

      // Create a simple HTTP client for MCP servers
      // Many MCP servers provide HTTP endpoints that wrap the protocol
      const client = new Client({
        name: 'fusion-autopilot-bridge',
        version: '1.0.0',
      });

      // For HTTP MCP servers, we'll use a direct fetch-based approach
      // Store the URL for later use
      return client;
    }

    // For stdio-based MCP servers
    console.log(`[MCP Bridge] Using stdio transport for ${serverUrl}`);
    const transport = new StdioClientTransport({
      command: serverUrl,
      args: [],
    });

    const client = new Client({
      name: 'fusion-autopilot-bridge',
      version: '1.0.0',
    });

    await client.connect(transport);
    console.log(`[MCP Bridge] Successfully connected to ${serverUrl}`);

    return client;
  } catch (error) {
    console.error(`[MCP Bridge] Failed to connect to ${serverUrl}:`, error);
    throw error;
  }
}

/**
 * Fetch tools from an MCP server
 */
async function getServerTools(serverUrl: string, client: Client): Promise<Tool[]> {
  console.log(`[MCP Bridge] Fetching tools from ${serverUrl}`);

  try {
    // For HTTP-based servers, try to fetch tools directly
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      return await fetchHttpMcpTools(serverUrl);
    }

    // For stdio-based servers, use the client
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
      },
      {}
    );

    const tools = (toolsResponse as any).tools || [];
    console.log(`[MCP Bridge] Found ${tools.length} tools on ${serverUrl}`);

    return tools;
  } catch (error) {
    console.error(`[MCP Bridge] Failed to fetch tools from ${serverUrl}:`, error);
    return [];
  }
}

/**
 * Fetch tools from HTTP-based MCP server
 */
async function fetchHttpMcpTools(serverUrl: string): Promise<Tool[]> {
  try {
    const baseUrl = serverUrl.replace(/\/$/, '');

    // Try multiple endpoint patterns
    const endpoints = [
      `${baseUrl}/mcp/tools`,
      `${baseUrl}/tools`,
      `${baseUrl}/api/tools`,
      `${baseUrl}/v1/tools`,
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`[MCP Bridge] Trying endpoint: ${endpoint}`);
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          const tools = Array.isArray(data) ? data : data.tools || [];

          // Normalize tools to MCP Tool format
          const normalizedTools: Tool[] = tools.map((tool: any) => ({
            name: tool.name || tool.id,
            description: tool.description || '',
            inputSchema: tool.inputSchema || tool.input_schema || {
              type: 'object',
              properties: {},
            },
          }));

          console.log(`[MCP Bridge] Successfully fetched ${normalizedTools.length} tools from ${endpoint}`);
          return normalizedTools;
        }
      } catch (error) {
        console.log(`[MCP Bridge] Failed to fetch from ${endpoint}: ${(error as Error).message}`);
      }
    }

    return [];
  } catch (error) {
    console.error(`[MCP Bridge] Error fetching HTTP MCP tools:`, error);
    return [];
  }
}

/**
 * Execute a tool on an MCP server
 */
async function executeMcpTool(
  serverUrl: string,
  toolName: string,
  input: any,
  client?: Client,
  serverId?: string
): Promise<string> {
  console.log(`[MCP Bridge] Executing tool "${toolName}" on ${serverUrl}`);

  try {
    // For HTTP-based servers
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      return await executeHttpMcpTool(serverUrl, toolName, input, serverId);
    }

    // For stdio-based servers
    if (!client) {
      throw new Error('Client not available for stdio server');
    }

    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: input,
        },
      },
      {}
    );

    return JSON.stringify(result);
  } catch (error) {
    console.error(`[MCP Bridge] Failed to execute tool:`, error);
    throw error;
  }
}

/**
 * Execute tool on HTTP-based MCP server
 */
async function executeHttpMcpTool(
  serverUrl: string,
  toolName: string,
  input: any,
  serverId?: string
): Promise<string> {
  try {
    const baseUrl = serverUrl.replace(/\/$/, '');

    // Add OAuth token if available
    const headers: any = { 'Content-Type': 'application/json' };
    if (serverId && oauthTokens[serverId]) {
      const token = oauthTokens[serverId];
      if (token.accessToken) {
        headers['Authorization'] = `Bearer ${token.accessToken}`;
        console.log(`[MCP Bridge] Adding OAuth token for server: ${serverId}`);
      }
    }

    // Try multiple endpoint patterns
    const endpoints = [
      `${baseUrl}/mcp/execute`,
      `${baseUrl}/execute`,
      `${baseUrl}/api/execute`,
      `${baseUrl}/v1/execute`,
      `${baseUrl}/call`,
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`[MCP Bridge] Trying execute endpoint: ${endpoint}`);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tool: toolName,
            input,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`[MCP Bridge] Successfully executed tool on ${endpoint}`);
          return JSON.stringify(result);
        }
      } catch (error) {
        console.log(`[MCP Bridge] Failed to execute on ${endpoint}: ${(error as Error).message}`);
      }
    }

    throw new Error(`No working execute endpoint found for ${serverUrl}`);
  } catch (error) {
    console.error(`[MCP Bridge] Error executing HTTP MCP tool:`, error);
    throw error;
  }
}

// Routes

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedServers: Array.from(connections.keys()),
  });
});

/**
 * List all tools from a specific MCP server
 * GET /api/mcp/servers/:serverId/tools
 */
app.get('/api/mcp/servers/:serverId/tools', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const serverUrl = Buffer.from(serverId, 'base64').toString('utf-8');

    console.log(`[API] Fetching tools for server: ${serverUrl}`);

    // Check if already connected
    let connection = connections.get(serverUrl);

    if (!connection) {
      // Create new connection
      const client = await connectToMcpServer(serverUrl);
      const tools = await getServerTools(serverUrl, client);

      connection = {
        client,
        transport: null,
        tools,
        lastUpdated: new Date(),
      };

      connections.set(serverUrl, connection);
    }

    res.json({
      serverId,
      serverUrl,
      tools: connection.tools,
      lastUpdated: connection.lastUpdated,
    });
  } catch (error) {
    console.error('[API] Error fetching tools:', error);
    res.status(500).json({
      error: 'Failed to fetch tools',
      message: (error as Error).message,
    });
  }
});

/**
 * Execute a tool on a specific MCP server
 * POST /api/mcp/servers/:serverId/execute
 */
app.post('/api/mcp/servers/:serverId/execute', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const { tool, input } = req.body;

    const serverUrl = Buffer.from(serverId, 'base64').toString('utf-8');

    console.log(`[API] Executing tool "${tool}" on server: ${serverUrl}`);

    // Ensure connection exists
    let connection = connections.get(serverUrl);
    if (!connection) {
      const client = await connectToMcpServer(serverUrl);
      const tools = await getServerTools(serverUrl, client);
      connection = {
        client,
        transport: null,
        tools,
        lastUpdated: new Date(),
      };
      connections.set(serverUrl, connection);
    }

    // Execute tool (pass serverId for OAuth support)
    const result = await executeMcpTool(serverUrl, tool, input, connection.client, serverId);

    res.json({
      tool,
      input,
      result: JSON.parse(result),
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error executing tool:', error);
    res.status(500).json({
      error: 'Failed to execute tool',
      message: (error as Error).message,
    });
  }
});

/**
 * Connect to a new MCP server
 * POST /api/mcp/connect
 */
app.post('/api/mcp/connect', async (req: Request, res: Response) => {
  try {
    const { serverUrl } = req.body;

    if (!serverUrl) {
      return res.status(400).json({ error: 'serverUrl is required' });
    }

    console.log(`[API] Connecting to MCP server: ${serverUrl}`);

    const client = await connectToMcpServer(serverUrl);
    const tools = await getServerTools(serverUrl, client);

    const connection = {
      client,
      transport: null,
      tools,
      lastUpdated: new Date(),
    };

    connections.set(serverUrl, connection);

    const serverId = Buffer.from(serverUrl).toString('base64');

    res.json({
      success: true,
      serverId,
      serverUrl,
      toolCount: tools.length,
      tools,
    });
  } catch (error) {
    console.error('[API] Error connecting to server:', error);
    res.status(500).json({
      error: 'Failed to connect to MCP server',
      message: (error as Error).message,
    });
  }
});

/**
 * Disconnect from an MCP server
 * POST /api/mcp/disconnect
 */
app.post('/api/mcp/disconnect', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;
    const serverUrl = Buffer.from(serverId, 'base64').toString('utf-8');

    console.log(`[API] Disconnecting from MCP server: ${serverUrl}`);

    const connection = connections.get(serverUrl);
    if (connection) {
      // Close transport if available
      if (connection.transport?.close) {
        await connection.transport.close();
      }
      connections.delete(serverUrl);
    }

    res.json({
      success: true,
      message: `Disconnected from ${serverUrl}`,
    });
  } catch (error) {
    console.error('[API] Error disconnecting from server:', error);
    res.status(500).json({
      error: 'Failed to disconnect from server',
      message: (error as Error).message,
    });
  }
});

/**
 * List all connected servers
 * GET /api/mcp/servers
 */
app.get('/api/mcp/servers', (req: Request, res: Response) => {
  const servers = Array.from(connections.entries()).map(([url, conn]) => ({
    serverUrl: url,
    serverId: Buffer.from(url).toString('base64'),
    toolCount: conn.tools.length,
    lastUpdated: conn.lastUpdated,
  }));

  res.json({
    servers,
    totalServers: servers.length,
  });
});

// ═══════════════════════════════════════════════════════════════════
// OAuth Authentication Endpoints
// ═══════════════════════════════════════════════════════════════════

/**
 * Initiate OAuth login for Zerodha Kite Connect
 * GET /api/auth/zerodha/login
 */
app.get('/api/auth/zerodha/login', (req: Request, res: Response) => {
  try {
    const apiKey = process.env.ZERODHA_API_KEY;
    const redirectUrl = process.env.ZERODHA_REDIRECT_URL || `http://localhost:${port}/api/auth/zerodha/callback`;

    if (!apiKey) {
      return res.status(400).json({
        error: 'Zerodha API key not configured',
        message: 'Set ZERODHA_API_KEY environment variable',
      });
    }

    console.log('[OAuth] Initiating Zerodha login');
    console.log('[OAuth] Redirect URL:', redirectUrl);

    // Generate login URL for Zerodha Kite Connect
    const loginUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3`;

    res.json({
      loginUrl,
      message: 'Redirect user to this URL to log in',
      redirectUrl,
    });
  } catch (error) {
    console.error('[OAuth] Error initiating login:', error);
    res.status(500).json({
      error: 'Failed to initiate login',
      message: (error as Error).message,
    });
  }
});

/**
 * OAuth callback handler for Zerodha
 * GET /api/auth/zerodha/callback?request_token=TOKEN
 */
app.get('/api/auth/zerodha/callback', async (req: Request, res: Response) => {
  try {
    const { request_token } = req.query;

    if (!request_token) {
      return res.status(400).json({
        error: 'Missing request_token',
        message: 'Zerodha OAuth callback requires request_token parameter',
      });
    }

    console.log('[OAuth] Received callback with request_token:', request_token);

    const apiKey = process.env.ZERODHA_API_KEY;
    const apiSecret = process.env.ZERODHA_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        error: 'Zerodha credentials not configured',
        message: 'Set ZERODHA_API_KEY and ZERODHA_API_SECRET environment variables',
      });
    }

    // In production, exchange request_token for access_token
    // This would involve calling Zerodha's token endpoint
    // For now, store the request_token
    const serverId = Buffer.from('https://mcp.kite.trade/mcp').toString('base64');

    oauthTokens[serverId] = {
      accessToken: request_token as string,
      requestToken: request_token as string,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    console.log('[OAuth] Token stored for server:', serverId);

    // Redirect back to Autopilot with success
    const redirectUrl = process.env.AUTOPILOT_URL || 'http://localhost:3000';
    res.redirect(
      `${redirectUrl}/autopilot?auth=success&server=zerodha&message=Successfully authorized Zerodha`
    );
  } catch (error) {
    console.error('[OAuth] Error in callback:', error);
    const redirectUrl = process.env.AUTOPILOT_URL || 'http://localhost:3000';
    res.redirect(
      `${redirectUrl}/autopilot?auth=failed&server=zerodha&message=${encodeURIComponent((error as Error).message)}`
    );
  }
});

/**
 * Get authorization status for a server
 * GET /api/auth/:serverId/status
 */
app.get('/api/auth/:serverId/status', (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const tokens = oauthTokens[serverId];

    if (!tokens) {
      return res.json({
        authorized: false,
        message: 'No authorization found for this server',
      });
    }

    const isExpired = tokens.expiresAt < Date.now();

    res.json({
      authorized: !isExpired,
      expiresAt: new Date(tokens.expiresAt),
      isExpired,
      message: isExpired ? 'Token has expired' : 'Authorized',
    });
  } catch (error) {
    console.error('[OAuth] Error getting status:', error);
    res.status(500).json({
      error: 'Failed to get authorization status',
      message: (error as Error).message,
    });
  }
});

/**
 * Clear authorization for a server
 * POST /api/auth/:serverId/logout
 */
app.post('/api/auth/:serverId/logout', (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    if (oauthTokens[serverId]) {
      delete oauthTokens[serverId];
      console.log('[OAuth] Logged out server:', serverId);
    }

    res.json({
      success: true,
      message: 'Successfully logged out',
    });
  } catch (error) {
    console.error('[OAuth] Error logging out:', error);
    res.status(500).json({
      error: 'Failed to logout',
      message: (error as Error).message,
    });
  }
});

/**
 * Get OAuth login URL for a server
 * POST /api/auth/:serverId/login-url
 */
app.post('/api/auth/:serverId/login-url', (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const serverUrl = Buffer.from(serverId, 'base64').toString('utf-8');

    console.log('[OAuth] Getting login URL for server:', serverUrl);

    // For Zerodha
    if (serverUrl.includes('kite') || serverUrl.includes('zerodha')) {
      const apiKey = process.env.ZERODHA_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          error: 'Zerodha API key not configured',
          message: 'Set ZERODHA_API_KEY environment variable',
        });
      }

      const redirectUrl =
        process.env.ZERODHA_REDIRECT_URL || `http://localhost:${port}/api/auth/zerodha/callback`;
      const loginUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3`;

      return res.json({
        serverType: 'zerodha',
        loginUrl,
        redirectUrl,
        message: 'Redirect user to loginUrl for authentication',
      });
    }

    res.status(400).json({
      error: 'Unknown server type',
      message: `No authentication handler for ${serverUrl}`,
    });
  } catch (error) {
    console.error('[OAuth] Error getting login URL:', error);
    res.status(500).json({
      error: 'Failed to get login URL',
      message: (error as Error).message,
    });
  }
});

// Error handling
app.use((err: any, req: Request, res: Response) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(port, () => {
  console.log(`
╔════════════════════════════════════════╗
║     MCP Bridge Server Started          ║
╠════════════════════════════════════════╣
║  Server: http://localhost:${port}${' '.repeat(String(port).length - 1)}       ║
║  Health: http://localhost:${port}/health${' '.repeat(String(port).length - 10)}║
║                                        ║
║  Ready to bridge MCP servers!          ║
╚════════════════════════════════════════╝
  `);
});

export default app;
