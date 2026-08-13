-- =====================================================
-- ORDS REST Handlers — AR Adjustments
-- Module  : ar  (already defined)
-- Base    : /ar/
-- Table   : RR_AR_ADJUSTMENTS
-- Package : RR_AR_ADJUSTMENTS_PKG
-- =====================================================

-- =====================================================
-- 1. Template: ar/adjustments
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'adjustments');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'adjustments',
        p_comments    => 'AR Adjustments'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. GET /ar/adjustments
--    Filters: business_unit, transaction_number,
--             adjustment_number, status, adjustment_type,
--             customer_transaction_id, approved_by,
--             date_from, date_to
--    Pagination: limit (default 200), offset (default 0)
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'adjustments',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List AR adjustments with optional filters including application_id and installment_id',
        p_source         => '
WITH fp AS (
    SELECT :business_unit           AS p_bu,
           :transaction_number      AS p_txn,
           :adjustment_number       AS p_adj_num,
           :status                  AS p_status,
           :adjustment_type         AS p_type,
           :customer_transaction_id AS p_cust_txn_id,
           :approved_by             AS p_approved_by,
           :date_from               AS p_date_from,
           :date_to                 AS p_date_to,
           :application_id          AS p_app_id,
           :installment_id          AS p_inst_id
    FROM DUAL
)
SELECT
    a.ADJUSTMENT_ID,
    a.ADJUSTMENT_NUMBER,
    a.ADJUSTMENT_TYPE,
    a.ADJUSTMENT_AMOUNT,
    TO_CHAR(a.ADJUSTMENT_DATE, ''YYYY-MM-DD'')  AS ADJUSTMENT_DATE,
    TO_CHAR(a.ACCOUNTING_DATE, ''YYYY-MM-DD'')  AS ACCOUNTING_DATE,
    a.STATUS,
    a.RECEIVABLES_ACTIVITY,
    a.BUSINESS_UNIT,
    a.CUSTOMER_TRANSACTION_ID,
    a.TRANSACTION_NUMBER,
    a.TRANSACTION_CLASS,
    a.ACCOUNTED_AMOUNT,
    a.CURRENCY,
    a.INSTALLMENT_NUMBER,
    a.INSTALLMENT_ID,
    a.INSTALLMENT_BALANCE,
    a.ADJUSTMENT_REASON,
    a.APPROVED_BY,
    a.BILL_TO_SITE_USE_ID,
    a.COMMENTS,
    a.ACCOUNT_COMBINATION,
    a.APPLICATION_ID,
    a.FUSION_CREATED_BY,
    TO_CHAR(a.FUSION_CREATION_DATE,    ''YYYY-MM-DD"T"HH24:MI:SS'') AS FUSION_CREATION_DATE,
    a.FUSION_LAST_UPDATED_BY,
    TO_CHAR(a.FUSION_LAST_UPDATE_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') AS FUSION_LAST_UPDATE_DATE,
    a.SYNC_STATUS,
    TO_CHAR(a.SYNC_DATE, ''YYYY-MM-DD'') AS SYNC_DATE
FROM RR_AR_ADJUSTMENTS a
CROSS JOIN fp
WHERE (fp.p_bu           IS NULL OR fp.p_bu           = '''' OR UPPER(a.BUSINESS_UNIT)        = UPPER(fp.p_bu))
  AND (fp.p_txn          IS NULL OR fp.p_txn          = '''' OR UPPER(a.TRANSACTION_NUMBER)   = UPPER(fp.p_txn))
  AND (fp.p_adj_num      IS NULL OR fp.p_adj_num      = '''' OR UPPER(a.ADJUSTMENT_NUMBER)    = UPPER(fp.p_adj_num))
  AND (fp.p_status       IS NULL OR fp.p_status       = '''' OR UPPER(a.STATUS)               = UPPER(fp.p_status))
  AND (fp.p_type         IS NULL OR fp.p_type         = '''' OR UPPER(a.ADJUSTMENT_TYPE)      LIKE ''%''||UPPER(fp.p_type)||''%'')
  AND (fp.p_cust_txn_id  IS NULL OR fp.p_cust_txn_id  = '''' OR TO_CHAR(a.CUSTOMER_TRANSACTION_ID) = fp.p_cust_txn_id)
  AND (fp.p_approved_by  IS NULL OR fp.p_approved_by  = '''' OR UPPER(a.APPROVED_BY)          LIKE ''%''||UPPER(fp.p_approved_by)||''%'')
  AND (fp.p_date_from    IS NULL OR fp.p_date_from    = '''' OR a.ADJUSTMENT_DATE >= TO_DATE(SUBSTR(fp.p_date_from,1,10),''YYYY-MM-DD''))
  AND (fp.p_date_to      IS NULL OR fp.p_date_to      = '''' OR a.ADJUSTMENT_DATE <= TO_DATE(SUBSTR(fp.p_date_to,1,10),  ''YYYY-MM-DD''))
  AND (fp.p_app_id       IS NULL OR fp.p_app_id       = '''' OR TO_CHAR(a.APPLICATION_ID)     = fp.p_app_id)
  AND (fp.p_inst_id      IS NULL OR fp.p_inst_id      = '''' OR TO_CHAR(a.INSTALLMENT_ID)     = fp.p_inst_id)
ORDER BY a.ADJUSTMENT_DATE DESC, a.ADJUSTMENT_ID DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. POST /ar/adjustments  — single upsert
--    Body: single Fusion receivablesAdjustments object
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'adjustments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert single AR adjustment',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
    l_wrapped  CLOB;
BEGIN
    -- Wrap single object into items array for the bulk procedure
    l_wrapped := ''{"items":['' || :body_text || '']}'';
    RR_AR_ADJUSTMENTS_PKG.save_adjustments_bulk(
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
-- 4. Template: ar/adjustments/bulk
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'adjustments/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'adjustments/bulk',
        p_comments    => 'Bulk upsert AR adjustments'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. POST /ar/adjustments/bulk
--    Body: {"items":[...array of Fusion objects...]}
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'adjustments/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR adjustments {"items":[...]}',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
BEGIN
    RR_AR_ADJUSTMENTS_PKG.save_adjustments_bulk(
        p_json      => :body_text,
        p_status    => l_status,
        p_message   => l_message,
        p_inserted  => l_inserted,
        p_updated   => l_updated,
        p_errors    => l_errors
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 200 ELSE 400 END;
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
-- GET  {base}/ar/adjustments
--   ?business_unit=           Filter by BU (exact, case-insensitive)
--   ?transaction_number=      Filter by invoice transaction number
--   ?adjustment_number=       Filter by adjustment number
--   ?status=                  Approved | More Research Required | Rejected
--   ?adjustment_type=         Contains match (e.g. Line Adjustments)
--   ?customer_transaction_id= Exact Fusion CustomerTransactionId
--   ?approved_by=             Contains match on approver name
--   ?date_from=YYYY-MM-DD     Adjustment date >= value
--   ?date_to=YYYY-MM-DD       Adjustment date <= value
--   ?application_id=          Filter by receipt application id
--   ?installment_id=          Filter by invoice installment id
--
-- POST {base}/ar/adjustments          Single upsert (raw Fusion object)
-- POST {base}/ar/adjustments/bulk     Bulk upsert   {"items":[...]}
-- =====================================================
