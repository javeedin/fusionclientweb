-- =============================================================================
-- PATCH 04: Rebuild POST / PUT / DELETE for approvals/rules
--
-- Same problems as 01_setup.sql rules handlers:
--   1. p_source_type => 'plsql/block'           (invalid)
--   2. :status / :body bind vars                (invalid)
--   3. JSON_OBJECT_T / JSON_ARRAY_T / TREAT     (ORA-40573 — not supported here)
--
-- Fix: use JSON_TABLE for all field extraction (same as all other working handlers)
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── POST approvals/rules ──────────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/rules',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/rules',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body       CLOB    := :body_text;
    v_rule_name  VARCHAR2(200);
    v_module     VARCHAR2(50);
    v_txn_type   VARCHAR2(100);
    v_desc       VARCHAR2(500);
    v_min_amt    VARCHAR2(50);
    v_max_amt    VARCHAR2(50);
    v_currency   VARCHAR2(10);
    v_appr_type  VARCHAR2(30);
    v_priority   VARCHAR2(10);
    v_active     VARCHAR2(1);
    v_rule_id    NUMBER;
BEGIN
    -- Extract scalar fields
    SELECT jt.rule_name, jt.module, jt.txn_type, jt.descr,
           jt.min_amt, jt.max_amt, jt.currency,
           jt.appr_type, jt.priority, jt.active
    INTO   v_rule_name, v_module, v_txn_type, v_desc,
           v_min_amt, v_max_amt, v_currency,
           v_appr_type, v_priority, v_active
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               rule_name  VARCHAR2(200) PATH '$.ruleName',
               module     VARCHAR2(50)  PATH '$.module',
               txn_type   VARCHAR2(100) PATH '$.transactionType',
               descr      VARCHAR2(500) PATH '$.description',
               min_amt    VARCHAR2(50)  PATH '$.minAmount',
               max_amt    VARCHAR2(50)  PATH '$.maxAmount',
               currency   VARCHAR2(10)  PATH '$.currency',
               appr_type  VARCHAR2(30)  PATH '$.approvalType',
               priority   VARCHAR2(10)  PATH '$.priority',
               active     VARCHAR2(1)   PATH '$.active'
             )
           ) jt;

    INSERT INTO RR_APPROVAL_RULES (
        RULE_NAME, MODULE, TRANSACTION_TYPE, DESCRIPTION,
        MIN_AMOUNT, MAX_AMOUNT, CURRENCY, APPROVAL_TYPE,
        PRIORITY, ACTIVE, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
    ) VALUES (
        v_rule_name,
        v_module,
        v_txn_type,
        v_desc,
        NVL(TO_NUMBER(v_min_amt), 0),
        TO_NUMBER(v_max_amt),
        NVL(v_currency,  'AED'),
        NVL(v_appr_type, 'SEQUENTIAL'),
        NVL(TO_NUMBER(v_priority), 10),
        NVL(v_active,    'Y'),
        SYS_CONTEXT('APEX$SESSION', 'APP_USER'),
        SYSDATE, SYSDATE
    ) RETURNING RULE_ID INTO v_rule_id;

    -- Insert approvers from nested array $.approvers[*]
    FOR a IN (
        SELECT jt.user_id, jt.seq
        FROM   JSON_TABLE(v_body, '$.approvers[*]'
                 COLUMNS (
                   user_id NUMBER PATH '$.userId',
                   seq     NUMBER PATH '$.sequence'
                 )
               ) jt
        WHERE  jt.user_id IS NOT NULL
    ) LOOP
        INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
        VALUES (v_rule_id, a.user_id, a.seq);
    END LOOP;

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","ruleId":' || v_rule_id || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── PUT approvals/rules/:id ───────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/rules/:id',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/rules/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body       CLOB    := :body_text;
    v_rule_name  VARCHAR2(200);
    v_module     VARCHAR2(50);
    v_txn_type   VARCHAR2(100);
    v_desc       VARCHAR2(500);
    v_min_amt    VARCHAR2(50);
    v_max_amt    VARCHAR2(50);
    v_currency   VARCHAR2(10);
    v_appr_type  VARCHAR2(30);
    v_priority   VARCHAR2(10);
    v_active     VARCHAR2(1);
    v_cnt        NUMBER;
BEGIN
    SELECT jt.rule_name, jt.module, jt.txn_type, jt.descr,
           jt.min_amt, jt.max_amt, jt.currency,
           jt.appr_type, jt.priority, jt.active
    INTO   v_rule_name, v_module, v_txn_type, v_desc,
           v_min_amt, v_max_amt, v_currency,
           v_appr_type, v_priority, v_active
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               rule_name  VARCHAR2(200) PATH '$.ruleName',
               module     VARCHAR2(50)  PATH '$.module',
               txn_type   VARCHAR2(100) PATH '$.transactionType',
               descr      VARCHAR2(500) PATH '$.description',
               min_amt    VARCHAR2(50)  PATH '$.minAmount',
               max_amt    VARCHAR2(50)  PATH '$.maxAmount',
               currency   VARCHAR2(10)  PATH '$.currency',
               appr_type  VARCHAR2(30)  PATH '$.approvalType',
               priority   VARCHAR2(10)  PATH '$.priority',
               active     VARCHAR2(1)   PATH '$.active'
             )
           ) jt;

    UPDATE RR_APPROVAL_RULES SET
        RULE_NAME        = NVL(v_rule_name,  RULE_NAME),
        MODULE           = NVL(v_module,     MODULE),
        TRANSACTION_TYPE = NVL(v_txn_type,   TRANSACTION_TYPE),
        DESCRIPTION      = v_desc,
        MIN_AMOUNT       = NVL(TO_NUMBER(v_min_amt), MIN_AMOUNT),
        MAX_AMOUNT       = TO_NUMBER(v_max_amt),
        CURRENCY         = NVL(v_currency,   CURRENCY),
        APPROVAL_TYPE    = NVL(v_appr_type,  APPROVAL_TYPE),
        PRIORITY         = NVL(TO_NUMBER(v_priority), PRIORITY),
        ACTIVE           = NVL(v_active,     ACTIVE),
        LAST_UPDATE_DATE = SYSDATE
    WHERE RULE_ID = :id;

    v_cnt := SQL%ROWCOUNT;

    IF v_cnt > 0 THEN
        -- Replace approvers
        DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
        FOR a IN (
            SELECT jt.user_id, jt.seq
            FROM   JSON_TABLE(v_body, '$.approvers[*]'
                     COLUMNS (
                       user_id NUMBER PATH '$.userId',
                       seq     NUMBER PATH '$.sequence'
                     )
                   ) jt
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
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── DELETE approvals/rules/:id ────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/rules/:id',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/rules/:id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
BEGIN
    DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
    DELETE FROM RR_APPROVAL_RULES           WHERE RULE_ID = :id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","message":"Rule deleted"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
