-- =============================================================================
-- PATCH 97: AP Invoice Approval Workflow
--
-- STEPS:
--   1. ADD approval tracking columns to RR_AP_INVOICES_ALL
--   2. Redeploy GET ap/createinvoice to include new approval columns
--   3. New PUT ap/invoices/:id/approval endpoint
--   4. Redeploy GET approvals/approve to also update AP invoices
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── Step 1: Add approval tracking columns ─────────────────────────────────────
DECLARE
    PROCEDURE add_col(p_col VARCHAR2, p_def VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_AP_INVOICES_ALL ADD ' || p_col || ' ' || p_def;
    EXCEPTION WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN NULL; -- column already exists
        ELSE RAISE; END IF;
    END;
BEGIN
    add_col('APPROVAL_SENT_DATE',      'TIMESTAMP');
    add_col('APPROVAL_SENT_BY',        'VARCHAR2(200)');
    add_col('APPROVAL_APPROVER_NAME',  'VARCHAR2(300)');
    add_col('APPROVAL_APPROVER_EMAIL', 'VARCHAR2(500)');
    add_col('APPROVED_DATE',           'TIMESTAMP');
    add_col('APPROVAL_REF',            'VARCHAR2(200)');
    DBMS_OUTPUT.PUT_LINE('RR_AP_INVOICES_ALL approval columns added.');
END;
/

-- ── Step 2: Redeploy GET ap/createinvoice with approval tracking columns ──────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'ap/createinvoice',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/createinvoice',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_comments       => 'Search AP Invoices — includes approval tracking columns',
        p_source         => q'[
SELECT
    i.invoice_id,
    i.invoice_number,
    i.invoice_currency,
    i.payment_currency,
    i.invoice_amount,
    TO_CHAR(i.invoice_date, 'YYYY-MM-DD')        AS invoice_date,
    TO_CHAR(i.creation_date, 'YYYY-MM-DD')       AS creation_date,
    i.business_unit,
    i.legal_entity,
    i.supplier,
    i.supplier_number,
    i.supplier_site,
    i.invoice_group,
    i.invoice_source,
    i.invoice_type,
    i.description,
    TO_CHAR(i.accounting_date, 'YYYY-MM-DD')     AS accounting_date,
    TO_CHAR(i.terms_date, 'YYYY-MM-DD')          AS terms_date,
    TO_CHAR(i.goods_received_date, 'YYYY-MM-DD') AS goods_received_date,
    i.pay_group,
    i.payment_terms,
    i.payment_method,
    NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0)  AS amount_paid,
    CASE
        WHEN NVL(i.invoice_amount, 0) < 0 THEN
            NVL(i.invoice_amount, 0)
            - NVL(pay.total_paid, NVL(i.amount_paid, 0))
            - NVL(prep.total_prep, 0)
        ELSE
            GREATEST(0,
                NVL(i.invoice_amount, 0)
                - NVL(pay.total_paid, NVL(i.amount_paid, 0))
                - NVL(prep.total_prep, 0)
            )
    END AS unpaid_amount,
    CASE
        WHEN NVL(i.canceled_flag, 'N') = 'Y'     THEN 'Cancelled'
        WHEN NVL(i.invoice_amount, 0) = 0         THEN NVL(i.paid_status, 'Unpaid')
        WHEN NVL(i.invoice_amount, 0) < 0         THEN
            CASE
                WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
                     <= NVL(i.invoice_amount, 0)                             THEN 'Fully Paid'
                WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
                     < 0                                                      THEN 'Partially Paid'
                ELSE NVL(i.paid_status, 'Unpaid')
            END
        WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
             >= NVL(i.invoice_amount, 0)                                     THEN 'Fully Paid'
        WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
             > 0                                                              THEN 'Partially Paid'
        ELSE NVL(i.paid_status, 'Unpaid')
    END AS paid_status,
    i.canceled_flag,
    TO_CHAR(NVL(i.canceled_date, i.cancellation_date), 'YYYY-MM-DD') AS canceled_date,
    NVL(i.canceled_by, i.cancelled_by)                               AS canceled_by,
    i.validation_status,
    i.approval_status,
    (SELECT h.accounting_status
     FROM   RR_SLA_ACCOUNTING_HEADERS h
     WHERE  h.source_table = 'AP_INVOICES'
       AND  h.source_id    = i.invoice_id
     ORDER BY h.header_id DESC
     FETCH FIRST 1 ROWS ONLY)                      AS accounting_status,
    TO_CHAR(i.apply_after_date, 'YYYY-MM-DD')    AS apply_after_date,
    NVL(prep.total_prep, 0)                       AS applied_prepayments,
    i.liability_distribution,
    -- Approval tracking columns
    TO_CHAR(i.approval_sent_date,  'YYYY-MM-DD"T"HH24:MI:SS') AS approval_sent_date,
    i.approval_sent_by,
    i.approval_approver_name,
    i.approval_approver_email,
    TO_CHAR(i.approved_date, 'YYYY-MM-DD"T"HH24:MI:SS')       AS approved_date,
    i.approval_ref
