-- =============================================================================
-- GET reerp/suppliers/balance/outstanding
-- Outstanding payables by Business Unit (and optionally one supplier), using
-- EXACTLY the same balance formula as the Supplier Balance Dashboard
-- (PKG_SUPPLIER_BALANCE.get_balance_summary → suppliers/balance/dashboard/:no),
-- so the Payables dashboard total, its drill-down and the supplier dashboard
-- all agree.
--
-- Per invoice (all invoice types, cancelled excluded):
--   remaining = invoice_amount
--             - payments  (AMOUNT_PAID_INVOICE_CURRENCY + DISCOUNT_TAKEN, excl. voided)
--             - prepayments applied TO this invoice          (excl. cancelled)
--             - applications OUT of this prepayment invoice  (excl. cancelled)
--   credit memos / negative invoices keep their negative remaining;
--   positive invoices are floored at 0.
--
-- Module  : reerp   (base path /reerp/)
-- Pattern : suppliers/balance/outstanding
-- Full URL: .../ords/bcldifc/reerp/suppliers/balance/outstanding
--
-- Query parameters (all optional):
--   P_BUSINESS_UNIT   – AP business unit name (e.g. BUIMERC CORP_DIFC_INVST); blank = all BUs
--   P_SUPPLIER_NUMBER – restrict to one supplier
--
-- Response:
-- {
--   "success": "true",
--   "business_unit": "BUIMERC CORP_DIFC_INVST",      (null = all BUs)
--   "balance_summary": {
--     "business_unit": "...", "balance": 10895, "total_invoice_amount": ...,
--     "total_payment_amount": ..., "total_invoices": ..., "supplier_count": ...,
--     "currency": "AED"
--   },
--   "items": [ { "supplier_number", "supplier_name", "invoice_count",
--                "total_invoice_amount", "total_paid", "outstanding_amount" } ]
-- }
-- =============================================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'suppliers/balance/outstanding');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'suppliers/balance/outstanding',
        p_comments    => 'Outstanding payables by business unit / supplier (supplier-dashboard formula)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers/balance/outstanding',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'BU-level outstanding + per-supplier rows; same formula as suppliers/balance/dashboard',
        p_source         => q'[
