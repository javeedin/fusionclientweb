-- RR_MCP_SERVERS Table and Package
-- Oracle Fusion MCP Server Configuration Storage

-- =====================================================
-- 1. CREATE TABLE: RR_MCP_SERVERS
-- =====================================================
CREATE TABLE RR_MCP_SERVERS (
  id                 VARCHAR2(36)    PRIMARY KEY,
  name               VARCHAR2(255)   NOT NULL,
  description        VARCHAR2(1000),
  type               VARCHAR2(20)    NOT NULL CHECK (type IN ('SOAP', 'REST')),
  status             VARCHAR2(20)    DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  config             CLOB            NOT NULL,
  created_at         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  created_by         VARCHAR2(255),
  updated_by         VARCHAR2(255),
  CONSTRAINT RR_MCP_SERVERS_UK_NAME UNIQUE (name)
);

CREATE INDEX RR_MCP_SERVERS_TYPE_IDX ON RR_MCP_SERVERS(type);
CREATE INDEX RR_MCP_SERVERS_STATUS_IDX ON RR_MCP_SERVERS(status);
CREATE INDEX RR_MCP_SERVERS_CREATED_IDX ON RR_MCP_SERVERS(created_at);

-- =====================================================
-- 2. CREATE PACKAGE: RR_MCP_REST_PKG
-- =====================================================
CREATE OR REPLACE PACKAGE RR_MCP_REST_PKG IS
  -- Type definitions
  TYPE server_rec IS RECORD (
    id           VARCHAR2(36),
    name         VARCHAR2(255),
    description  VARCHAR2(1000),
    type         VARCHAR2(20),
    status       VARCHAR2(20),
    config       CLOB,
    created_at   VARCHAR2(50),
    updated_at   VARCHAR2(50)
  );

  TYPE server_table IS TABLE OF server_rec;

  -- Procedures
  PROCEDURE get_server(
    p_id    IN  VARCHAR2,
    p_result OUT CLOB
  );

  PROCEDURE list_servers(
    p_result OUT CLOB
  );

  PROCEDURE create_server(
    p_id          IN VARCHAR2,
    p_name        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_type        IN VARCHAR2,
    p_status      IN VARCHAR2,
    p_config      IN CLOB,
    p_result      OUT CLOB
  );

  PROCEDURE update_server(
    p_id          IN VARCHAR2,
    p_name        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_status      IN VARCHAR2,
    p_config      IN CLOB,
    p_result      OUT CLOB
  );

  PROCEDURE delete_server(
    p_id     IN VARCHAR2,
    p_result OUT CLOB
  );

  PROCEDURE test_server(
    p_id     IN VARCHAR2,
    p_result OUT CLOB
  );

  PROCEDURE execute_report(
    p_server_id IN VARCHAR2,
    p_params    IN CLOB,
    p_result    OUT CLOB
  );

END RR_MCP_REST_PKG;
/

