-- =============================================================================
-- 01_BIP_REPORTS_REGISTRY.SQL
--
-- Creates the dynamic BIP Reports registry:
--   RR_BIP_REPORTS          – registered report definitions
--   RR_BIP_REPORTS_HISTORY  – execution audit trail
--
-- ORDS endpoints (under reerp module):
--   GET    reerp/bip-reports              – list all registered reports
--   POST   reerp/bip-reports              – register a new report
--   DELETE reerp/bip-reports/:report_id   – remove a report
--   GET    reerp/bip-reports/history      – list execution history
--   POST   reerp/bip-reports/history      – record execution result
-- =============================================================================


-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE RR_BIP_REPORTS (
    REPORT_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    MODULE          VARCHAR2(50)  NOT NULL,
    REPORT_NAME     VARCHAR2(200) NOT NULL,
    PATH            VARCHAR2(500) NOT NULL,
    DESCRIPTION     VARCHAR2(500),
    APEX_ENDPOINT   VARCHAR2(200),
    CREATED_DATE    DATE DEFAULT SYSDATE,
    CONSTRAINT uq_bip_report_path UNIQUE (PATH)
);

CREATE TABLE RR_BIP_REPORTS_HISTORY (
    HISTORY_ID        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    REPORT_ID         NUMBER REFERENCES RR_BIP_REPORTS(REPORT_ID) ON DELETE SET NULL,
    MODULE            VARCHAR2(50),
    REPORT_NAME       VARCHAR2(200),
    PATH              VARCHAR2(500),
    EXECUTION_DATE    DATE DEFAULT SYSDATE,
    EXECUTION_STATUS  VARCHAR2(20),   -- SUCCESS | ERROR
    ROW_COUNT         NUMBER,
    ERROR_MESSAGE     VARCHAR2(2000)
);

CREATE INDEX idx_bip_hist_report ON RR_BIP_REPORTS_HISTORY(REPORT_ID);
CREATE INDEX idx_bip_hist_date   ON RR_BIP_REPORTS_HISTORY(EXECUTION_DATE);


-- =============================================================================
-- ORDS TEMPLATE + HANDLERS
-- =============================================================================

-- ── Template: bip-reports ─────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'bip-reports',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'BIP Reports registry — list and register'
    );
    COMMIT;
END;
/

-- ── GET bip-reports ───────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'bip-reports',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'List all registered BIP reports ordered by module',
        p_source         => q'[
SELECT
    REPORT_ID,
    MODULE,
    REPORT_NAME,
    PATH,
    DESCRIPTION,
    APEX_ENDPOINT,
    TO_CHAR(CREATED_DATE, 'YYYY-MM-DD') AS CREATED_DATE
FROM RR_BIP_REPORTS
ORDER BY MODULE, REPORT_NAME
        ]'
    );
    COMMIT;
END;
/

-- ── POST bip-reports ──────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'bip-reports',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Register a new BIP report',
        p_source         => q'[
            DECLARE
                v_id     NUMBER;
                v_module VARCHAR2(50);
                v_name   VARCHAR2(200);
                v_path   VARCHAR2(500);
                v_desc   VARCHAR2(500);
                v_apex   VARCHAR2(200);
                v_body   CLOB := :body_text;
                v_json   JSON_OBJECT_T;
            BEGIN
                v_json   := JSON_OBJECT_T.PARSE(v_body);
                v_module := v_json.get_string('module');
                v_name   := v_json.get_string('reportName');
                v_path   := v_json.get_string('path');
                v_desc   := v_json.get_string('description');
                v_apex   := v_json.get_string('apexEndpoint');

                INSERT INTO RR_BIP_REPORTS (MODULE, REPORT_NAME, PATH, DESCRIPTION, APEX_ENDPOINT)
                VALUES (v_module, v_name, v_path, v_desc, v_apex)
                RETURNING REPORT_ID INTO v_id;

                COMMIT;
                :status := 200;
                HTP.P('{"success":true,"reportId":' || v_id || ',"message":"Report registered successfully"}');
            EXCEPTION
                WHEN DUP_VAL_ON_INDEX THEN
                    :status := 409;
                    HTP.P('{"success":false,"error":"A report with this path is already registered"}');
                WHEN OTHERS THEN
                    ROLLBACK;
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ── Template: bip-reports/:report_id ─────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'bip-reports/:report_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Single BIP report by ID'
    );
    COMMIT;
END;
/

-- ── DELETE bip-reports/:report_id ────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'bip-reports/:report_id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Remove a registered BIP report',
        p_source         => q'[
            BEGIN
                DELETE FROM RR_BIP_REPORTS WHERE REPORT_ID = :report_id;
                IF SQL%ROWCOUNT = 0 THEN
                    :status := 404;
                    HTP.P('{"success":false,"error":"Report not found"}');
                ELSE
                    COMMIT;
                    :status := 200;
                    HTP.P('{"success":true,"message":"Report deleted"}');
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    ROLLBACK;
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ── Template: bip-reports/history ────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'bip-reports/history',
        p_priority    => 1,
        p_etag_type   => 'HASH',
        p_comments    => 'BIP report execution history'
    );
    COMMIT;
END;
/

-- ── GET bip-reports/history ───────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'bip-reports/history',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List recent BIP report execution history',
        p_source         => q'[
SELECT
    HISTORY_ID,
    REPORT_ID,
    MODULE,
    REPORT_NAME,
    PATH,
    TO_CHAR(EXECUTION_DATE, 'YYYY-MM-DD HH24:MI:SS') AS EXECUTION_DATE,
    EXECUTION_STATUS,
    ROW_COUNT,
    ERROR_MESSAGE
FROM RR_BIP_REPORTS_HISTORY
ORDER BY EXECUTION_DATE DESC
        ]'
    );
    COMMIT;
END;
/

-- ── POST bip-reports/history ──────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'bip-reports/history',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Record a BIP report execution result',
        p_source         => q'[
            DECLARE
                v_json    JSON_OBJECT_T;
                v_body    CLOB := :body_text;
                v_hid     NUMBER;
            BEGIN
                v_json := JSON_OBJECT_T.PARSE(v_body);
                INSERT INTO RR_BIP_REPORTS_HISTORY (
                    REPORT_ID, MODULE, REPORT_NAME, PATH,
                    EXECUTION_STATUS, ROW_COUNT, ERROR_MESSAGE
                ) VALUES (
                    v_json.get_number('reportId'),
                    v_json.get_string('module'),
                    v_json.get_string('reportName'),
                    v_json.get_string('path'),
                    v_json.get_string('executionStatus'),
                    v_json.get_number('rowCount'),
                    v_json.get_string('errorMessage')
                ) RETURNING HISTORY_ID INTO v_hid;
                COMMIT;
                :status := 200;
                HTP.P('{"success":true,"historyId":' || v_hid || '}');
            EXCEPTION
                WHEN OTHERS THEN
                    ROLLBACK;
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
            END;
        ]'
    );
    COMMIT;
END;
/
