# RR MCP Server Manager - Database Setup Guide

## Overview
This guide shows how to set up persistent database storage for the MCP Server Manager using Oracle APEX with RR_ naming convention.

## Important: Oracle Version Compatibility
These SQL procedures are compatible with **Oracle 11g and later**. They use string concatenation for JSON generation instead of native JSON functions, ensuring compatibility with all Oracle versions (no requirement for Oracle 19c+).

The updated procedures:
- Use VARCHAR2/CLOB concatenation to build JSON responses
- Include an RR_ESCAPE_JSON_STRING helper function for proper escaping
- Support all CRUD operations (Create, Read, Update, Delete)

---

## Part 1: Database Table Setup

### 1.1 Create the Table

Execute this SQL in your Oracle database:

```sql
CREATE TABLE RR_MCP_SERVERS (
    mcp_server_id       NUMBER PRIMARY KEY,
    server_name         VARCHAR2(255) NOT NULL,
    description         VARCHAR2(1000),
    server_type         VARCHAR2(20) NOT NULL,  -- 'SOAP' or 'REST'
    config_json         CLOB NOT NULL,           -- Stores all configuration
    status              VARCHAR2(20) DEFAULT 'active',
    created_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by          VARCHAR2(255),
    updated_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_by          VARCHAR2(255),
    CONSTRAINT chk_type CHECK (server_type IN ('SOAP', 'REST')),
    CONSTRAINT chk_status CHECK (status IN ('active', 'inactive'))
);

-- Create sequence for ID generation
CREATE SEQUENCE RR_MCP_SERVERS_SEQ START WITH 1 INCREMENT BY 1;

-- Create index for faster queries
CREATE INDEX RR_MCP_SERVERS_IDX ON RR_MCP_SERVERS(created_date DESC);
```

### 1.2 Table Structure Details

| Column | Type | Description |
|--------|------|-------------|
| mcp_server_id | NUMBER | Primary Key, auto-generated |
| server_name | VARCHAR2(255) | Server display name |
| description | VARCHAR2(1000) | Server description |
| server_type | VARCHAR2(20) | 'SOAP' or 'REST' |
| config_json | CLOB | Complete config as JSON |
| status | VARCHAR2(20) | 'active' or 'inactive' |
| created_date | TIMESTAMP | Creation timestamp |
| created_by | VARCHAR2(255) | User who created |
| updated_date | TIMESTAMP | Last update timestamp |
| updated_by | VARCHAR2(255) | User who updated |

---

## Part 2: PL/SQL Procedures

### 2.1 Create Procedures

Execute all procedures from the `rr_mcp_server_procedures.sql` file:

**Key Procedures:**

- `RR_CREATE_MCP_SERVER` - Insert new server
- `RR_GET_MCP_SERVER` - Retrieve single server
- `RR_LIST_MCP_SERVERS` - List all servers
- `RR_UPDATE_MCP_SERVER` - Update existing server
- `RR_DELETE_MCP_SERVER` - Delete server

### 2.2 Example Procedure Call

```sql
DECLARE
    v_result_id     NUMBER;
    v_result_status VARCHAR2(100);
    v_config        CLOB := '{
        "endpoint": "https://api.example.com/reports",
        "method": "GET",
        "authType": "basic",
        "timeout": 30000
    }';
BEGIN
    RR_CREATE_MCP_SERVER(
        p_server_name    => 'Price List API',
        p_description    => 'REST API for price list',
        p_type           => 'REST',
        p_config_json    => v_config,
        p_created_by     => 'ADMIN',
        p_result_id      => v_result_id,
        p_result_status  => v_result_status
    );
    
    DBMS_OUTPUT.PUT_LINE('Status: ' || v_result_status);
    DBMS_OUTPUT.PUT_LINE('Server ID: ' || v_result_id);
END;
/
```

---

## Part 3: APEX REST Endpoints

### 3.1 Create REST Package

Execute the `rr_apex_rest_handlers.sql` file to create the REST package:

