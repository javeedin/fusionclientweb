-- =====================================================
-- ORDS REST Handlers for AR Credit Memo Headers
-- Module  : ar  (already defined)
-- Base    : /ar/
-- Table   : RR_AR_CREDITMEMO_HEADERS
-- Package : RR_AR_CREDITMEMO_PKG
-- =====================================================

-- =====================================================
-- 1. Template: ar/credit-memos
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'credit-memos');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'credit-memos',
        p_comments    => 'AR Credit Memo Headers'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. GET /ar/credit-memos
--    Filters: business_unit, transaction_source,
--             transaction_type, transaction_number,
--             bill_to_customer, cross_reference,
--             credit_memo_status, date_from, date_to
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List AR Credit Memo headers with optional filters',
        p_source         => '
WITH fp AS (
    SELECT :business_unit        AS bu,
           :transaction_source   AS src,
           :transaction_number   AS num,
           :bill_to_customer     AS cust,
           :cross_reference      AS ref,
           :credit_memo_status   AS status,
           :date_from            AS dfrom,
           :date_to              AS dto
    FROM DUAL
)
SELECT
    h.CUSTOMER_TRANSACTION_ID,
    h.TRANSACTION_NUMBER,
    h.DOCUMENT_NUMBER,
    h.CROSS_REFERENCE,
    h.CUSTOMER_REFERENCE,
    h.TRANSACTION_DATE,
    h.ACCOUNTING_DATE,
    h.CREDIT_MEMO_STATUS,
    h.CREDIT_MEMO_CURRENCY,
    h.TRANSACTION_TYPE,
    h.TRANSACTION_SOURCE,
    h.ENTERED_AMOUNT,
    h.TRANSACTION_BALANCE_DUE,
    h.CREDIT_REASON,
    h.BILL_TO_CUSTOMER_NUMBER,
    h.BILL_TO_CUSTOMER_NAME,
    h.BUSINESS_UNIT,
    h.LEGAL_ENTITY_IDENTIFIER,
    h.PURCHASE_ORDER,
    h.SYNC_STATUS,
    h.SYNC_DATE
