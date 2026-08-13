-- =====================================================
-- ORDS REST Handlers for AR Invoices
-- Module  : ar
-- Base    : /ar/
-- Tables  : RR_AR_INVOICE_HEADERS, RR_AR_INVOICE_LINES
-- Package : RR_AR_INVOICES_PKG
-- =====================================================

-- =====================================================
-- 1. Define REST Module
-- =====================================================
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'ar',
        p_base_path      => '/ar/',
        p_items_per_page => 100,
        p_status         => 'PUBLISHED',
        p_comments       => 'AR Invoices REST API'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. Template: ar/invoices
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices',
        p_comments       => 'AR Invoice headers'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. POST /ar/invoices  — save single invoice header
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert single AR invoice from JSON',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICES_PKG.save_invoice(
        p_invoice_json => :body_text,
        p_status       => l_status,
        p_message      => l_message
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
-- 4. GET /ar/invoices  — list headers with optional filters
-- Each bind variable referenced EXACTLY ONCE via CTE
-- (multiple refs cause empty results in some ORDS versions)
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'List AR invoice headers with optional filters',
        p_source         => '
WITH fp AS (
    SELECT :business_unit      AS bu,
           :transaction_source AS src,
           :transaction_class  AS cls,
           :transaction_type   AS typ,
           :transaction_number AS num,
           :bill_to_customer   AS cust,
           :cross_reference    AS ref,
           :date_from          AS dfrom,
           :date_to            AS dto
    FROM DUAL
)
SELECT
    h.CUSTOMER_TRANSACTION_ID,
    h.TRANSACTION_NUMBER,
    h.DOCUMENT_NUMBER,
    h.CROSS_REFERENCE,
    h.TRANSACTION_DATE,
    h.ACCOUNTING_DATE,
    h.DUE_DATE,
    h.TRANSACTION_TYPE,
    h.TRANSACTION_SOURCE,
    h.INVOICE_STATUS,
    h.INVOICE_CURRENCY_CODE,
    h.ENTERED_AMOUNT,
    h.INVOICE_BALANCE_AMOUNT,
    RR_AR_INVOICE_BALANCES.get_balance(h.CUSTOMER_TRANSACTION_ID) AS COMPUTED_BALANCE,
    h.BILL_TO_CUSTOMER_NUMBER,
    h.BILL_TO_CUSTOMER_NAME,
    h.BUSINESS_UNIT,
    h.PAYMENT_TERMS,
    h.PURCHASE_ORDER,
    h.SYNC_STATUS,
    h.SYNC_DATE
