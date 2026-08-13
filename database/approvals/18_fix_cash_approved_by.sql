-- =============================================================================
-- PATCH 18: Fix APPROVED_BY → APPROVAL_APPROVER_NAME in direct approval handler
--
-- PURPOSE:
--   Patch 17 used APPROVED_BY which does not exist in RR_EXTERNAL_CASH_TRANSACTIONS.
--   The correct column (added in patch 96) is APPROVAL_APPROVER_NAME.
--   This patch re-registers the PUT approvals/requests/:id/status handler with
--   the correct column name.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the single BEGIN...END; block
-- =============================================================================

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
        p_source         => q'[
DECLARE
    v_request_id  NUMBER        := TO_NUMBER(:id);
    v_body        CLOB          := :body_text;
    v_status      VARCHAR2(30)  := JSON_VALUE(v_body, '$.status');
    v_actor       VARCHAR2(200) := JSON_VALUE(v_body, '$.actorName');
    v_comments    VARCHAR2(2000):= JSON_VALUE(v_body, '$.comments');
    v_module      VARCHAR2(50);
    v_txn_ref     VARCHAR2(300);
    v_rows        NUMBER;
BEGIN
    -- Validate status value
    IF v_status NOT IN ('APPROVED','REJECTED','CANCELLED','RECALLED') THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"Invalid status. Must be APPROVED, REJECTED, CANCELLED or RECALLED."}');
        RETURN;
    END IF;

    -- Read module + ref for downstream update
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

    -- Update the approval request row
    UPDATE RR_APPROVAL_REQUESTS
    SET    STATUS           = v_status,
           LAST_UPDATE_DATE = SYSDATE
    WHERE  REQUEST_ID       = v_request_id;

    v_rows := SQL%ROWCOUNT;

    -- Insert history entry
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

    -- Update underlying cash transaction if applicable
    IF v_module = 'CASH' THEN
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
        SET    APPROVAL_STATUS        = CASE v_status
                                            WHEN 'APPROVED' THEN 'Manually approved'
                                            WHEN 'REJECTED' THEN 'Rejected'
                                            ELSE v_status
                                        END,
               APPROVED_DATE          = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME = NVL(v_actor, 'System')
        WHERE  APPROVAL_REF    = v_txn_ref
        AND    NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved','Rejected');
    END IF;

    -- Update underlying AP invoice if applicable
    IF v_module = 'AP' THEN
        UPDATE RR_AP_INVOICES_ALL
        SET    APPROVAL_STATUS        = CASE v_status
                                            WHEN 'APPROVED' THEN 'Manually approved'
                                            WHEN 'REJECTED' THEN 'Rejected'
                                            ELSE v_status
                                        END,
               APPROVED_DATE          = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME = NVL(v_actor, 'System')
        WHERE  APPROVAL_REF  = v_txn_ref
        AND    NVL(APPROVAL_STATUS, 'PENDING') NOT IN ('Manually approved','Rejected');
    END IF;

    COMMIT;

    :status_code := 200;
    HTP.P('{"status":"SUCCESS","requestId":' || v_request_id || ',"newStatus":"' || v_status || '","rowsUpdated":' || v_rows || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT approvals/requests/:id/status fixed (APPROVAL_APPROVER_NAME).');
END;
/
