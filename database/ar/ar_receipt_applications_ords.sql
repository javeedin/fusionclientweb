-- =====================================================
-- ORDS REST Handlers for AR Receipt Applications
-- Module  : ar  (already defined)
-- Base    : /ar/
-- Table   : RR_AR_RECEIPT_APPLICATIONS
-- Package : RR_AR_RECEIPT_APPLICATIONS_PKG
-- =====================================================

-- =====================================================
-- 1. Template: ar/receipt-applications
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipt-applications');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipt-applications',
        p_comments    => 'AR Receipt Applications'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. POST /ar/receipt-applications  — single upsert
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert single AR receipt application',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
    l_wrapped  CLOB;
BEGIN
    l_wrapped := ''{"items":['' || :body_text || '']}'';
    RR_AR_RECEIPT_APPLICATIONS_PKG.save_applications_bulk(
        p_json      => l_wrapped,
        p_status    => l_status,
        p_message   => l_message,
        p_inserted  => l_inserted,
        p_updated   => l_updated,
        p_errors    => l_errors
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"''   || l_status                            ||
          ''","message":"'' || REPLACE(l_message, ''"'', ''\\"'') ||
          ''","inserted":'' || l_inserted                         ||
          '',"updated":''   || l_updated                          ||
          '',"errors":''    || l_errors || ''}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. GET /ar/receipt-applications  — list with filters
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List AR receipt applications with optional filters',
        p_source         => '
WITH fp AS (
    SELECT :cust_account_id        AS cust_id,
           :standard_receipt_id    AS rcpt_id,
           :receipt_number         AS rnum,
           :application_status     AS app_sts,
           :process_status         AS proc_sts,
           :reference_txn_number   AS ref_txn,
           :date_from              AS dfrom,
           :date_to                AS dto
    FROM DUAL
)
SELECT
    a.APPLICATION_ID,
    a.APPLICATION_DATE,
    a.APPLICATION_AMOUNT,
    a.APPLICATION_STATUS,
    a.ACCOUNTING_DATE,
    a.REFERENCE_INSTALLMENT_ID,
    a.REFERENCE_TRANSACTION_NUMBER,
    a.REFERENCE_TRANSACTION_ID,
    a.REFERENCE_TRANSACTION_STATUS,
    a.ACTIVITY_NAME,
    a.STANDARD_RECEIPT_ID,
    a.RECEIPT_NUMBER,
    a.ENTERED_CURRENCY,
    a.RECEIPT_METHOD,
    a.PROCESS_STATUS,
    a.IS_LATEST_APPLICATION,
    a.CUST_ACCOUNT_ID,
    a.CUSTOMER_SITE,
    a.FUSION_CREATED_BY,
    a.FUSION_CREATION_DATE,
    a.FUSION_LAST_UPDATED_BY,
    a.FUSION_LAST_UPDATE_DATE,
    a.SYNC_STATUS,
    a.SYNC_DATE
FROM RR_AR_RECEIPT_APPLICATIONS a
CROSS JOIN fp
WHERE (fp.cust_id  IS NULL OR fp.cust_id  = '''' OR TO_CHAR(a.CUST_ACCOUNT_ID) = fp.cust_id)
  AND (fp.rcpt_id  IS NULL OR fp.rcpt_id  = '''' OR TO_CHAR(a.STANDARD_RECEIPT_ID) = fp.rcpt_id)
  AND (fp.rnum     IS NULL OR fp.rnum     = '''' OR UPPER(a.RECEIPT_NUMBER) LIKE UPPER(fp.rnum)||''%'')
  AND (fp.app_sts  IS NULL OR fp.app_sts  = '''' OR UPPER(a.APPLICATION_STATUS) = UPPER(fp.app_sts))
  AND (fp.proc_sts IS NULL OR fp.proc_sts = '''' OR UPPER(a.PROCESS_STATUS)     = UPPER(fp.proc_sts))
  AND (fp.ref_txn  IS NULL OR fp.ref_txn  = '''' OR UPPER(a.REFERENCE_TRANSACTION_NUMBER) LIKE UPPER(fp.ref_txn)||''%'')
  AND (fp.dfrom    IS NULL OR fp.dfrom    = '''' OR a.APPLICATION_DATE >= TO_DATE(SUBSTR(fp.dfrom,1,10),''YYYY-MM-DD''))
  AND (fp.dto      IS NULL OR fp.dto      = '''' OR a.APPLICATION_DATE <= TO_DATE(SUBSTR(fp.dto,1,10),''YYYY-MM-DD''))
ORDER BY a.APPLICATION_DATE DESC, a.APPLICATION_ID DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. Template: ar/receipt-applications/bulk
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipt-applications/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipt-applications/bulk',
        p_comments    => 'Bulk upsert AR receipt applications'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. POST /ar/receipt-applications/bulk
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR receipt applications {"items":[...]}',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
BEGIN
    RR_AR_RECEIPT_APPLICATIONS_PKG.save_applications_bulk(
        p_json      => :body_text,
        p_status    => l_status,
        p_message   => l_message,
        p_inserted  => l_inserted,
        p_updated   => l_updated,
        p_errors    => l_errors
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"''   || l_status                            ||
          ''","message":"'' || REPLACE(l_message, ''"'', ''\\"'') ||
          ''","inserted":'' || l_inserted                         ||
          '',"updated":''   || l_updated                          ||
          '',"errors":''    || l_errors || ''}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/receipt-applications
--   ?cust_account_id=  ?standard_receipt_id=  ?receipt_number=
--   ?application_status=  ?process_status=  ?reference_txn_number=
--   ?date_from=YYYY-MM-DD  ?date_to=YYYY-MM-DD
-- POST {base}/ar/receipt-applications        Single upsert (raw object)
-- POST {base}/ar/receipt-applications/bulk   Bulk upsert {"items":[...]}
-- =====================================================
