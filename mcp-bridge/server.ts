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
  client?: Client
): Promise<string> {
  console.log(`[MCP Bridge] Executing tool "${toolName}" on ${serverUrl}`);

  try {
    // For HTTP-based servers
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      return await executeHttpMcpTool(serverUrl, toolName, input);
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
  input: any
): Promise<string> {
  try {
    const baseUrl = serverUrl.replace(/\/$/, '');

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
          headers: { 'Content-Type': 'application/json' },
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

    // Execute tool
    const result = await executeMcpTool(serverUrl, tool, input, connection.client);

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
