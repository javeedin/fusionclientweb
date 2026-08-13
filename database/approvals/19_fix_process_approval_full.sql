-- =============================================================================
-- PATCH 19: Unified in-app approval — full data recording
--
-- PROBLEMS:
--   1. PUT /approvals/email-replies/:id/process only marks the reply as
--      PROCESSED; it does not update the underlying AP invoice or cash
--      transaction, and does not insert into RR_APPROVAL_HISTORY.
--      → "Process Approval" button in email confirmations has no effect
--        on the invoice/transaction record.
--
--   2. PUT /approvals/requests/:id/status (patch 17) stores
--      APPROVAL_APPROVER_NAME but silently ignores APPROVAL_APPROVER_EMAIL.
--      → In-app approvals from the notification panel leave the email blank
--        in the approval history modal.
--
-- FIX:
--   Step 1 — Redeploy PUT approvals/email-replies/:id/process to:
--     • Read FROM_EMAIL, FROM_NAME, ACTION_DETECTED, REF_NUMBER from the reply
--     • Look up MODULE in RR_APPROVAL_REQUESTS via REQUEST_ID
--     • Update RR_AP_INVOICES_ALL (if AP) or RR_EXTERNAL_CASH_TRANSACTIONS
--       (if CASH) with full approval details
--     • Insert an entry into RR_APPROVAL_HISTORY
--     • Update RR_APPROVAL_REQUESTS status
--     • Mark the reply as PROCESSED
--
--   Step 2 — Redeploy PUT approvals/requests/:id/status to also accept
--     actorEmail and store it in APPROVAL_APPROVER_EMAIL.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately.
-- =============================================================================

-- ── Step 1: PUT approvals/email-replies/:id/process ──────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/email-replies/:id/process',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/email-replies/:id/process',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'#
DECLARE
    v_reply_id   NUMBER        := TO_NUMBER(:id);
    v_body       CLOB          := :body_text;
    v_actor      VARCHAR2(200) := JSON_VALUE(v_body, '$.actorName');
    v_notes      VARCHAR2(1000):= JSON_VALUE(v_body, '$.notes');

    -- Reply row fields
    v_from_name  VARCHAR2(300);
    v_from_email VARCHAR2(500);
    v_action     VARCHAR2(10);
    v_ref        VARCHAR2(200);
    v_req_id     NUMBER;

    -- Request row fields
    v_module     VARCHAR2(50);
    v_txn_ref    VARCHAR2(300);

    v_cnt        NUMBER;
    v_new_status VARCHAR2(30);
BEGIN
    -- Read reply
    BEGIN
        SELECT FROM_NAME, FROM_EMAIL, ACTION_DETECTED, REF_NUMBER, REQUEST_ID
        INTO   v_from_name, v_from_email, v_action, v_ref, v_req_id
        FROM   RR_APPROVAL_EMAIL_REPLIES
        WHERE  REPLY_ID = v_reply_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"status":"ERROR","message":"Reply not found"}');
            RETURN;
    END;

    -- Resolve MODULE and TRANSACTION_REF from RR_APPROVAL_REQUESTS if possible
    BEGIN
        SELECT MODULE, TRANSACTION_REF
        INTO   v_module, v_txn_ref
        FROM   RR_APPROVAL_REQUESTS
        WHERE  REQUEST_ID = v_req_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            -- Fall back: use the ref from the email reply directly
            v_txn_ref := v_ref;
            -- Detect module: check legacy prefix first, then probe tables
            IF v_ref LIKE 'AP-INV-%' THEN
                v_module := 'AP';
            ELSIF v_ref LIKE 'CASH-EXT-%' THEN
                v_module := 'CASH';
            ELSE
                -- Invoice number used directly as ref — probe which table holds it
                DECLARE v_probe NUMBER; BEGIN
                    SELECT 1 INTO v_probe FROM RR_AP_INVOICES_ALL
                    WHERE APPROVAL_REF = v_ref AND ROWNUM = 1;
                    v_module := 'AP';
                EXCEPTION WHEN NO_DATA_FOUND THEN
                    BEGIN
                        SELECT 1 INTO v_probe FROM RR_EXTERNAL_CASH_TRANSACTIONS
                        WHERE APPROVAL_REF = v_ref AND ROWNUM = 1;
                        v_module := 'CASH';
                    EXCEPTION WHEN NO_DATA_FOUND THEN
                        v_module := NULL;
                    END;
                END;
            END IF;
    END;

    -- Use override actor name if provided (in-app approval), else use email sender
    IF v_actor IS NULL THEN v_actor := v_from_name; END IF;

    v_new_status := CASE v_action
                        WHEN 'APPROVE' THEN 'Manually approved'
                        WHEN 'REJECT'  THEN 'Rejected'
                        ELSE 'Rejected'
                    END;

    -- Update AP Invoice (if applicable)
    IF v_module = 'AP' OR v_ref LIKE 'AP-INV-%' THEN
        UPDATE RR_AP_INVOICES_ALL
        SET    APPROVAL_STATUS         = v_new_status,
               APPROVED_DATE           = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME  = NVL(v_actor, v_from_name),
               APPROVAL_APPROVER_EMAIL = v_from_email
        WHERE  APPROVAL_REF = v_txn_ref
          AND  NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved', 'Rejected');
    END IF;

    -- Update Cash External Transaction (if applicable)
    IF v_module = 'CASH' OR v_ref LIKE 'CASH-EXT-%' THEN
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
        SET    APPROVAL_STATUS  = v_new_status,
               APPROVED_DATE    = SYSTIMESTAMP,
               APPROVED_BY      = NVL(v_actor, v_from_name)
        WHERE  APPROVAL_REF = v_txn_ref
          AND  NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved', 'Rejected');
    END IF;

    -- Update RR_APPROVAL_REQUESTS status
    IF v_req_id IS NOT NULL THEN
        UPDATE RR_APPROVAL_REQUESTS
        SET    STATUS           = CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
               LAST_UPDATE_DATE = SYSDATE
        WHERE  REQUEST_ID       = v_req_id;

        -- Insert approval history entry
        INSERT INTO RR_APPROVAL_HISTORY (
            REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS, ACTION_DATE, NOTIFICATION_SENT
        ) VALUES (
            v_req_id,
            CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
            NVL(v_actor, v_from_name),
            NVL(v_notes, 'Processed via ERP on ' || TO_CHAR(SYSDATE, 'DD-MON-YYYY HH24:MI')),
            SYSDATE,
            'N'
        );
    END IF;

    -- Mark reply as PROCESSED
    UPDATE RR_APPROVAL_EMAIL_REPLIES
    SET    STATUS         = 'PROCESSED',
           PROCESSED_DATE = SYSTIMESTAMP,
           PROCESSED_BY   = NVL(v_actor, SYS_CONTEXT('APEX$SESSION','APP_USER')),
           NOTES          = v_notes
    WHERE  REPLY_ID = v_reply_id;

    v_cnt := SQL%ROWCOUNT;
    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Reply not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"' || v_new_status || '","ref":"' || NVL(v_txn_ref,'') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
