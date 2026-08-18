# Oracle APEX ORDS Configuration Guide for MCP Server Manager

## Overview
This guide explains how to configure Oracle REST Data Services (ORDS) endpoints for the MCP Server Manager using the RR_MCP_REST_PKG procedures.

## Prerequisites
- Oracle APEX 19.1 or later
- Oracle ORDS 20.1 or later
- RR_MCP_REST_PKG and RR_MCP_SERVERS table already created
- Database user with ORDS module creation privileges

---

## Method 1: APEX Application Builder (Easiest)

### Step 1: Navigate to REST Modules

1. Open your APEX application in **Application Builder**
2. Click **Shared Components** (or workspace-level if creating shared endpoints)
3. Under **REST Data Sources**, click **Modules**
4. Click **Create** or **Create Module**

### Step 2: Create MCP Servers Module

Fill in these fields:
```
Module Name:        mcp-servers
Base Path:          /mcp-servers/
Requires Secure Gateway: No (or Yes if needed)
```
Click **Create Module**

### Step 3: Create Handler 1 - List Servers

**URI Pattern:** `list`
**HTTP Method:** `GET`
**Source Type:** `PL/SQL`

Click the module, then **Create Handler**

**Settings:**
- URI Pattern: `list`
- HTTP Method: `GET` 
- Source Type: `PL/SQL`

**PL/SQL Source:**
```plsql
DECLARE
    v_result VARCHAR2(32767);
BEGIN
    RR_MCP_REST_PKG.list_servers(v_result);
    HTP.print(v_result);
END;
```

Click **Create Handler**

### Step 4: Create Handler 2 - Get Single Server

**URI Pattern:** `get`

**PL/SQL Source:**
```plsql
DECLARE
    v_result VARCHAR2(32767);
    v_id NUMBER;
BEGIN
    -- Get ID from query parameter
    v_id := TO_NUMBER(APEX_UTIL.get_parameter('id'));
    
    RR_MCP_REST_PKG.get_server(v_id, v_result);
    HTP.print(v_result);
EXCEPTION WHEN OTHERS THEN
    HTP.print('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

### Step 5: Create Handler 3 - Manage Server

**URI Pattern:** `manage`
**HTTP Method:** `POST`

**PL/SQL Source:**
```plsql
DECLARE
    v_result VARCHAR2(32767);
    v_body CLOB;
    v_action VARCHAR2(50);
    v_server_id NUMBER;
    v_server_name VARCHAR2(255);
    v_description VARCHAR2(1000);
    v_server_type VARCHAR2(20);
    v_config_json CLOB;
BEGIN
    -- Read request body
    IF APEX_APPLICATION.g_clob_01 IS NOT NULL THEN
        v_body := APEX_APPLICATION.g_clob_01;
    ELSIF OWA_UTIL.get_cgi_env('CONTENT_LENGTH') IS NOT NULL THEN
        v_body := APEX_WEB_SERVICE.read_response_clob;
    END IF;
    
    -- For simple JSON parsing without Oracle 19c native functions:
    -- Use APEX_JSON package (built-in to APEX)
    v_action := APEX_JSON.get_varchar2(p_path => 'action');
    v_server_id := APEX_JSON.get_number(p_path => 'server_id');
    v_server_name := APEX_JSON.get_varchar2(p_path => 'server_name');
    v_description := APEX_JSON.get_varchar2(p_path => 'description');
    v_server_type := APEX_JSON.get_varchar2(p_path => 'type');
    v_config_json := APEX_JSON.get_clob(p_path => 'config_json');
    
    -- Call the management procedure
    RR_MCP_REST_PKG.manage_server(
        p_action => v_action,
        p_server_id => v_server_id,
        p_server_name => v_server_name,
        p_description => v_description,
        p_type => v_server_type,
        p_config_json => v_config_json,
        p_result => v_result
    );
    
    HTP.print(v_result);
