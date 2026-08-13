-- ============================================================================
-- PL/SQL Procedure to Insert/Update GL Code Combinations from JSON
-- ============================================================================

CREATE OR REPLACE PROCEDURE reerp_gl_cc_load_json (
    p_json_payload    IN  CLOB,
    p_status          OUT VARCHAR2,
    p_message         OUT VARCHAR2,
    p_total_count     OUT NUMBER,
    p_success_count   OUT NUMBER,
    p_error_count     OUT NUMBER
) AS
BEGIN
    p_success_count := 0;
    p_error_count := 0;
    p_total_count := 0;

    -- Count total items
    SELECT COUNT(*)
    INTO p_total_count
    FROM JSON_TABLE(
        p_json_payload,
        '$.items[*]'
        COLUMNS (
            code_combination_id NUMBER PATH '$._CODE_COMBINATION_ID'
        )
    );

    -- MERGE: Insert or Update from JSON
    MERGE INTO reerp_gl_code_combinations tgt
    USING (
        SELECT
            jt."AccountType",
            jt."DetailBudgetingAllowedFlag",
            jt."JgzzReconFlag",
            jt."FinancialCategory",
            jt."DetailPostingAllowedFlag",
            jt."Reference3",
            jt."SummaryFlag",
            TO_DATE(jt."StartDateActive", 'YYYY-MM-DD') AS "StartDateActive",
            CASE
                WHEN jt."EndDateActive" IS NOT NULL
                THEN TO_DATE(jt."EndDateActive", 'YYYY-MM-DD')
                ELSE NULL
            END AS "EndDateActive",
            jt."EnabledFlag",
            jt."_CODE_COMBINATION_ID",
            jt."_CHART_OF_ACCOUNTS_ID",
            jt."buimercFinGlbCoaCo",
            jt."buimercFinGlbCoaLob",
            jt."buimercFinGlbCoaDepartment",
            jt."buimercFinGlbCoaAccount",
            jt."buimercFinGlbCoaSubAcc",
            jt."buimercFinGlbCoaAlys",
            jt."buimercFinGlbCoaIc",
            jt."buimercFinGlbCoaFut1",
            jt."buimercFinGlbCoaFut2"
        FROM JSON_TABLE(
            p_json_payload,
            '$.items[*]'
            COLUMNS (
                "AccountType"                 VARCHAR2(1)   PATH '$.AccountType',
                "DetailBudgetingAllowedFlag"  VARCHAR2(1)   PATH '$.DetailBudgetingAllowedFlag',
                "JgzzReconFlag"               VARCHAR2(1)   PATH '$.JgzzReconFlag',
                "FinancialCategory"           VARCHAR2(100) PATH '$.FinancialCategory',
                "DetailPostingAllowedFlag"    VARCHAR2(1)   PATH '$.DetailPostingAllowedFlag',
                "Reference3"                  VARCHAR2(150) PATH '$.Reference3',
                "SummaryFlag"                 VARCHAR2(1)   PATH '$.SummaryFlag',
                "StartDateActive"             VARCHAR2(20)  PATH '$.StartDateActive',
                "EndDateActive"               VARCHAR2(20)  PATH '$.EndDateActive',
                "EnabledFlag"                 VARCHAR2(1)   PATH '$.EnabledFlag',
                "_CODE_COMBINATION_ID"        NUMBER        PATH '$._CODE_COMBINATION_ID',
                "_CHART_OF_ACCOUNTS_ID"       NUMBER        PATH '$._CHART_OF_ACCOUNTS_ID',
                "buimercFinGlbCoaCo"          VARCHAR2(30)  PATH '$.buimercFinGlbCoaCo',
                "buimercFinGlbCoaLob"         VARCHAR2(30)  PATH '$.buimercFinGlbCoaLob',
                "buimercFinGlbCoaDepartment"  VARCHAR2(30)  PATH '$.buimercFinGlbCoaDepartment',
                "buimercFinGlbCoaAccount"     VARCHAR2(30)  PATH '$.buimercFinGlbCoaAccount',
                "buimercFinGlbCoaSubAcc"      VARCHAR2(30)  PATH '$.buimercFinGlbCoaSubAcc',
                "buimercFinGlbCoaAlys"        VARCHAR2(30)  PATH '$.buimercFinGlbCoaAlys',
                "buimercFinGlbCoaIc"          VARCHAR2(30)  PATH '$.buimercFinGlbCoaIc',
                "buimercFinGlbCoaFut1"        VARCHAR2(30)  PATH '$.buimercFinGlbCoaFut1',
                "buimercFinGlbCoaFut2"        VARCHAR2(30)  PATH '$.buimercFinGlbCoaFut2'
            )
        ) jt
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

    p_success_count := SQL%ROWCOUNT;
    p_error_count := p_total_count - p_success_count;

    COMMIT;

    p_status := 'SUCCESS';
    p_message := 'Processed ' || p_total_count || ' records. Success: ' || p_success_count || ', Errors: ' || p_error_count;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_status := 'ERROR';
        p_message := 'Error: ' || SQLERRM;
        p_total_count := NVL(p_total_count, 0);
        p_success_count := 0;
        p_error_count := NVL(p_total_count, 0);
END reerp_gl_cc_load_json;
/


-- ============================================================================
-- APEX REST POST Handler
-- ============================================================================
-- Module: reerp
-- Template: gl/codecombinations/sync
-- Method: POST
-- Source Type: PL/SQL
--
-- Copy the code below into the APEX REST Handler Source:
-- ============================================================================

/*
DECLARE
    l_status          VARCHAR2(20);
    l_message         VARCHAR2(4000);
    l_total_count     NUMBER;
    l_success_count   NUMBER;
    l_error_count     NUMBER;
BEGIN
    -- Call the procedure with request body
    reerp_gl_cc_load_json(
        p_json_payload    => :body_text,
        p_status          => l_status,
        p_message         => l_message,
        p_total_count     => l_total_count,
        p_success_count   => l_success_count,
        p_error_count     => l_error_count
    );

    -- Set HTTP status code
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 500 END;

    -- Return JSON response
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
        apex_json.write('totalCount', 0);
        apex_json.write('successCount', 0);
        apex_json.write('errorCount', 0);
        apex_json.close_object;
END;
*/


-- ============================================================================
-- Test the procedure with sample JSON
-- ============================================================================
/*
DECLARE
    l_json CLOB := '{
        "items": [
            {
                "AccountType": "L",
                "DetailBudgetingAllowedFlag": "Y",
                "JgzzReconFlag": "N",
                "FinancialCategory": null,
                "DetailPostingAllowedFlag": "Y",
                "Reference3": "N",
                "SummaryFlag": "N",
                "StartDateActive": "1952-01-01",
                "EndDateActive": null,
                "EnabledFlag": "Y",
                "_CODE_COMBINATION_ID": 300000002671383,
                "_CHART_OF_ACCOUNTS_ID": 2002,
                "buimercFinGlbCoaCo": "01",
                "buimercFinGlbCoaLob": "00",
                "buimercFinGlbCoaDepartment": "00",
                "buimercFinGlbCoaAccount": "2311100",
                "buimercFinGlbCoaSubAcc": "0000",
                "buimercFinGlbCoaAlys": "000",
                "buimercFinGlbCoaIc": "00",
                "buimercFinGlbCoaFut1": "000",
                "buimercFinGlbCoaFut2": "000"
            },
            {
                "AccountType": "A",
                "DetailBudgetingAllowedFlag": "Y",
                "JgzzReconFlag": "N",
                "FinancialCategory": null,
                "DetailPostingAllowedFlag": "Y",
                "Reference3": "N",
                "SummaryFlag": "N",
                "StartDateActive": "1952-01-01",
                "EndDateActive": null,
                "EnabledFlag": "Y",
                "_CODE_COMBINATION_ID": 300000002671384,
                "_CHART_OF_ACCOUNTS_ID": 2002,
                "buimercFinGlbCoaCo": "01",
                "buimercFinGlbCoaLob": "00",
                "buimercFinGlbCoaDepartment": "00",
                "buimercFinGlbCoaAccount": "1100000",
                "buimercFinGlbCoaSubAcc": "0000",
                "buimercFinGlbCoaAlys": "000",
                "buimercFinGlbCoaIc": "00",
                "buimercFinGlbCoaFut1": "000",
                "buimercFinGlbCoaFut2": "000"
            }
        ]
    }';
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
    l_total         NUMBER;
    l_success       NUMBER;
    l_error         NUMBER;
BEGIN
    reerp_gl_cc_load_json(
        p_json_payload    => l_json,
        p_status          => l_status,
        p_message         => l_message,
        p_total_count     => l_total,
        p_success_count   => l_success,
        p_error_count     => l_error
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || l_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || l_message);
    DBMS_OUTPUT.PUT_LINE('Total: ' || l_total);
    DBMS_OUTPUT.PUT_LINE('Success: ' || l_success);
    DBMS_OUTPUT.PUT_LINE('Errors: ' || l_error);
END;
/
*/


-- ============================================================================
-- Verify data
-- ============================================================================
/*
SELECT
    "_CODE_COMBINATION_ID",
    "buimercFinGlbCoaCo" || '-' ||
    "buimercFinGlbCoaLob" || '-' ||
    "buimercFinGlbCoaDepartment" || '-' ||
    "buimercFinGlbCoaAccount" || '-' ||
    "buimercFinGlbCoaSubAcc" || '-' ||
    "buimercFinGlbCoaAlys" || '-' ||
    "buimercFinGlbCoaIc" || '-' ||
    "buimercFinGlbCoaFut1" || '-' ||
    "buimercFinGlbCoaFut2" AS concatenated_segments,
    "AccountType",
    "EnabledFlag",
    creation_date
FROM reerp_gl_code_combinations
ORDER BY "_CODE_COMBINATION_ID";
*/
