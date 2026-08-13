-- =====================================================
-- ORDS REST Handlers for AR Credit Memo Applications
-- Module  : ar  (already defined)
-- Base    : /ar/
-- Table   : RR_AR_CM_APPLICATIONS
-- Package : RR_AR_CM_APPLICATIONS_PKG
-- =====================================================

-- =====================================================
-- 1. Template: ar/cm-applications
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'cm-applications');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'cm-applications',
        p_comments    => 'AR Credit Memo Applications'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. GET /ar/cm-applications
--    Filters: cust_account_id, credit_memo_number,
--             reference_transaction_number, application_status,
--             date_from, date_to
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'cm-applications',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'List AR Credit Memo applications with optional filters',
        p_source         => '
WITH fp AS (
    SELECT :cust_account_id             AS cust_id,
           :credit_memo_number          AS cm_num,
           :reference_transaction_number AS ref_num,
           :application_status          AS status,
           :date_from                   AS dfrom,
           :date_to                     AS dto
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
    a.CREDIT_MEMO_ID,
    a.CREDIT_MEMO_NUMBER,
    a.CREDIT_MEMO_STATUS,
    a.ENTERED_CURRENCY,
    a.TRANSACTION_TYPE,
    a.ACTIVITY_NAME,
    a.IS_LATEST_APPLICATION,
    a.BILL_TO_SITE_NUMBER,
    a.CUST_ACCOUNT_ID,
    a.FUSION_CREATED_BY,
    a.FUSION_CREATION_DATE,
    a.FUSION_LAST_UPDATED_BY,
    a.FUSION_LAST_UPDATE_DATE,
    a.SYNC_STATUS,
    a.SYNC_DATE
FROM RR_AR_CM_APPLICATIONS a
CROSS JOIN fp
WHERE (fp.cust_id IS NULL OR fp.cust_id = '''' OR a.CUST_ACCOUNT_ID = TO_NUMBER(fp.cust_id))
  AND (fp.cm_num  IS NULL OR fp.cm_num  = '''' OR UPPER(a.CREDIT_MEMO_NUMBER)          LIKE ''%''||UPPER(fp.cm_num)||''%'')
  AND (fp.ref_num IS NULL OR fp.ref_num = '''' OR UPPER(a.REFERENCE_TRANSACTION_NUMBER) LIKE ''%''||UPPER(fp.ref_num)||''%'')
  AND (fp.status  IS NULL OR fp.status  = '''' OR UPPER(a.APPLICATION_STATUS)           = UPPER(fp.status))
  AND (fp.dfrom   IS NULL OR fp.dfrom   = '''' OR a.APPLICATION_DATE >= TO_DATE(SUBSTR(fp.dfrom,1,10),''YYYY-MM-DD''))
  AND (fp.dto     IS NULL OR fp.dto     = '''' OR a.APPLICATION_DATE <= TO_DATE(SUBSTR(fp.dto,1,10),''YYYY-MM-DD''))
ORDER BY a.APPLICATION_DATE DESC, a.APPLICATION_ID DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. Template: ar/cm-applications/bulk
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'cm-applications/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'cm-applications/bulk',
        p_comments    => 'Bulk upsert AR Credit Memo Applications'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. POST /ar/cm-applications/bulk
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'cm-applications/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR Credit Memo Applications {"items":[...]}',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
BEGIN
    RR_AR_CM_APPLICATIONS_PKG.save_applications_bulk(
        p_json      => :body_text,
        p_status    => l_status,
        p_message   => l_message,
        p_inserted  => l_inserted,
        p_updated   => l_updated,
        p_errors    => l_errors
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"''   || l_status   ||
          ''","message":"'' || REPLACE(l_message, ''"'', ''\\"'') ||
          ''","inserted":'' || l_inserted ||
          '',"updated":''   || l_updated  ||
          '',"errors":''    || l_errors   || ''}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/cm-applications               List (paginated, filtered)
--   ?cust_account_id=             NUMBER  (optional)
--   ?credit_memo_number=          VARCHAR (optional)
--   ?reference_transaction_number=VARCHAR (optional)
--   ?application_status=          VARCHAR (optional, exact)
--   ?date_from=                   YYYY-MM-DD (optional)
--   ?date_to=                     YYYY-MM-DD (optional)
--
-- POST {base}/ar/cm-applications/bulk          Bulk upsert {"items":[...]}
-- =====================================================