FROM  RR_AP_INVOICES_ALL i
LEFT JOIN (
    SELECT INVOICE_ID,
           SUM(NVL(AMOUNT_PAID_PAYMENT_CURRENCY, 0) + NVL(DISCOUNT_TAKEN, 0)) AS total_paid
    FROM   RR_AP_PAYMENTS_RELATED_INVOICES
    GROUP BY INVOICE_ID
) pay  ON pay.INVOICE_ID  = i.invoice_id
LEFT JOIN (
    SELECT INVOICE_ID,
           SUM(NVL(applied_amount, 0)) AS total_prep
    FROM   RR_AP_APPLIED_PREPAYMENTS
    WHERE  status = 'Applied'
    GROUP BY INVOICE_ID
) prep ON prep.INVOICE_ID = i.invoice_id
WHERE (i.supplier_number  = :supplier_number  OR :supplier_number  IS NULL)
  AND (i.business_unit    = :business_unit    OR :business_unit    IS NULL)
  AND (UPPER(i.invoice_number) LIKE '%' || UPPER(:invoice_number) || '%'
       OR :invoice_number IS NULL)
  AND (UPPER(i.supplier)  LIKE '%' || UPPER(:supplier) || '%'
       OR :supplier IS NULL)
  AND (TRUNC(i.invoice_date) >= TO_DATE(:invoice_date_from, 'YYYY-MM-DD') OR :invoice_date_from IS NULL)
  AND (TRUNC(i.invoice_date) <= TO_DATE(:invoice_date_to,   'YYYY-MM-DD') OR :invoice_date_to   IS NULL)
  AND (i.invoice_amount   = :invoice_amount   OR :invoice_amount   IS NULL)
  AND (i.supplier_site    = :supplier_site    OR :supplier_site    IS NULL)
  AND (UPPER(i.invoice_group) LIKE '%' || UPPER(:invoice_group) || '%'
       OR :invoice_group IS NULL)
  AND (i.invoice_id       = :invoice_id       OR :invoice_id       IS NULL)
  AND (i.invoice_type     = :invoice_type     OR :invoice_type     IS NULL)
ORDER BY i.invoice_date DESC, i.invoice_id DESC
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET ap/createinvoice redeployed with approval columns.');
END;
/

-- ── Step 3: PUT ap/invoices/:id/approval ─────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'ap/invoices/:id/approval',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/invoices/:id/approval',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body            CLOB    := :body_text;
    v_approval_status VARCHAR2(30);
    v_sent_by         VARCHAR2(200);
    v_approver_name   VARCHAR2(300);
    v_approver_email  VARCHAR2(500);
    v_approval_ref    VARCHAR2(200);
    v_cnt             NUMBER;
