-- =============================================================================
-- AP Multiperiod Fusion Detail Handler
-- Handler:
--   GET  reerp/ap/multiperiod/fusion-detail/:invoice_id
--        Returns all MPA invoice lines for one invoice, each with its
--        generated accrual schedule periods and posted/pending summary.
--
-- Query params:
--   open_as_of  – YYYY-MM-DD; used to compute pending_from_date
--                 (pending = not-posted periods where period_date >= this date)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1.  Drop existing ORDS template (idempotent)
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/multiperiod/fusion-detail/:invoice_id');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- 2.  GET ap/multiperiod/fusion-detail/:invoice_id
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'ap/multiperiod/fusion-detail/:invoice_id',
    p_method        => 'GET',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => '',
    p_comments      => 'Full MPA detail for one invoice: lines with schedule periods and posted/pending totals',
    p_source        => q'[
DECLARE
  v_invoice_id      NUMBER        := :invoice_id;
  v_open_as_of      DATE;
  v_open_as_of_str  VARCHAR2(20);
  -- Invoice header
  v_inv_number      VARCHAR2(50);
  v_inv_date        VARCHAR2(20);
  v_inv_amount      NUMBER;
  v_currency        VARCHAR2(15);
  v_supplier        VARCHAR2(500);
  v_supplier_num    VARCHAR2(30);
  v_business_unit   VARCHAR2(200);