#'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT approvals/email-replies/:id/process updated (patch 19: full approval).');
END;
/

-- ── Step 2: PUT approvals/requests/:id/status — add actorEmail ───────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/requests/:id/status',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/requests/:id/status',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'#
DECLARE
    v_request_id  NUMBER        := TO_NUMBER(:id);
    v_body        CLOB          := :body_text;
    v_status      VARCHAR2(30)  := JSON_VALUE(v_body, '$.status');
    v_actor       VARCHAR2(200) := JSON_VALUE(v_body, '$.actorName');
    v_actor_email VARCHAR2(500) := JSON_VALUE(v_body, '$.actorEmail');
    v_comments    VARCHAR2(2000):= JSON_VALUE(v_body, '$.comments');
    v_module      VARCHAR2(50);
    v_txn_ref     VARCHAR2(300);
    v_rows        NUMBER;
BEGIN
    IF v_status NOT IN ('APPROVED','REJECTED','CANCELLED','RECALLED') THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"Invalid status. Must be APPROVED, REJECTED, CANCELLED or RECALLED."}');
        RETURN;
    END IF;

    BEGIN
        SELECT MODULE, TRANSACTION_REF
        INTO   v_module, v_txn_ref
        FROM   RR_APPROVAL_REQUESTS
        WHERE  REQUEST_ID = v_request_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"status":"ERROR","message":"Request not found."}');
            RETURN;
    END;

    UPDATE RR_APPROVAL_REQUESTS
    SET    STATUS           = v_status,
           LAST_UPDATE_DATE = SYSDATE
    WHERE  REQUEST_ID       = v_request_id;

    v_rows := SQL%ROWCOUNT;

    INSERT INTO RR_APPROVAL_HISTORY (
        REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS, ACTION_DATE, NOTIFICATION_SENT
    ) VALUES (
        v_request_id,
        v_status,
        NVL(v_actor, 'System'),
        v_comments,
        SYSDATE,
        'N'
    );

    -- Update AP Invoice (if applicable)
    IF v_module = 'AP' THEN
        UPDATE RR_AP_INVOICES_ALL
        SET    APPROVAL_STATUS         = CASE v_status
                                             WHEN 'APPROVED' THEN 'Manually approved'
                                             WHEN 'REJECTED' THEN 'Rejected'
                                             ELSE v_status
                                         END,
               APPROVED_DATE           = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME  = NVL(v_actor, 'System'),
               APPROVAL_APPROVER_EMAIL = v_actor_email
        WHERE  APPROVAL_REF = v_txn_ref
          AND  NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved','Rejected');
    END IF;

    -- Update Cash External Transaction (if applicable)
    IF v_module = 'CASH' THEN
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
        SET    APPROVAL_STATUS  = CASE v_status
                                      WHEN 'APPROVED' THEN 'Manually approved'
                                      WHEN 'REJECTED' THEN 'Rejected'
                                      ELSE v_status
                                  END,
               APPROVED_DATE    = SYSTIMESTAMP,
               APPROVED_BY      = NVL(v_actor, 'System')
        WHERE  APPROVAL_REF = v_txn_ref
          AND  NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved','Rejected');
    END IF;

    COMMIT;

    :status_code := 200;
    HTP.P('{"status":"SUCCESS","requestId":' || v_request_id || ',"newStatus":"' || v_status || '","rowsUpdated":' || v_rows || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
#'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT approvals/requests/:id/status updated (patch 19: added actorEmail).');
END;
/
