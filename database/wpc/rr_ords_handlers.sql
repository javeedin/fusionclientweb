-- ============================================================
-- RR ORDS/APEX REST Handlers Configuration
-- Oracle APEX REST Data Services Setup
-- ============================================================

-- This script configures ORDS handlers for MCP Server management
-- Execute in your APEX/ORDS environment

-- ============================================================
-- Method 1: Using ORDS SQL Handler (Recommended for ORDS 20.1+)
-- ============================================================

-- Handler 1: List all MCP Servers
BEGIN
    ORDS.create_restful_service(
        p_module_name     => 'mcp-servers',
        p_base_path       => '/mcp-servers/',
        p_pattern         => 'list',
        p_method          => 'GET',
        p_source_type     => 'plsql',
        p_source          => 'BEGIN RR_MCP_REST_PKG.list_servers(:result); END;',
        p_items_per_page  => 0
    );
END;
/

-- Handler 2: Get single MCP Server by ID
BEGIN
    ORDS.create_restful_service(
        p_module_name     => 'mcp-servers',
        p_base_path       => '/mcp-servers/',
        p_pattern         => 'get',
        p_method          => 'GET',
        p_source_type     => 'plsql',
        p_source          => 'BEGIN RR_MCP_REST_PKG.get_server(:id, :result); END;',
        p_items_per_page  => 0
    );
END;
/

-- Handler 3: Manage Server (Create/Update/Delete)
BEGIN
    ORDS.create_restful_service(
        p_module_name     => 'mcp-servers',
        p_base_path       => '/mcp-servers/',
        p_pattern         => 'manage',
        p_method          => 'POST',
        p_source_type     => 'plsql',
        p_source          => 'BEGIN RR_MCP_REST_PKG.manage_server(:action, :server_id, :server_name, :description, :type, :config_json, :result); END;',
        p_items_per_page  => 0
    );
END;
/

-- ============================================================
-- Method 2: Using APEX REST Modules (Manual Setup in APEX UI)
-- ============================================================
-- If Method 1 fails, use APEX Application Builder:

-- Step 1: Create REST Module
-- Navigate to: Shared Components → REST Modules
-- Create new module with these settings:
--   - Module Name: mcp-servers
--   - Base Path: /mcp-servers/

-- Step 2: Create REST Handlers

-- Handler 2.1: /mcp-servers/list
-- URI Pattern: list
-- HTTP Method: GET
-- Source Type: PL/SQL
-- Source Code:
-- DECLARE
--     v_result VARCHAR2(32767);
-- BEGIN
--     RR_MCP_REST_PKG.list_servers(v_result);
--     HTP.print(v_result);
-- END;
--

-- Handler 2.2: /mcp-servers/get
-- URI Pattern: get
-- HTTP Method: GET
-- Query Parameters: id (NUMBER)
-- Source Type: PL/SQL
-- Source Code:
-- DECLARE
--     v_result VARCHAR2(32767);
--     v_id NUMBER := TO_NUMBER(OWA_UTIL.get_cgi_env('QUERY_STRING'));
-- BEGIN
--     RR_MCP_REST_PKG.get_server(v_id, v_result);
--     HTP.print(v_result);
-- END;
--

-- Handler 2.3: /mcp-servers/manage
-- URI Pattern: manage
-- HTTP Method: POST
-- Source Type: PL/SQL
-- Source Code:
-- DECLARE
--     v_result VARCHAR2(32767);
--     v_body CLOB;
--     v_action VARCHAR2(50);
--     v_server_id NUMBER;
--     v_server_name VARCHAR2(255);
--     v_description VARCHAR2(1000);
--     v_type VARCHAR2(20);
--     v_config_json CLOB;
-- BEGIN
--     -- Read request body
--     v_body := APEX_APPLICATION.g_clob_01;
--
--     -- Parse JSON (or use native JSON parsing if Oracle 19c+)
--     v_action := APEX_JSON.get_varchar2(p_path => 'action');
--     v_server_id := APEX_JSON.get_number(p_path => 'server_id');
--     v_server_name := APEX_JSON.get_varchar2(p_path => 'server_name');
--     v_description := APEX_JSON.get_varchar2(p_path => 'description');
--     v_type := APEX_JSON.get_varchar2(p_path => 'type');
--     v_config_json := APEX_JSON.get_clob(p_path => 'config_json');
--
--     RR_MCP_REST_PKG.manage_server(
--         p_action => v_action,
--         p_server_id => v_server_id,
--         p_server_name => v_server_name,
--         p_description => v_description,
--         p_type => v_type,
--         p_config_json => v_config_json,
--         p_result => v_result
--     );
--
--     HTP.print(v_result);
-- END;
--

-- ============================================================
-- Method 3: Manual ORDS Configuration (sqlcl/SQLPlus)
-- ============================================================

-- Enable ORDS for your schema (if not already enabled):
-- EXEC ords.enable_schema(p_schema => 'YOUR_SCHEMA', p_url_mapping_type => 'BASE_PATH');
-- COMMIT;

-- ============================================================
-- Testing the Endpoints
-- ============================================================

-- Test 1: List all servers
-- GET http://your-apex-url/ords/your-workspace/mcp-servers/list

-- Test 2: Get single server
-- GET http://your-apex-url/ords/your-workspace/mcp-servers/get?id=1

-- Test 3: Create server
-- POST http://your-apex-url/ords/your-workspace/mcp-servers/manage
-- Content-Type: application/json
-- Body:
-- {
--   "action": "create",
--   "server_name": "Test API",
--   "description": "Test REST API",
--   "type": "REST",
--   "config_json": "{\"endpoint\":\"https://api.example.com\",\"method\":\"GET\"}"
-- }

-- Test 4: Update server
-- POST http://your-apex-url/ords/your-workspace/mcp-servers/manage
-- Content-Type: application/json
-- Body:
-- {
--   "action": "update",
--   "server_id": 1,
--   "server_name": "Updated API"
-- }

-- Test 5: Delete server
-- POST http://your-apex-url/ords/your-workspace/mcp-servers/manage
-- Content-Type: application/json
-- Body:
-- {
--   "action": "delete",
--   "server_id": 1
-- }