```sql
CREATE OR REPLACE PACKAGE RR_MCP_REST_PKG AS
    PROCEDURE list_servers (p_result OUT VARCHAR2);
    PROCEDURE get_server (p_id IN NUMBER, p_result OUT VARCHAR2);
    PROCEDURE manage_server (
        p_action IN VARCHAR2,
        p_server_id IN NUMBER DEFAULT NULL,
        ...
    );
END RR_MCP_REST_PKG;
```

### 3.2 Configure APEX REST Services

In APEX Application Builder, create 3 REST services:

#### Service 1: List Servers
```
Endpoint: /mcp-servers/list
Method: GET
Handler: PL/SQL (RR_MCP_REST_PKG.list_servers)
Response Format: JSON
```

#### Service 2: Get Single Server
```
Endpoint: /mcp-servers/get
Method: GET
Handler: PL/SQL (RR_MCP_REST_PKG.get_server)
Query Parameters: id (NUMBER)
Response Format: JSON
```

#### Service 3: Manage Server (Create/Update/Delete)
```
Endpoint: /mcp-servers/manage
Method: POST
Handler: PL/SQL (RR_MCP_REST_PKG.manage_server)
Request Body: JSON
Response Format: JSON

Parameters:
- action: 'create' | 'update' | 'delete'
- server_name: VARCHAR2
- description: VARCHAR2
- server_type: 'SOAP' | 'REST'
- config_json: CLOB
```

---

## Part 4: Backend Integration

### 4.1 Proxy.cjs Configuration

The proxy server now makes calls to APEX endpoints:

```javascript
// Example: Create MCP Server
const response = await fetch(`${APEX_CONFIG.baseUrl}/mcp-servers/manage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    server_name: 'My API',
    description: 'My API Server',
    server_type: 'REST',
    config_json: JSON.stringify(config)
  })
});
```

### 4.2 Endpoints in Proxy

```
GET  /api/mcp-servers          → APEX /mcp-servers/list
POST /api/mcp-servers          → APEX /mcp-servers/manage (action: create)
GET  /api/mcp-servers/:id      → APEX /mcp-servers/get (id param)
PUT  /api/mcp-servers/:id      → APEX /mcp-servers/manage (action: update)
DELETE /api/mcp-servers/:id    → APEX /mcp-servers/manage (action: delete)
```

---

## Part 5: Example JSON Configurations

### REST API Configuration
```json
{
  "endpoint": "https://api.example.com/price-list",
  "method": "GET",
  "authType": "bearer",
  "bearerToken": "your-token-here",
  "headers": {
    "X-Custom-Header": "value"
  },
  "timeout": 30000
}
```

### SOAP Configuration
```json
{
  "fusionUrl": "https://efmh-test.fa.em3.oraclecloud.com",
  "bipReportName": "RR_PRICE_LIST",
  "username": "your-username",
  "password": "your-password",
  "timeout": 30000,
  "parameters": {
    "company_id": "123",
    "ledger_id": "456"
  }
}
```

---

## Part 6: API Request/Response Examples

### Create MCP Server

**Request:**
```bash
curl -X POST http://localhost:3001/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Price List API",
    "description": "REST API for price lists",
    "type": "REST",
    "config": {
      "endpoint": "https://api.example.com/reports",
      "method": "GET",
      "authType": "basic",
      "authUsername": "user",
      "authPassword": "pass"
    }
  }'
```

**Response:**
```json
{
  "id": "mcp_1",
  "name": "Price List API",
  "description": "REST API for price lists",
  "type": "REST",
  "status": "active",
  "config": { ... },
  "createdAt": "2026-08-18T12:00:00Z",
  "url": "http://localhost:3001/mcp/mcp_1"
}
```

### List MCP Servers

**Request:**
```bash
curl -X GET http://localhost:3001/api/mcp-servers
```

**Response:**
```json
[
  {
    "id": "mcp_1",
    "name": "Price List API",
    "type": "REST",
    "status": "active",
    "createdAt": "2026-08-18T12:00:00Z",
    ...
  }
]
```

### Update MCP Server

**Request:**
```bash
curl -X PUT http://localhost:3001/api/mcp-servers/mcp_1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Price List",
    "config": { ... }
  }'
