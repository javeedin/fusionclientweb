-- ============================================================
-- RR_GL_FISCAL_PERIODS
-- Stores Oracle Fusion GL accounting period fiscal metadata.
--
-- Synced via GET /reerp/periodsstatus/create
-- Used by GENERATE_TB to map calendar PERIOD_NAME → fiscal
-- PERIOD_YEAR / PERIOD_NUM so that P&L opening balance resets
-- at the correct fiscal year boundary.
--
-- Example: May-26 belongs to fiscal year 2027 (period 2) when
-- the fiscal year starts in April.
-- ============================================================


-- ============================================================
-- 1. TABLE
-- ============================================================
CREATE TABLE RR_GL_FISCAL_PERIODS (
    ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Period identifier in Mon-YY format (e.g., 'May-26')
    -- Matches PERIOD_NAME in RR_GL_JE_HEADERS / RR_ERP_TRIALBALANCE
    PERIOD_NAME     VARCHAR2(30)    NOT NULL,

    -- Ledger this period belongs to (matches LEDGER_NAME in journals)
    LEDGER_NAME     VARCHAR2(240)   NOT NULL,

    -- Application short code, e.g., 'GL'
    APPLICATION     VARCHAR2(10)    NOT NULL,

    -- Oracle Fusion fiscal year (e.g., 2027 for May-26 on April fiscal year)
    FISCAL_YEAR     NUMBER(4)       NOT NULL,

    -- Sequence within fiscal year: 1 = first month of fiscal year
    FISCAL_PERIOD   NUMBER(2)       NOT NULL,

    -- Period status (Never Opened, Open, Closed, etc.)
    STATUS          VARCHAR2(50),

    -- Calendar start/end dates of this period
    START_DATE      DATE,
    END_DATE        DATE,

    -- Y = adjustment period (13th period), N = regular
    ADJ_FLAG        VARCHAR2(1)     DEFAULT 'N',

    -- Sync metadata
    SYNC_DATE       TIMESTAMP       DEFAULT SYSTIMESTAMP,

    -- One row per period per ledger per application
    CONSTRAINT RR_GL_FP_UK UNIQUE (PERIOD_NAME, LEDGER_NAME, APPLICATION)
);

-- Indexes
CREATE INDEX RR_GL_FP_LEDGER_IDX ON RR_GL_FISCAL_PERIODS (LEDGER_NAME, FISCAL_YEAR, FISCAL_PERIOD);
CREATE INDEX RR_GL_FP_PERIOD_IDX ON RR_GL_FISCAL_PERIODS (PERIOD_NAME, ADJ_FLAG);

COMMENT ON TABLE  RR_GL_FISCAL_PERIODS              IS 'GL fiscal period mapping synced from Oracle Fusion via periodsstatus/create';
COMMENT ON COLUMN RR_GL_FISCAL_PERIODS.PERIOD_NAME  IS 'Period name in Mon-YY format, e.g. May-26 — matches PERIOD_NAME in journal headers';
COMMENT ON COLUMN RR_GL_FISCAL_PERIODS.LEDGER_NAME  IS 'Ledger name, e.g. BUIMERC LEDGER';
COMMENT ON COLUMN RR_GL_FISCAL_PERIODS.FISCAL_YEAR  IS 'Oracle Fusion fiscal year (not calendar year)';
COMMENT ON COLUMN RR_GL_FISCAL_PERIODS.FISCAL_PERIOD IS '1 = first period of fiscal year (e.g. Apr=1 for April fiscal start)';


