# MCP Bridge Server

A proper HTTP bridge for MCP (Model Context Protocol) servers. This service implements the MCP client protocol correctly and exposes MCP servers through simple HTTP APIs, making them accessible to web applications.

## Overview

The MCP Bridge acts as an intermediary between web applications and MCP servers:

```
Web App → HTTP API → MCP Bridge → MCP Protocol → MCP Server
```

### What It Does

1. **Connects to MCP servers** using the proper MCP protocol
2. **Discovers available tools** from MCP servers
3. **Executes tools** on behalf of web applications
4. **Exposes tools** through simple HTTP REST endpoints
5. **Manages connections** and caches tool definitions

## Installation

```bash
cd mcp-bridge
npm install
```

## Configuration

Create a `.env` file (optional):

```env
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug
```

## Running the Bridge

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The server will start on `http://localhost:3001`

## API Endpoints

### Health Check
```bash
GET /health
```

Returns server status and connected servers.

### Connect to MCP Server
```bash
POST /api/mcp/connect
Content-Type: application/json

{
  "serverUrl": "https://mcp.kite.trade/mcp"
}
```

**Response:**
```json
{
  "success": true,
  "serverId": "aHR0cHM6Ly9tY3Aua2l0ZS50cmFkZS9tY3A=",
  "serverUrl": "https://mcp.kite.trade/mcp",
  "toolCount": 22,
  "tools": [
    {
      "name": "get_holdings",
      "description": "Get account holdings",
      "inputSchema": { ... }
    }
  ]
}
```

### Get Tools from Server
```bash
GET /api/mcp/servers/:serverId/tools
```

Returns all available tools from a connected MCP server.

### Execute a Tool
```bash
POST /api/mcp/servers/:serverId/execute
Content-Type: application/json

{
  "tool": "get_holdings",
  "input": {
    "account_id": "12345"
  }
}
```

**Response:**
```json
{
  "tool": "get_holdings",
  "input": { "account_id": "12345" },
  "result": {
    "holdings": [ ... ]
  },
  "executedAt": "2024-01-15T10:30:00Z"
}
```

### List Connected Servers
```bash
GET /api/mcp/servers
```

Returns all currently connected MCP servers.

### Disconnect from Server
```bash
POST /api/mcp/disconnect
Content-Type: application/json

{
  "serverId": "aHR0cHM6Ly9tY3Aua2l0ZS50cmFkZS9tY3A="
}
```

## How It Works

### MCP Protocol Support

The bridge supports multiple MCP server types:

1. **HTTP-based MCP servers** - Servers that expose MCP through HTTP endpoints
   - Tries multiple endpoint patterns: `/mcp/tools`, `/tools`, `/api/tools`, `/v1/tools`
   - Supports `/mcp/execute`, `/execute`, `/api/execute` for tool execution

2. **Stdio-based MCP servers** - Servers that use standard input/output
   - Uses `@modelcontextprotocol/sdk` for proper protocol implementation
   - Manages stdio transport and connection lifecycle

### Server ID Format

Server URLs are encoded in base64 to use as `serverId` in URLs:
```javascript
const serverId = Buffer.from(serverUrl).toString('base64');
const serverUrl = Buffer.from(serverId, 'utf-8').toString('utf-8');
```

### Connection Caching

Once connected, MCP servers are cached in memory with their tools. The bridge reuses connections to avoid reconnecting for each request.

## Integration with Autopilot

### Before (Direct Connection)
```typescript
// In Autopilot component - trying to call MCP server directly
fetch(`${serverUrl}/tools`)  // ❌ Doesn't work with real MCP servers
```

### After (Through Bridge)
```typescript
// In Autopilot component - using MCP Bridge
const response = await fetch('http://localhost:3001/api/mcp/connect', {
  method: 'POST',
  body: JSON.stringify({ serverUrl: 'https://mcp.kite.trade/mcp' })
});

// Then use the serverId to call tools
fetch(`http://localhost:3001/api/mcp/servers/${serverId}/execute`, {
  method: 'POST',
  body: JSON.stringify({ tool: 'get_holdings', input: {...} })
});
```

## Troubleshooting

### Server Connection Fails
1. Verify the server URL is correct
2. Check if the server is running and accessible
3. Look at bridge logs for detailed error messages
4. Try connecting through a different protocol (stdio vs HTTP)

### Tools Not Discovered
1. Check if the server exposes tools
2. Verify the endpoint patterns match your server
3. Try connecting with verbose logging:
   ```bash
   DEBUG=* npm run dev
   ```

### Tool Execution Fails
1. Verify tool name is correct
2. Check input schema matches the tool's requirements
3. Check server-side logs for errors
4. Verify authentication if required

## Environment Variables

```env
PORT=3001                  # Server port
NODE_ENV=development       # development or production
LOG_LEVEL=debug           # Logging level
MCP_BRIDGE_TIMEOUT=30000  # Tool execution timeout (ms)
```

## Docker Support

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t mcp-bridge .
docker run -p 3001:3001 mcp-bridge
```

## Security Considerations

⚠️ **Important**: The MCP Bridge executes arbitrary code from MCP servers. Use it only with trusted servers.

### Recommendations

1. **Run on localhost only** in development:
   ```bash
   PORT=3001 npm run dev
   ```

2. **Behind authentication** in production:
   - Add API key validation
   - Implement rate limiting
   - Add request logging and monitoring

3. **Restrict allowed servers**:
   - Whitelist specific server URLs
   - Validate server certificates

4. **Tool execution limits**:
   - Set timeout limits
   - Restrict tool names
   - Monitor resource usage

## Development

### Add MCP Server Types

To support new MCP server types, modify `connectToMcpServer()`:

```typescript
async function connectToMcpServer(serverUrl: string): Promise<Client> {
  // Add new connection type
  if (serverUrl.startsWith('custom://')) {
    return await connectToCustomServer(serverUrl);
  }
  // ...
}
```

### Add Logging

The bridge uses console.log with `[MCP Bridge]` prefix. For production, consider using a logger library like Winston:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});
```

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review bridge logs for error details
3. Verify MCP server is properly configured
4. Test with `curl` commands before integrating

## Related Documentation

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Anthropic MCP SDK](https://github.com/anthropics/modelcontextprotocol)
- [Zerodha MCP Server](https://mcp.kite.trade)