EXCEPTION WHEN OTHERS THEN
    HTP.print('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

---

## Method 2: SQL/SQLcl Command Line

Execute in your ORDS-enabled database:

```sql
-- Enable ORDS for your schema first (one time)
BEGIN
    ORDS.enable_schema(
        p_schema => 'YOUR_SCHEMA_NAME',
        p_url_mapping_type => 'BASE_PATH'
    );
    COMMIT;
END;
/

-- Create module and handlers
BEGIN
    ORDS.define_module(
        p_module_name => 'mcp-servers',
        p_base_path => '/mcp-servers/',
        p_pattern => 'list',
        p_method => 'GET',
        p_source_type => 'plsql',
        p_source => q'[
            DECLARE
                v_result VARCHAR2(32767);
            BEGIN
                RR_MCP_REST_PKG.list_servers(v_result);
                HTP.print(v_result);
            END;
        ]'
    );
    COMMIT;
END;
/
```

---

## Testing Your Endpoints

### Using cURL

**List all servers:**
```bash
curl -X GET "http://your-apex-url/ords/your-workspace/mcp-servers/list"
```

**Get single server:**
```bash
curl -X GET "http://your-apex-url/ords/your-workspace/mcp-servers/get?id=1"
```

**Create server:**
```bash
curl -X POST "http://your-apex-url/ords/your-workspace/mcp-servers/manage" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "server_name": "My API",
    "description": "Test API Server",
    "type": "REST",
    "config_json": "{\"endpoint\":\"https://api.example.com\",\"method\":\"GET\"}"
  }'
```

**Update server:**
```bash
curl -X POST "http://your-apex-url/ords/your-workspace/mcp-servers/manage" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "server_id": 1,
    "server_name": "Updated API"
  }'
```

**Delete server:**
```bash
curl -X POST "http://your-apex-url/ords/your-workspace/mcp-servers/manage" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "delete",
    "server_id": 1
  }'
```

### Using Postman

1. **Create new Request**
2. **Set Method:** GET or POST
3. **Set URL:** `http://your-apex-url/ords/your-workspace/mcp-servers/[endpoint]`
4. **Headers:**
   - `Content-Type: application/json` (for POST requests)
5. **Body (for POST):**
   ```json
   {
     "action": "create",
     "server_name": "Test Server",
     "type": "REST",
     "config_json": "{...}"
   }
   ```
6. **Click Send**

---

## Endpoint Reference

| Endpoint | Method | Purpose | Parameters |
|----------|--------|---------|------------|
| `/mcp-servers/list` | GET | List all servers | None |
| `/mcp-servers/get` | GET | Get single server | `id` (query param) |
| `/mcp-servers/manage` | POST | Create/Update/Delete | JSON body |

---

## Response Formats

### Success Response (List)
```json
{
  "status": "success",
  "servers": [
    {
      "mcp_server_id": 1,
      "name": "Price List API",
      "type": "REST",
      "status": "active",
      "config": { ... },
      "createdAt": "2026-08-18T12:00:00Z"
    }
  ]
}
```

### Success Response (Create)
```json
{
  "status": "success",
  "mcp_server_id": 1,
  "message": "Server created"
}
```

### Error Response
```json
{
  "status": "error",
  "message": "Error details here"
}
```

---

## Troubleshooting

### Issue: "Module not found"
- Ensure ORDS is properly configured for your schema
- Check that module base path is correct
- Verify workspace allows ORDS access

### Issue: "PL/SQL error"
- Check that RR_MCP_REST_PKG and table exist in your schema
- Review database logs for more details
- Ensure procedures have execute permissions

### Issue: "CORS issues"
- Add CORS headers in APEX REST handler settings
- Or configure ORDS cors settings in ords/conf/apex.xml

### Issue: Large JSON responses timeout
- Check ORDS timeout settings
- Limit number of records returned
- Implement pagination if needed

---

## Integration with Frontend

### JavaScript/Node.js Example
```javascript
// List servers
async function listServers() {
  const response = await fetch('http://apex-url/ords/workspace/mcp-servers/list');
  const data = await response.json();
  console.log(data.servers);
}

// Create server
async function createServer(serverData) {
  const response = await fetch('http://apex-url/ords/workspace/mcp-servers/manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      server_name: serverData.name,
      description: serverData.description,
      type: serverData.type,
      config_json: JSON.stringify(serverData.config)
    })
  });
  return await response.json();
}
```

---

## Security Considerations

1. **Authentication:**
   - Enable APEX authentication for REST endpoints
   - Use OAuth 2.0 if available in your APEX version

2. **Authorization:**
   - Implement role-based access control
   - Validate user permissions in PL/SQL procedures

3. **Input Validation:**
   - Validate JSON input in procedures
   - Use prepared statements (procedures do this)

4. **HTTPS:**
   - Always use HTTPS in production
   - Configure SSL certificates in ORDS

5. **Rate Limiting:**
   - Configure ORDS rate limiting if needed
   - Implement throttling in procedures

---

## Related Files

- `rr_mcp_server_procedures.sql` - Database procedures
- `rr_apex_rest_handlers.sql` - APEX REST package
- `rr_ords_handlers.sql` - ORDS configuration scripts
- `RR_MCP_DATABASE_SETUP_GUIDE.md` - Database setup