FROM RR_AR_INVOICE_HEADERS h
CROSS JOIN fp
WHERE (fp.bu    IS NULL OR fp.bu    = '''' OR UPPER(h.BUSINESS_UNIT)      LIKE ''%''||UPPER(fp.bu)||''%'')
  AND (fp.src   IS NULL OR fp.src   = '''' OR UPPER(h.TRANSACTION_SOURCE) LIKE ''%''||UPPER(fp.src)||''%'')
  AND (fp.typ   IS NULL OR fp.typ   = '''' OR UPPER(h.TRANSACTION_TYPE)   LIKE ''%''||UPPER(fp.typ)||''%'')
  AND (fp.num   IS NULL OR fp.num   = '''' OR UPPER(h.TRANSACTION_NUMBER) LIKE       UPPER(fp.num)||''%'')
  AND (fp.cust  IS NULL OR fp.cust  = '''' OR UPPER(h.BILL_TO_CUSTOMER_NAME)   LIKE ''%''||UPPER(fp.cust)||''%''
                                           OR UPPER(h.BILL_TO_CUSTOMER_NUMBER) LIKE ''%''||UPPER(fp.cust)||''%'')
  AND (fp.ref   IS NULL OR fp.ref   = '''' OR UPPER(h.CROSS_REFERENCE)    LIKE ''%''||UPPER(fp.ref)||''%'')
  AND (fp.dfrom IS NULL OR fp.dfrom = '''' OR h.TRANSACTION_DATE >= TO_DATE(SUBSTR(fp.dfrom,1,10),''YYYY-MM-DD''))
  AND (fp.dto   IS NULL OR fp.dto   = '''' OR h.TRANSACTION_DATE <= TO_DATE(SUBSTR(fp.dto,1,10),''YYYY-MM-DD''))
ORDER BY h.TRANSACTION_DATE DESC, h.TRANSACTION_NUMBER DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. Template: ar/invoices/bulk
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/bulk',
        p_comments       => 'Bulk upsert AR invoice headers'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. POST /ar/invoices/bulk  — bulk upsert headers
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR invoices {"items":[...]}',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_message  VARCHAR2(4000);
    l_inserted NUMBER;
    l_updated  NUMBER;
    l_errors   NUMBER;
BEGIN
    RR_AR_INVOICES_PKG.save_invoices_bulk(
        p_invoices_json => :body_text,
        p_status        => l_status,
        p_message       => l_message,
        p_inserted      => l_inserted,
        p_updated       => l_updated,
        p_errors        => l_errors
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
-- 7. Template: ar/invoices/:id
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id',
        p_comments       => 'Single AR invoice header by CustomerTransactionId'
    );
    COMMIT;
END;
/

-- =====================================================
-- 8. GET /ar/invoices/:id
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_comments       => 'Get single AR invoice header',
        p_source         => '
SELECT h.*
FROM   RR_AR_INVOICE_HEADERS h
WHERE  h.CUSTOMER_TRANSACTION_ID = :id'
    );
    COMMIT;
END;
/

-- =====================================================
-- 9. Template: ar/invoices/:id/lines
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/lines',
        p_comments       => 'AR invoice lines for a header'
    );
    COMMIT;
END;
/

-- =====================================================
-- 10. POST /ar/invoices/:id/lines  — save lines
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/lines',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert lines for a specific AR invoice',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICES_PKG.save_invoice_lines(
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
-- 11. GET /ar/invoices/:id/lines
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'Get lines for an AR invoice',
        p_source         => '
SELECT ln.*
FROM   RR_AR_INVOICE_LINES ln
WHERE  ln.CUSTOMER_TRANSACTION_ID = :id
ORDER  BY ln.LINE_NUMBER'
    );
    COMMIT;
END;
/

-- =====================================================
-- 12. Template: ar/invoices/stats
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/stats',
        p_comments       => 'AR invoice summary statistics'
    );
    COMMIT;
END;
/

-- =====================================================
-- 13. GET /ar/invoices/stats
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/stats',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_comments       => 'AR invoice dashboard stats',
        p_source         => '
SELECT
    COUNT(*)                                                           AS total_invoices,
    SUM(ENTERED_AMOUNT)                                                AS total_entered_amount,
    SUM(INVOICE_BALANCE_AMOUNT)                                        AS total_outstanding,
    COUNT(CASE WHEN INVOICE_STATUS = ''Complete'' THEN 1 END)          AS complete_count,
    COUNT(CASE WHEN INVOICE_STATUS = ''Incomplete'' THEN 1 END)        AS incomplete_count,
    COUNT(CASE WHEN DUE_DATE < SYSDATE
                AND INVOICE_BALANCE_AMOUNT > 0 THEN 1 END)             AS overdue_count,
    MAX(SYNC_DATE)                                                     AS last_sync_date
FROM RR_AR_INVOICE_HEADERS
WHERE (:P_BUSINESS_UNIT IS NULL OR BUSINESS_UNIT = :P_BUSINESS_UNIT)'
    );
    COMMIT;
END;
/

-- =====================================================
-- 14. Template: ar/invoices/:id/installments
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments',
        p_comments       => 'AR invoice installments for a header'
    );
    COMMIT;
END;
/

