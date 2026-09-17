-- ============================================================
-- Patch 156: DELETE ar/invoices/delete/:customerTransactionId
--            Delete an AR invoice that is NOT accounted and NOT paid
--
-- Guards (server-side, always enforced):
--   * NOT ACCOUNTED — no GL journal line references the invoice
--     (REFERENCE2 = id, REFERENCE5 in the AR-invoice marker set used
--      by RR_V_AR_INVOICE_ACCT_STATUS)
--   * NOT PAID — no receipt applications and no adjustments exist
--     for the invoice
--
-- Cascade: RR_AR_INVOICE_LINES / _INSTALLMENTS / _DISTRIBUTIONS have
-- ON DELETE CASCADE FKs; DFF and installment notes are deleted
-- explicitly first.
--
-- Own URL path (literal 'delete' segment) so no ORDS template-shape
-- conflict with existing ar/invoices/:id routes.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands — run as one block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'ar/invoices/delete/:customerTransactionId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'ar/invoices/delete/:customerTransactionId'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ar/invoices/delete/:customerTransactionId',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Delete an unpaid, unaccounted AR invoice'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ar/invoices/delete/:customerTransactionId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete AR invoice — refused when accounted or paid',
        p_source         => q'[
DECLARE
    v_path  VARCHAR2(1000);
    v_raw   VARCHAR2(200);
    v_id    NUMBER;
    l_cnt   NUMBER;
    l_gl    NUMBER;
    l_apps  NUMBER;
    l_adj   NUMBER;
    l_num   VARCHAR2(240);
BEGIN
    -- id from bind, else parse the URL (ORDS DELETE path-bind quirk)
    v_raw := :customerTransactionId;
    IF v_raw IS NULL THEN
        v_path := OWA_UTIL.get_cgi_env('PATH_INFO');
        v_raw  := REGEXP_SUBSTR(v_path, '[0-9]+$');
    END IF;
    IF v_raw IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"success": false,"error":"Could not determine customerTransactionId from request"}');
        RETURN;
    END IF;
    BEGIN
        v_id := TO_NUMBER(v_raw);
    EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        HTP.PRN('{"success": false,"error":"Invalid id: ' || v_raw || '"}');
        RETURN;
    END;

    BEGIN
        SELECT TRANSACTION_NUMBER INTO l_num
          FROM RR_AR_INVOICE_HEADERS
         WHERE CUSTOMER_TRANSACTION_ID = v_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        :status_code := 404;
        HTP.PRN('{"success": false,"error":"Invoice not found","id":' || v_id || '}');
        RETURN;
    END;

    -- Guard 1: accounted? (same matching as RR_V_AR_INVOICE_ACCT_STATUS)
    SELECT COUNT(*) INTO l_gl
      FROM RR_GL_JE_LINES_ALL l
     WHERE l.REFERENCE2 = TO_CHAR(v_id)
       AND l.REFERENCE5 IN ('AR_INVOICES', 'AR-INVOICE-CREATION', 'AR_INVOICE_CREATION');
    IF l_gl > 0 THEN
        :status_code := 409;
        HTP.PRN('{"success": false,"error":"Invoice ' || l_num || ' is accounted — ' || l_gl ||
                ' GL journal line(s) reference it. Delete the journal first if this is intentional."}');
        RETURN;
    END IF;

    -- Guard 2: paid / settled? (receipt applications or adjustments exist)
    -- receipt applications link to the invoice via REFERENCE_TRANSACTION_ID
    SELECT COUNT(*) INTO l_apps
      FROM RR_AR_RECEIPT_APPLICATIONS WHERE REFERENCE_TRANSACTION_ID = v_id;
    SELECT COUNT(*) INTO l_adj
      FROM RR_AR_ADJUSTMENTS WHERE CUSTOMER_TRANSACTION_ID = v_id;
    IF l_apps > 0 OR l_adj > 0 THEN
        :status_code := 409;
        HTP.PRN('{"success": false,"error":"Invoice ' || l_num || ' has ' || l_apps ||
                ' receipt application(s) and ' || l_adj ||
                ' adjustment(s) — unapply them before deleting."}');
        RETURN;
    END IF;

    -- Children without ON DELETE CASCADE
    BEGIN
        DELETE FROM RR_AR_INVOICE_INSTALLMENT_NOTES WHERE CUSTOMER_TRX_ID = v_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        DELETE FROM RR_AR_INVOICES_DFF WHERE CUSTOMER_TRANSACTION_ID = v_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Header (lines, installments, distributions cascade via FK)
    DELETE FROM RR_AR_INVOICE_HEADERS WHERE CUSTOMER_TRANSACTION_ID = v_id;
    l_cnt := SQL%ROWCOUNT;
    COMMIT;

    :status_code := 200;
    HTP.PRN('{"success": true,"message":"Invoice deleted","customerTransactionId":' || v_id ||
            ',"transactionNumber":"' || REPLACE(l_num, '"', '\"') || '"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"success": false,"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Verify ─────────────────────────────────────────────────────────────────
--   DELETE {base}/ar/invoices/delete/300000091482652
--   Accounted invoice  -> 409 "...is accounted..."
--   Paid invoice       -> 409 "...receipt application(s)..."
--   Clean invoice      -> {"success": true,...} and header+children removed
