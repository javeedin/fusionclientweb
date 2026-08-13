-- ============================================
-- ORDS REST Handler: PUT /cash/reconciliation/ap_payments/:check_id
-- Marks an AP payment as reconciled against a bank statement line.
--
-- Request body:
--   {
--     "reconciledFlag":  "Y",
--     "reconciledDate":  "2026-05-02",
--     "paymentStatus":   "CLEARED",
--     "statementId":     22,
--     "stmtLineId":      60
--   }
--
-- Updates RR_AP_PAYMENTS_ALL:
--   RECONCILED_FLAG   → reconciledFlag
--   CLEARING_DATE     → reconciledDate
--   PAYMENT_STATUS    → paymentStatus
--   LOCAL_UPDATED_DATE → SYSTIMESTAMP
-- ============================================

-- ---------------------------------------------------------------------------
-- Template: cash/reconciliation/ap_payments/:check_id
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/reconciliation/ap_payments/:check_id'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/reconciliation/ap_payments/:check_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Payment reconciliation update endpoint'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- PUT Handler — update reconciliation flags on a single AP payment
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/ap_payments/:check_id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_check_id        NUMBER;
    v_reconciled_flag VARCHAR2(1);
    v_reconciled_date DATE;
    v_payment_status  VARCHAR2(50);
    v_statement_id    NUMBER;
    v_stmt_line_id    NUMBER;
    v_rows_updated    NUMBER;
BEGIN
    -- URL parameter
    v_check_id := TO_NUMBER(:check_id);

    -- Parse JSON body
    SELECT jt.reconciled_flag,
           jt.payment_status,
           jt.statement_id,
           jt.stmt_line_id,
           CASE
               WHEN jt.reconciled_date IS NOT NULL
               THEN TO_DATE(jt.reconciled_date, 'YYYY-MM-DD')
               ELSE SYSDATE
           END
    INTO   v_reconciled_flag,
           v_payment_status,
           v_statement_id,
           v_stmt_line_id,
           v_reconciled_date
    FROM   JSON_TABLE(:body_text, '$'
             COLUMNS (
               reconciled_flag  VARCHAR2(1)   PATH '$.reconciledFlag',
               reconciled_date  VARCHAR2(20)  PATH '$.reconciledDate',
               payment_status   VARCHAR2(50)  PATH '$.paymentStatus',
               statement_id     NUMBER        PATH '$.statementId',
               stmt_line_id     NUMBER        PATH '$.stmtLineId'
             )
           ) jt;

    -- Update the payment record
    UPDATE RR_AP_PAYMENTS_ALL
    SET    RECONCILED_FLAG   = v_reconciled_flag,
           CLEARING_DATE     = v_reconciled_date,
           PAYMENT_STATUS    = v_payment_status,
           LOCAL_UPDATED_DATE = SYSTIMESTAMP
    WHERE  CHECK_ID = v_check_id;

    v_rows_updated := SQL%ROWCOUNT;
    COMMIT;

    IF v_rows_updated = 0 THEN
        OWA_UTIL.MIME_HEADER('application/json', FALSE);
        HTP.P('{"status":"error","message":"No AP payment found for check_id ' || v_check_id || '"}');
    ELSE
        OWA_UTIL.MIME_HEADER('application/json', FALSE);
        HTP.P('{"status":"success","checkId":' || v_check_id ||
              ',"reconciledFlag":"'   || v_reconciled_flag || '"' ||
              ',"paymentStatus":"'    || v_payment_status  || '"' ||
              ',"statementId":'       || NVL(TO_CHAR(v_statement_id),  'null') ||
              ',"stmtLineId":'        || NVL(TO_CHAR(v_stmt_line_id),  'null') ||
              '}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        OWA_UTIL.MIME_HEADER('application/json', FALSE);
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0,
        p_comments       => 'Mark AP payment as reconciled / cleared'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- OPTIONS Handler — CORS preflight
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/ap_payments/:check_id',
        p_method         => 'OPTIONS',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('');
END;
]',
        p_items_per_page => 0,
        p_comments       => 'CORS preflight for AP payment reconcile endpoint'
    );
    COMMIT;
END;
/

-- Verify
SELECT method, uri_template
FROM   user_ords_handlers h
JOIN   user_ords_templates t ON h.template_id = t.id
WHERE  t.uri_template = 'cash/reconciliation/ap_payments/:check_id';