BEGIN
  v_open_as_of_str := NULLIF(TRIM(:open_as_of), '');
  IF v_open_as_of_str IS NOT NULL THEN
    v_open_as_of := TO_DATE(v_open_as_of_str, 'YYYY-MM-DD');
  END IF;

  -- Fetch invoice header
  BEGIN
    SELECT TO_CHAR(INVOICE_DATE,'YYYY-MM-DD'), INVOICE_AMOUNT,
           INVOICE_CURRENCY, SUPPLIER, SUPPLIER_NUMBER,
           BUSINESS_UNIT, INVOICE_NUMBER
      INTO v_inv_date, v_inv_amount, v_currency,
           v_supplier, v_supplier_num, v_business_unit, v_inv_number
      FROM RR_AP_INVOICES_ALL
     WHERE INVOICE_ID = v_invoice_id;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      :status_code := 404;
      OWA_UTIL.MIME_HEADER('application/json', TRUE);
      HTP.PRN('{"error":"Invoice not found: '||TO_CHAR(v_invoice_id)||'"}');
      RETURN;
  END;

  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);

  APEX_JSON.INITIALIZE_OUTPUT(p_http_header => FALSE);
  APEX_JSON.OPEN_OBJECT;                          -- root {
  APEX_JSON.WRITE('invoiceId',     v_invoice_id);
  APEX_JSON.WRITE('invoiceNumber', v_inv_number);
  APEX_JSON.WRITE('invoiceDate',   v_inv_date);
  APEX_JSON.WRITE('invoiceAmount', v_inv_amount);
  APEX_JSON.WRITE('currencyCode',  v_currency);
  APEX_JSON.WRITE('supplier',      v_supplier);
  APEX_JSON.WRITE('supplierNumber',v_supplier_num);
  APEX_JSON.WRITE('businessUnit',  v_business_unit);
  APEX_JSON.WRITE('openAsOf',      v_open_as_of_str);

  APEX_JSON.OPEN_ARRAY('lines');                  -- "lines":[

  FOR ln IN (
    SELECT
      l.LINE_NUMBER,
      l.LINE_AMOUNT,
      l.DESCRIPTION                                   AS LINE_DESCRIPTION,
      l.DISTRIBUTION_COMBINATION                      AS CHARGE_ACCOUNT,
      l.MULTIPERIOD_ACCRUAL_ACCOUNT                   AS ACCRUAL_ACCOUNT,
      TO_CHAR(l.MULTIPERIOD_START_DATE, 'YYYY-MM-DD') AS MPA_START,
      TO_CHAR(l.MULTIPERIOD_END_DATE,   'YYYY-MM-DD') AS MPA_END,
      -- Aggregated totals from the schedule
      NVL(s.SCHEDULE_EXISTS, 0)   AS SCHEDULE_GENERATED,
      NVL(s.TOTAL_SCHEDULED, 0)   AS TOTAL_SCHEDULED,
      NVL(s.POSTED_AMT,      0)   AS POSTED_AMT,
      NVL(s.PENDING_AMT,     0)   AS PENDING_AMT,
      NVL(s.PENDING_FROM_DT, 0)   AS PENDING_FROM_DT
    FROM RR_AP_INVOICE_LINES_ALL l
    LEFT JOIN (
      SELECT
        INVOICE_ID,
        LINE_NUMBER,
        1                                                             AS SCHEDULE_EXISTS,
        SUM(PERIOD_AMOUNT)                                            AS TOTAL_SCHEDULED,
        SUM(CASE WHEN POSTING_STATUS  = 'Posted'  THEN PERIOD_AMOUNT ELSE 0 END) AS POSTED_AMT,
        SUM(CASE WHEN POSTING_STATUS != 'Posted'  THEN PERIOD_AMOUNT ELSE 0 END) AS PENDING_AMT,
        SUM(CASE WHEN POSTING_STATUS != 'Posted'
                  AND PERIOD_DATE >= NVL(TO_DATE(NULLIF(TRIM(:open_as_of),''),'YYYY-MM-DD'), DATE '1900-01-01')
             THEN PERIOD_AMOUNT ELSE 0 END)                           AS PENDING_FROM_DT
      FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
      WHERE INVOICE_ID         = v_invoice_id
        AND TRANSACTION_STATUS = 'Active'
      GROUP BY INVOICE_ID, LINE_NUMBER
    ) s ON s.INVOICE_ID = l.INVOICE_ID AND s.LINE_NUMBER = l.LINE_NUMBER
    WHERE l.INVOICE_ID             = v_invoice_id
      AND l.MULTIPERIOD_START_DATE IS NOT NULL
      AND l.MULTIPERIOD_END_DATE   IS NOT NULL
    ORDER BY l.LINE_NUMBER
  ) LOOP
    APEX_JSON.OPEN_OBJECT;                        -- line {
    APEX_JSON.WRITE('lineNumber',        ln.LINE_NUMBER);
    APEX_JSON.WRITE('lineAmount',        ln.LINE_AMOUNT);
    APEX_JSON.WRITE('lineDescription',   ln.LINE_DESCRIPTION);
    APEX_JSON.WRITE('chargeAccount',     ln.CHARGE_ACCOUNT);
    APEX_JSON.WRITE('accrualAccount',    ln.ACCRUAL_ACCOUNT);
    APEX_JSON.WRITE('mpaStartDate',      ln.MPA_START);
    APEX_JSON.WRITE('mpaEndDate',        ln.MPA_END);
    APEX_JSON.WRITE('scheduleGenerated', ln.SCHEDULE_GENERATED);
    APEX_JSON.WRITE('totalScheduled',    ln.TOTAL_SCHEDULED);
    APEX_JSON.WRITE('postedAmount',      ln.POSTED_AMT);
    APEX_JSON.WRITE('pendingAmount',     ln.PENDING_AMT);
    APEX_JSON.WRITE('pendingFromDate',   ln.PENDING_FROM_DT);

    APEX_JSON.OPEN_ARRAY('periods');              -- "periods":[

    FOR p IN (
      SELECT
        SCHEDULE_ID,
        PERIOD_NAME,
        TO_CHAR(PERIOD_DATE,  'YYYY-MM-DD') AS PERIOD_DATE_STR,
        PERIOD_AMOUNT,
        ORIGINAL_AMOUNT,
        POSTING_STATUS,
        TO_CHAR(POSTED_DATE,  'YYYY-MM-DD') AS POSTED_DATE_STR,
        POSTED_BY,
        SLA_HEADER_ID,
        ACCRUAL_ACCOUNT,
        CHARGE_ACCOUNT
      FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
      WHERE INVOICE_ID         = v_invoice_id
        AND LINE_NUMBER        = ln.LINE_NUMBER
        AND TRANSACTION_STATUS = 'Active'
      ORDER BY PERIOD_DATE
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('scheduleId',    p.SCHEDULE_ID);
      APEX_JSON.WRITE('periodName',    p.PERIOD_NAME);
      APEX_JSON.WRITE('periodDate',    p.PERIOD_DATE_STR);
      APEX_JSON.WRITE('periodAmount',  p.PERIOD_AMOUNT);
      APEX_JSON.WRITE('originalAmount',p.ORIGINAL_AMOUNT);
      APEX_JSON.WRITE('postingStatus', p.POSTING_STATUS);
      APEX_JSON.WRITE('postedDate',    p.POSTED_DATE_STR);
      APEX_JSON.WRITE('postedBy',      p.POSTED_BY);
      APEX_JSON.WRITE('slaHeaderId',   p.SLA_HEADER_ID);
      APEX_JSON.WRITE('accrualAccount',p.ACCRUAL_ACCOUNT);
      APEX_JSON.WRITE('chargeAccount', p.CHARGE_ACCOUNT);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;                        -- ] periods
    APEX_JSON.CLOSE_OBJECT;                       -- } line
  END LOOP;

  APEX_JSON.CLOSE_ARRAY;                          -- ] lines
  APEX_JSON.CLOSE_OBJECT;                         -- } root

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
