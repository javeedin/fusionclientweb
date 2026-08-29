-- ============================================================
-- RR_WEBSERVICES / RR_WEBSERVICE_PARAMS — ORDS endpoint catalog
--
-- Catalog of every REST endpoint defined in the APEX/ORDS
-- 'reerp' module together with its parameters, used by the
-- Report Designer's Data Source picker so users choose a web
-- service from a list instead of typing paths.
--
-- No manual inserts are needed: ORDS already stores its full
-- metadata in the USER_ORDS_* dictionary views —
--     USER_ORDS_MODULES     (modules, base paths)
--     USER_ORDS_TEMPLATES   (URI patterns)
--     USER_ORDS_HANDLERS    (GET/POST/... handlers + source)
--     USER_ORDS_PARAMETERS  (explicitly defined parameters)
-- RR_REFRESH_WEBSERVICES snapshots those views into the RR_
-- tables, and additionally scans each handler's SQL/PLSQL
-- source for :bind_variables that were never registered with
-- ORDS.DEFINE_PARAMETER (ORDS auto-binds URI query parameters
-- for SQL sources, so these are real, usable parameters too).
--
-- ORDS endpoints (module: reerp):
--   GET  reports/webservices          list endpoints + parameters
--   POST reports/webservices/refresh  re-scan the ORDS dictionary
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================
CREATE TABLE RR_WEBSERVICES (
    ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    MODULE_NAME  VARCHAR2(200)  NOT NULL,      -- ORDS module (reerp)
    URI_PREFIX   VARCHAR2(200),                -- module base path
    PATTERN      VARCHAR2(500)  NOT NULL,      -- template URI pattern, e.g. gl/fiscalperiods or reports/designer/:id
    METHOD       VARCHAR2(10)   NOT NULL,      -- GET / POST / PUT / DELETE
    SOURCE_TYPE  VARCHAR2(50),                 -- json/collection, plsql/block, ...
    COMMENTS     VARCHAR2(1000),               -- handler or template comments
    SYNC_DATE    TIMESTAMP      DEFAULT SYSTIMESTAMP,
    CONSTRAINT RR_WS_UK UNIQUE (MODULE_NAME, PATTERN, METHOD)
);

CREATE TABLE RR_WEBSERVICE_PARAMS (
    ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    WS_ID        NUMBER         NOT NULL REFERENCES RR_WEBSERVICES (ID) ON DELETE CASCADE,
    NAME         VARCHAR2(200)  NOT NULL,      -- parameter name as passed by the caller
    BIND_NAME    VARCHAR2(200),                -- bind variable inside the handler source
    SOURCE_TYPE  VARCHAR2(20),                 -- URI / HEADER / RESPONSE
    PARAM_TYPE   VARCHAR2(20),                 -- STRING / INT / DOUBLE / ...
    ACCESS_METHOD VARCHAR2(10),                -- IN / OUT / INOUT
    ORIGIN       VARCHAR2(10)   DEFAULT 'DEFINED',  -- DEFINED (ORDS.DEFINE_PARAMETER) | BIND (found in source) | URITPL (:x in pattern)
    COMMENTS     VARCHAR2(1000),
    CONSTRAINT RR_WSP_UK UNIQUE (WS_ID, NAME)
);

COMMENT ON TABLE RR_WEBSERVICES        IS 'Snapshot of ORDS reerp module endpoints (from USER_ORDS_* views) for the Report Designer data source picker';
COMMENT ON TABLE RR_WEBSERVICE_PARAMS  IS 'Parameters per endpoint: ORDS-defined, source bind variables, and URI template parameters';


