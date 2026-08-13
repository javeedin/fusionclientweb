-- =============================================================================
-- AP Multiperiod Delete Handler
-- Handler:
--   DELETE reerp/ap/multiperiod/:invoice_id
--          Hard-deletes all Not-Posted schedule rows for the invoice.
--          Posted rows are left intact for audit.
--          Returns: { deleted: N }  or error 409 if all rows are Posted.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1.  Drop existing DELETE handler (idempotent — won't touch the GET handler)
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'reerp',
    p_pattern     => 'ap/multiperiod/:invoice_id',
    p_method      => 'DELETE'
  );
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- 2.  DELETE ap/multiperiod/:invoice_id
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'ap/multiperiod/:invoice_id',
    p_method        => 'DELETE',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => '',
    p_comments      => 'Delete Not-Posted MPA schedule rows for one invoice',
    p_source        => q'[
DECLARE
  v_invoice_id    NUMBER  := :invoice_id;
  v_deleted       NUMBER  := 0;
  v_posted_count  NUMBER  := 0;
BEGIN
  -- Check how many rows are already Posted (cannot delete those)
  SELECT COUNT(*)
    INTO v_posted_count
    FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
   WHERE INVOICE_ID         = v_invoice_id
     AND TRANSACTION_STATUS = 'Active'
     AND POSTING_STATUS     = 'Posted';

  -- Delete only the Not-Posted rows
  DELETE FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
   WHERE INVOICE_ID         = v_invoice_id
     AND TRANSACTION_STATUS = 'Active'
     AND POSTING_STATUS     = 'Not Posted';

  v_deleted := SQL%ROWCOUNT;
  COMMIT;

  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"deleted":'||v_deleted||',"postedKept":'||v_posted_count||'}');

EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
  );
  COMMIT;
END;
/
