-- ============================================================================
-- GL Code Combinations Table - Exact match to JSON structure
-- ============================================================================

-- Drop existing table if needed
-- DROP TABLE reerp_gl_code_combinations CASCADE CONSTRAINTS;

-- ============================================================================
-- 1. TABLE: REERP_GL_CODE_COMBINATIONS (matching JSON exactly)
-- ============================================================================
CREATE TABLE reerp_gl_code_combinations (
    -- Columns in exact order as JSON
    "AccountType"                 VARCHAR2(1),
    "DetailBudgetingAllowedFlag"  VARCHAR2(1),
    "JgzzReconFlag"               VARCHAR2(1),
    "FinancialCategory"           VARCHAR2(100),
    "DetailPostingAllowedFlag"    VARCHAR2(1),
    "Reference3"                  VARCHAR2(150),
    "SummaryFlag"                 VARCHAR2(1),
    "StartDateActive"             DATE,
    "EndDateActive"               DATE,
    "EnabledFlag"                 VARCHAR2(1),
    "_CODE_COMBINATION_ID"        NUMBER(18)      NOT NULL,
    "_CHART_OF_ACCOUNTS_ID"       NUMBER(18),
    "buimercFinGlbCoaCo"          VARCHAR2(30),
    "buimercFinGlbCoaLob"         VARCHAR2(30),
    "buimercFinGlbCoaDepartment"  VARCHAR2(30),
    "buimercFinGlbCoaAccount"     VARCHAR2(30),
    "buimercFinGlbCoaSubAcc"      VARCHAR2(30),
    "buimercFinGlbCoaAlys"        VARCHAR2(30),
    "buimercFinGlbCoaIc"          VARCHAR2(30),
    "buimercFinGlbCoaFut1"        VARCHAR2(30),
    "buimercFinGlbCoaFut2"        VARCHAR2(30),

    -- Audit columns (optional)
    created_by                    VARCHAR2(100)   DEFAULT USER,
    creation_date                 TIMESTAMP       DEFAULT SYSTIMESTAMP,
    last_updated_by               VARCHAR2(100),
    last_update_date              TIMESTAMP,

    -- Primary Key
    CONSTRAINT reerp_gl_cc_pk PRIMARY KEY ("_CODE_COMBINATION_ID")
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX reerp_gl_cc_coa_idx ON reerp_gl_code_combinations("_CHART_OF_ACCOUNTS_ID");
CREATE INDEX reerp_gl_cc_account_idx ON reerp_gl_code_combinations("buimercFinGlbCoaAccount");
CREATE INDEX reerp_gl_cc_company_idx ON reerp_gl_code_combinations("buimercFinGlbCoaCo");
CREATE INDEX reerp_gl_cc_enabled_idx ON reerp_gl_code_combinations("EnabledFlag");

-- ============================================================================
-- 3. COMMENTS
-- ============================================================================
COMMENT ON TABLE reerp_gl_code_combinations IS 'GL Code Combinations - synced from Oracle Fusion';
COMMENT ON COLUMN reerp_gl_code_combinations."_CODE_COMBINATION_ID" IS 'Primary key - Code Combination ID from Fusion';
COMMENT ON COLUMN reerp_gl_code_combinations."AccountType" IS 'A=Asset, L=Liability, O=Equity, R=Revenue, E=Expense';


-- ============================================================================
-- 4. PL/SQL PROCEDURE: Process JSON Payload (for REST POST)
-- ============================================================================
CREATE OR REPLACE PROCEDURE reerp_gl_cc_process_json (
    p_json_payload    IN  CLOB,
    p_status          OUT VARCHAR2,
    p_message         OUT VARCHAR2,
    p_total_count     OUT NUMBER,
    p_success_count   OUT NUMBER,
    p_error_count     OUT NUMBER
) AS
    l_items       JSON_ARRAY_T;
    l_item        JSON_OBJECT_T;
    l_json_obj    JSON_OBJECT_T;
BEGIN
    p_success_count := 0;
    p_error_count := 0;

    -- Parse JSON
    l_json_obj := JSON_OBJECT_T.parse(p_json_payload);
    l_items := l_json_obj.get_Array('items');
    p_total_count := l_items.get_size();

    -- Process each item
    FOR i IN 0 .. l_items.get_size() - 1 LOOP
        l_item := TREAT(l_items.get(i) AS JSON_OBJECT_T);

        BEGIN
            -- MERGE: Insert or Update
            MERGE INTO reerp_gl_code_combinations tgt
            USING (
                SELECT
                    l_item.get_String('AccountType')                AS "AccountType",
                    l_item.get_String('DetailBudgetingAllowedFlag') AS "DetailBudgetingAllowedFlag",
                    l_item.get_String('JgzzReconFlag')              AS "JgzzReconFlag",
                    l_item.get_String('FinancialCategory')          AS "FinancialCategory",
                    l_item.get_String('DetailPostingAllowedFlag')   AS "DetailPostingAllowedFlag",
                    l_item.get_String('Reference3')                 AS "Reference3",
                    l_item.get_String('SummaryFlag')                AS "SummaryFlag",
                    CASE
                        WHEN l_item.get_String('StartDateActive') IS NOT NULL
                        THEN TO_DATE(l_item.get_String('StartDateActive'), 'YYYY-MM-DD')
                        ELSE NULL
                    END AS "StartDateActive",
                    CASE
                        WHEN l_item.get_String('EndDateActive') IS NOT NULL
                        THEN TO_DATE(l_item.get_String('EndDateActive'), 'YYYY-MM-DD')
                        ELSE NULL
                    END AS "EndDateActive",
                    l_item.get_String('EnabledFlag')                AS "EnabledFlag",
                    l_item.get_Number('_CODE_COMBINATION_ID')       AS "_CODE_COMBINATION_ID",
                    l_item.get_Number('_CHART_OF_ACCOUNTS_ID')      AS "_CHART_OF_ACCOUNTS_ID",
                    l_item.get_String('buimercFinGlbCoaCo')         AS "buimercFinGlbCoaCo",
                    l_item.get_String('buimercFinGlbCoaLob')        AS "buimercFinGlbCoaLob",
                    l_item.get_String('buimercFinGlbCoaDepartment') AS "buimercFinGlbCoaDepartment",
                    l_item.get_String('buimercFinGlbCoaAccount')    AS "buimercFinGlbCoaAccount",
                    l_item.get_String('buimercFinGlbCoaSubAcc')     AS "buimercFinGlbCoaSubAcc",
                    l_item.get_String('buimercFinGlbCoaAlys')       AS "buimercFinGlbCoaAlys",
                    l_item.get_String('buimercFinGlbCoaIc')         AS "buimercFinGlbCoaIc",
                    l_item.get_String('buimercFinGlbCoaFut1')       AS "buimercFinGlbCoaFut1",
                    l_item.get_String('buimercFinGlbCoaFut2')       AS "buimercFinGlbCoaFut2"
                FROM dual
            ) src
            ON (tgt."_CODE_COMBINATION_ID" = src."_CODE_COMBINATION_ID")
            WHEN MATCHED THEN
                UPDATE SET
                    tgt."AccountType"                 = src."AccountType",
                    tgt."DetailBudgetingAllowedFlag"  = src."DetailBudgetingAllowedFlag",
                    tgt."JgzzReconFlag"               = src."JgzzReconFlag",
                    tgt."FinancialCategory"           = src."FinancialCategory",
                    tgt."DetailPostingAllowedFlag"    = src."DetailPostingAllowedFlag",
                    tgt."Reference3"                  = src."Reference3",
                    tgt."SummaryFlag"                 = src."SummaryFlag",
                    tgt."StartDateActive"             = src."StartDateActive",
                    tgt."EndDateActive"               = src."EndDateActive",
                    tgt."EnabledFlag"                 = src."EnabledFlag",
                    tgt."_CHART_OF_ACCOUNTS_ID"       = src."_CHART_OF_ACCOUNTS_ID",
                    tgt."buimercFinGlbCoaCo"          = src."buimercFinGlbCoaCo",
                    tgt."buimercFinGlbCoaLob"         = src."buimercFinGlbCoaLob",
                    tgt."buimercFinGlbCoaDepartment"  = src."buimercFinGlbCoaDepartment",
                    tgt."buimercFinGlbCoaAccount"     = src."buimercFinGlbCoaAccount",
                    tgt."buimercFinGlbCoaSubAcc"      = src."buimercFinGlbCoaSubAcc",
                    tgt."buimercFinGlbCoaAlys"        = src."buimercFinGlbCoaAlys",
                    tgt."buimercFinGlbCoaIc"          = src."buimercFinGlbCoaIc",
                    tgt."buimercFinGlbCoaFut1"        = src."buimercFinGlbCoaFut1",
                    tgt."buimercFinGlbCoaFut2"        = src."buimercFinGlbCoaFut2",
                    tgt.last_updated_by               = USER,
                    tgt.last_update_date              = SYSTIMESTAMP
            WHEN NOT MATCHED THEN
                INSERT (
                    "AccountType",
                    "DetailBudgetingAllowedFlag",
                    "JgzzReconFlag",
                    "FinancialCategory",
                    "DetailPostingAllowedFlag",
                    "Reference3",
                    "SummaryFlag",
                    "StartDateActive",
                    "EndDateActive",
                    "EnabledFlag",
                    "_CODE_COMBINATION_ID",
                    "_CHART_OF_ACCOUNTS_ID",
                    "buimercFinGlbCoaCo",
                    "buimercFinGlbCoaLob",
                    "buimercFinGlbCoaDepartment",
                    "buimercFinGlbCoaAccount",
                    "buimercFinGlbCoaSubAcc",
                    "buimercFinGlbCoaAlys",
                    "buimercFinGlbCoaIc",
                    "buimercFinGlbCoaFut1",
                    "buimercFinGlbCoaFut2",
                    created_by,
                    creation_date
                ) VALUES (
                    src."AccountType",
                    src."DetailBudgetingAllowedFlag",
                    src."JgzzReconFlag",
                    src."FinancialCategory",
                    src."DetailPostingAllowedFlag",
                    src."Reference3",
                    src."SummaryFlag",
                    src."StartDateActive",
                    src."EndDateActive",
                    src."EnabledFlag",
                    src."_CODE_COMBINATION_ID",
                    src."_CHART_OF_ACCOUNTS_ID",
                    src."buimercFinGlbCoaCo",
                    src."buimercFinGlbCoaLob",
                    src."buimercFinGlbCoaDepartment",
                    src."buimercFinGlbCoaAccount",
                    src."buimercFinGlbCoaSubAcc",
                    src."buimercFinGlbCoaAlys",
                    src."buimercFinGlbCoaIc",
                    src."buimercFinGlbCoaFut1",
                    src."buimercFinGlbCoaFut2",
                    USER,
                    SYSTIMESTAMP
                );

            p_success_count := p_success_count + 1;

        EXCEPTION
            WHEN OTHERS THEN
                p_error_count := p_error_count + 1;
                -- Continue processing other records
        END;
    END LOOP;

    COMMIT;

    p_status := 'SUCCESS';
    p_message := 'Processed ' || p_total_count || ' records. Success: ' || p_success_count || ', Errors: ' || p_error_count;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_status := 'ERROR';
        p_message := 'Error: ' || SQLERRM;
        p_total_count := 0;
        p_success_count := 0;
        p_error_count := 0;
END reerp_gl_cc_process_json;
/


-- ============================================================================
-- 5. APEX REST POST HANDLER
-- Module: reerp
-- Template: gl/codecombinations/sync
-- Method: POST
-- Source Type: PL/SQL
-- ============================================================================

/*
DECLARE
    l_status          VARCHAR2(20);
    l_message         VARCHAR2(4000);
    l_total_count     NUMBER;
    l_success_count   NUMBER;
    l_error_count     NUMBER;
BEGIN
    reerp_gl_cc_process_json(
        p_json_payload    => :body_text,
        p_status          => l_status,
        p_message         => l_message,
        p_total_count     => l_total_count,
        p_success_count   => l_success_count,
        p_error_count     => l_error_count
    );

    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 500 END;

    apex_json.open_object;
    apex_json.write('status', l_status);
    apex_json.write('message', l_message);
    apex_json.write('totalCount', l_total_count);
    apex_json.write('successCount', l_success_count);
    apex_json.write('errorCount', l_error_count);
    apex_json.close_object;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', SQLERRM);
        apex_json.close_object;
END;
*/


-- ============================================================================
-- 6. APEX REST GET HANDLER (returns JSON in same format)
-- Module: reerp
-- Template: gl/codecombinations
-- Method: GET
-- Source Type: Query
-- ============================================================================

/*
SELECT
    "AccountType",
    "DetailBudgetingAllowedFlag",
    "JgzzReconFlag",
    "FinancialCategory",
    "DetailPostingAllowedFlag",
    "Reference3",
    "SummaryFlag",
    TO_CHAR("StartDateActive", 'YYYY-MM-DD') AS "StartDateActive",
    TO_CHAR("EndDateActive", 'YYYY-MM-DD') AS "EndDateActive",
    "EnabledFlag",
    "_CODE_COMBINATION_ID",
    "_CHART_OF_ACCOUNTS_ID",
    "buimercFinGlbCoaCo",
    "buimercFinGlbCoaLob",
    "buimercFinGlbCoaDepartment",
    "buimercFinGlbCoaAccount",
    "buimercFinGlbCoaSubAcc",
    "buimercFinGlbCoaAlys",
    "buimercFinGlbCoaIc",
    "buimercFinGlbCoaFut1",
    "buimercFinGlbCoaFut2"
FROM reerp_gl_code_combinations
WHERE "EnabledFlag" = 'Y'
ORDER BY "_CODE_COMBINATION_ID"
*/


-- ============================================================================
-- 7. Quick test insert (same as JSON)
-- ============================================================================
/*
INSERT INTO reerp_gl_code_combinations (
    "AccountType",
    "DetailBudgetingAllowedFlag",
    "JgzzReconFlag",
    "FinancialCategory",
    "DetailPostingAllowedFlag",
    "Reference3",
    "SummaryFlag",
    "StartDateActive",
    "EndDateActive",
    "EnabledFlag",
    "_CODE_COMBINATION_ID",
    "_CHART_OF_ACCOUNTS_ID",
    "buimercFinGlbCoaCo",
    "buimercFinGlbCoaLob",
    "buimercFinGlbCoaDepartment",
    "buimercFinGlbCoaAccount",
    "buimercFinGlbCoaSubAcc",
    "buimercFinGlbCoaAlys",
    "buimercFinGlbCoaIc",
    "buimercFinGlbCoaFut1",
    "buimercFinGlbCoaFut2"
) VALUES (
    'L',
    'Y',
    'N',
    NULL,
    'Y',
    'N',
    'N',
    TO_DATE('1952-01-01', 'YYYY-MM-DD'),
    NULL,
    'Y',
    300000002671383,
    2002,
    '01',
    '00',
    '00',
    '2311100',
    '0000',
    '000',
    '00',
    '000',
    '000'
);
COMMIT;
*/
