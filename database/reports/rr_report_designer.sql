-- ============================================================
-- RR_REPORTS — Report Designer storage
--
-- Stores user-designed ReportBro report templates for the
-- in-app Report Designer (menu: Reports → Report Designer).
--
-- Each row keeps:
--   * TEMPLATE     — the ReportBro report definition JSON
--                    (docElements, parameters, styles, version,
--                    documentProperties) produced by the designer
--   * DATA_SOURCE  — JSON describing where the report data comes
--                    from at run time (Fusion REST / APEX ORDS /
--                    static sample), including the query template
--                    and user parameters
--
-- The React app fetches the data itself (all data arrives via
-- REST) and sends {template + data} to the ReportBro render
-- service for PDF/XLSX output — the database only stores the
-- report catalog.
--
-- ORDS endpoints (module: reerp):
--   GET    reports/designer          list (summary, filterable)
--   POST   reports/designer          create / update (upsert by id)
--   GET    reports/designer/:id      full report incl. template
--   DELETE reports/designer/:id      delete report
-- ============================================================


-- ============================================================
-- 1. TABLE
-- ============================================================
CREATE TABLE RR_REPORTS (
    ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Display name shown in the report catalog (unique)
    NAME          VARCHAR2(200)  NOT NULL,

    DESCRIPTION   VARCHAR2(1000),

    -- Functional area the report belongs to (GL, AP, AR, SCM, GENERAL, ...)
    MODULE        VARCHAR2(30)   DEFAULT 'GENERAL',

    -- Default output format: pdf | xlsx
    OUTPUT_FORMAT VARCHAR2(10)   DEFAULT 'pdf',

    -- ACTIVE | INACTIVE (inactive reports hidden from run lists)
    STATUS        VARCHAR2(20)   DEFAULT 'ACTIVE',

    -- Data source definition JSON (source type, path, query, params)
    DATA_SOURCE   CLOB,

    -- ReportBro report definition JSON
    TEMPLATE      CLOB,

    CREATED_BY    VARCHAR2(100),
    CREATED_ON    TIMESTAMP      DEFAULT SYSTIMESTAMP,
    UPDATED_BY    VARCHAR2(100),
    UPDATED_ON    TIMESTAMP      DEFAULT SYSTIMESTAMP,

    CONSTRAINT RR_REPORTS_NAME_UK  UNIQUE (NAME),
    CONSTRAINT RR_REPORTS_DS_JSON  CHECK (DATA_SOURCE IS JSON),
    CONSTRAINT RR_REPORTS_TPL_JSON CHECK (TEMPLATE IS JSON)
);

CREATE INDEX RR_REPORTS_MODULE_IDX ON RR_REPORTS (MODULE, STATUS);

COMMENT ON TABLE  RR_REPORTS             IS 'User-designed ReportBro report templates for the in-app Report Designer';
COMMENT ON COLUMN RR_REPORTS.TEMPLATE    IS 'ReportBro report definition JSON (docElements, parameters, styles, documentProperties)';
COMMENT ON COLUMN RR_REPORTS.DATA_SOURCE IS 'Run-time data source JSON: {sourceType, path, query, extraQuery, limit, dataParameter, userParams[]}';


-- ============================================================
-- 2. ORDS ENDPOINTS
-- ============================================================

-- Template: reports/designer  (list + upsert)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'reports/designer',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Report Designer catalog: list and create/update reports'
    );

    -- ── GET: list reports (summary — no template CLOB) ───────────────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/designer',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'List reports, filterable by search text / module / status',
        p_source         => q'[
SELECT
    r.ID            AS "id",
    r.NAME          AS "name",
    r.DESCRIPTION   AS "description",
    r.MODULE        AS "module",
    r.OUTPUT_FORMAT AS "output_format",
    r.STATUS        AS "status",
    r.CREATED_BY    AS "created_by",
    TO_CHAR(r.CREATED_ON, 'YYYY-MM-DD"T"HH24:MI:SS') AS "created_on",
    r.UPDATED_BY    AS "updated_by",
    TO_CHAR(r.UPDATED_ON, 'YYYY-MM-DD"T"HH24:MI:SS') AS "updated_on"