BEGIN
    v_approval_status := JSON_VALUE(v_body, '$.approvalStatus');
    v_sent_by         := JSON_VALUE(v_body, '$.approvalSentBy');
    v_approver_name   := JSON_VALUE(v_body, '$.approverName');
    v_approver_email  := JSON_VALUE(v_body, '$.approverEmail');
    v_approval_ref    := JSON_VALUE(v_body, '$.approvalRef');

    UPDATE RR_AP_INVOICES_ALL SET
        APPROVAL_STATUS         = NVL(v_approval_status, APPROVAL_STATUS),
        APPROVAL_SENT_DATE      = CASE WHEN v_approval_status = 'PENDING' THEN SYSTIMESTAMP ELSE APPROVAL_SENT_DATE END,
        APPROVAL_SENT_BY        = NVL(v_sent_by,       APPROVAL_SENT_BY),
        APPROVAL_APPROVER_NAME  = NVL(v_approver_name,  APPROVAL_APPROVER_NAME),
        APPROVAL_APPROVER_EMAIL = NVL(v_approver_email, APPROVAL_APPROVER_EMAIL),
        APPROVED_DATE           = CASE WHEN v_approval_status IN ('Manually approved','Rejected') THEN SYSTIMESTAMP ELSE APPROVED_DATE END,
        APPROVAL_REF            = NVL(v_approval_ref,   APPROVAL_REF)
    WHERE INVOICE_ID = :id;

    v_cnt := SQL%ROWCOUNT;
    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Invoice not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","approvalStatus":"' || NVL(v_approval_status,'') || '"}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT ap/invoices/:id/approval registered.');
END;
/

-- ── Step 4: Redeploy GET approvals/approve to also handle AP invoices ─────────
-- Extends the existing handler to update RR_AP_INVOICES_ALL when APPROVAL_REF
-- starts with 'AP-INV-' in addition to the existing CASH external txn update.
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
    v_token    VARCHAR2(128) := :token;
    v_action   VARCHAR2(10);
    v_ref      VARCHAR2(200);
    v_name     VARCHAR2(300);
    v_email    VARCHAR2(500);
    v_req_id   NUMBER;
    v_expires  TIMESTAMP;
    v_status   VARCHAR2(20);
    v_txn_type VARCHAR2(100);
    v_color    VARCHAR2(20);
    v_icon     VARCHAR2(10);
    v_title    VARCHAR2(100);
    v_msg      VARCHAR2(500);