DECLARE
    l_bu         VARCHAR2(240) := TRIM(:P_BUSINESS_UNIT);
    l_supp       VARCHAR2(100) := TRIM(:P_SUPPLIER_NUMBER);
    l_rows       CLOB;
    l_first      BOOLEAN := TRUE;
    l_len        INTEGER;
    l_offset     INTEGER;
    l_chunk      CONSTANT INTEGER := 32000;
    l_balance    NUMBER := 0;
    l_inv_amt    NUMBER := 0;
    l_paid       NUMBER := 0;
    l_inv_cnt    NUMBER := 0;
    l_supp_cnt   NUMBER := 0;

    FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(100);
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        v := TO_CHAR(p, 'TM9');
        IF v LIKE  '.%' THEN v := '0'  || v; END IF;
        IF v LIKE '-.%' THEN v := '-0.' || SUBSTR(v, 3); END IF;
        RETURN v;
    END;

    FUNCTION js(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        RETURN '"' || REPLACE(REPLACE(REPLACE(REPLACE(p, '\', '\\'), '"', '\"'), CHR(13), '\r'), CHR(10), '\n') || '"';
    END;

BEGIN
    DBMS_LOB.CREATETEMPORARY(l_rows, TRUE);
    DBMS_LOB.APPEND(l_rows, TO_CLOB('['));

    FOR rec IN (
        WITH pay_sum AS (
            SELECT ri.INVOICE_ID,
                   SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
            WHERE  NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
            AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
            GROUP BY ri.INVOICE_ID
        ),
        prep_sum AS (           -- prepayments applied TO an invoice
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                     AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                   ON  ap.INVOICE_ID IS NULL
                   AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        ),
        prepaid_sum AS (        -- amounts applied OUT of a prepayment invoice
            SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS PREPAYMENT_INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                                AS total_applied_out
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL prep_r
                   ON  ap.PREPAYMENT_INVOICE_ID IS NULL
                   AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
        ),
        inv AS (
            SELECT i.SUPPLIER_NUMBER,
                   i.INVOICE_AMOUNT,
                   CASE WHEN NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment' THEN 1 ELSE 0 END AS is_regular,
                   NVL(ps.total_paid, 0) + NVL(pr.total_applied, 0)                          AS paid_applied,
                   CASE WHEN NVL(i.INVOICE_AMOUNT, 0) < 0 THEN
                            NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.total_paid, 0)
                          - NVL(pr.total_applied, 0) - NVL(po.total_applied_out, 0)
                        ELSE GREATEST(0,
                            NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.total_paid, 0)
                          - NVL(pr.total_applied, 0) - NVL(po.total_applied_out, 0))
                   END                                                                       AS remaining
            FROM   RR_AP_INVOICES_ALL i
            LEFT JOIN pay_sum     ps ON ps.INVOICE_ID            = i.INVOICE_ID
            LEFT JOIN prep_sum    pr ON pr.INVOICE_ID            = i.INVOICE_ID
            LEFT JOIN prepaid_sum po ON po.PREPAYMENT_INVOICE_ID = i.INVOICE_ID
            WHERE  NVL(i.CANCELED_FLAG, 'N') != 'Y'
            AND    (l_bu   IS NULL OR i.BUSINESS_UNIT   = l_bu)
            AND    (l_supp IS NULL OR i.SUPPLIER_NUMBER = l_supp)
        )
        SELECT inv.SUPPLIER_NUMBER,
               NVL(MAX(sm.SUPPLIER), inv.SUPPLIER_NUMBER)                   AS SUPPLIER_NAME,
               SUM(inv.is_regular)                                          AS INVOICE_COUNT,
               SUM(CASE WHEN inv.is_regular = 1 THEN NVL(inv.INVOICE_AMOUNT, 0) ELSE 0 END) AS TOTAL_INVOICE_AMOUNT,
               SUM(CASE WHEN inv.is_regular = 1 THEN inv.paid_applied ELSE 0 END)           AS TOTAL_PAID,
               SUM(inv.remaining)                                           AS OUTSTANDING_AMOUNT
        FROM   inv
        LEFT JOIN RR_SUPPLIER_MASTER sm ON sm.SUPPLIER_NUMBER = inv.SUPPLIER_NUMBER
        GROUP BY inv.SUPPLIER_NUMBER
        ORDER BY OUTSTANDING_AMOUNT DESC
    ) LOOP
        l_balance := l_balance + NVL(rec.OUTSTANDING_AMOUNT, 0);
        l_inv_amt := l_inv_amt + NVL(rec.TOTAL_INVOICE_AMOUNT, 0);
        l_paid    := l_paid    + NVL(rec.TOTAL_PAID, 0);
        l_inv_cnt := l_inv_cnt + NVL(rec.INVOICE_COUNT, 0);

        -- Rows only for suppliers with something outstanding (incl. net credits),
        -- so the drill-down rows sum exactly to the headline balance
        IF NVL(rec.OUTSTANDING_AMOUNT, 0) != 0 THEN
            l_supp_cnt := l_supp_cnt + 1;
            IF NOT l_first THEN DBMS_LOB.APPEND(l_rows, TO_CLOB(',')); END IF;
            l_first := FALSE;
            DBMS_LOB.APPEND(l_rows, TO_CLOB(
                '{"supplier_number":'     || js(rec.SUPPLIER_NUMBER)      || ',' ||
                '"supplier_name":'        || js(rec.SUPPLIER_NAME)        || ',' ||
                '"invoice_count":'        || jn(rec.INVOICE_COUNT)        || ',' ||
                '"total_invoice_amount":' || jn(rec.TOTAL_INVOICE_AMOUNT) || ',' ||
                '"total_paid":'           || jn(rec.TOTAL_PAID)           || ',' ||
                '"outstanding_amount":'   || jn(rec.OUTSTANDING_AMOUNT)   || '}'
            ));
        END IF;
    END LOOP;

    DBMS_LOB.APPEND(l_rows, TO_CLOB(']'));

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN(
        '{"success":"true",' ||
        '"business_unit":' || js(l_bu) || ',' ||
        '"supplier_number":' || js(l_supp) || ',' ||
        '"balance_summary":{' ||
            '"business_unit":'        || js(NVL(l_bu, 'All Business Units')) || ',' ||
            '"balance":'              || jn(l_balance)  || ',' ||
            '"total_invoice_amount":' || jn(l_inv_amt)  || ',' ||
            '"total_payment_amount":' || jn(l_paid)     || ',' ||
            '"total_invoices":'       || jn(l_inv_cnt)  || ',' ||
            '"supplier_count":'       || jn(l_supp_cnt) || ',' ||
            '"currency":"AED"},' ||
        '"items":'
    );
    l_len    := NVL(DBMS_LOB.GETLENGTH(l_rows), 0);
    l_offset := 1;
    WHILE l_offset <= l_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(l_rows, l_chunk, l_offset));
        l_offset := l_offset + l_chunk;
    END LOOP;
    HTP.PRN('}');

EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":"false","error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 80) src
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id  = t.module_id
JOIN   user_ords_handlers  h ON t.id  = h.template_id
WHERE  m.name         = 'reerp'
AND    t.uri_template = 'suppliers/balance/outstanding'
ORDER  BY h.method;

-- Sanity check (should equal suppliers/balance/dashboard/10148 → balance_summary.balance):
--   GET .../reerp/suppliers/balance/outstanding?P_SUPPLIER_NUMBER=10148