-- =====================================================
-- 15. POST /ar/invoices/:id/installments  — save installments
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert installments for a specific AR invoice',
        p_source         => '
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
BEGIN
    XXAP_INVOICE_INSTALLMENTS_PKG.save_installments_from_items(
        p_json          => :body_text,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    :status_code := CASE
        WHEN l_status = ''SUCCESS'' THEN 201
        WHEN l_status = ''PARTIAL'' THEN 207
        ELSE 400
    END;

    HTP.P(''{"success":'' ||
          CASE WHEN l_status = ''SUCCESS'' THEN ''true'' ELSE ''false'' END ||
          '',"status":"''       || l_status                              ||
          ''","message":"''     || REPLACE(l_message, ''"'', ''\\"'')   ||
          ''","successCount":'' || l_success_count                      ||
          '',"errorCount":''    || l_error_count || ''}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 16. GET /ar/invoices/:id/installments
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_comments       => 'Get installments for an AR invoice with calculated balance and status',
        p_source         => q'[
DECLARE
    l_txn_id        NUMBER := :id;
    l_orig          NUMBER;
    l_paid          NUMBER;
    l_adj           NUMBER;
    l_balance       NUMBER;
    l_calc_applied  NUMBER;
    l_calc_adj      NUMBER;
    l_calc_balance  NUMBER;
    l_status        VARCHAR2(30);
    l_closed_date   DATE;
    l_count         NUMBER := 0;
BEGIN
    APEX_JSON.open_object;
    APEX_JSON.open_array('items');

    FOR r IN (
        SELECT ii.INSTALLMENT_ID,
               ii.CUSTOMER_TRANSACTION_ID,
               ii.INSTALLMENT_SEQUENCE_NUMBER,
               ii.INSTALLMENT_DUE_DATE,
               ii.INSTALLMENT_LINE_AMOUNT_ORIGINAL,
               ii.ORIGINAL_AMOUNT,
               ii.AMOUNT_PAID,
               ii.INSTALLMENT_AMOUNT_ADJUSTED,
               ii.INSTALLMENT_FREIGHT_AMOUNT_DUE,
               ii.INSTALLMENT_TAX_AMOUNT_DUE,
               ii.INSTALLMENT_STATUS,
               ii.INSTALLMENT_CLOSED_DATE,
               ii.INSTALLMENT_GL_CLOSED_DATE,
               ii.LAST_UPDATE_DATE,
               ii.LAST_UPDATED_BY,
               (SELECT NVL(SUM(NVL(ra.APPLICATION_AMOUNT, 0)), 0)
                  FROM RR_AR_RECEIPT_APPLICATIONS ra
                 WHERE ra.REFERENCE_INSTALLMENT_ID = ii.INSTALLMENT_ID) AS APPLIED_AMT,
               -- Adjustment is sourced from RR_AR_ADJUSTMENTS (NOT the receipt
               -- application row). Match on INSTALLMENT_ID; fall back to
               -- CUSTOMER_TRANSACTION_ID + INSTALLMENT_NUMBER for rows where
               -- INSTALLMENT_ID was not populated.
               (SELECT NVL(SUM(ABS(NVL(adj.ADJUSTMENT_AMOUNT, 0))), 0)
                  FROM RR_AR_ADJUSTMENTS adj
                 WHERE adj.INSTALLMENT_ID = ii.INSTALLMENT_ID
                    OR (adj.INSTALLMENT_ID IS NULL
                        AND adj.CUSTOMER_TRANSACTION_ID = ii.CUSTOMER_TRANSACTION_ID
                        AND adj.INSTALLMENT_NUMBER      = ii.INSTALLMENT_SEQUENCE_NUMBER)) AS APPLIED_ADJ
        FROM   RR_AR_INVOICE_INSTALLMENTS ii
        WHERE  ii.CUSTOMER_TRANSACTION_ID = l_txn_id
        ORDER  BY ii.INSTALLMENT_SEQUENCE_NUMBER
    ) LOOP
        l_orig    := NVL(r.INSTALLMENT_LINE_AMOUNT_ORIGINAL, NVL(r.ORIGINAL_AMOUNT, 0));
        l_paid    := NVL(r.AMOUNT_PAID, 0);
        l_adj     := NVL(r.INSTALLMENT_AMOUNT_ADJUSTED, 0);
        l_balance := l_orig - l_paid - ABS(l_adj);

        -- Calculated balance = ORIGINAL - applied (from RR_AR_RECEIPT_APPLICATIONS)
        -- - adjustments (from RR_AR_ADJUSTMENTS). Independent of the stored
        -- balance-due columns.
        l_calc_applied := NVL(r.APPLIED_AMT, 0);
        l_calc_adj     := NVL(r.APPLIED_ADJ, 0);
        l_calc_balance := l_orig - l_calc_applied - l_calc_adj;
        IF l_calc_balance < 0 THEN l_calc_balance := 0; END IF;

        IF (l_paid + ABS(l_adj)) >= l_orig AND l_orig > 0 THEN
            l_status      := 'Closed';
            l_closed_date := NVL(r.INSTALLMENT_CLOSED_DATE, SYSDATE);
            l_balance     := 0;
        ELSE
            l_status      := 'Open';
            l_closed_date := NULL;
        END IF;

        APEX_JSON.open_object;
        APEX_JSON.write('installment_id',                r.INSTALLMENT_ID);
        APEX_JSON.write('customer_trx_id',               r.CUSTOMER_TRANSACTION_ID);
        APEX_JSON.write('installment_sequence_number',   r.INSTALLMENT_SEQUENCE_NUMBER);
        APEX_JSON.write('installment_due_date',          r.INSTALLMENT_DUE_DATE);
        APEX_JSON.write('original_amount',               l_orig);
        APEX_JSON.write('amount_paid',                   l_paid);
        APEX_JSON.write('installment_amount_adjusted',   l_adj);
        APEX_JSON.write('installment_balance_due',       l_balance);
        APEX_JSON.write('accounted_balance_due',         l_balance);
        APEX_JSON.write('installment_line_amount_due',   l_balance);
        APEX_JSON.write('applied_amount',                l_calc_applied);
        APEX_JSON.write('applied_adjustment',            l_calc_adj);
        APEX_JSON.write('calculated_balance',            l_calc_balance);
        APEX_JSON.write('installment_freight_amount_due', CASE WHEN l_status = 'Closed' THEN 0 ELSE NVL(r.INSTALLMENT_FREIGHT_AMOUNT_DUE, 0) END);
        APEX_JSON.write('installment_tax_amount_due',    CASE WHEN l_status = 'Closed' THEN 0 ELSE NVL(r.INSTALLMENT_TAX_AMOUNT_DUE, 0) END);
        APEX_JSON.write('installment_status',            l_status);
        APEX_JSON.write('installment_closed_date',       l_closed_date);
        APEX_JSON.write('installment_gl_closed_date',    r.INSTALLMENT_GL_CLOSED_DATE);
        APEX_JSON.write('last_update_date',              r.LAST_UPDATE_DATE);
        APEX_JSON.write('last_updated_by',               r.LAST_UPDATED_BY);
        APEX_JSON.close_object;

        l_count := l_count + 1;
    END LOOP;

    APEX_JSON.close_array;
    APEX_JSON.write('count', l_count);
    APEX_JSON.close_object;
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 17. Template: ar/invoices/:id/distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/distributions',
        p_comments       => 'AR invoice distributions for a header'
    );
    COMMIT;
END;
/

-- =====================================================
-- 18. POST /ar/invoices/:id/distributions  — save distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/distributions',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert distributions for a specific AR invoice',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICES_PKG.save_invoice_distributions(
        p_transaction_id      => :id,
        p_distributions_json  => :body_text,
        p_status              => l_status,
        p_message             => l_message
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
-- 19. GET /ar/invoices/:id/distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/distributions',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_comments       => 'Get distributions for an AR invoice',
        p_source         => '
SELECT d.*
FROM   RR_AR_INVOICE_DISTRIBUTIONS d
WHERE  d.CUSTOMER_TRANSACTION_ID = :id
ORDER  BY d.INVOICE_LINE_NUMBER, d.DISTRIBUTION_ID'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- POST   {base}/ar/invoices                      Upsert single header
-- POST   {base}/ar/invoices/bulk                 Bulk upsert headers {"items":[...]}
-- POST   {base}/ar/invoices/:id/lines            Upsert lines for a header {"items":[...]}
-- POST   {base}/ar/invoices/:id/installments     Upsert installments for a header {"items":[...]}
-- POST   {base}/ar/invoices/:id/distributions    Upsert distributions for a header {"items":[...]}
-- GET    {base}/ar/invoices                      List all headers (paginated)
-- GET    {base}/ar/invoices/:id                  Get single header
-- GET    {base}/ar/invoices/:id/lines            Get lines for a header
-- GET    {base}/ar/invoices/:id/installments     Get installments for a header
--          (adds applied_amount, applied_adjustment and calculated_balance —
--           applied_amount from RR_AR_RECEIPT_APPLICATIONS, applied_adjustment
--           from RR_AR_ADJUSTMENTS; balance = ORIGINAL - applied - adjustment,
--           independent of the stored balance-due columns)
-- GET    {base}/ar/invoices/:id/distributions    Get distributions for a header
-- GET    {base}/ar/invoices/stats                Dashboard summary stats
-- =====================================================