BEGIN
    IF v_token IS NULL THEN
        :status_code := 400;
        HTP.P('<html><body style="font-family:Arial;text-align:center;padding:60px"><h2>Invalid Link</h2><p>This approval link is invalid.</p></body></html>');
        RETURN;
    END IF;

    BEGIN
        SELECT ACTION, REQUEST_REF, TO_NAME, TO_EMAIL, REQUEST_ID,
               EXPIRES_DATE, STATUS, TRANSACTION_TYPE
        INTO   v_action, v_ref, v_name, v_email, v_req_id,
               v_expires, v_status, v_txn_type
        FROM   RR_APPROVAL_TOKENS
        WHERE  TOKEN_VALUE = v_token;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 200;
            HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invalid Link</title></head>'
               || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
               || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
               || '<div style="font-size:48px;margin-bottom:16px;">&#10060;</div>'
               || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Invalid Link</h2>'
               || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link does not exist or has already been removed.</p>'
               || '</div></body></html>');
            RETURN;
    END;

    IF v_status = 'USED' THEN
        :status_code := 200;
        HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Already Used</title></head>'
           || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
           || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
           || '<div style="font-size:48px;margin-bottom:16px;">&#9888;&#65039;</div>'
           || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Link Already Used</h2>'
           || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link has already been used.<br>Your action was recorded.</p>'
           || '<p style="color:#aaa;font-size:12px;margin-top:24px;">You may close this tab.</p>'
           || '</div></body></html>');
        RETURN;
    END IF;

    IF SYSTIMESTAMP > v_expires THEN
        UPDATE RR_APPROVAL_TOKENS SET STATUS = 'EXPIRED' WHERE TOKEN_VALUE = v_token;
        COMMIT;
        :status_code := 200;
        HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired</title></head>'
           || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
           || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
           || '<div style="font-size:48px;margin-bottom:16px;">&#8987;</div>'
           || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Link Expired</h2>'
           || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link expired 72 hours after it was sent.<br>Please contact the requester for a new link.</p>'
           || '<p style="color:#aaa;font-size:12px;margin-top:24px;">You may close this tab.</p>'
           || '</div></body></html>');
        RETURN;
    END IF;

    -- Valid token — mark USED
    UPDATE RR_APPROVAL_TOKENS
    SET    STATUS    = 'USED',
           USED_DATE = SYSTIMESTAMP
    WHERE  TOKEN_VALUE = v_token;

    -- Record in email replies log
    INSERT INTO RR_APPROVAL_EMAIL_REPLIES (
        FROM_EMAIL, FROM_NAME, SUBJECT, BODY_TEXT,
        ACTION_DETECTED, REF_NUMBER, REQUEST_ID, STATUS
    ) VALUES (
        v_email, v_name,
        v_action || ': ' || v_ref || ' [via approval link]',
        v_action || ' — clicked approval button in email',
        v_action, v_ref, v_req_id, 'PENDING'
    );

    -- Update Cash External Transaction (if applicable)
    BEGIN
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
        SET    APPROVAL_STATUS         = CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
               APPROVED_DATE           = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME  = v_name,
               APPROVAL_APPROVER_EMAIL = v_email
        WHERE  APPROVAL_REF = v_ref
        AND    NVL(APPROVAL_STATUS, 'NONE') = 'PENDING';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Update AP Invoice (if applicable)
    BEGIN
        UPDATE RR_AP_INVOICES_ALL
        SET    APPROVAL_STATUS         = CASE v_action WHEN 'APPROVE' THEN 'Manually approved' ELSE 'Rejected' END,
               APPROVED_DATE           = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME  = v_name,
               APPROVAL_APPROVER_EMAIL = v_email
        WHERE  APPROVAL_REF = v_ref
        AND    NVL(APPROVAL_STATUS, 'Not required') = 'PENDING';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    COMMIT;

    v_color := CASE v_action WHEN 'APPROVE' THEN '#16a34a' ELSE '#dc2626' END;
    v_icon  := CASE v_action WHEN 'APPROVE' THEN '&#9989;' ELSE '&#10060;' END;
    v_title := CASE v_action WHEN 'APPROVE' THEN 'Approved!' ELSE 'Rejected' END;
    v_msg   := CASE v_action
                   WHEN 'APPROVE' THEN 'Your approval has been recorded. The requester will be notified.'
                   ELSE 'Your rejection has been recorded. The requester will be notified.'
               END;

    :status_code := 200;
    HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' || v_title || '</title></head>'
       || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
       || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
       || '<div style="font-size:48px;margin-bottom:16px;">' || v_icon || '</div>'
       || '<h2 style="margin:0 0 12px;color:' || v_color || ';font-size:28px;">' || v_title || '</h2>'
       || '<p style="color:#444;font-size:15px;line-height:1.6;margin-bottom:8px;"><strong>' || NVL(v_ref,'') || '</strong></p>'
       || '<p style="color:#666;font-size:14px;line-height:1.6;">' || v_msg || '</p>'
       || '<p style="color:#aaa;font-size:12px;margin-top:24px;">You may close this tab.</p>'
       || '</div></body></html>');
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('<html><body><p>Error: ' || SQLERRM || '</p></body></html>');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET approvals/approve redeployed with AP invoice support.');
END;
/