-- ============================================================
-- 2. UPSERT PROCEDURE
-- ============================================================
CREATE OR REPLACE PROCEDURE RR_UPSERT_GL_FISCAL_PERIODS (
    p_json  IN  CLOB,
    p_count OUT NUMBER,
    p_error OUT VARCHAR2
) AS
BEGIN
    p_count := 0;
    p_error := NULL;

    FOR rec IN (
        SELECT
            jt.period_name_id  AS period_name,
            jt.ledger_name,
            jt.app             AS application,
            jt.period_year     AS fiscal_year,
            jt.period_number   AS fiscal_period,
            jt.status,
            -- strip trailing 'Z' if present before TO_DATE conversion
            TO_DATE(REGEXP_REPLACE(jt.start_date, 'T.*$', ''), 'YYYY-MM-DD') AS start_date,
            TO_DATE(REGEXP_REPLACE(jt.end_date,   'T.*$', ''), 'YYYY-MM-DD') AS end_date,
            CASE WHEN UPPER(jt.adj_flag) IN ('Y','TRUE','1') THEN 'Y' ELSE 'N' END AS adj_flag
        FROM JSON_TABLE(
            p_json,
            '$.items[*]'
            COLUMNS (
                period_name_id  VARCHAR2(30)  PATH '$.period_name_id',
                ledger_name     VARCHAR2(240) PATH '$.ledger_name',
                app             VARCHAR2(10)  PATH '$.app',
                period_year     NUMBER        PATH '$.period_year',
                period_number   NUMBER        PATH '$.period_number',
                status          VARCHAR2(50)  PATH '$.status',
                start_date      VARCHAR2(30)  PATH '$.start_date',
                end_date        VARCHAR2(30)  PATH '$.end_date',
                adj_flag        VARCHAR2(10)  PATH '$.adj_flag'
            )
        ) jt
        WHERE jt.period_name_id IS NOT NULL
          AND jt.ledger_name    IS NOT NULL
          AND jt.period_year    IS NOT NULL
    ) LOOP
        MERGE INTO RR_GL_FISCAL_PERIODS tgt
        USING (
            SELECT
                rec.period_name  AS period_name,
                rec.ledger_name  AS ledger_name,
                NVL(rec.application, 'GL') AS application
            FROM DUAL
        ) src
        ON (
            tgt.PERIOD_NAME  = src.period_name
            AND tgt.LEDGER_NAME = src.ledger_name
            AND tgt.APPLICATION = src.application
        )
        WHEN MATCHED THEN
            UPDATE SET
                tgt.FISCAL_YEAR   = rec.fiscal_year,
                tgt.FISCAL_PERIOD = rec.fiscal_period,
                tgt.STATUS        = rec.status,
                tgt.START_DATE    = rec.start_date,
                tgt.END_DATE      = rec.end_date,
                tgt.ADJ_FLAG      = rec.adj_flag,
                tgt.SYNC_DATE     = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                PERIOD_NAME, LEDGER_NAME, APPLICATION,
                FISCAL_YEAR, FISCAL_PERIOD,
                STATUS, START_DATE, END_DATE, ADJ_FLAG
            ) VALUES (
                rec.period_name, rec.ledger_name, NVL(rec.application,'GL'),
                rec.fiscal_year, rec.fiscal_period,
                rec.status, rec.start_date, rec.end_date, rec.adj_flag
            );

        p_count := p_count + 1;
    END LOOP;

    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
END RR_UPSERT_GL_FISCAL_PERIODS;
/


-- ============================================================
-- 3. ORDS ENDPOINTS
-- ============================================================

-- Template: periodsstatus/create
-- Called as:
--   GET /reerp/periodsstatus/create?P_APPLICATION_NAME=General+Ledger&P_LEDGER_NAME=BUIMERC LEDGER
--
-- This GET handler calls Oracle Fusion's accounting period status
-- REST API, transforms the response into fiscal period rows, and
-- upserts them into RR_GL_FISCAL_PERIODS.
-- It then returns the stored rows as JSON.
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'periodsstatus/create',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Sync GL fiscal periods from Oracle Fusion and return stored rows'
    );

    -- ── GET: fetch from Fusion, store locally, return JSON ───────────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'periodsstatus/create',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Sync GL periods from Oracle Fusion for a given ledger',
        p_source         => q'[
