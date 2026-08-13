-- =============================================================================
-- PATCH 15: Fix Requests & History tab
--
-- PROBLEMS:
--   1. RR_APPROVAL_REQUESTS has no LAST_UPDATE_DATE column — GET handler fails
--   2. Table is empty — approval send flow never inserts rows into it
--
-- STEPS:
--   1. Add LAST_UPDATE_DATE to RR_APPROVAL_REQUESTS
--   2. Fix GET approvals/requests (redeploy without the bad column ref)
--   3. New POST approvals/requests — creates request + SUBMITTED history row
--   4. Update GET approvals/approve to flip request status on approve/reject
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── Step 1: Add LAST_UPDATE_DATE to RR_APPROVAL_REQUESTS ─────────────────────
BEGIN
    EXECUTE IMMEDIATE
        'ALTER TABLE RR_APPROVAL_REQUESTS ADD LAST_UPDATE_DATE DATE DEFAULT SYSDATE';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN NULL; -- column already exists
        ELSE RAISE;
        END IF;
END;
/

-- ── Step 2: Fix GET approvals/requests ───────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/requests',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/requests',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob   CLOB;
    v_first  BOOLEAN := TRUE;
    v_module VARCHAR2(50)  := :module;
    v_status VARCHAR2(30)  := :status;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT rq.REQUEST_ID,
               rq.MODULE,
               rq.TRANSACTION_TYPE,
               rq.TRANSACTION_ID,
               rq.TRANSACTION_REF,
               rq.AMOUNT,
               rq.CURRENCY,
               rq.DESCRIPTION,
               rq.REQUESTED_BY_NAME,
               rq.STATUS,
               rq.RULE_ID,
               TO_CHAR(rq.REQUESTED_DATE,   'YYYY-MM-DD"T"HH24:MI:SS') AS REQUESTED_DATE,
               TO_CHAR(rq.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               u.FULL_NAME AS APPROVER_NAME,
               u.EMAIL     AS APPROVER_EMAIL
        FROM   RR_APPROVAL_REQUESTS rq
        LEFT   JOIN RR_APPROVAL_USERS u ON u.USER_ID = rq.CURRENT_APPROVER_ID
        WHERE  (v_module IS NULL OR rq.MODULE = v_module)
        AND    (v_status IS NULL OR rq.STATUS = v_status)
        ORDER  BY rq.REQUESTED_DATE DESC
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"requestId":'              || r.REQUEST_ID ||
            ',"module":'                 || APEX_JSON.STRINGIFY(NVL(r.MODULE,''))           ||
            ',"transactionType":'        || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_TYPE,'')) ||
            ',"transactionId":'          || NVL(TO_CHAR(r.TRANSACTION_ID),'null')           ||
            ',"transactionRef":'         || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_REF,''))  ||
            ',"amount":'                 || NVL(TO_CHAR(r.AMOUNT),'null')                   ||
            ',"currency":'               || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))      ||
            ',"description":'            || APEX_JSON.STRINGIFY(NVL(r.DESCRIPTION,''))      ||
            ',"requestedByName":'        || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_BY_NAME,''))||
            ',"status":'                 || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))    ||
            ',"ruleId":'                 || NVL(TO_CHAR(r.RULE_ID),'null')                  ||
            ',"requestedDate":'          || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_DATE,''))   ||
            ',"lastUpdateDate":'         || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,'')) ||
            ',"currentApproverName":'    || APEX_JSON.STRINGIFY(NVL(r.APPROVER_NAME,''))    ||
            ',"currentApproverEmail":'   || APEX_JSON.STRINGIFY(NVL(r.APPROVER_EMAIL,''))   ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    :status_code := 200;
    HTP.P(v_clob);
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET approvals/requests fixed.');
END;
/

-- ── Step 3: POST approvals/requests ──────────────────────────────────────────
-- Called by the React service when sending an approval.
-- Creates a row in RR_APPROVAL_REQUESTS + a SUBMITTED history entry.
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/requests',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/requests',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body          CLOB    := :body_text;
    v_module        VARCHAR2(50);
    v_txn_type      VARCHAR2(100);
    v_txn_id        NUMBER;
    v_txn_ref       VARCHAR2(300);
    v_amount        NUMBER;
    v_currency      VARCHAR2(10);
    v_description   VARCHAR2(1000);
    v_requested_by  VARCHAR2(200);
    v_approver_email VARCHAR2(500);
    v_approver_id   NUMBER;
    v_request_id    NUMBER;
BEGIN
    v_module         := JSON_VALUE(v_body, '$.module');
    v_txn_type       := JSON_VALUE(v_body, '$.transactionType');
    v_txn_id         := JSON_VALUE(v_body, '$.transactionId'  RETURNING NUMBER);
    v_txn_ref        := JSON_VALUE(v_body, '$.transactionRef');
    v_amount         := JSON_VALUE(v_body, '$.amount'         RETURNING NUMBER);
    v_currency       := NVL(JSON_VALUE(v_body, '$.currency'), 'AED');
    v_description    := JSON_VALUE(v_body, '$.description');
    v_requested_by   := JSON_VALUE(v_body, '$.requestedByName');
    v_approver_email := JSON_VALUE(v_body, '$.approverEmail');

    -- Look up approver USER_ID (optional — null if not found)
    BEGIN
        SELECT USER_ID INTO v_approver_id
        FROM   RR_APPROVAL_USERS
        WHERE  UPPER(EMAIL) = UPPER(v_approver_email)
        AND    ROWNUM = 1;
    EXCEPTION WHEN NO_DATA_FOUND THEN v_approver_id := NULL;
    END;

    -- Insert request row
    INSERT INTO RR_APPROVAL_REQUESTS (
        MODULE, TRANSACTION_TYPE, TRANSACTION_ID, TRANSACTION_REF,
        AMOUNT, CURRENCY, DESCRIPTION, REQUESTED_BY_NAME,
        STATUS, CURRENT_APPROVER_ID, REQUESTED_DATE, LAST_UPDATE_DATE
    ) VALUES (
        v_module, v_txn_type, v_txn_id, v_txn_ref,
        v_amount, v_currency, v_description, v_requested_by,
        'PENDING', v_approver_id, SYSDATE, SYSDATE
    )
    RETURNING REQUEST_ID INTO v_request_id;

    -- Insert SUBMITTED history entry
    INSERT INTO RR_APPROVAL_HISTORY (
        REQUEST_ID, ACTION, ACTOR_NAME, ACTION_DATE, NOTIFICATION_SENT
    ) VALUES (
        v_request_id, 'SUBMITTED', v_requested_by, SYSDATE, 'Y'
    );

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","requestId":' || v_request_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST approvals/requests registered.');
END;
/

