-- ============================================================
-- RR MCP Server Management Procedures
-- Compatible with Oracle 11g+ (no JSON functions required)
-- ============================================================

-- Table Creation
CREATE TABLE RR_MCP_SERVERS (
    mcp_server_id       NUMBER PRIMARY KEY,
    server_name         VARCHAR2(255) NOT NULL,
    description         VARCHAR2(1000),
    server_type         VARCHAR2(20) NOT NULL,  -- 'SOAP' or 'REST'
    config_json         CLOB NOT NULL,           -- JSON blob for all config
    status              VARCHAR2(20) DEFAULT 'active',
    created_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by          VARCHAR2(255),
    updated_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_by          VARCHAR2(255),
    CONSTRAINT chk_type CHECK (server_type IN ('SOAP', 'REST')),
    CONSTRAINT chk_status CHECK (status IN ('active', 'inactive'))
);

CREATE SEQUENCE RR_MCP_SERVERS_SEQ START WITH 1 INCREMENT BY 1;
CREATE INDEX RR_MCP_SERVERS_IDX ON RR_MCP_SERVERS(created_date DESC);

-- ============================================================

-- 1. CREATE MCP Server
CREATE OR REPLACE PROCEDURE RR_CREATE_MCP_SERVER (
    p_server_name    IN VARCHAR2,
    p_description    IN VARCHAR2,
    p_type           IN VARCHAR2,
    p_config_json    IN CLOB,
    p_created_by     IN VARCHAR2,
    p_result_id      OUT NUMBER,
    p_result_status  OUT VARCHAR2
) AS
    v_server_id NUMBER;
BEGIN
    -- Generate new ID
    SELECT RR_MCP_SERVERS_SEQ.NEXTVAL INTO v_server_id FROM DUAL;

    -- Insert the server
    INSERT INTO RR_MCP_SERVERS (
        mcp_server_id, server_name, description, server_type,
        config_json, status, created_by, updated_by, created_date, updated_date
    ) VALUES (
        v_server_id, p_server_name, p_description, p_type,
        p_config_json, 'active', p_created_by, p_created_by, SYSTIMESTAMP, SYSTIMESTAMP
    );

    COMMIT;

    p_result_id := v_server_id;
    p_result_status := 'success';

EXCEPTION WHEN OTHERS THEN
    p_result_status := 'error: ' || SQLERRM;
    ROLLBACK;
END RR_CREATE_MCP_SERVER;
/

-- 2. GET MCP Server by ID
-- Returns JSON as string using concatenation (Oracle 11g+ compatible)
CREATE OR REPLACE PROCEDURE RR_GET_MCP_SERVER (
    p_server_id      IN NUMBER,
    p_result_json    OUT CLOB,
    p_result_status  OUT VARCHAR2
) AS
    v_json CLOB;
    v_server_name VARCHAR2(255);
    v_description VARCHAR2(1000);
    v_type VARCHAR2(20);
    v_status VARCHAR2(20);
    v_config_json CLOB;
    v_created_date TIMESTAMP;
    v_updated_date TIMESTAMP;
    v_created_by VARCHAR2(255);