```

### Delete MCP Server

**Request:**
```bash
curl -X DELETE http://localhost:3001/api/mcp-servers/mcp_1
```

---

## Part 7: APEX REST Service Setup Steps

### Step-by-Step in APEX Application Builder:

1. **Navigate to:** App Builder → Your App → Shared Components → REST Data Sources

2. **Create New REST Data Source:**
   - Name: `RR_MCP_SERVERS_LIST`
   - URL Template: `https://your-apex-url/ords/your-workspace/mcp-servers/list`
   - HTTP Method: GET

3. **For each REST service:**
   - Configure the endpoint URL
   - Set authentication (if needed)
   - Test the connection
   - Define parameters (for GET with params)

4. **Test the service:**
   - Use REST Data Source Test page
   - Verify JSON response format

---

## Part 8: Naming Convention (RR_)

All database objects follow the `RR_` prefix:

| Object Type | Name |
|------------|------|
| Table | `RR_MCP_SERVERS` |
| Sequence | `RR_MCP_SERVERS_SEQ` |
| Index | `RR_MCP_SERVERS_IDX` |
| Procedures | `RR_CREATE_MCP_SERVER`, `RR_GET_MCP_SERVER`, etc. |
| Package | `RR_MCP_REST_PKG` |
| Package Body | `RR_MCP_REST_PKG` (body) |

---

## Part 9: Security Considerations

### Password Encryption

Consider encrypting sensitive data in the config JSON:

```sql
-- Encrypt password before storing
UPDATE RR_MCP_SERVERS
SET config_json = json_transform(
    config_json,
    SET '$.password' = DBMS_CRYPTO.ENCRYPT(password, ...)
)
WHERE server_type = 'SOAP';
```

### Access Control

Implement APEX security:
- Add authorization scheme to REST endpoints
- Audit all CRUD operations
- Log sensitive operations

### Network Security

- Always use HTTPS for API communications
- Validate SSL certificates
- Use API gateways/firewalls

---

## Part 10: Troubleshooting

### Issue: "Failed to save MCP Server"

**Solutions:**
1. Verify APEX REST endpoint is accessible
2. Check network connectivity
3. Review APEX logs for errors
4. Ensure table exists and sequence is created
5. Check APEX user permissions

### Issue: "Server not found"

**Solutions:**
1. Verify server ID is correct
2. Check if server was actually saved to database
3. Query the table directly: `SELECT * FROM RR_MCP_SERVERS`

### Issue: JSON Config Parsing Error

**Solutions:**
1. Validate JSON before saving
2. Ensure CLOB size is within limits
3. Check character encoding (UTF-8)

---

## Part 11: Deployment Checklist

- [ ] Table created (`RR_MCP_SERVERS`)
- [ ] Sequence created (`RR_MCP_SERVERS_SEQ`)
- [ ] All PL/SQL procedures created (RR_*)
- [ ] APEX REST package created (`RR_MCP_REST_PKG`)
- [ ] 3 APEX REST endpoints configured and tested
- [ ] Proxy.cjs updated with APEX calls
- [ ] Frontend service layer updated
- [ ] MCP Server Manager page accessible
- [ ] Test create/read/update/delete operations
- [ ] Verify data persists after app restart

---

## Next Steps

1. Execute the SQL scripts on your database
2. Configure APEX REST endpoints
3. Test the API calls from Postman/curl
4. Start the application
5. Test the UI workflow
6. Monitor logs for any errors

---

## Files Reference

- **Database Schema & Procedures:** `rr_mcp_server_procedures.sql`
- **APEX REST Handler:** `rr_apex_rest_handlers.sql`
- **Backend Implementation:** `server/proxy.cjs` (updated)
- **Frontend Service:** `src/services/mcp-server.service.ts`
- **Frontend Component:** `src/pages/admin/MCPServerManager.tsx`
