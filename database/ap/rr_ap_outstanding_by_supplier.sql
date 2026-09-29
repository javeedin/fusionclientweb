-- =====================================================================
-- GET reerp/ap/invoices/outstanding-by-supplier
-- Outstanding balance broken down by supplier.
-- Uses actual payment + prepayment application tables (not AMOUNT_PAID).
-- DISCOUNT_TAKEN is included in total_paid so it reduces the outstanding.
-- Excludes Prepayment-type invoices (they reduce other invoices via
-- RR_AP_APPLIED_PREPAYMENTS and must not appear as outstanding themselves).
--
-- Credit notes / debit memos (negative invoices) are INCLUDED with their
-- negative remaining (invoice amount − amounts already applied in payments), as
-- the Payables dashboard (suppliers/balance/outstanding) does; positive invoices
-- are floored at 0. Suppliers with a net credit balance are listed too.
--
-- Optional filters (either spelling):
--   P_BUSINESS_UNIT | business_unit  – AP business unit name
--   P_COMPANY       | company        – company (segment 1 of the liability account)
--
-- Extra fields per supplier: credit_note_count, credit_note_amount (open credit
-- notes, negative), invoice_outstanding (open positive invoices).
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
    -- filters: P_BUSINESS_UNIT / business_unit, P_COMPANY / company
    l_bu      VARCHAR2(240) := TRIM(NVL(:P_BUSINESS_UNIT, :business_unit));
    l_company VARCHAR2(30)  := TRIM(NVL(:P_COMPANY, :company));
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
            x.SUPPLIER_NUMBER,
            x.SUPPLIER_NAME,
            COUNT(*)                                                     AS INVOICE_COUNT,
            SUM(x.amt)                                                   AS TOTAL_INVOICE_AMOUNT,
            SUM(x.paid + x.applied)                                      AS TOTAL_PAID,
            SUM(x.remaining)                                             AS OUTSTANDING_AMOUNT,
            SUM(CASE WHEN x.remaining < 0 THEN 1 ELSE 0 END)             AS CREDIT_NOTE_COUNT,
            SUM(LEAST(x.remaining, 0))                                   AS CREDIT_NOTE_AMOUNT,
            SUM(GREATEST(x.remaining, 0))                                AS INVOICE_OUTSTANDING
        FROM (
            SELECT i.SUPPLIER_NUMBER,
                   NVL(sm.SUPPLIER, i.SUPPLIER_NUMBER)                   AS SUPPLIER_NAME,
                   NVL(i.INVOICE_AMOUNT, 0)                              AS amt,
                   NVL(pay_sum.total_paid, 0)                            AS paid,
                   NVL(prep_sum.total_applied, 0)                        AS applied,
                   -- credit notes keep their negative balance; positive invoices
                   -- are floored at 0 (an overpayment is not a credit)
                   CASE WHEN NVL(i.INVOICE_AMOUNT, 0) < 0
                        THEN NVL(i.INVOICE_AMOUNT, 0) - NVL(pay_sum.total_paid, 0) - NVL(prep_sum.total_applied, 0)
                        ELSE GREATEST(0, NVL(i.INVOICE_AMOUNT, 0) - NVL(pay_sum.total_paid, 0) - NVL(prep_sum.total_applied, 0))
                   END                                                   AS remaining
            FROM RR_AP_INVOICES_ALL i
            LEFT JOIN RR_SUPPLIER_MASTER sm
                   ON sm.SUPPLIER_NUMBER = i.SUPPLIER_NUMBER
            -- cash payments per invoice: amount paid + discount taken (both reduce liability);
            -- for a credit note these are negative (the credit applied in a payment)
            LEFT JOIN (
                SELECT ri.INVOICE_ID,
                       SUM(  NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                            + NVL(ri.DISCOUNT_TAKEN, 0))                 AS total_paid
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL              p  ON p.CHECK_ID = ri.CHECK_ID
                WHERE  NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
                AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
                GROUP BY ri.INVOICE_ID
            ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
            -- prepayment applications per invoice (by id, or by number when the id is missing)
            LEFT JOIN (
                SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)         AS INVOICE_ID,
                       SUM(NVL(ap.APPLIED_AMOUNT, 0))                    AS total_applied
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL inv_r
                       ON ap.INVOICE_ID IS NULL AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
            ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
            WHERE NVL(i.CANCELED_FLAG, 'N')        != 'Y'
            AND   NVL(i.INVOICE_TYPE,  'Standard') != 'Prepayment'
            AND   (l_bu      IS NULL OR i.BUSINESS_UNIT = l_bu)
            AND   (l_company IS NULL OR REGEXP_SUBSTR(i.LIABILITY_DISTRIBUTION, '[^-]+', 1, 1) = l_company)
        ) x
        -- open items only: invoices with a balance and credit notes not yet used up
        WHERE ROUND(x.remaining, 2) != 0
        GROUP BY x.SUPPLIER_NUMBER, x.SUPPLIER_NAME
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
            '"outstanding_amount":'   || jn(rec.OUTSTANDING_AMOUNT)   || ',' ||
            '"credit_note_count":'    || jn(rec.CREDIT_NOTE_COUNT)    || ',' ||
            '"credit_note_amount":'   || jn(rec.CREDIT_NOTE_AMOUNT)   || ',' ||
            '"invoice_outstanding":'  || jn(rec.INVOICE_OUTSTANDING)  ||
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
--    GET .../reerp/ap/invoices/outstanding-by-supplier?business_unit=BUIMERC CORP_DIFC_INVST&company=01
--    Σ outstanding_amount should equal the Payables dashboard / suppliers/balance/outstanding
--    (credit notes now included, negative)
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 80) src
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id  = t.module_id
JOIN   user_ords_handlers  h ON t.id  = h.template_id
WHERE  m.name         = 'reerp'
AND    t.uri_template = 'ap/invoices/outstanding-by-supplier'
ORDER  BY h.method;
