-- ============================================================
-- RR APEX REST Handlers for MCP Server Management
-- Compatible with Oracle 11g+ (no JSON functions required)
-- ============================================================

-- Create the package specification
CREATE OR REPLACE PACKAGE RR_MCP_REST_PKG AS
    PROCEDURE list_servers (
        p_result OUT VARCHAR2
    );

    PROCEDURE get_server (
        p_id     IN NUMBER,
        p_result OUT VARCHAR2
    );

    PROCEDURE manage_server (
        p_action        IN VARCHAR2,
        p_server_id     IN NUMBER DEFAULT NULL,
        p_server_name   IN VARCHAR2 DEFAULT NULL,
        p_description   IN VARCHAR2 DEFAULT NULL,
        p_type          IN VARCHAR2 DEFAULT NULL,
        p_config_json   IN CLOB DEFAULT NULL,
        p_result        OUT VARCHAR2
    );
END RR_MCP_REST_PKG;
/

-- Helper function to escape JSON string values
CREATE OR REPLACE FUNCTION RR_ESCAPE_JSON_STRING (p_str IN VARCHAR2) RETURN VARCHAR2 AS
BEGIN
    RETURN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p_str, '\', '\\'), '"', '\"'), CHR(10), '\n'), CHR(13), '\r'), CHR(9), '\t');
END RR_ESCAPE_JSON_STRING;
/

