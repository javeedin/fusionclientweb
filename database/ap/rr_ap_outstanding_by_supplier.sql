-- =====================================================================
-- GET reerp/ap/invoices/outstanding-by-supplier
-- Outstanding balance broken down by supplier.
-- Uses actual payment + prepayment application tables (not AMOUNT_PAID).
-- DISCOUNT_TAKEN is included in total_paid so it reduces the outstanding.
-- Excludes Prepayment-type invoices (they reduce other invoices via
-- RR_AP_APPLIED_PREPAYMENTS and must not appear as outstanding themselves).
-- Optional: P_BUSINESS_UNIT filter
--
-- Module : reerp   (base path /reerp/)
-- Pattern: ap/invoices/outstanding-by-supplier
-- Full URL: .../ords/bcldifc/reerp/ap/invoices/outstanding-by-supplier
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop existing template (idempotent — handles both old 'ap' and 'reerp')
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/invoices/outstanding-by-supplier');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'invoices/outstanding-by-supplier');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ---------------------------------------------------------------------------
-- 2. Define template under reerp module
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/invoices/outstanding-by-supplier',
        p_comments    => 'AP outstanding balance broken down by supplier'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 3. GET handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/invoices/outstanding-by-supplier',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns one row per supplier: invoice count, total invoiced, total paid (incl. discount), outstanding',
        p_source         => q'[
DECLARE
    l_rows   CLOB;
    l_first  BOOLEAN := TRUE;
    l_len    INTEGER;
    l_offset INTEGER;
    l_chunk  CONSTANT INTEGER := 32000;

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
        RETURN '"' || REPLACE(REPLACE(p, '\', '\\'), '"', '\"') || '"';
    END;

BEGIN
    DBMS_LOB.CREATETEMPORARY(l_rows, TRUE);
    DBMS_LOB.APPEND(l_rows, TO_CLOB('['));

    FOR rec IN (
        SELECT
            i.SUPPLIER_NUMBER,
            NVL(sm.SUPPLIER, i.SUPPLIER_NUMBER)                          AS SUPPLIER_NAME,
            COUNT(i.INVOICE_ID)                                          AS INVOICE_COUNT,
            SUM(NVL(i.INVOICE_AMOUNT, 0))                                AS TOTAL_INVOICE_AMOUNT,
            SUM(  NVL(pay_sum.total_paid,     0)
                + NVL(prep_sum.total_applied, 0))                        AS TOTAL_PAID,
            SUM(GREATEST(0,
                    NVL(i.INVOICE_AMOUNT, 0)
                  - NVL(pay_sum.total_paid,     0)
                  - NVL(prep_sum.total_applied, 0)))                     AS OUTSTANDING_AMOUNT
        FROM RR_AP_INVOICES_ALL i
        LEFT JOIN RR_SUPPLIER_MASTER sm
               ON sm.SUPPLIER_NUMBER = i.SUPPLIER_NUMBER
        -- cash payments per invoice: amount paid + discount taken (both reduce liability)
        LEFT JOIN (
            SELECT ri.INVOICE_ID,
                   SUM(  NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                        + NVL(ri.DISCOUNT_TAKEN, 0))                     AS total_paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL              p  ON p.CHECK_ID = ri.CHECK_ID
            WHERE  NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
            AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
            GROUP BY ri.INVOICE_ID
        ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
        -- prepayment applications per invoice
        LEFT JOIN (
            SELECT ap.INVOICE_ID,
                   SUM(NVL(ap.APPLIED_AMOUNT, 0))                        AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY ap.INVOICE_ID
        ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
        WHERE NVL(i.CANCELED_FLAG,  'N')        != 'Y'
        AND   NVL(i.INVOICE_TYPE,   'Standard') != 'Prepayment'
        AND   NVL(i.PAID_STATUS,    'Unpaid')   NOT IN ('Paid', 'Cancelled')
        AND   (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT = :P_BUSINESS_UNIT)
        GROUP BY i.SUPPLIER_NUMBER,
                 NVL(sm.SUPPLIER, i.SUPPLIER_NUMBER)
        HAVING SUM(GREATEST(0,
                       NVL(i.INVOICE_AMOUNT, 0)
                     - NVL(pay_sum.total_paid,     0)
                     - NVL(prep_sum.total_applied, 0))) > 0
        ORDER BY OUTSTANDING_AMOUNT DESC
    ) LOOP
        IF NOT l_first THEN
            DBMS_LOB.APPEND(l_rows, TO_CLOB(','));
        END IF;
        l_first := FALSE;

        DBMS_LOB.APPEND(l_rows, TO_CLOB(
            '{"supplier_number":'     || js(rec.SUPPLIER_NUMBER)     || ',' ||
            '"supplier_name":'        || js(rec.SUPPLIER_NAME)        || ',' ||
            '"invoice_count":'        || rec.INVOICE_COUNT            || ',' ||
            '"total_invoice_amount":' || jn(rec.TOTAL_INVOICE_AMOUNT) || ',' ||
            '"total_paid":'           || jn(rec.TOTAL_PAID)           || ',' ||
            '"outstanding_amount":'   || jn(rec.OUTSTANDING_AMOUNT)   ||
            '}'
        ));
    END LOOP;

    DBMS_LOB.APPEND(l_rows, TO_CLOB(']'));

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"items":');
    l_len    := NVL(DBMS_LOB.GETLENGTH(l_rows), 0);
    l_offset := 1;
    WHILE l_offset <= l_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(l_rows, l_chunk, l_offset));
        l_offset := l_offset + l_chunk;
    END LOOP;
    HTP.PRN('}');

EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 80) src
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id  = t.module_id
JOIN   user_ords_handlers  h ON t.id  = h.template_id
WHERE  m.name         = 'reerp'
AND    t.uri_template = 'ap/invoices/outstanding-by-supplier'
ORDER  BY h.method;
