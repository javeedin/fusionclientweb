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
      const url = getMcpServersUrl();
      console.log('[MCP Service] GET', url);
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('[MCP Service] GET Response:', response.status, response.statusText);
      const data = await response.json();
      console.log('[MCP Service] GET Data:', data);
      return data.items || data || [];
    } catch (error) {
      console.error('Error fetching MCP servers from APEX:', error);
      return [];
    }
  },

  async createServer(payload: MCPServerPayload): Promise<MCPServer> {
    const url = getMcpServersUrl();

    // Format payload to match RR_MCP_REST_PKG.manage_server procedure parameters
    const dbPayload = {
      action: 'CREATE',
      server_name: payload.name,
      description: payload.description,
      type: payload.type,
      config_json: JSON.stringify(payload.config),
    };

    console.log('[MCP Service] POST', url);
    console.log('[MCP Service] Payload:', JSON.stringify(dbPayload, null, 2));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload),
      });
      console.log('[MCP Service] POST Response:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data;
      try {
        data = await response.json();
        console.log('[MCP Service] POST Response Body:', data);
      } catch (parseError) {
        console.log('[MCP Service] Response is not JSON, returning success');
        data = { success: true };
      }

      return data;
    } catch (error) {
      console.error('[MCP Service] POST Error:', error);
      throw error;
    }
  },

  async updateServer(id: string, payload: Partial<MCPServerPayload>): Promise<MCPServer> {
    const url = getMcpServersUrl();

    // Format payload to match RR_MCP_REST_PKG.manage_server procedure parameters
    const dbPayload = {
      action: 'UPDATE',
      server_id: id,
      ...(payload.name && { server_name: payload.name }),
      ...(payload.description !== undefined && { description: payload.description }),
      ...(payload.type && { type: payload.type }),
      ...(payload.config && { config_json: JSON.stringify(payload.config) }),
    };

    console.log('[MCP Service] PUT', url);
    console.log('[MCP Service] Update Payload:', JSON.stringify(dbPayload, null, 2));
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload),
      });
      console.log('[MCP Service] PUT Response:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data;
      try {
        data = await response.json();
        console.log('[MCP Service] PUT Response Body:', data);
      } catch (parseError) {
        console.log('[MCP Service] Response is not JSON, returning success');
        data = { success: true };
      }

      return data;
    } catch (error) {
      console.error('[MCP Service] PUT Error:', error);
      throw error;
    }
  },

  async deleteServer(id: string): Promise<void> {
    const url = getMcpServersUrl();

    // Format payload to match RR_MCP_REST_PKG.manage_server procedure parameters
    const dbPayload = {
      action: 'DELETE',
      server_id: id,
    };

    console.log('[MCP Service] DELETE', url);
    console.log('[MCP Service] Delete Payload:', JSON.stringify(dbPayload, null, 2));
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload),
      });
      console.log('[MCP Service] DELETE Response:', response.status, response.statusText);
      if (!response.ok) throw new Error(`Failed to delete MCP server: ${response.statusText}`);
    } catch (error) {
      console.error('[MCP Service] DELETE Error:', error);
      throw error;
    }
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