FROM RR_AR_CREDITMEMO_HEADERS h
CROSS JOIN fp
WHERE (fp.bu     IS NULL OR fp.bu     = '''' OR UPPER(h.BUSINESS_UNIT)        LIKE ''%''||UPPER(fp.bu)||''%'')
  AND (fp.src    IS NULL OR fp.src    = '''' OR UPPER(h.TRANSACTION_SOURCE)   LIKE ''%''||UPPER(fp.src)||''%'')
  AND (fp.num    IS NULL OR fp.num    = '''' OR UPPER(h.TRANSACTION_NUMBER)   LIKE      UPPER(fp.num)||''%'')
  AND (fp.cust   IS NULL OR fp.cust   = '''' OR UPPER(h.BILL_TO_CUSTOMER_NAME)   LIKE ''%''||UPPER(fp.cust)||''%''
                                             OR UPPER(h.BILL_TO_CUSTOMER_NUMBER) LIKE ''%''||UPPER(fp.cust)||''%'')
  AND (fp.ref    IS NULL OR fp.ref    = '''' OR UPPER(h.CROSS_REFERENCE)      LIKE ''%''||UPPER(fp.ref)||''%'')
  AND (fp.status IS NULL OR fp.status = '''' OR UPPER(h.CREDIT_MEMO_STATUS)   = UPPER(fp.status))
  AND (fp.dfrom  IS NULL OR fp.dfrom  = '''' OR h.TRANSACTION_DATE >= TO_DATE(SUBSTR(fp.dfrom,1,10),''YYYY-MM-DD''))
  AND (fp.dto    IS NULL OR fp.dto    = '''' OR h.TRANSACTION_DATE <= TO_DATE(SUBSTR(fp.dto,1,10),''YYYY-MM-DD''))
ORDER BY h.TRANSACTION_DATE DESC, h.TRANSACTION_NUMBER DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. POST /ar/credit-memos/bulk  — bulk upsert
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'credit-memos/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'credit-memos/bulk',
        p_comments    => 'Bulk upsert AR Credit Memo headers'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR Credit Memos {"items":[...]}',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
BEGIN
    RR_AR_CREDITMEMO_PKG.save_creditmemos_bulk(
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
-- 4. Template: ar/credit-memos/:id
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'credit-memos/:id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'credit-memos/:id',
        p_comments    => 'Single AR Credit Memo by CustomerTransactionId'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET /ar/credit-memos/:id
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/:id',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_comments       => 'Get single AR Credit Memo header',
        p_source         => '
SELECT h.*
FROM   RR_AR_CREDITMEMO_HEADERS h
WHERE  h.CUSTOMER_TRANSACTION_ID = :id'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. Template: ar/credit-memos/:id/lines
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'credit-memos/:id/lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'credit-memos/:id/lines',
        p_comments    => 'AR Credit Memo Lines for a header'
    );
    COMMIT;
END;
/

-- =====================================================
-- 7. GET /ar/credit-memos/:id/lines
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/:id/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'Get lines for an AR Credit Memo',
        p_source         => '
SELECT ln.*
FROM   RR_AR_CREDITMEMO_LINES ln
WHERE  ln.CUSTOMER_TRANSACTION_ID = :id
ORDER  BY ln.LINE_NUMBER'
    );
    COMMIT;
END;
/

-- =====================================================
-- 8. POST /ar/credit-memos/:id/lines
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/:id/lines',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert lines for a specific AR Credit Memo',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_CREDITMEMO_PKG.save_creditmemo_lines(
        p_transaction_id => :id,
        p_lines_json     => :body_text,
        p_status         => l_status,
        p_message        => l_message
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"'' || l_status || ''","message":"'' ||
          REPLACE(l_message, ''"'', ''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/credit-memos                 List headers (paginated, filtered)
--   ?business_unit=      VARCHAR2 (optional)
--   ?transaction_source= VARCHAR2 (optional)
--   ?transaction_number= VARCHAR2 (optional, starts-with)
--   ?bill_to_customer=   VARCHAR2 (optional, name or number)
--   ?cross_reference=    VARCHAR2 (optional)
--   ?credit_memo_status= VARCHAR2 (optional, exact match)
--   ?date_from=          YYYY-MM-DD (optional)
--   ?date_to=            YYYY-MM-DD (optional)
--
-- GET  {base}/ar/credit-memos/:id             Get single header
-- POST {base}/ar/credit-memos/bulk            Bulk upsert {"items":[...]}
-- =====================================================
-- 9. Template: ar/credit-memos/:id/distributions
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'credit-memos/:id/distributions');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'credit-memos/:id/distributions',
        p_comments    => 'AR Credit Memo Distributions for a header'
    );
    COMMIT;
END;
/

-- =====================================================
-- 10. GET /ar/credit-memos/:id/distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/:id/distributions',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'Get distributions for an AR Credit Memo',
        p_source         => '
SELECT d.*
FROM   RR_AR_CREDITMEMO_DISTRIBUTIONS d
WHERE  d.CUSTOMER_TRANSACTION_ID = :id
ORDER  BY d.DISTRIBUTION_ID'
    );
    COMMIT;
END;
/

-- =====================================================
-- 11. POST /ar/credit-memos/:id/distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'credit-memos/:id/distributions',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert distributions for a specific AR Credit Memo',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_CREDITMEMO_PKG.save_creditmemo_distributions(
        p_transaction_id     => :id,
        p_distributions_json => :body_text,
        p_status             => l_status,
        p_message            => l_message
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"'' || l_status || ''","message":"'' ||
          REPLACE(l_message, ''"'', ''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/credit-memos                        List headers (paginated, filtered)
-- GET  {base}/ar/credit-memos/:id                    Get single header
-- POST {base}/ar/credit-memos/bulk                   Bulk upsert {"items":[...]}
-- GET  {base}/ar/credit-memos/:id/lines              Get lines for a credit memo
-- POST {base}/ar/credit-memos/:id/lines              Upsert lines {"items":[...]}
-- GET  {base}/ar/credit-memos/:id/distributions      Get distributions for a credit memo
-- POST {base}/ar/credit-memos/:id/distributions      Upsert distributions {"items":[...]}
-- =====================================================
