-- ============================================================
-- PATCH 120: mark-posted updates a SINGLE schedule (by scheduleId)
--
-- Problem:
--   POST {baseUrl}/ap/multiperiod/mark-posted previously updated EVERY
--   Not-Posted schedule row for an invoice + period:
--       WHERE INVOICE_ID = :invoiceId AND PERIOD_NAME = :periodName
--   When an invoice has more than one schedule line in the same period, a single
--   accrual posting flipped ALL of them to 'Posted'.
--
-- Fix:
--   Accept an optional "scheduleId" in the body. When present, update only that
--   one schedule row (by SCHEDULE_ID, the primary key). When absent, fall back to
--   the legacy invoice + period behaviour so older callers keep working.
--
--   Body: {"scheduleId":N,"invoiceId":N,"periodName":"May-2026","slaHeaderId":N,"postedBy":"..."}
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
        p_comments      => 'Mark a multiperiod schedule posted — by scheduleId when supplied, else invoice + period',
        p_source        => q'[
DECLARE
  v_body          CLOB := :body_text;
  v_json          JSON_OBJECT_T;
  v_schedule_id   NUMBER;
  v_invoice_id    NUMBER;
  v_period_name   VARCHAR2(30);
  v_sla_header_id NUMBER;
  v_posted_by     VARCHAR2(200);
  v_rows          NUMBER;
BEGIN
  v_json          := JSON_OBJECT_T.PARSE(v_body);
  v_schedule_id   := CASE WHEN v_json.HAS('scheduleId') AND NOT v_json.GET('scheduleId').IS_NULL
                          THEN v_json.GET_NUMBER('scheduleId') ELSE NULL END;
  v_invoice_id    := CASE WHEN v_json.HAS('invoiceId') AND NOT v_json.GET('invoiceId').IS_NULL
                          THEN v_json.GET_NUMBER('invoiceId') ELSE NULL END;
  v_period_name   := v_json.GET_STRING('periodName');
  v_sla_header_id := CASE WHEN v_json.HAS('slaHeaderId') AND NOT v_json.GET('slaHeaderId').IS_NULL
                          THEN v_json.GET_NUMBER('slaHeaderId') ELSE NULL END;
  v_posted_by     := v_json.GET_STRING('postedBy');

  IF v_schedule_id IS NOT NULL THEN
    -- Precise: update exactly one schedule row.
    UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
       SET POSTING_STATUS   = 'Posted',
           SLA_HEADER_ID    = v_sla_header_id,
           POSTED_DATE      = SYSDATE,
           POSTED_BY        = v_posted_by,
           LAST_UPDATE_DATE = SYSTIMESTAMP,
           LAST_UPDATED_BY  = v_posted_by
     WHERE SCHEDULE_ID     = v_schedule_id
       AND POSTING_STATUS  = 'Not Posted';
  ELSE
    -- Legacy fallback: invoice + period.
    UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
       SET POSTING_STATUS   = 'Posted',
           SLA_HEADER_ID    = v_sla_header_id,
           POSTED_DATE      = SYSDATE,
           POSTED_BY        = v_posted_by,
           LAST_UPDATE_DATE = SYSTIMESTAMP,
           LAST_UPDATED_BY  = v_posted_by
     WHERE INVOICE_ID     = v_invoice_id
       AND PERIOD_NAME    = v_period_name
       AND POSTING_STATUS = 'Not Posted';
  END IF;
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
    DBMS_OUTPUT.PUT_LINE('POST /ap/multiperiod/mark-posted (re)deployed (patch 120 — scheduleId aware).');
END;
/
