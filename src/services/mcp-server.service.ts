export interface MCPServerPayload {
  name: string;
  description: string;
  type: 'SOAP' | 'REST';
  config: Record<string, any>;
}

export interface MCPServer extends MCPServerPayload {
  id: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  url?: string;
}

const API_BASE = 'http://localhost:3001/api';

export const mcpServerService = {
  async listServers(): Promise<MCPServer[]> {
    const response = await fetch(`${API_BASE}/mcp-servers`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Failed to fetch MCP servers: ${response.statusText}`);
    return response.json();
  },

  async createServer(payload: MCPServerPayload): Promise<MCPServer> {
    const response = await fetch(`${API_BASE}/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Failed to create MCP server: ${response.statusText}`);
    return response.json();
  },

  async updateServer(id: string, payload: Partial<MCPServerPayload>): Promise<MCPServer> {
    const response = await fetch(`${API_BASE}/mcp-servers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Failed to update MCP server: ${response.statusText}`);
    return response.json();
  },

  async deleteServer(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/mcp-servers/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Failed to delete MCP server: ${response.statusText}`);
  },

  async testServer(id: string): Promise<any> {
    const response = await fetch(`${API_BASE}/mcp-servers/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Test failed: ${response.statusText}`);
    return response.json();
  },

  async getServerConfig(id: string): Promise<MCPServer> {
    const response = await fetch(`${API_BASE}/mcp-servers/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Failed to fetch server config: ${response.statusText}`);
    return response.json();
  },

  async executeReport(serverId: string, params?: Record<string, any>): Promise<any> {
    const response = await fetch(`${API_BASE}/mcp-servers/${serverId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    if (!response.ok) throw new Error(`Failed to execute report: ${response.statusText}`);
    return response.json();
  },
};
