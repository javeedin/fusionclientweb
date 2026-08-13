-- ============================================================
-- PATCH 119: (Re)deploy POST ap/multiperiod/mark-posted handler
--
-- Problem:
--   The MPA "Create Accounting" flow calls
--     POST {baseUrl}/ap/multiperiod/mark-posted
--   to flip a schedule/period's POSTING_STATUS to 'Posted', but the endpoint is
--   not registered on this database ("does not exist").
--
-- Fix:
--   Register the handler. Self-contained — updates
--   RR_AP_INVOICE_MULTIPERIOD_SCHEDULE directly (does NOT depend on the
--   RR_AP_MPA_PKG package being deployed).
--
--   Body: {"invoiceId":N,"periodName":"Apr-2026","slaHeaderId":N,"postedBy":"..."}
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'ap/multiperiod/mark-posted',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Ensure the route template exists (harmless if already defined).
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/multiperiod/mark-posted');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name   => 'reerp',
        p_pattern       => 'ap/multiperiod/mark-posted',
        p_method        => 'POST',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Mark multiperiod schedule lines as posted for an invoice + period',
        p_source        => q'[
DECLARE
  v_body          CLOB := :body_text;
  v_json          JSON_OBJECT_T;
  v_invoice_id    NUMBER;
  v_period_name   VARCHAR2(30);
  v_sla_header_id NUMBER;
  v_posted_by     VARCHAR2(200);
  v_rows          NUMBER;
BEGIN
  v_json          := JSON_OBJECT_T.PARSE(v_body);
  v_invoice_id    := v_json.GET_NUMBER('invoiceId');
  v_period_name   := v_json.GET_STRING('periodName');
  v_sla_header_id := CASE WHEN v_json.HAS('slaHeaderId') AND NOT v_json.GET('slaHeaderId').IS_NULL
                          THEN v_json.GET_NUMBER('slaHeaderId') ELSE NULL END;
  v_posted_by     := v_json.GET_STRING('postedBy');

  UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
     SET POSTING_STATUS   = 'Posted',
         SLA_HEADER_ID    = v_sla_header_id,
         POSTED_DATE      = SYSDATE,
         POSTED_BY        = v_posted_by,
         LAST_UPDATE_DATE = SYSTIMESTAMP,
         LAST_UPDATED_BY  = v_posted_by
   WHERE INVOICE_ID    = v_invoice_id
     AND PERIOD_NAME   = v_period_name
     AND POSTING_STATUS = 'Not Posted';
  v_rows := SQL%ROWCOUNT;
  COMMIT;

  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"rowsUpdated":' || v_rows || '}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST /ap/multiperiod/mark-posted (re)deployed (patch 119).');
END;
/
