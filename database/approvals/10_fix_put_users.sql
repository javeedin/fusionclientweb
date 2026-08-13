-- =============================================================================
-- PATCH 10: Redeploy PUT approvals/users/:id
--
-- Root cause of ORA-06550 / PLS-00382:
--   The live handler (from 01_setup.sql) assigns to :body and :status bind
--   variables which are no longer writable in this ORDS version, causing a
--   compile-time type mismatch.  Additionally, JSON_OBJECT_T.get_string()
--   fails when the frontend sends modules as a JSON array ["AP","CASH"].
--
-- This patch replaces that handler using:
--   - JSON_VALUE for each scalar field (no CLOB/JSON_TABLE scalar issue)
--   - JSON_TABLE only for the modules array conversion
--   - HTP.P() + :status_code (correct modern ORDS output variables)
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the single BEGIN...END; block below
-- =============================================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/users/:id',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/users/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body     CLOB    := :body_text;
    v_full_name VARCHAR2(500);
    v_email     VARCHAR2(500);
    v_phone     VARCHAR2(100);
    v_dept      VARCHAR2(200);
    v_job       VARCHAR2(200);
    v_max_amt   VARCHAR2(50);
    v_currency  VARCHAR2(10);
    v_active    VARCHAR2(1);
    v_modules   VARCHAR2(500);
    v_cnt       NUMBER;
BEGIN
    -- Extract each scalar field with JSON_VALUE (safe with CLOB, handles nulls)
    v_full_name := JSON_VALUE(v_body, '$.fullName');
    v_email     := JSON_VALUE(v_body, '$.email');
    v_phone     := JSON_VALUE(v_body, '$.phoneNumber');
    v_dept      := JSON_VALUE(v_body, '$.department');
    v_job       := JSON_VALUE(v_body, '$.jobTitle');
    v_max_amt   := JSON_VALUE(v_body, '$.maxApprovalAmount');
    v_currency  := JSON_VALUE(v_body, '$.currency');
    v_active    := JSON_VALUE(v_body, '$.active');

    -- Convert ["AP","CASH"] array → "AP,CASH" string
    BEGIN
        SELECT LISTAGG(jt.val, ',') WITHIN GROUP (ORDER BY jt.ord)
        INTO   v_modules
        FROM   JSON_TABLE(v_body, '$.modules[*]'
                 COLUMNS (ord FOR ORDINALITY, val VARCHAR2(50) PATH '$')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_modules := NULL;
    END;

    UPDATE RR_APPROVAL_USERS SET
        FULL_NAME        = NVL(v_full_name,  FULL_NAME),
        EMAIL            = NVL(v_email,      EMAIL),
        PHONE_NUMBER     = v_phone,
        DEPARTMENT       = v_dept,
        JOB_TITLE        = v_job,
        MAX_APPROVAL_AMT = CASE
                             WHEN v_max_amt IS NULL THEN NULL
                             ELSE TO_NUMBER(v_max_amt)
                           END,
        CURRENCY         = NVL(v_currency,  CURRENCY),
        MODULES          = NVL(v_modules,   MODULES),
        ACTIVE           = NVL(v_active,    ACTIVE),
        LAST_UPDATE_DATE = SYSDATE
    WHERE USER_ID = :id;

    v_cnt := SQL%ROWCOUNT;
    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Approver not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Approver updated"}');
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
