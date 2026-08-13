-- =============================================================================
-- Fix: GET ap/multiperiod/:invoice_id
-- Problem: original handler calls HTP.PRN(CLOB) which has a 32 767-byte
--          VARCHAR2 limit → ORA-06502 for invoices with many schedule lines.
-- Solution: replace with an inline APEX_JSON handler (no CLOB, no HTP.PRN).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop existing ORDS template (idempotent)
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/multiperiod/:invoice_id');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- 2. GET ap/multiperiod/:invoice_id
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'ap/multiperiod/:invoice_id',
    p_method        => 'GET',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => '',
    p_comments      => 'Full multiperiod schedule for one invoice — APEX_JSON (no CLOB limit)',
    p_source        => q'[
DECLARE
  v_invoice_id  NUMBER       := :invoice_id;
  v_inv_number  VARCHAR2(50);
  v_supplier    VARCHAR2(500);
  v_bus_unit    VARCHAR2(200);
  v_inv_date    VARCHAR2(20);
  v_currency    VARCHAR2(15);
  v_acct_status VARCHAR2(30);
BEGIN
  -- Fetch header from schedule table (same as original)
  BEGIN
    SELECT INVOICE_NUMBER, SUPPLIER, BUSINESS_UNIT,
           TO_CHAR(INVOICE_DATE,'YYYY-MM-DD'), CURRENCY_CODE
      INTO v_inv_number, v_supplier, v_bus_unit, v_inv_date, v_currency
      FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
     WHERE INVOICE_ID = v_invoice_id
       AND ROWNUM     = 1;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN NULL;
  END;

  -- Fetch invoice accounting status
  BEGIN
    SELECT h.ACCOUNTING_STATUS
      INTO v_acct_status
      FROM RR_SLA_ACCOUNTING_HEADERS h
     WHERE h.SOURCE_TABLE = 'AP_INVOICES'
       AND h.SOURCE_ID    = v_invoice_id
     ORDER BY h.HEADER_ID DESC
     FETCH FIRST 1 ROWS ONLY;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN NULL;
  END;

  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);

  APEX_JSON.INITIALIZE_OUTPUT(p_http_header => FALSE);
  APEX_JSON.OPEN_OBJECT;                              -- root {
  APEX_JSON.WRITE('invoiceId',                v_invoice_id);
  APEX_JSON.WRITE('invoiceNumber',            v_inv_number);
  APEX_JSON.WRITE('supplier',                 v_supplier);
  APEX_JSON.WRITE('businessUnit',             v_bus_unit);
  APEX_JSON.WRITE('invoiceDate',              v_inv_date);
  APEX_JSON.WRITE('currencyCode',             v_currency);
  APEX_JSON.WRITE('invoiceAccountingStatus',  v_acct_status);

  APEX_JSON.OPEN_ARRAY('lines');                      -- "lines":[

  FOR r IN (
    SELECT
      SCHEDULE_ID,
      LINE_NUMBER,
      TO_CHAR(PERIOD_DATE, 'YYYY-MM-DD') AS PERIOD_DATE_STR,
      PERIOD_NAME,
      ORIGINAL_AMOUNT,
      PERIOD_AMOUNT,
      ACCRUAL_ACCOUNT,
      CHARGE_ACCOUNT,
      DESCRIPTION,
      POSTING_STATUS,
      TO_CHAR(POSTED_DATE, 'YYYY-MM-DD') AS POSTED_DATE_STR,
      POSTED_BY,
      SLA_HEADER_ID
    FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
    WHERE INVOICE_ID         = v_invoice_id
      AND TRANSACTION_STATUS = 'Active'
    ORDER BY LINE_NUMBER, PERIOD_DATE
  ) LOOP
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('scheduleId',     r.SCHEDULE_ID);
    APEX_JSON.WRITE('lineNumber',     r.LINE_NUMBER);
    APEX_JSON.WRITE('periodDate',     r.PERIOD_DATE_STR);
    APEX_JSON.WRITE('periodName',     r.PERIOD_NAME);
    APEX_JSON.WRITE('originalAmount', r.ORIGINAL_AMOUNT);
    APEX_JSON.WRITE('periodAmount',   r.PERIOD_AMOUNT);
    APEX_JSON.WRITE('accrualAccount', r.ACCRUAL_ACCOUNT);
    APEX_JSON.WRITE('chargeAccount',  r.CHARGE_ACCOUNT);
    APEX_JSON.WRITE('description',    r.DESCRIPTION);
    APEX_JSON.WRITE('postingStatus',  r.POSTING_STATUS);
    APEX_JSON.WRITE('postedDate',     r.POSTED_DATE_STR);
    APEX_JSON.WRITE('postedBy',       r.POSTED_BY);
    APEX_JSON.WRITE('slaHeaderId',    r.SLA_HEADER_ID);
    APEX_JSON.CLOSE_OBJECT;
  END LOOP;

  APEX_JSON.CLOSE_ARRAY;                              -- ] lines
  APEX_JSON.CLOSE_OBJECT;                             -- } root

EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
  );
  COMMIT;
END;
/