DECLARE
    l_app_name    VARCHAR2(200) := :P_APPLICATION_NAME;
    l_ledger_name VARCHAR2(240) := :P_LEDGER_NAME;
    l_app_short   VARCHAR2(10)  := 'GL';

    -- Oracle Fusion REST call variables
    l_response    CLOB;
    l_url         VARCHAR2(2000);
    l_wallet_path VARCHAR2(500);

    -- Transform / storage
    l_json_out    CLOB;
    l_count       NUMBER := 0;
    l_err         VARCHAR2(4000);

    -- Derive app short name from full name
    FUNCTION app_short(p_name IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE
            WHEN UPPER(p_name) LIKE '%GENERAL LEDGER%' THEN 'GL'
            WHEN UPPER(p_name) LIKE '%PAYABLES%'       THEN 'AP'
            WHEN UPPER(p_name) LIKE '%RECEIVABLES%'    THEN 'AR'
            ELSE SUBSTR(UPPER(p_name), 1, 10)
        END;
    END app_short;
BEGIN
    l_app_short := app_short(l_app_name);

    -- ── Call Oracle Fusion GL accountingPeriodStatuses REST API ──────
    -- The base URL and credentials are configured in the Oracle
    -- APEX Web Credentials: FUSION_REST_CRED
    -- Endpoint: /fscmRestApi/resources/11.13.18.05/accountingPeriodStatuses
    -- Filter by ledger name and application short name
    l_url := :FUSION_BASE_URL
          || '/fscmRestApi/resources/11.13.18.05/accountingPeriodStatuses'
          || '?q=LedgerName=''' || l_ledger_name || ''''
          || ' and ApplicationShortName=''' || l_app_short || ''''
          || '&fields=PeriodName,PeriodYear,PeriodNumber,StartDate,EndDate,ClosingStatus,AdjustmentPeriodFlag'
          || '&limit=1000';

    l_response := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
        p_url         => l_url,
        p_http_method => 'GET',
        p_credential_static_id => 'FUSION_REST_CRED'
    );

    -- ── Transform Fusion response into our RR_GL_FISCAL_PERIODS format ─
    -- Build the items array that RR_UPSERT_GL_FISCAL_PERIODS expects
    SELECT JSON_ARRAYAGG(
        JSON_OBJECT(
            'period_name_id' VALUE jt.period_name,
            'ledger_name'    VALUE l_ledger_name,
            'app'            VALUE l_app_short,
            'period_year'    VALUE jt.period_year,
            'period_number'  VALUE jt.period_number,
            'status'         VALUE jt.closing_status,
            'start_date'     VALUE jt.start_date,
            'end_date'       VALUE jt.end_date,
            'adj_flag'       VALUE CASE WHEN LOWER(jt.adj_flag)='true' THEN 'Y' ELSE 'N' END
            RETURNING CLOB
        )
        RETURNING CLOB
    )
    INTO l_json_out
    FROM JSON_TABLE(
        l_response,
        '$.items[*]'
        COLUMNS (
            period_name     VARCHAR2(30)  PATH '$.PeriodName',
            period_year     NUMBER        PATH '$.PeriodYear',
            period_number   NUMBER        PATH '$.PeriodNumber',
            start_date      VARCHAR2(30)  PATH '$.StartDate',
            end_date        VARCHAR2(30)  PATH '$.EndDate',
            closing_status  VARCHAR2(30)  PATH '$.ClosingStatus',
            adj_flag        VARCHAR2(10)  PATH '$.AdjustmentPeriodFlag'
        )
    ) jt;

    -- Wrap in items array and upsert
    l_json_out := '{"items":' || NVL(l_json_out, '[]') || '}';

    RR_UPSERT_GL_FISCAL_PERIODS(
        p_json  => l_json_out,
        p_count => l_count,
        p_error => l_err
    );

    -- ── Return the stored rows ────────────────────────────────────────
    HTP.P('{"success":true,"synced":' || l_count || ',"items":');
    FOR rec IN (
        SELECT
            fp.PERIOD_NAME,
            fp.LEDGER_NAME,
            fp.APPLICATION,
            fp.FISCAL_YEAR    AS period_year,
            fp.FISCAL_PERIOD  AS period_number,
            fp.STATUS,
            TO_CHAR(fp.START_DATE,'YYYY-MM-DD') AS start_date,
            TO_CHAR(fp.END_DATE,  'YYYY-MM-DD') AS end_date,
            fp.ADJ_FLAG
        FROM RR_GL_FISCAL_PERIODS fp
        WHERE fp.LEDGER_NAME  = l_ledger_name
          AND fp.APPLICATION  = l_app_short
          AND fp.ADJ_FLAG     = 'N'
        ORDER BY fp.FISCAL_YEAR, fp.FISCAL_PERIOD
    ) LOOP
        l_count := l_count + 1;
    END LOOP;

    HTP.P(
        (SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'period_name_id' VALUE fp.PERIOD_NAME,
                'ledger_name'    VALUE fp.LEDGER_NAME,
                'app'            VALUE fp.APPLICATION,
                'period_year'    VALUE fp.FISCAL_YEAR,
                'period_number'  VALUE fp.FISCAL_PERIOD,
                'status'         VALUE fp.STATUS,
                'start_date'     VALUE TO_CHAR(fp.START_DATE,'YYYY-MM-DD')||'T00:00:00Z',
                'end_date'       VALUE TO_CHAR(fp.END_DATE,  'YYYY-MM-DD')||'T00:00:00Z',
                'adj_flag'       VALUE fp.ADJ_FLAG
                RETURNING CLOB
            )
            RETURNING CLOB
        )
        FROM RR_GL_FISCAL_PERIODS fp
        WHERE fp.LEDGER_NAME  = l_ledger_name
          AND fp.APPLICATION  = l_app_short
          AND fp.ADJ_FLAG     = 'N'
        ORDER BY fp.FISCAL_YEAR, fp.FISCAL_PERIOD)
    );
    HTP.P('}');
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','''') || '"}');
END;
]'
    );

    -- ── POST: receive JSON batch directly (bypass Fusion call) ────────
    -- Accepts the same format as the GET response so the React app can
    -- POST data obtained from the sync service.
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'periodsstatus/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert GL fiscal periods from JSON body',
        p_source         => q'[