FROM RR_REPORTS r
WHERE (:search IS NULL
        OR UPPER(r.NAME)               LIKE '%' || UPPER(:search) || '%'
        OR UPPER(NVL(r.DESCRIPTION,'')) LIKE '%' || UPPER(:search) || '%')
  AND (:module IS NULL OR r.MODULE = UPPER(:module))
  AND (:status IS NULL OR r.STATUS = UPPER(:status))
ORDER BY r.UPDATED_ON DESC
]'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name => 'reerp', p_pattern => 'reports/designer', p_method => 'GET',
        p_name => 'search', p_bind_variable_name => 'search',
        p_source_type => 'URI', p_param_type => 'STRING', p_access_method => 'IN',
        p_comments => 'Search in name/description');

    ORDS.DEFINE_PARAMETER(
        p_module_name => 'reerp', p_pattern => 'reports/designer', p_method => 'GET',
        p_name => 'module', p_bind_variable_name => 'module',
        p_source_type => 'URI', p_param_type => 'STRING', p_access_method => 'IN',
        p_comments => 'Filter by module code');

    ORDS.DEFINE_PARAMETER(
        p_module_name => 'reerp', p_pattern => 'reports/designer', p_method => 'GET',
        p_name => 'status', p_bind_variable_name => 'status',
        p_source_type => 'URI', p_param_type => 'STRING', p_access_method => 'IN',
        p_comments => 'Filter by status (ACTIVE/INACTIVE)');

    -- ── POST: create or update (upsert by optional "id") ─────────────
    -- Body: { "id": 12,                      -- omit/null to create
    --         "name": "...", "description": "...", "module": "GL",
    --         "output_format": "pdf", "status": "ACTIVE",
    --         "data_source": { ... }, "template": { ... },
    --         "user": "USERNAME" }
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/designer',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create or update a report (upsert by id)',
        p_source         => q'[
DECLARE
    l_json     CLOB := :body_text;
    l_id       NUMBER;
    l_name     VARCHAR2(200);
    l_desc     VARCHAR2(1000);
    l_module   VARCHAR2(30);
    l_format   VARCHAR2(10);
    l_status   VARCHAR2(20);
    l_user     VARCHAR2(100);
    l_ds       CLOB;
    l_tpl      CLOB;
BEGIN
    l_id     := JSON_VALUE(l_json, '$.id' RETURNING NUMBER);
    l_name   := JSON_VALUE(l_json, '$.name');
    l_desc   := JSON_VALUE(l_json, '$.description');
    l_module := NVL(UPPER(JSON_VALUE(l_json, '$.module')), 'GENERAL');
    l_format := NVL(LOWER(JSON_VALUE(l_json, '$.output_format')), 'pdf');
    l_status := NVL(UPPER(JSON_VALUE(l_json, '$.status')), 'ACTIVE');
    l_user   := JSON_VALUE(l_json, '$.user');
    l_ds     := JSON_QUERY(l_json, '$.data_source' RETURNING CLOB);
    l_tpl    := JSON_QUERY(l_json, '$.template'    RETURNING CLOB);

    IF l_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success":false,"error":"name is required"}');
        RETURN;
    END IF;

    IF l_id IS NULL THEN
        INSERT INTO RR_REPORTS (
            NAME, DESCRIPTION, MODULE, OUTPUT_FORMAT, STATUS,
            DATA_SOURCE, TEMPLATE, CREATED_BY, UPDATED_BY
        ) VALUES (
            l_name, l_desc, l_module, l_format, l_status,
            l_ds, l_tpl, l_user, l_user
        )
        RETURNING ID INTO l_id;
    ELSE
        UPDATE RR_REPORTS
           SET NAME          = l_name,
               DESCRIPTION   = l_desc,
               MODULE        = l_module,
               OUTPUT_FORMAT = l_format,
               STATUS        = l_status,
               DATA_SOURCE   = NVL(l_ds,  DATA_SOURCE),
               TEMPLATE      = NVL(l_tpl, TEMPLATE),
               UPDATED_BY    = l_user,
               UPDATED_ON    = SYSTIMESTAMP
         WHERE ID = l_id;

        IF SQL%ROWCOUNT = 0 THEN
            :status_code := 404;
            HTP.P('{"success":false,"error":"report ' || l_id || ' not found"}');
            RETURN;
        END IF;
    END IF;

    COMMIT;
    :status_code := 200;
    HTP.P('{"success":true,"id":' || l_id || '}');
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK;
        :status_code := 409;
        HTP.P('{"success":false,"error":"a report with this name already exists"}');
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