-- ============================================================
-- 2. REFRESH PROCEDURE — populate from the ORDS dictionary
-- ============================================================
CREATE OR REPLACE PROCEDURE RR_REFRESH_WEBSERVICES (
    p_module    IN  VARCHAR2 DEFAULT 'reerp',
    p_services  OUT NUMBER,
    p_params    OUT NUMBER
) AS
    l_ws_id    NUMBER;
    l_name     VARCHAR2(200);
    l_pos      NUMBER;
    l_cnt      NUMBER;
    -- binds implicitly provided by ORDS / config — not user parameters
    FUNCTION is_reserved (p_name IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN UPPER(p_name) IN (
            'BODY', 'BODY_TEXT', 'CONTENT_TYPE', 'STATUS_CODE',
            'FORWARD_LOCATION', 'CURRENT_USER', 'FUSION_BASE_URL',
            'PAGE_OFFSET', 'PAGE_SIZE', 'ROW_COUNT'
        );
    END is_reserved;
BEGIN
    p_services := 0;
    p_params   := 0;

    DELETE FROM RR_WEBSERVICES WHERE MODULE_NAME = p_module;  -- params cascade

    FOR h IN (
        SELECT m.name          AS module_name,
               m.uri_prefix    AS uri_prefix,
               t.uri_template  AS pattern,
               t.comments      AS template_comments,
               h.id            AS handler_id,
               h.method        AS method,
               h.source_type   AS source_type,
               h.comments      AS handler_comments,
               h.source        AS source
        FROM   user_ords_modules   m
        JOIN   user_ords_templates t ON t.module_id = m.id
        JOIN   user_ords_handlers  h ON h.template_id = t.id
        WHERE  LOWER(m.name) = LOWER(p_module)
    ) LOOP
        INSERT INTO RR_WEBSERVICES (MODULE_NAME, URI_PREFIX, PATTERN, METHOD, SOURCE_TYPE, COMMENTS)
        VALUES (h.module_name, h.uri_prefix, h.pattern, h.method, h.source_type,
                SUBSTR(NVL(h.handler_comments, h.template_comments), 1, 1000))
        RETURNING ID INTO l_ws_id;
        p_services := p_services + 1;

        -- 2a. Parameters explicitly registered with ORDS.DEFINE_PARAMETER
        FOR p IN (
            SELECT p.name, p.bind_variable_name, p.source_type, p.param_type,
                   p.access_method, p.comments
            FROM   user_ords_parameters p
            WHERE  p.handler_id = h.handler_id
        ) LOOP
            BEGIN
                INSERT INTO RR_WEBSERVICE_PARAMS
                    (WS_ID, NAME, BIND_NAME, SOURCE_TYPE, PARAM_TYPE, ACCESS_METHOD, ORIGIN, COMMENTS)
                VALUES
                    (l_ws_id, p.name, p.bind_variable_name, p.source_type, p.param_type,
                     p.access_method, 'DEFINED', SUBSTR(p.comments, 1, 1000));
                p_params := p_params + 1;
            EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;
            END;
        END LOOP;

        -- 2b. URI template parameters (:id in the pattern itself)
        l_pos := 1;
        LOOP
            l_name := REGEXP_SUBSTR(h.pattern, ':([A-Za-z_][A-Za-z0-9_]*)', 1, l_pos, NULL, 1);
            EXIT WHEN l_name IS NULL;
            BEGIN
                INSERT INTO RR_WEBSERVICE_PARAMS
                    (WS_ID, NAME, BIND_NAME, SOURCE_TYPE, PARAM_TYPE, ACCESS_METHOD, ORIGIN)
                VALUES
                    (l_ws_id, l_name, l_name, 'URI', 'STRING', 'IN', 'URITPL');
                p_params := p_params + 1;
            EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;
            END;
            l_pos := l_pos + 1;
        END LOOP;

        -- 2c. Bind variables used inside the handler source but never
        --     registered (ORDS auto-binds matching URI query parameters
        --     for SQL sources). Skip reserved ORDS binds.
        IF h.source IS NOT NULL THEN
            l_cnt := REGEXP_COUNT(h.source, ':([A-Za-z_][A-Za-z0-9_]*)');
            FOR i IN 1 .. LEAST(NVL(l_cnt, 0), 200) LOOP
                l_name := REGEXP_SUBSTR(h.source, ':([A-Za-z_][A-Za-z0-9_]*)', 1, i, NULL, 1);
                IF l_name IS NOT NULL AND NOT is_reserved(l_name) THEN
                    BEGIN
                        INSERT INTO RR_WEBSERVICE_PARAMS
                            (WS_ID, NAME, BIND_NAME, SOURCE_TYPE, PARAM_TYPE, ACCESS_METHOD, ORIGIN)
                        VALUES
                            (l_ws_id, l_name, l_name, 'URI', 'STRING', 'IN', 'BIND');
                        p_params := p_params + 1;
                    EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;  -- already DEFINED/URITPL/BIND
                    END;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    COMMIT;
END RR_REFRESH_WEBSERVICES;
/


-- ============================================================
-- 3. ORDS ENDPOINTS
-- ============================================================

-- Template: reports/webservices  (list catalog)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'reports/webservices',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'List catalogued reerp web services with their parameters'
    );

    -- ── GET: list endpoints with parameters nested as JSON ───────────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/webservices',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 1000,
        p_mimes_allowed  => NULL,
        p_comments       => 'Endpoint catalog for the Report Designer data source picker',
        p_source         => q'[
