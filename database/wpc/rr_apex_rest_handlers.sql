-- ============================================================
-- RR APEX REST Handlers for MCP Server Management
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

-- Create the package body
CREATE OR REPLACE PACKAGE BODY RR_MCP_REST_PKG AS

    -- List all MCP servers
    PROCEDURE list_servers (
        p_result OUT VARCHAR2
    ) AS
        v_json_array CLOB;
    BEGIN
        SELECT json_arrayagg(
            json_object(
                'mcp_server_id' VALUE mcp_server_id,
                'name' VALUE server_name,
                'description' VALUE description,
                'type' VALUE server_type,
                'status' VALUE status,
                'config' VALUE json_parse(config_json),
                'createdAt' VALUE to_char(created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'updatedAt' VALUE to_char(updated_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
            ORDER BY created_date DESC
        )
        INTO v_json_array
        FROM RR_MCP_SERVERS;

        p_result := json_object(
            'status' VALUE 'success',
            'servers' VALUE json_parse(COALESCE(v_json_array, '[]'))
        ).to_string();

    EXCEPTION WHEN OTHERS THEN
        p_result := json_object(
            'status' VALUE 'error',
            'message' VALUE SQLERRM
        ).to_string();
    END list_servers;

    -- Get single server
    PROCEDURE get_server (
        p_id     IN NUMBER,
        p_result OUT VARCHAR2
    ) AS
        v_config_json CLOB;
        v_server_name VARCHAR2(255);
    BEGIN
        SELECT config_json, server_name
        INTO v_config_json, v_server_name
        FROM RR_MCP_SERVERS
        WHERE mcp_server_id = p_id;

        p_result := json_object(
            'status' VALUE 'success',
            'server' VALUE json_parse(
                json_object(
                    'id' VALUE p_id,
                    'name' VALUE v_server_name,
                    'config' VALUE json_parse(v_config_json)
                ).to_string()
            )
        ).to_string();

    EXCEPTION WHEN NO_DATA_FOUND THEN
        p_result := json_object(
            'status' VALUE 'not_found',
            'message' VALUE 'Server not found'
        ).to_string();
    WHEN OTHERS THEN
        p_result := json_object(
            'status' VALUE 'error',
            'message' VALUE SQLERRM
        ).to_string();
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
    BEGIN
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
                NVL(SYS_CONTEXT('APEX$SESSION', 'APP_USER'), 'ADMIN'),
                NVL(SYS_CONTEXT('APEX$SESSION', 'APP_USER'), 'ADMIN'),
                SYSTIMESTAMP,
                SYSTIMESTAMP
            );

            COMMIT;

            p_result := json_object(
                'status' VALUE 'success',
                'mcp_server_id' VALUE v_new_id,
                'message' VALUE 'Server created'
            ).to_string();

        ELSIF p_action = 'update' THEN
            -- Update existing server
            UPDATE RR_MCP_SERVERS
            SET
                server_name = COALESCE(p_server_name, server_name),
                description = COALESCE(p_description, description),
                server_type = COALESCE(p_type, server_type),
                config_json = COALESCE(p_config_json, config_json),
                updated_date = SYSTIMESTAMP,
                updated_by = NVL(SYS_CONTEXT('APEX$SESSION', 'APP_USER'), 'ADMIN')
            WHERE mcp_server_id = p_server_id;

            IF SQL%ROWCOUNT = 0 THEN
                p_result := json_object(
                    'status' VALUE 'not_found',
                    'message' VALUE 'Server not found'
                ).to_string();
            ELSE
                COMMIT;
                p_result := json_object(
                    'status' VALUE 'success',
                    'message' VALUE 'Server updated'
                ).to_string();
            END IF;

        ELSIF p_action = 'delete' THEN
            -- Delete server
            DELETE FROM RR_MCP_SERVERS
            WHERE mcp_server_id = p_server_id;

            IF SQL%ROWCOUNT = 0 THEN
                p_result := json_object(
                    'status' VALUE 'not_found',
                    'message' VALUE 'Server not found'
                ).to_string();
            ELSE
                COMMIT;
                p_result := json_object(
                    'status' VALUE 'success',
                    'message' VALUE 'Server deleted'
                ).to_string();
            END IF;

        ELSE
            p_result := json_object(
                'status' VALUE 'error',
                'message' VALUE 'Invalid action: ' || p_action
            ).to_string();
        END IF;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_result := json_object(
            'status' VALUE 'error',
            'message' VALUE SQLERRM
        ).to_string();
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