BEGIN
    SELECT
        server_name, description, server_type, status, config_json,
        created_date, updated_date, created_by
    INTO
        v_server_name, v_description, v_type, v_status, v_config_json,
        v_created_date, v_updated_date, v_created_by
    FROM RR_MCP_SERVERS
    WHERE mcp_server_id = p_server_id;

    -- Build JSON using string concatenation
    v_json := '{' ||
        '"id":' || p_server_id || ',' ||
        '"name":"' || REPLACE(REPLACE(v_server_name, '\', '\\'), '"', '\"') || '",' ||
        '"description":"' || REPLACE(REPLACE(NVL(v_description, ''), '\', '\\'), '"', '\"') || '",' ||
        '"type":"' || v_type || '",' ||
        '"status":"' || v_status || '",' ||
        '"config":' || v_config_json || ',' ||
        '"createdAt":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
        '"updatedAt":"' || TO_CHAR(v_updated_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
        '"createdBy":"' || NVL(v_created_by, '') || '"' ||
        '}';

    p_result_json := v_json;
    p_result_status := 'success';

EXCEPTION WHEN NO_DATA_FOUND THEN
    p_result_status := 'not_found';
WHEN OTHERS THEN
    p_result_status := 'error: ' || SQLERRM;
END RR_GET_MCP_SERVER;
/

-- 3. LIST All MCP Servers
-- Returns JSON array as string using concatenation (Oracle 11g+ compatible)
CREATE OR REPLACE PROCEDURE RR_LIST_MCP_SERVERS (
    p_result_json    OUT CLOB,
    p_result_status  OUT VARCHAR2
) AS
    v_json CLOB;
    v_first BOOLEAN := TRUE;
    CURSOR c_servers IS
        SELECT mcp_server_id, server_name, description, server_type, status,
               config_json, created_date, updated_date
        FROM RR_MCP_SERVERS
        ORDER BY created_date DESC;
BEGIN
    v_json := '[';

    FOR rec IN c_servers LOOP
        IF NOT v_first THEN
            v_json := v_json || ',';
        END IF;
        v_first := FALSE;

        v_json := v_json || '{' ||
            '"id":' || rec.mcp_server_id || ',' ||
            '"name":"' || REPLACE(REPLACE(rec.server_name, '\', '\\'), '"', '\"') || '",' ||
            '"description":"' || REPLACE(REPLACE(NVL(rec.description, ''), '\', '\\'), '"', '\"') || '",' ||
            '"type":"' || rec.server_type || '",' ||
            '"status":"' || rec.status || '",' ||
            '"config":' || rec.config_json || ',' ||
            '"createdAt":"' || TO_CHAR(rec.created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
            '"updatedAt":"' || TO_CHAR(rec.updated_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
            '"url":"/mcp/mcp_' || rec.mcp_server_id || '"' ||
            '}';
    END LOOP;

    v_json := v_json || ']';
    p_result_json := v_json;
    p_result_status := 'success';

EXCEPTION WHEN OTHERS THEN
    p_result_status := 'error: ' || SQLERRM;
END RR_LIST_MCP_SERVERS;
/

-- 4. UPDATE MCP Server
CREATE OR REPLACE PROCEDURE RR_UPDATE_MCP_SERVER (
    p_server_id      IN NUMBER,
    p_server_name    IN VARCHAR2,
    p_description    IN VARCHAR2,
    p_type           IN VARCHAR2,
    p_config_json    IN CLOB,
    p_updated_by     IN VARCHAR2,
    p_result_status  OUT VARCHAR2
) AS
BEGIN
    UPDATE RR_MCP_SERVERS
    SET
        server_name = COALESCE(p_server_name, server_name),
        description = COALESCE(p_description, description),
        server_type = COALESCE(p_type, server_type),
        config_json = COALESCE(p_config_json, config_json),
        updated_date = SYSTIMESTAMP,
        updated_by = p_updated_by
    WHERE mcp_server_id = p_server_id;

    IF SQL%ROWCOUNT = 0 THEN
        p_result_status := 'not_found';
    ELSE
        COMMIT;
        p_result_status := 'success';
    END IF;

EXCEPTION WHEN OTHERS THEN
    p_result_status := 'error: ' || SQLERRM;
    ROLLBACK;
END RR_UPDATE_MCP_SERVER;
/

-- 5. DELETE MCP Server
CREATE OR REPLACE PROCEDURE RR_DELETE_MCP_SERVER (
    p_server_id      IN NUMBER,
    p_result_status  OUT VARCHAR2
) AS
BEGIN
    DELETE FROM RR_MCP_SERVERS
    WHERE mcp_server_id = p_server_id;

    IF SQL%ROWCOUNT = 0 THEN
        p_result_status := 'not_found';
    ELSE
        COMMIT;
        p_result_status := 'success';
    END IF;

EXCEPTION WHEN OTHERS THEN
    p_result_status := 'error: ' || SQLERRM;
    ROLLBACK;
END RR_DELETE_MCP_SERVER;
/