-- Template: reports/designer/:id  (read one + delete)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'reports/designer/:id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Single Report Designer report: read full definition / delete'
    );

    -- ── GET: full report including template + data source CLOBs ─────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/designer/:id',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 1,
        p_mimes_allowed  => NULL,
        p_comments       => 'Return one report with full template and data source JSON',
        p_source         => q'[
SELECT
    r.ID            AS "id",
    r.NAME          AS "name",
    r.DESCRIPTION   AS "description",
    r.MODULE        AS "module",
    r.OUTPUT_FORMAT AS "output_format",
    r.STATUS        AS "status",
    r.DATA_SOURCE   AS "data_source",
    r.TEMPLATE      AS "template",
    r.CREATED_BY    AS "created_by",
    TO_CHAR(r.CREATED_ON, 'YYYY-MM-DD"T"HH24:MI:SS') AS "created_on",
    r.UPDATED_BY    AS "updated_by",
    TO_CHAR(r.UPDATED_ON, 'YYYY-MM-DD"T"HH24:MI:SS') AS "updated_on"
FROM RR_REPORTS r
WHERE r.ID = :id
]'
    );

    -- ── DELETE: remove report ────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'reports/designer/:id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Delete a report by id',
        p_source         => q'[
BEGIN
    DELETE FROM RR_REPORTS WHERE ID = :id;
    IF SQL%ROWCOUNT = 0 THEN
        :status_code := 404;
        HTP.P('{"success":false,"error":"report not found"}');
    ELSE
        COMMIT;
        :status_code := 200;
        HTP.P('{"success":true}');
    END IF;
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
-- NOTES
-- ============================================================
-- 1. Run this script in the same schema that owns the existing
--    'reerp' ORDS module (SQL Workshop → SQL Scripts, or SQLcl).
--
-- 2. Endpoints (relative to the company APEX base URL):
--      GET    /reports/designer?search=&module=&status=
--      POST   /reports/designer            (JSON body, upsert)
--      GET    /reports/designer/123
--      DELETE /reports/designer/123
--
-- 3. The DATA_SOURCE JSON is interpreted by the React app only:
--    { "sourceType": "fusion" | "ords" | "static",
--      "path":        "shipmentLines",
--      "query":       "OrganizationCode='{org}'",
--      "extraQuery":  "fields=Order,Item&orderBy=Order:asc",
--      "limit":       500,
--      "dataParameter": "items",
--      "userParams":  [ { "name": "org", "label": "Organization",
--                         "type": "string", "testValue": "M1" } ],
--      "staticData":  [ ... ]   -- only for sourceType = static
--    }
--
-- 4. Rendering uses a ReportBro render service (Python
--    reportbro-lib). Configure its URL via the React env var
--    REACT_APP_REPORTBRO_SERVER_URL. Until a self-hosted service
--    is deployed, the app falls back to the public ReportBro demo
--    server — do not run sensitive data through the demo server.
-- ============================================================
