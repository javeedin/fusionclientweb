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

import { buildApexUrl } from '../config/api.helper';

// Query MCP servers from APEX database (saved server configs)
const getMcpServersUrl = () => buildApexUrl('mcp-servers');

export const mcpServerService = {
  async listServers(): Promise<MCPServer[]> {
    try {
      const response = await fetch(getMcpServersUrl(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to fetch MCP servers: ${response.statusText}`);
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('Error fetching MCP servers from APEX:', error);
      return [];
    }
  },

  async createServer(payload: MCPServerPayload): Promise<MCPServer> {
    const response = await fetch(getMcpServersUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Failed to create MCP server: ${response.statusText}`);
    return response.json();
  },

  async updateServer(id: string, payload: Partial<MCPServerPayload>): Promise<MCPServer> {
    const response = await fetch(`${getMcpServersUrl()}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Failed to update MCP server: ${response.statusText}`);
    return response.json();
  },

  async deleteServer(id: string): Promise<void> {
    const response = await fetch(`${getMcpServersUrl()}/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Failed to delete MCP server: ${response.statusText}`);
  },

  async testServer(id: string): Promise<any> {
    const response = await fetch(`${getMcpServersUrl()}/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Test failed: ${response.statusText}`);
    return response.json();
  },

  async getServerConfig(id: string): Promise<MCPServer> {
    const response = await fetch(`${getMcpServersUrl()}/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Failed to fetch server config: ${response.statusText}`);
    return response.json();
  },

  async executeReport(serverId: string, params?: Record<string, any>): Promise<any> {
    const response = await fetch(`${getMcpServersUrl()}/${serverId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    if (!response.ok) throw new Error(`Failed to execute report: ${response.statusText}`);
    return response.json();
  },
};
