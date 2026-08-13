-- ============================================================
-- PATCH 122: Suspend multiperiod schedule lines
--
-- New webservice: POST {baseUrl}/ap/multiperiod/suspend
--
--   Sets POSTING_STATUS = 'Suspended' on the given schedule rows, but ONLY
--   for lines that are NOT accounted (POSTING_STATUS <> 'Posted'). Already
--   posted/accounted lines are left untouched and reported as skipped.
--
--   Body: {
--     "scheduleIds": [101, 102, 103],
--     "status":      "Suspended",   -- optional; default 'Suspended'.
--                                   -- pass 'Not Posted' to un-suspend (resume).
--     "updatedBy":   "user"         -- optional
--   }
--
--   Response: {"success":true,"rowsUpdated":N,"skipped":M,"status":"Suspended"}
--
-- Only 'Posted' (accounted) rows are protected; suspend/resume move freely
-- between 'Not Posted' and 'Suspended'.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'ap/multiperiod/suspend',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/multiperiod/suspend');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name   => 'reerp',
        p_pattern       => 'ap/multiperiod/suspend',
        p_method        => 'POST',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Suspend (or resume) not-accounted multiperiod schedule lines',
        p_source        => q'[
DECLARE
  v_body     CLOB := :body_text;
  v_json     JSON_OBJECT_T;
  v_ids      JSON_ARRAY_T;
  v_status   VARCHAR2(30);
  v_by       VARCHAR2(200);
  v_id       NUMBER;
  v_rows     NUMBER := 0;
  v_skipped  NUMBER := 0;
BEGIN
  v_json   := JSON_OBJECT_T.PARSE(v_body);
  v_ids    := v_json.GET_ARRAY('scheduleIds');
  v_status := CASE WHEN v_json.HAS('status') AND NOT v_json.GET('status').IS_NULL
                   THEN v_json.GET_STRING('status') ELSE 'Suspended' END;
  v_by     := CASE WHEN v_json.HAS('updatedBy') AND NOT v_json.GET('updatedBy').IS_NULL
                   THEN v_json.GET_STRING('updatedBy') ELSE 'REERP' END;

  -- Never let this endpoint flip an accounted line.
  IF UPPER(v_status) = 'POSTED' THEN
    :status_code := 400;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"status cannot be set to Posted here"}');
    RETURN;
  END IF;

  IF v_ids IS NULL OR v_ids.GET_SIZE = 0 THEN
    :status_code := 400;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"scheduleIds is required"}');
    RETURN;
  END IF;

  FOR i IN 0 .. v_ids.GET_SIZE - 1 LOOP
    v_id := v_ids.GET_NUMBER(i);
    UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
       SET POSTING_STATUS   = v_status,
           LAST_UPDATE_DATE = SYSTIMESTAMP,
           LAST_UPDATED_BY  = v_by
     WHERE SCHEDULE_ID      = v_id
       AND POSTING_STATUS  <> 'Posted';   -- only NOT-accounted lines can change
    IF SQL%ROWCOUNT = 0 THEN
      v_skipped := v_skipped + 1;         -- not found or already Posted
    ELSE
      v_rows := v_rows + SQL%ROWCOUNT;
    END IF;
  END LOOP;

  COMMIT;
  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"rowsUpdated":' || v_rows ||
          ',"skipped":' || v_skipped ||
          ',"status":"' || v_status || '"}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST /ap/multiperiod/suspend deployed (patch 122).');
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- POST {base}/ap/multiperiod/suspend
--   Body: {"scheduleIds":[...],"status":"Suspended","updatedBy":"user"}
--   Sets POSTING_STATUS on not-accounted lines; skips 'Posted' lines.
-- =====================================================