SELECT
    w.ID          AS "id",
    w.MODULE_NAME AS "module_name",
    w.PATTERN     AS "pattern",
    w.METHOD      AS "method",
    w.SOURCE_TYPE AS "source_type",
    w.COMMENTS    AS "comments",
    TO_CHAR(w.SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "sync_date",
    NVL((SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'name'          VALUE p.NAME,
                        'bind_name'     VALUE p.BIND_NAME,
                        'source_type'   VALUE p.SOURCE_TYPE,
                        'param_type'    VALUE p.PARAM_TYPE,
                        'access_method' VALUE p.ACCESS_METHOD,
                        'origin'        VALUE p.ORIGIN,
                        'comments'      VALUE p.COMMENTS
                    )
                    ORDER BY p.ORIGIN, p.NAME
                    RETURNING CLOB)
         FROM RR_WEBSERVICE_PARAMS p
         WHERE p.WS_ID = w.ID
           AND NVL(p.ACCESS_METHOD, 'IN') <> 'OUT'), '[]') AS "params"
FROM RR_WEBSERVICES w
WHERE (:method IS NULL OR w.METHOD = UPPER(:method))
ORDER BY w.PATTERN, w.METHOD
]'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name => 'reerp', p_pattern => 'reports/webservices', p_method => 'GET',
        p_name => 'method', p_bind_variable_name => 'method',
        p_source_type => 'URI', p_param_type => 'STRING', p_access_method => 'IN',
        p_comments => 'Filter by HTTP method (default: all)');

    COMMIT;
END;
/

-- Template: reports/webservices/refresh  (re-scan the ORDS dictionary)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'reports/webservices/refresh',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Rebuild RR_WEBSERVICES from the USER_ORDS_* dictionary views'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/webservices/refresh',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Refresh the endpoint catalog',
        p_source         => q'[
DECLARE
    l_services NUMBER;
    l_params   NUMBER;
BEGIN
    RR_REFRESH_WEBSERVICES(p_module => 'reerp', p_services => l_services, p_params => l_params);
    :status_code := 200;
    HTP.P('{"success":true,"services":' || l_services || ',"params":' || l_params || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','''') || '"}');
END;
]'
    );

    COMMIT;
END;
/


-- ============================================================
-- 4. INITIAL LOAD — populate the catalog now
-- ============================================================
DECLARE
    l_services NUMBER;
    l_params   NUMBER;
BEGIN
    RR_REFRESH_WEBSERVICES(p_module => 'reerp', p_services => l_services, p_params => l_params);
    DBMS_OUTPUT.PUT_LINE('RR_WEBSERVICES loaded: ' || l_services || ' endpoints, ' || l_params || ' parameters');
END;
/


-- ============================================================
-- NOTES
-- ============================================================
-- 1. Ad-hoc queries to inspect what ORDS has defined (this is
--    where the catalog comes from — no manual inserts needed):
--
--    SELECT m.name module_name, t.uri_template, h.method, h.source_type
--    FROM   user_ords_modules m
--    JOIN   user_ords_templates t ON t.module_id = m.id
--    JOIN   user_ords_handlers  h ON h.template_id = t.id
--    WHERE  m.name = 'reerp'
--    ORDER  BY t.uri_template, h.method;
--
--    SELECT t.uri_template, h.method, p.name, p.bind_variable_name,
--           p.source_type, p.param_type, p.access_method
--    FROM   user_ords_modules m
--    JOIN   user_ords_templates  t ON t.module_id  = m.id
--    JOIN   user_ords_handlers   h ON h.template_id = t.id
--    JOIN   user_ords_parameters p ON p.handler_id  = h.id
--    WHERE  m.name = 'reerp'
--    ORDER  BY t.uri_template, h.method, p.name;
--
-- 2. After adding new ORDS endpoints, refresh the catalog with
--    POST /reerp/reports/webservices/refresh (the Report
--    Designer's data source drawer has a Rescan button), or run
--    EXEC RR_REFRESH_WEBSERVICES('reerp', :a, :b);
--
-- 3. Parameter ORIGIN meaning:
--      DEFINED — registered via ORDS.DEFINE_PARAMETER
--      URITPL  — :name inside the URI template (path parameter)
--      BIND    — :bind found in the handler source; ORDS auto-binds
--                a matching URI query parameter for SQL sources
-- ============================================================