-- Create the package body
CREATE OR REPLACE PACKAGE BODY RR_MCP_REST_PKG AS

    -- List all MCP servers
    PROCEDURE list_servers (
        p_result OUT VARCHAR2
    ) AS
        v_json VARCHAR2(32767);
        v_first BOOLEAN := TRUE;
        CURSOR c_servers IS
            SELECT mcp_server_id, server_name, description, server_type, status,
                   config_json, created_date, updated_date
            FROM RR_MCP_SERVERS
            ORDER BY created_date DESC;
    BEGIN
        v_json := '{"status":"success","servers":[';

        FOR rec IN c_servers LOOP
            IF NOT v_first THEN
                v_json := v_json || ',';
            END IF;
            v_first := FALSE;

            v_json := v_json || '{' ||
                '"mcp_server_id":' || rec.mcp_server_id || ',' ||
                '"name":"' || RR_ESCAPE_JSON_STRING(rec.server_name) || '",' ||
                '"description":"' || RR_ESCAPE_JSON_STRING(NVL(rec.description, '')) || '",' ||
                '"type":"' || rec.server_type || '",' ||
                '"status":"' || rec.status || '",' ||
                '"config":' || rec.config_json || ',' ||
                '"createdAt":"' || TO_CHAR(rec.created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
                '"updatedAt":"' || TO_CHAR(rec.updated_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
                '}';
        END LOOP;

        v_json := v_json || ']}';
        p_result := v_json;

    EXCEPTION WHEN OTHERS THEN
        p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END list_servers;

    -- Get single server
    PROCEDURE get_server (
        p_id     IN NUMBER,
        p_result OUT VARCHAR2
    ) AS
        v_config_json CLOB;
        v_server_name VARCHAR2(255);
        v_description VARCHAR2(1000);
        v_type VARCHAR2(20);
        v_status VARCHAR2(20);
        v_created_date TIMESTAMP;
        v_updated_date TIMESTAMP;
        v_json VARCHAR2(32767);
    BEGIN
        SELECT config_json, server_name, description, server_type, status, created_date, updated_date
        INTO v_config_json, v_server_name, v_description, v_type, v_status, v_created_date, v_updated_date
        FROM RR_MCP_SERVERS
        WHERE mcp_server_id = p_id;

        v_json := '{"status":"success","server":{' ||
            '"id":' || p_id || ',' ||
            '"name":"' || RR_ESCAPE_JSON_STRING(v_server_name) || '",' ||
            '"description":"' || RR_ESCAPE_JSON_STRING(NVL(v_description, '')) || '",' ||
            '"type":"' || v_type || '",' ||
            '"status":"' || v_status || '",' ||
            '"config":' || v_config_json || ',' ||
            '"createdAt":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
            '"updatedAt":"' || TO_CHAR(v_updated_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
            '}}';

        p_result := v_json;

    EXCEPTION WHEN NO_DATA_FOUND THEN
        p_result := '{"status":"not_found","message":"Server not found"}';
    WHEN OTHERS THEN
        p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_server;

    -- Manage server (create/update/delete)
    PROCEDURE manage_server (
        p_action        IN VARCHAR2,
        p_server_id     IN NUMBER DEFAULT NULL,
        p_server_name   IN VARCHAR2 DEFAULT NULL,
        p_description   IN VARCHAR2 DEFAULT NULL,
        p_type          IN VARCHAR2 DEFAULT NULL,
        p_config_json   IN CLOB DEFAULT NULL,
        p_result        OUT VARCHAR2
    ) AS
        v_new_id NUMBER;
        v_user_name VARCHAR2(255);
    BEGIN
        -- Get current user
        v_user_name := NVL(SYS_CONTEXT('APEX$SESSION', 'APP_USER'), 'ADMIN');

        IF p_action = 'create' THEN
            -- Create new server
            SELECT RR_MCP_SERVERS_SEQ.NEXTVAL INTO v_new_id FROM DUAL;

            INSERT INTO RR_MCP_SERVERS (
                mcp_server_id, server_name, description, server_type,
                config_json, status, created_by, updated_by, created_date, updated_date
            ) VALUES (
                v_new_id,
                p_server_name,
                p_description,
                p_type,
                p_config_json,
                'active',
                v_user_name,
                v_user_name,
                SYSTIMESTAMP,
                SYSTIMESTAMP
            );

            COMMIT;

            p_result := '{"status":"success","mcp_server_id":' || v_new_id || ',"message":"Server created"}';

        ELSIF p_action = 'update' THEN
            -- Update existing server
            UPDATE RR_MCP_SERVERS
            SET
                server_name = COALESCE(p_server_name, server_name),
                description = COALESCE(p_description, description),
                server_type = COALESCE(p_type, server_type),
                config_json = COALESCE(p_config_json, config_json),
                updated_date = SYSTIMESTAMP,
                updated_by = v_user_name
            WHERE mcp_server_id = p_server_id;

            IF SQL%ROWCOUNT = 0 THEN
                p_result := '{"status":"not_found","message":"Server not found"}';
            ELSE
                COMMIT;
                p_result := '{"status":"success","message":"Server updated"}';
            END IF;

        ELSIF p_action = 'delete' THEN
            -- Delete server
            DELETE FROM RR_MCP_SERVERS
            WHERE mcp_server_id = p_server_id;

            IF SQL%ROWCOUNT = 0 THEN
                p_result := '{"status":"not_found","message":"Server not found"}';
            ELSE
                COMMIT;
                p_result := '{"status":"success","message":"Server deleted"}';
            END IF;

        ELSE
            p_result := '{"status":"error","message":"Invalid action: ' || p_action || '"}';
        END IF;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END manage_server;

END RR_MCP_REST_PKG;
/

-- ============================================================
-- APEX REST Services Configuration
-- ============================================================
-- Add these as REST endpoints in APEX Application Builder:

-- REST Service 1: /mcp-servers/list
-- Handler: Call RR_MCP_REST_PKG.list_servers
-- Method: GET
-- Source Type: PL/SQL

-- REST Service 2: /mcp-servers/get
-- Handler: Call RR_MCP_REST_PKG.get_server with query param 'id'
-- Method: GET
-- Source Type: PL/SQL

-- REST Service 3: /mcp-servers/manage
-- Handler: Call RR_MCP_REST_PKG.manage_server with JSON body parameters
-- Method: POST
-- Source Type: PL/SQL
