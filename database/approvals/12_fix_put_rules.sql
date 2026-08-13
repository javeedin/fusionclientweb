-- =============================================================================
-- PATCH 12: Fix PUT approvals/rules/:id  (ORA-06550 / PLS-00382)
--
-- The live handler from 01_setup.sql uses JSON_OBJECT_T + :body/:status
-- bind variables that are no longer valid in this ORDS version.
-- This patch force-replaces it with JSON_VALUE + HTP.P() + :status_code.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste the ENTIRE block below and run
-- =============================================================================

DECLARE
    v_exists NUMBER;
BEGIN
    -- Step 1: Remove the old handler (ignore if already gone)
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/rules/:id',
            p_method      => 'PUT'
        );
        COMMIT;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Step 2: Register the new handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/rules/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body CLOB := :body_text;
    v_cnt  NUMBER;
BEGIN
    UPDATE RR_APPROVAL_RULES SET
        RULE_NAME        = NVL(JSON_VALUE(v_body,'$.ruleName'),        RULE_NAME),
        MODULE           = NVL(JSON_VALUE(v_body,'$.module'),          MODULE),
        TRANSACTION_TYPE = NVL(JSON_VALUE(v_body,'$.transactionType'), TRANSACTION_TYPE),
        DESCRIPTION      = JSON_VALUE(v_body,'$.description'),
        MIN_AMOUNT       = NVL(TO_NUMBER(JSON_VALUE(v_body,'$.minAmount')), MIN_AMOUNT),
        MAX_AMOUNT       = CASE WHEN JSON_VALUE(v_body,'$.maxAmount') IS NULL THEN NULL
                                ELSE TO_NUMBER(JSON_VALUE(v_body,'$.maxAmount')) END,
        CURRENCY         = NVL(JSON_VALUE(v_body,'$.currency'),        CURRENCY),
        APPROVAL_TYPE    = NVL(JSON_VALUE(v_body,'$.approvalType'),    APPROVAL_TYPE),
        PRIORITY         = NVL(TO_NUMBER(JSON_VALUE(v_body,'$.priority')), PRIORITY),
        ACTIVE           = NVL(JSON_VALUE(v_body,'$.active'),          ACTIVE),
        LAST_UPDATE_DATE = SYSDATE
    WHERE RULE_ID = :id;

    v_cnt := SQL%ROWCOUNT;

    IF v_cnt > 0 THEN
        DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
        FOR a IN (
            SELECT jt.user_id, jt.seq
            FROM   JSON_TABLE(v_body, '$.approvers[*]'
                     COLUMNS (user_id NUMBER PATH '$.userId',
                              seq     NUMBER PATH '$.sequence')) jt
            WHERE  jt.user_id IS NOT NULL
        ) LOOP
            INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
            VALUES (:id, a.user_id, a.seq);
        END LOOP;
    END IF;

    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Rule not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Rule updated"}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT approvals/rules/:id registered successfully');
END;
/