DECLARE
    l_json  CLOB;
    l_count NUMBER;
    l_error VARCHAR2(4000);
BEGIN
    l_json := :body_text;
    RR_UPSERT_GL_FISCAL_PERIODS(
        p_json  => l_json,
        p_count => l_count,
        p_error => l_error
    );
    IF l_error IS NOT NULL THEN
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(l_error,'"','''') || '"}');
    ELSE
        :status_code := 200;
        HTP.P('{"success":true,"count":' || l_count || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','''') || '"}');
        ROLLBACK;
END;
]'
    );

    COMMIT;
END;
/


-- Template: gl/fiscalperiods  (query endpoint)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/fiscalperiods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Query stored GL fiscal periods'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/fiscalperiods',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'Return stored fiscal periods (filterable by ledger/year)',
        p_source         => q'[
SELECT
    fp.PERIOD_NAME     AS "period_name_id",
    fp.LEDGER_NAME     AS "ledger_name",
    fp.APPLICATION     AS "app",
    fp.FISCAL_YEAR     AS "period_year",
    fp.FISCAL_PERIOD   AS "period_number",
    fp.STATUS          AS "status",
    TO_CHAR(fp.START_DATE,'YYYY-MM-DD')||'T00:00:00Z' AS "start_date",
    TO_CHAR(fp.END_DATE,  'YYYY-MM-DD')||'T00:00:00Z' AS "end_date",
    fp.ADJ_FLAG        AS "adj_flag",
    fp.SYNC_DATE       AS "sync_date"
FROM RR_GL_FISCAL_PERIODS fp
WHERE (:ledger_name   IS NULL OR UPPER(fp.LEDGER_NAME) = UPPER(:ledger_name))
  AND (:fiscal_year   IS NULL OR fp.FISCAL_YEAR        = :fiscal_year)
  AND (:application   IS NULL OR fp.APPLICATION        = UPPER(:application))
ORDER BY fp.LEDGER_NAME, fp.FISCAL_YEAR, fp.FISCAL_PERIOD
]'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/fiscalperiods',
        p_method             => 'GET',
        p_name               => 'ledger_name',
        p_bind_variable_name => 'ledger_name',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by ledger name'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/fiscalperiods',
        p_method             => 'GET',
        p_name               => 'fiscal_year',
        p_bind_variable_name => 'fiscal_year',
        p_source_type        => 'URI',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Filter by fiscal year'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/fiscalperiods',
        p_method             => 'GET',
        p_name               => 'application',
        p_bind_variable_name => 'application',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by application code (GL, AP, AR)'
    );

    COMMIT;
END;
/


-- ============================================================
-- NOTES
-- ============================================================
-- 1. APEX Web Credential setup (one-time):
--    In APEX Workspace → App Builder → Workspace Utilities →
--    Web Credentials → Create
--    Static ID: FUSION_REST_CRED
--    Authentication Type: Basic Authentication
--    Client ID / Username: <fusion_service_account>
--    Client Secret / Password: <password>
--
-- 2. :FUSION_BASE_URL bind variable:
--    Configure as an ORDS module-level bind or set in the
--    APEX Application Substitution Strings / Environment.
--    Example: https://your-fusion-host.oraclecloud.com
--
-- 3. Usage flow:
--    a) Sync:  GET /reerp/periodsstatus/create
--                  ?P_APPLICATION_NAME=General+Ledger
--                  &P_LEDGER_NAME=BUIMERC+LEDGER
--    b) Verify: GET /reerp/gl/fiscalperiods?ledger_name=BUIMERC+LEDGER
--    c) Generate TB: EXEC RR_ERP_TB_PKG.GENERATE_TB(...)
--
-- 4. To manually insert test data without calling Fusion:
--    POST /reerp/periodsstatus/create
--    Body: { "items": [ { "period_name_id":"Jul-23",
--                          "ledger_name":"BUIMERC LEDGER",
--                          "app":"GL",
--                          "period_year":2024,
--                          "period_number":1,
--                          "status":"Closed",
--                          "start_date":"2023-07-01T00:00:00Z",
--                          "end_date":"2023-07-31T00:00:00Z",
--                          "adj_flag":"N" } ] }
-- ============================================================
