-- ORDS Handlers for RR_RAW_CUSTOMER_SITE_ACTIVITIES
-- Module: reerp | Template: ar/customer-site-activities
--
-- Endpoints:
--   GET  /reerp/ar/customer-site-activities          -> query all rows
--   POST /reerp/ar/customer-site-activities/sync     -> upsert batch of rows from Fusion
-- ============================================================

BEGIN
  -- ----------------------------------------------------------------
  -- GET /reerp/ar/customer-site-activities
  -- ----------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/customer-site-activities'
  );

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/customer-site-activities',
    p_method         => 'GET',
    p_source_type    => ORDS.SOURCE_TYPE_COLLECTION_FEED,
    p_source         => q'[
SELECT
  BILL_TO_SITE_USE_ID,
  BILL_TO_SITE_NUMBER,
  BILL_TO_SITE_ADDRESS,
  ACCOUNT_NUMBER,
  CUSTOMER_NAME,
  TAX_REGISTRATION_NUMBER,
  TOTAL_OPEN_RECEIVABLES_FOR_SITE,
  TOTAL_TRANSACTIONS_DUE_FOR_SITE,
  TO_CHAR(SYNC_DATE, 'DD-Mon-YYYY HH24:MI') AS SYNC_DATE
FROM RR_RAW_CUSTOMER_SITE_ACTIVITIES
ORDER BY CUSTOMER_NAME, BILL_TO_SITE_NUMBER
]'
  );

  -- ----------------------------------------------------------------
  -- POST /reerp/ar/customer-site-activities/sync
  -- Body: { "rows": [ { BillToSiteUseId, BillToSiteNumber, ... } ] }
  -- ----------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/customer-site-activities/sync'
  );

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/customer-site-activities/sync',
    p_method         => 'POST',
    p_source_type    => ORDS.SOURCE_TYPE_PLSQL,
    p_source         => q'[
DECLARE
  l_cnt   NUMBER;
  l_id    NUMBER;
  l_sn    VARCHAR2(100);
  l_sa    VARCHAR2(500);
  l_an    VARCHAR2(100);
  l_cn    VARCHAR2(500);
  l_trn   VARCHAR2(100);
  l_tor   NUMBER;
  l_ttd   NUMBER;
BEGIN
  APEX_JSON.PARSE(:body_text);
  l_cnt := APEX_JSON.GET_COUNT(p_path => 'rows');
  FOR i IN 1..l_cnt LOOP
    l_id  := TO_NUMBER(NVL(APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].BillToSiteUseId',             p0 => i), '0'));
    l_sn  := APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].BillToSiteNumber',                          p0 => i);
    l_sa  := APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].BillToSiteAddress',                         p0 => i);
    l_an  := APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].AccountNumber',                             p0 => i);
    l_cn  := APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].CustomerName',                              p0 => i);
    l_trn := APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].TaxRegistrationNumber',                     p0 => i);
    l_tor := TO_NUMBER(NVL(APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].TotalOpenReceivablesForSite', p0 => i), '0'));
    l_ttd := TO_NUMBER(NVL(APEX_JSON.GET_VARCHAR2(p_path => 'rows[%d].TotalTransactionsDueForSite', p0 => i), '0'));

    IF l_id = 0 THEN CONTINUE; END IF;

    MERGE INTO RR_RAW_CUSTOMER_SITE_ACTIVITIES tgt
    USING (SELECT l_id AS bill_to_site_use_id FROM DUAL) src
    ON (tgt.BILL_TO_SITE_USE_ID = src.bill_to_site_use_id)
    WHEN MATCHED THEN
      UPDATE SET
        BILL_TO_SITE_NUMBER             = l_sn,
        BILL_TO_SITE_ADDRESS            = l_sa,
        ACCOUNT_NUMBER                  = l_an,
        CUSTOMER_NAME                   = l_cn,
        TAX_REGISTRATION_NUMBER         = l_trn,
        TOTAL_OPEN_RECEIVABLES_FOR_SITE = l_tor,
        TOTAL_TRANSACTIONS_DUE_FOR_SITE = l_ttd,
        SYNC_DATE                       = SYSDATE
    WHEN NOT MATCHED THEN
      INSERT (BILL_TO_SITE_USE_ID, BILL_TO_SITE_NUMBER, BILL_TO_SITE_ADDRESS,
              ACCOUNT_NUMBER, CUSTOMER_NAME, TAX_REGISTRATION_NUMBER,
              TOTAL_OPEN_RECEIVABLES_FOR_SITE, TOTAL_TRANSACTIONS_DUE_FOR_SITE, SYNC_DATE)
      VALUES (l_id, l_sn, l_sa, l_an, l_cn, l_trn, l_tor, l_ttd, SYSDATE);
  END LOOP;
  COMMIT;
  :status := 200;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'ok');
  APEX_JSON.WRITE('upserted', l_cnt);
  APEX_JSON.CLOSE_OBJECT;
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  :status := 500;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'error');
  APEX_JSON.WRITE('message', SQLERRM);
  APEX_JSON.CLOSE_OBJECT;
END;
]'
  );

  COMMIT;
END;
/
