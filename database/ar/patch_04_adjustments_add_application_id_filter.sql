-- =============================================================
-- PATCH 04 — RR_AR_ADJUSTMENTS GET handler
-- Add application_id filter and return APPLICATION_ID column.
-- Safe to re-run (ORDS.DEFINE_HANDLER replaces the handler).
-- =============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'adjustments',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List AR adjustments with optional filters including application_id',
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
           :application_id          AS p_app_id
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
ORDER BY a.ADJUSTMENT_DATE DESC, a.ADJUSTMENT_ID DESC'
    );
    COMMIT;
END;
/