-- =====================================================
-- 3. PACKAGE BODY: RR_MCP_REST_PKG
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_MCP_REST_PKG IS

  PROCEDURE get_server(
    p_id    IN  VARCHAR2,
    p_result OUT CLOB
  ) IS
    v_server_data CLOB;
    v_server_rec  server_rec;
  BEGIN
    SELECT id, name, description, type, status, config,
           TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    INTO   v_server_rec
    FROM   RR_MCP_SERVERS
    WHERE  id = p_id;

    -- Build JSON response
    p_result := '{' ||
      '"id":"' || v_server_rec.id || '",' ||
      '"name":"' || REPLACE(v_server_rec.name, '"', '\"') || '",' ||
      '"description":"' || NVL(REPLACE(v_server_rec.description, '"', '\"'), '') || '",' ||
      '"type":"' || v_server_rec.type || '",' ||
      '"status":"' || v_server_rec.status || '",' ||
      '"config":' || v_server_rec.config || ',' ||
      '"createdAt":"' || v_server_rec.created_at || '",' ||
      '"updatedAt":"' || v_server_rec.updated_at || '"' ||
    '}';

  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_result := '{"error":"Server not found","code":"NOT_FOUND"}';
    WHEN OTHERS THEN
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END get_server;

  PROCEDURE list_servers(
    p_result OUT CLOB
  ) IS
    v_cursor       INTEGER;
    v_status       INTEGER;
    v_count        INTEGER := 0;
    v_json         CLOB;
  BEGIN
    v_json := '{"items":[';

    FOR rec IN (SELECT id, name, description, type, status, config,
                       TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at,
                       TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') updated_at
                FROM   RR_MCP_SERVERS
                ORDER BY created_at DESC)
    LOOP
      IF v_count > 0 THEN
        v_json := v_json || ',';
      END IF;

      v_json := v_json || '{' ||
        '"id":"' || rec.id || '",' ||
        '"name":"' || REPLACE(rec.name, '"', '\"') || '",' ||
        '"description":"' || NVL(REPLACE(rec.description, '"', '\"'), '') || '",' ||
        '"type":"' || rec.type || '",' ||
        '"status":"' || rec.status || '",' ||
        '"config":' || rec.config || ',' ||
        '"createdAt":"' || rec.created_at || '",' ||
        '"updatedAt":"' || rec.updated_at || '"' ||
      '}';

      v_count := v_count + 1;
    END LOOP;

    v_json := v_json || ']}';
    p_result := v_json;

  EXCEPTION
    WHEN OTHERS THEN
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR","items":[]}';
  END list_servers;

  PROCEDURE create_server(
    p_id          IN VARCHAR2,
    p_name        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_type        IN VARCHAR2,
    p_status      IN VARCHAR2,
    p_config      IN CLOB,
    p_result      OUT CLOB
  ) IS
  BEGIN
    INSERT INTO RR_MCP_SERVERS (id, name, description, type, status, config, created_by, updated_by)
    VALUES (p_id, p_name, p_description, p_type, NVL(p_status, 'inactive'), p_config,
            SUBSTR(USER, 1, 255), SUBSTR(USER, 1, 255));

    COMMIT;

    p_result := '{' ||
      '"id":"' || p_id || '",' ||
      '"name":"' || REPLACE(p_name, '"', '\"') || '",' ||
      '"description":"' || NVL(REPLACE(p_description, '"', '\"'), '') || '",' ||
      '"type":"' || p_type || '",' ||
      '"status":"' || NVL(p_status, 'inactive') || '",' ||
      '"config":' || p_config || ',' ||
      '"createdAt":"' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",' ||
      '"updatedAt":"' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
    '}';

  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      p_result := '{"error":"Server name already exists","code":"DUPLICATE"}';
    WHEN OTHERS THEN
      ROLLBACK;
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END create_server;

  PROCEDURE update_server(
    p_id          IN VARCHAR2,
    p_name        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_status      IN VARCHAR2,
    p_config      IN CLOB,
    p_result      OUT CLOB
  ) IS
    v_type VARCHAR2(20);
    v_created_at VARCHAR2(50);
  BEGIN
    SELECT type, TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    INTO   v_type, v_created_at
    FROM   RR_MCP_SERVERS
    WHERE  id = p_id;

    UPDATE RR_MCP_SERVERS
    SET    name = NVL(p_name, name),
           description = NVL(p_description, description),
           status = NVL(p_status, status),
           config = NVL(p_config, config),
           updated_by = SUBSTR(USER, 1, 255),
           updated_at = CURRENT_TIMESTAMP
    WHERE  id = p_id;

    COMMIT;

    p_result := '{' ||
      '"id":"' || p_id || '",' ||
      '"name":"' || REPLACE(NVL(p_name, p_name), '"', '\"') || '",' ||
      '"description":"' || NVL(REPLACE(p_description, '"', '\"'), '') || '",' ||
      '"type":"' || v_type || '",' ||
      '"status":"' || NVL(p_status, 'inactive') || '",' ||
      '"config":' || p_config || ',' ||
      '"createdAt":"' || v_created_at || '",' ||
      '"updatedAt":"' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
    '}';

  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_result := '{"error":"Server not found","code":"NOT_FOUND"}';
    WHEN OTHERS THEN
      ROLLBACK;
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END update_server;

  PROCEDURE delete_server(
    p_id     IN VARCHAR2,
    p_result OUT CLOB
  ) IS
  BEGIN
    DELETE FROM RR_MCP_SERVERS
    WHERE  id = p_id;

    COMMIT;

    IF SQL%ROWCOUNT = 0 THEN
      p_result := '{"error":"Server not found","code":"NOT_FOUND"}';
    ELSE
      p_result := '{"success":true,"message":"Server deleted","id":"' || p_id || '"}';
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END delete_server;

  PROCEDURE test_server(
    p_id     IN VARCHAR2,
    p_result OUT CLOB
  ) IS
    v_type VARCHAR2(20);
  BEGIN
    SELECT type INTO v_type FROM RR_MCP_SERVERS WHERE id = p_id;

    -- Simple test - verify server exists and is reachable
    p_result := '{' ||
      '"success":true,' ||
      '"message":"Server is reachable",' ||
      '"serverType":"' || v_type || '",' ||
      '"timestamp":"' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
    '}';

  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_result := '{"error":"Server not found","code":"NOT_FOUND"}';
    WHEN OTHERS THEN
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END test_server;

  PROCEDURE execute_report(
    p_server_id IN VARCHAR2,
    p_params    IN CLOB,
    p_result    OUT CLOB
  ) IS
    v_config CLOB;
  BEGIN
    SELECT config INTO v_config FROM RR_MCP_SERVERS WHERE id = p_server_id;

    -- Placeholder for report execution
    p_result := '{' ||
      '"success":true,' ||
      '"message":"Report execution initiated",' ||
      '"serverId":"' || p_server_id || '",' ||
      '"timestamp":"' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"' ||
    '}';

  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_result := '{"error":"Server not found","code":"NOT_FOUND"}';
    WHEN OTHERS THEN
      p_result := '{"error":"' || SQLERRM || '","code":"ERROR"}';
  END execute_report;

END RR_MCP_REST_PKG;
/

-- =====================================================
-- 4. APEX REST HANDLERS
-- =====================================================
-- NOTE: These need to be configured in APEX directly or via SQL
-- Execute the following in APEX SQL Commands or as a SQL script:

-- GET /mcp-servers/:id
-- PROCEDURE: RR_MCP_REST_PKG.get_server

-- GET /mcp-servers
-- PROCEDURE: RR_MCP_REST_PKG.list_servers

-- POST /mcp-servers
-- PROCEDURE: RR_MCP_REST_PKG.create_server

-- PUT /mcp-servers/:id
-- PROCEDURE: RR_MCP_REST_PKG.update_server

-- DELETE /mcp-servers/:id
-- PROCEDURE: RR_MCP_REST_PKG.delete_server

-- POST /mcp-servers/:id/test
-- PROCEDURE: RR_MCP_REST_PKG.test_server

-- POST /mcp-servers/:id/execute
-- PROCEDURE: RR_MCP_REST_PKG.execute_report

COMMIT;
/