-- ── Step 4: Update GET approvals/approve to also close the request ────────────
-- When an approver clicks Approve/Reject link the request row should flip to
-- APPROVED or REJECTED and a history entry should be written.
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/approve',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/approve',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_token  VARCHAR2(200) := :token;
    v_action VARCHAR2(10);
    v_ref    VARCHAR2(300);
    v_name   VARCHAR2(300);
    v_email  VARCHAR2(500);
    v_req_id NUMBER;
    v_new_status VARCHAR2(30);
BEGIN
    -- Validate token
    SELECT ACTION, REQUEST_REF,
           TO_NAME, TO_EMAIL
    INTO   v_action, v_ref, v_name, v_email
    FROM   RR_APPROVAL_TOKENS
    WHERE  TOKEN_VALUE  = v_token
    AND    TOKEN_STATUS = 'PENDING'
    AND    EXPIRES_AT   > SYSDATE;

    -- Mark token used
    UPDATE RR_APPROVAL_TOKENS
    SET    TOKEN_STATUS = 'USED',
           USED_AT      = SYSDATE
    WHERE  TOKEN_VALUE  = v_token;

    -- ── Update external cash transaction ──────────────────────────────────────
    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
    SET    APPROVAL_STATUS = CASE v_action
                               WHEN 'APPROVE' THEN 'Manually approved'
                               ELSE 'Rejected'
                             END,
           APPROVED_DATE   = SYSTIMESTAMP,
           APPROVED_BY     = v_name
    WHERE  APPROVAL_REF  = v_ref
    AND    NVL(APPROVAL_STATUS,'PENDING') = 'PENDING';

    -- ── Update AP invoice ─────────────────────────────────────────────────────
    UPDATE RR_AP_INVOICES_ALL
    SET    APPROVAL_STATUS         = CASE v_action
                                       WHEN 'APPROVE' THEN 'Manually approved'
                                       ELSE 'Rejected'
                                     END,
           APPROVED_DATE           = SYSTIMESTAMP,
           APPROVAL_APPROVER_NAME  = v_name,
           APPROVAL_APPROVER_EMAIL = v_email
    WHERE  APPROVAL_REF  = v_ref
    AND    NVL(APPROVAL_STATUS,'PENDING') = 'PENDING';

    -- ── Update approval request row ───────────────────────────────────────────
    v_new_status := CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END;

    BEGIN
        SELECT REQUEST_ID INTO v_req_id
        FROM   RR_APPROVAL_REQUESTS
        WHERE  TRANSACTION_REF = v_ref
        AND    STATUS          = 'PENDING'
        AND    ROWNUM = 1;

        UPDATE RR_APPROVAL_REQUESTS
        SET    STATUS           = v_new_status,
               LAST_UPDATE_DATE = SYSDATE
        WHERE  REQUEST_ID       = v_req_id;

        INSERT INTO RR_APPROVAL_HISTORY (
            REQUEST_ID, ACTION, ACTOR_NAME, ACTION_DATE, NOTIFICATION_SENT
        ) VALUES (
            v_req_id,
            CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
            v_name,
            SYSDATE,
            'N'
        );
    EXCEPTION WHEN NO_DATA_FOUND THEN NULL; -- request row may not exist; skip
    END;

    COMMIT;

    -- Return a friendly HTML page
    HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8">');
    HTP.P('<title>' || CASE v_action WHEN 'APPROVE' THEN 'Approved' ELSE 'Rejected' END || '</title>');
    HTP.P('<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}');
    HTP.P('.card{background:#fff;border-radius:12px;padding:40px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:420px}');
    HTP.P('h2{margin:0 0 8px}p{color:#555;margin:0}</style></head><body><div class="card">');
    IF v_action = 'APPROVE' THEN
        HTP.P('<h2 style="color:#1D7B4D">&#10003; Approved</h2>');
        HTP.P('<p>You approved <strong>' || APEX_JSON.STRINGIFY(v_ref) || '</strong>.</p>');
    ELSE
        HTP.P('<h2 style="color:#C74634">&#10007; Rejected</h2>');
        HTP.P('<p>You rejected <strong>' || APEX_JSON.STRINGIFY(v_ref) || '</strong>.</p>');
    END IF;
    HTP.P('<p style="margin-top:16px;font-size:12px;color:#999">You may close this window.</p>');
    HTP.P('</div></body></html>');

EXCEPTION
    WHEN NO_DATA_FOUND THEN
        :status_code := 400;
        HTP.P('<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px">');
        HTP.P('<h2 style="color:#C74634">Link Expired or Already Used</h2>');
        HTP.P('<p>This approval link is no longer valid.</p></body></html>');
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET approvals/approve updated.');
END;
/
