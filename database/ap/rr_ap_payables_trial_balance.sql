-- =============================================================================
-- GET reerp/ap/reports/trial-balance
-- Payables Trial Balance (Oracle style) — open, ACCOUNTED liability per invoice
-- as of a date, grouped by liability account, with a GL comparison and the list
-- of unaccounted items that explain differences.
--
-- Module  : reerp   (base path /reerp/)
-- Pattern : ap/reports/trial-balance
-- Full URL: .../ords/bcldifc/reerp/ap/reports/trial-balance?P_AS_OF_DATE=2026-09-30
--
-- "Accounted as of D" for a transaction means:
--   * Fusion-synced (SYNC_STATUS='SYNCED')  → accounted in Oracle Fusion;
--     effective on its own accounting date (invoice ACCOUNTING_DATE / payment
--     ACCOUNTING_DATE, falling back to the document date), or
--   * locally created → a GL journal exists for it (the app's definition of
--     "posted"), tagged REFERENCE5/REFERENCE2 by the Re-ERP posting service, with
--     a GL date (RR_GL_JE_HEADERS.DEFAULT_EFFECTIVE_DATE) <= D:
--        AP-INVOICE-CREATION       REFERENCE2 = INVOICE_ID
--        AP-INVOICE-CANCELLATION   REFERENCE2 = INVOICE_ID
--        AP-PAYMENT                REFERENCE2 = CHECK_ID
--        AP-PAYMENT-VOID           REFERENCE2 = CHECK_ID
--        AP-PREPAYMENT-APPLICATION REFERENCE2 = APPLICATION_ID
--
-- Open liability per invoice as of D (invoice currency, then × invoice rate):
--     invoice amount                         (invoice accounted <= D, not cancelled <= D)
--   − payments + discounts on the invoice    (payment accounted <= D, not voided <= D)
--   − prepayments applied to the invoice     (application accounted <= D, not cancelled)
-- Functional (AED) = open amount × invoice conversion rate — liability is relieved
-- at the invoice rate; FX gain/loss goes to its own account, as in Oracle.
-- Prepayment invoices are liabilities only until paid (an application debits the
-- target invoice's liability and credits the prepayment asset, not this liability).
--
-- GL comparison: GL balance (accounted CR − DR, DEFAULT_EFFECTIVE_DATE <= D) of every
-- liability account used by invoices in scope — same journals and date as the GL
-- Trial Balance report (no journal-status filter).
--
-- The logic lives in procedure RR_AP_PAYABLES_TB_JSON so compile errors show up
-- when this script runs (see the user_errors check) instead of as ORDS-25001.
--
-- Parameters:
--   P_AS_OF_DATE        (required) YYYY-MM-DD
--   P_BUSINESS_UNIT     optional, exact BU name
--   P_LIABILITY_ACCOUNT optional, full combination (01-00-00-2313101-…) or natural
--                       account only (2313101 = 4th segment)
--   P_SUPPLIER_NUMBER   optional
--   P_CURRENCY          optional invoice currency (AED, USD, …)
--
-- Response:
-- { success, asOfDate, businessUnit,
--   accounts:    [{ account, tb_total, gl_balance, difference, invoice_count, supplier_count }],
--   invoices:    [{ account, supplier_number, supplier_name, invoice_id, invoice_number,
--                   invoice_type, invoice_date, accounting_date, currency, rate,
--                   invoice_amount, paid_amount, prepaid_amount, open_entered,
--                   open_functional, synced }],
--   unaccounted: [{ type, id, number, supplier_number, supplier_name, doc_date,
--                   currency, amount_functional, effect }],
--   totals:      { tb_total, gl_balance, difference, unaccounted_effect } }
-- =============================================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/reports/trial-balance');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/reports/trial-balance',
        p_comments    => 'Payables Trial Balance as of a date with GL comparison'
    );
    COMMIT;
END;
/

CREATE OR REPLACE PROCEDURE RR_AP_PAYABLES_TB_JSON (
    p_as_of_date        IN VARCHAR2,
    p_business_unit     IN VARCHAR2 DEFAULT NULL,
    p_liability_account IN VARCHAR2 DEFAULT NULL,
    p_supplier_number   IN VARCHAR2 DEFAULT NULL,
    p_currency          IN VARCHAR2 DEFAULT NULL
) AS
    l_asof      DATE;
    l_bu        VARCHAR2(240) := TRIM(p_business_unit);
    l_acct      VARCHAR2(240) := TRIM(p_liability_account);
    l_supp      VARCHAR2(100) := TRIM(p_supplier_number);
    l_ccy       VARCHAR2(15)  := UPPER(TRIM(p_currency));
    l_full_acct BOOLEAN;

    l_inv      CLOB;
    l_una      CLOB;
    l_acc      CLOB;
    l_first    BOOLEAN;
    l_chunk    CONSTANT INTEGER := 8000;    -- chars; keeps each HTP chunk < 32767 bytes even for multibyte text

    TYPE t_num  IS TABLE OF NUMBER INDEX BY VARCHAR2(240);
    TYPE t_set  IS TABLE OF NUMBER INDEX BY VARCHAR2(400);
    a_total    t_num;           -- account -> TB total (functional)
    a_invcnt   t_num;           -- account -> open invoice count
    a_suppcnt  t_num;           -- account -> distinct supplier count
    s_seen     t_set;           -- account|supplier seen
    a_key      VARCHAR2(240);
    l_gl       NUMBER;
    l_tb_tot   NUMBER := 0;
    l_gl_tot   NUMBER := 0;
    l_una_tot  NUMBER := 0;

    FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(100);
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        v := TO_CHAR(ROUND(p, 2), 'TM9');
        IF v LIKE  '.%' THEN v := '0'  || v; END IF;
        IF v LIKE '-.%' THEN v := '-0.' || SUBSTR(v, 3); END IF;
        RETURN v;
    END;

    FUNCTION js(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        RETURN '"' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p, '\', '\\'), '"', '\"'),
                      CHR(13), '\r'), CHR(10), '\n'), CHR(9), '\t') || '"';
    END;

    FUNCTION jr(p IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(100);
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        v := TO_CHAR(p, 'TM9');
        IF v LIKE  '.%' THEN v := '0'  || v; END IF;
        IF v LIKE '-.%' THEN v := '-0.' || SUBSTR(v, 3); END IF;
        RETURN v;
    END;

    FUNCTION jd(p IN DATE) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || TO_CHAR(p, 'YYYY-MM-DD') || '"' END;
    END;

    PROCEDURE lob_add(p_lob IN OUT NOCOPY CLOB, p_txt IN VARCHAR2) IS
    BEGIN
        DBMS_LOB.WRITEAPPEND(p_lob, LENGTH(p_txt), p_txt);
    END;

    PROCEDURE lob_out(p_lob IN CLOB) IS
        l_len INTEGER := NVL(DBMS_LOB.GETLENGTH(p_lob), 0);
        l_off INTEGER := 1;
    BEGIN
        WHILE l_off <= l_len LOOP
            HTP.PRN(DBMS_LOB.SUBSTR(p_lob, l_chunk, l_off));
            l_off := l_off + l_chunk;
        END LOOP;
    END;

    FUNCTION acct_ok(p_combo IN VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        IF l_acct IS NULL THEN RETURN TRUE; END IF;
        IF l_full_acct THEN RETURN p_combo = l_acct; END IF;
        RETURN REGEXP_SUBSTR(p_combo, '[^-]+', 1, 4) = l_acct;
    END;
BEGIN
    BEGIN
        l_asof := TO_DATE(TRIM(p_as_of_date), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN l_asof := NULL;
    END;
    IF l_asof IS NULL THEN
        OWA_UTIL.MIME_HEADER('application/json', TRUE);
        HTP.PRN('{"success":"false","error":"P_AS_OF_DATE (YYYY-MM-DD) is required"}');
        RETURN;
    END IF;
    l_full_acct := INSTR(NVL(l_acct, 'x'), '-') > 0;

    DBMS_LOB.CREATETEMPORARY(l_inv, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_una, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_acc, TRUE);

    -- ── 1. open accounted invoices ─────────────────────────────────────────
    lob_add(l_inv, '[');
    l_first := TRUE;
    FOR r IN (
        WITH gl_post AS (
            SELECT l.REFERENCE5 AS ref5, l.REFERENCE2 AS ref2,
                   MIN(TRUNC(h.DEFAULT_EFFECTIVE_DATE)) AS gl_date
            FROM   RR_GL_JE_LINES_ALL l
            JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
            WHERE  l.REFERENCE5 IN ('AP-INVOICE-CREATION','AP-INVOICE-CANCELLATION',
                                    'AP-PAYMENT','AP-PAYMENT-VOID','AP-PREPAYMENT-APPLICATION')
            GROUP BY l.REFERENCE5, l.REFERENCE2
        ),
        inv AS (
            SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.INVOICE_TYPE, i.INVOICE_DATE,
                   i.SUPPLIER_NUMBER, i.SUPPLIER, i.LIABILITY_DISTRIBUTION AS acct,
                   NVL(i.INVOICE_CURRENCY, 'AED') AS ccy,
                   CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                        ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END AS rate,
                   NVL(i.INVOICE_AMOUNT, 0) AS amt,
                   CASE WHEN i.SYNC_STATUS = 'SYNCED' THEN 'Y' ELSE 'N' END AS synced,
                   CASE WHEN i.SYNC_STATUS = 'SYNCED'
                        THEN TRUNC(NVL(i.ACCOUNTING_DATE, i.INVOICE_DATE))
                        ELSE gi.gl_date END AS acct_date,
                   CASE WHEN NVL(i.CANCELED_FLAG, 'N') = 'Y' THEN
                        CASE WHEN i.SYNC_STATUS = 'SYNCED'
                             THEN TRUNC(COALESCE(i.CANCELED_DATE, i.CANCELLATION_DATE, i.INVOICE_DATE))
                             ELSE gc.gl_date END
                   END AS cancel_date
            FROM   RR_AP_INVOICES_ALL i
            LEFT JOIN gl_post gi ON gi.ref5 = 'AP-INVOICE-CREATION'     AND gi.ref2 = TO_CHAR(i.INVOICE_ID)
            LEFT JOIN gl_post gc ON gc.ref5 = 'AP-INVOICE-CANCELLATION' AND gc.ref2 = TO_CHAR(i.INVOICE_ID)
            WHERE  (l_bu   IS NULL OR i.BUSINESS_UNIT   = l_bu)
            AND    (l_supp IS NULL OR i.SUPPLIER_NUMBER = l_supp)
            AND    (l_ccy  IS NULL OR NVL(i.INVOICE_CURRENCY, 'AED') = l_ccy)
        ),
        pay AS (
            SELECT ri.INVOICE_ID,
                   SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
            LEFT JOIN gl_post gp ON gp.ref5 = 'AP-PAYMENT'      AND gp.ref2 = TO_CHAR(p.CHECK_ID)
            LEFT JOIN gl_post gv ON gv.ref5 = 'AP-PAYMENT-VOID' AND gv.ref2 = TO_CHAR(p.CHECK_ID)
            WHERE  (CASE WHEN p.SYNC_STATUS = 'SYNCED'
                         THEN TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE))
                         ELSE gp.gl_date END) <= l_asof
            AND    NOT (NVL(p.PAYMENT_STATUS, 'x') = 'Voided'
                        AND NVL(CASE WHEN p.SYNC_STATUS = 'SYNCED'
                                     THEN TRUNC(COALESCE(p.VOID_ACCOUNTING_DATE, p.VOID_DATE, p.PAYMENT_DATE))
                                     ELSE gv.gl_date END, l_asof + 1) <= l_asof)
            GROUP BY ri.INVOICE_ID
        ),
        app AS (
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(NVL(ap.APPLIED_AMOUNT, 0)) AS applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                   ON ap.INVOICE_ID IS NULL AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            LEFT JOIN RR_AP_INVOICES_ALL tgt
                   ON tgt.INVOICE_ID = COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
            LEFT JOIN gl_post ga ON ga.ref5 = 'AP-PREPAYMENT-APPLICATION' AND ga.ref2 = TO_CHAR(ap.APPLICATION_ID)
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            AND    (CASE WHEN NVL(ap.SYNC_STATUS, 'NEW') = 'SYNCED' OR tgt.SYNC_STATUS = 'SYNCED'
                         THEN TRUNC(COALESCE(ap.APPLICATION_ACCOUNTING_DATE, tgt.ACCOUNTING_DATE, tgt.INVOICE_DATE))
                         ELSE ga.gl_date END) <= l_asof
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        )
        SELECT inv.*, NVL(pay.paid, 0) AS paid, NVL(app.applied, 0) AS applied,
               inv.amt - NVL(pay.paid, 0) - NVL(app.applied, 0) AS open_entered
        FROM   inv
        LEFT JOIN pay ON pay.INVOICE_ID = inv.INVOICE_ID
        LEFT JOIN app ON app.INVOICE_ID = inv.INVOICE_ID
        WHERE  inv.acct_date <= l_asof
        AND    (inv.cancel_date IS NULL OR inv.cancel_date > l_asof)
        ORDER  BY inv.acct, inv.SUPPLIER, inv.INVOICE_DATE, inv.INVOICE_NUMBER
    ) LOOP
        a_key := NVL(r.acct, '(no liability account)');
        -- account list for the GL comparison: every account in scope, even with 0 open
        IF NOT a_total.EXISTS(a_key) AND acct_ok(r.acct) THEN
            a_total(a_key) := 0; a_invcnt(a_key) := 0; a_suppcnt(a_key) := 0;
        END IF;
        IF ROUND(r.open_entered, 2) != 0 AND acct_ok(r.acct) THEN
            a_total(a_key)  := a_total(a_key)  + ROUND(r.open_entered * r.rate, 2);
            a_invcnt(a_key) := a_invcnt(a_key) + 1;
            IF NOT s_seen.EXISTS(a_key || '|' || r.SUPPLIER_NUMBER) THEN
                s_seen(a_key || '|' || r.SUPPLIER_NUMBER) := 1;
                a_suppcnt(a_key) := a_suppcnt(a_key) + 1;
            END IF;
            IF NOT l_first THEN lob_add(l_inv, ','); END IF;
            l_first := FALSE;
            lob_add(l_inv,
                '{"account":'          || js(a_key)
             || ',"supplier_number":'  || js(r.SUPPLIER_NUMBER)
             || ',"supplier_name":'    || js(r.SUPPLIER)
             || ',"invoice_id":'       || jn(r.INVOICE_ID)
             || ',"invoice_number":'   || js(r.INVOICE_NUMBER)
             || ',"invoice_type":'     || js(r.INVOICE_TYPE)
             || ',"invoice_date":'     || jd(r.INVOICE_DATE)
             || ',"accounting_date":'  || jd(r.acct_date)
             || ',"currency":'         || js(r.ccy)
             || ',"rate":'             || jr(r.rate)
             || ',"invoice_amount":'   || jn(r.amt)
             || ',"paid_amount":'      || jn(r.paid)
             || ',"prepaid_amount":'   || jn(r.applied)
             || ',"open_entered":'     || jn(r.open_entered)
             || ',"open_functional":'  || jn(r.open_entered * r.rate)
             || ',"synced":'           || CASE WHEN r.synced = 'Y' THEN 'true' ELSE 'false' END
             || '}');
        END IF;
    END LOOP;
    lob_add(l_inv, ']');

    -- the account filter can name an account that no invoice uses: still compare it
    IF l_acct IS NOT NULL AND l_full_acct AND NOT a_total.EXISTS(l_acct) THEN
        a_total(l_acct) := 0; a_invcnt(l_acct) := 0; a_suppcnt(l_acct) := 0;
    END IF;

    -- ── 2. GL balance per liability account ────────────────────────────────
    lob_add(l_acc, '[');
    l_first := TRUE;
    a_key := a_total.FIRST;
    WHILE a_key IS NOT NULL LOOP
        SELECT NVL(SUM(NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0)), 0)
        INTO   l_gl
        FROM   RR_GL_JE_LINES_ALL l
        JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
        WHERE  l.ACCOUNT_COMBINATION = a_key
        AND    TRUNC(h.DEFAULT_EFFECTIVE_DATE) <= l_asof;

        l_tb_tot := l_tb_tot + a_total(a_key);
        l_gl_tot := l_gl_tot + l_gl;
        IF NOT l_first THEN lob_add(l_acc, ','); END IF;
        l_first := FALSE;
        lob_add(l_acc,
            '{"account":'         || js(a_key)
         || ',"tb_total":'        || jn(a_total(a_key))
         || ',"gl_balance":'      || jn(l_gl)
         || ',"difference":'      || jn(a_total(a_key) - l_gl)
         || ',"invoice_count":'   || jn(a_invcnt(a_key))
         || ',"supplier_count":'  || jn(a_suppcnt(a_key))
         || '}');
        a_key := a_total.NEXT(a_key);
    END LOOP;
    lob_add(l_acc, ']');

    -- ── 3. unaccounted items (local, dated <= D, no posted GL journal yet) ─
    lob_add(l_una, '[');
    l_first := TRUE;
    FOR u IN (
        WITH gl_post AS (
            SELECT l.REFERENCE5 AS ref5, l.REFERENCE2 AS ref2,
                   MIN(TRUNC(h.DEFAULT_EFFECTIVE_DATE)) AS gl_date
            FROM   RR_GL_JE_LINES_ALL l
            JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
            WHERE  l.REFERENCE5 IN ('AP-INVOICE-CREATION','AP-PAYMENT','AP-PREPAYMENT-APPLICATION')
            GROUP BY l.REFERENCE5, l.REFERENCE2
        )
        -- invoices not accounted: would ADD to the liability once posted
        SELECT 'INVOICE' AS typ, i.INVOICE_ID AS id, i.INVOICE_NUMBER AS num,
               i.SUPPLIER_NUMBER AS supp_no, i.SUPPLIER AS supp_name,
               TRUNC(NVL(i.ACCOUNTING_DATE, i.INVOICE_DATE)) AS doc_date,
               NVL(i.INVOICE_CURRENCY, 'AED') AS ccy,
               NVL(i.INVOICE_AMOUNT, 0)
                 * CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                        ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END AS amt_fn,
               1 AS sgn, i.LIABILITY_DISTRIBUTION AS acct
        FROM   RR_AP_INVOICES_ALL i
        LEFT JOIN gl_post g ON g.ref5 = 'AP-INVOICE-CREATION' AND g.ref2 = TO_CHAR(i.INVOICE_ID)
        WHERE  NVL(i.SYNC_STATUS, 'NEW') != 'SYNCED'
        AND    NVL(i.CANCELED_FLAG, 'N') != 'Y'
        AND    TRUNC(NVL(i.ACCOUNTING_DATE, i.INVOICE_DATE)) <= l_asof
        AND    (g.gl_date IS NULL OR g.gl_date > l_asof)
        AND    (l_bu   IS NULL OR i.BUSINESS_UNIT   = l_bu)
        AND    (l_supp IS NULL OR i.SUPPLIER_NUMBER = l_supp)
        AND    (l_ccy  IS NULL OR NVL(i.INVOICE_CURRENCY, 'AED') = l_ccy)
        UNION ALL
        -- payments not accounted: would REDUCE the liability once posted
        SELECT 'PAYMENT', p.CHECK_ID, p.PAYMENT_NUMBER,
               p.SUPPLIER_NUMBER, p.PAYEE,
               TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE)),
               NVL(p.PAYMENT_CURRENCY, 'AED'),
               NVL(p.PAYMENT_AMOUNT, 0)
                 * CASE WHEN NVL(p.PAYMENT_CURRENCY, 'AED') = 'AED' THEN 1
                        ELSE NVL(NULLIF(p.CONVERSION_RATE, 0), 1) END,
               -1, NULL
        FROM   RR_AP_PAYMENTS_ALL p
        LEFT JOIN gl_post g ON g.ref5 = 'AP-PAYMENT' AND g.ref2 = TO_CHAR(p.CHECK_ID)
        WHERE  NVL(p.SYNC_STATUS, 'NEW') != 'SYNCED'
        AND    NVL(p.PAYMENT_STATUS, 'x') != 'Voided'
        AND    TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE)) <= l_asof
        AND    (g.gl_date IS NULL OR g.gl_date > l_asof)
        AND    (l_bu   IS NULL OR p.BUSINESS_UNIT   = l_bu)
        AND    (l_supp IS NULL OR p.SUPPLIER_NUMBER = l_supp)
        AND    (l_ccy  IS NULL OR NVL(p.PAYMENT_CURRENCY, 'AED') = l_ccy)
        UNION ALL
        -- prepayment applications not accounted: would REDUCE the liability
        SELECT 'PREPAYMENT_APPLICATION', ap.APPLICATION_ID,
               ap.PREPAYMENT_NUMBER || ' -> ' || ap.INVOICE_NUMBER,
               tgt.SUPPLIER_NUMBER, tgt.SUPPLIER,
               TRUNC(NVL(ap.APPLICATION_ACCOUNTING_DATE, CAST(ap.CREATION_DATE AS DATE))),
               NVL(ap.CURRENCY, 'AED'),
               NVL(ap.APPLIED_AMOUNT, 0)
                 * CASE WHEN NVL(tgt.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                        ELSE NVL(NULLIF(tgt.CONVERSION_RATE, 0), 1) END,
               -1, tgt.LIABILITY_DISTRIBUTION
        FROM   RR_AP_APPLIED_PREPAYMENTS ap
        LEFT JOIN RR_AP_INVOICES_ALL tgt
               ON tgt.INVOICE_ID = ap.INVOICE_ID
               OR (ap.INVOICE_ID IS NULL AND tgt.INVOICE_NUMBER = ap.INVOICE_NUMBER)
        LEFT JOIN gl_post g ON g.ref5 = 'AP-PREPAYMENT-APPLICATION' AND g.ref2 = TO_CHAR(ap.APPLICATION_ID)
        WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
        AND    NVL(ap.SYNC_STATUS, 'NEW') != 'SYNCED'
        AND    NVL(tgt.SYNC_STATUS, 'NEW') != 'SYNCED'
        AND    TRUNC(NVL(ap.APPLICATION_ACCOUNTING_DATE, CAST(ap.CREATION_DATE AS DATE))) <= l_asof
        AND    (g.gl_date IS NULL OR g.gl_date > l_asof)
        AND    (l_bu   IS NULL OR ap.BUSINESS_UNIT   = l_bu)
        AND    (l_supp IS NULL OR tgt.SUPPLIER_NUMBER = l_supp)
        AND    (l_ccy  IS NULL OR NVL(ap.CURRENCY, 'AED') = l_ccy)
        ORDER BY 6, 1, 3
    ) LOOP
        IF u.acct IS NULL OR acct_ok(u.acct) THEN
            l_una_tot := l_una_tot + ROUND(u.sgn * u.amt_fn, 2);
            IF NOT l_first THEN lob_add(l_una, ','); END IF;
            l_first := FALSE;
            lob_add(l_una,
                '{"type":'              || js(u.typ)
             || ',"id":'                || jn(u.id)
             || ',"number":'            || js(u.num)
             || ',"supplier_number":'   || js(u.supp_no)
             || ',"supplier_name":'     || js(u.supp_name)
             || ',"doc_date":'          || jd(u.doc_date)
             || ',"currency":'          || js(u.ccy)
             || ',"amount_functional":' || jn(u.amt_fn)
             || ',"effect":'            || jn(u.sgn * u.amt_fn)
             || '}');
        END IF;
    END LOOP;
    lob_add(l_una, ']');

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":"true","asOfDate":"' || TO_CHAR(l_asof, 'YYYY-MM-DD') || '"'
         || ',"businessUnit":' || js(l_bu)
         || ',"totals":{"tb_total":' || jn(l_tb_tot)
         || ',"gl_balance":'         || jn(l_gl_tot)
         || ',"difference":'         || jn(l_tb_tot - l_gl_tot)
         || ',"unaccounted_effect":' || jn(l_una_tot) || '}'
         || ',"accounts":');
    lob_out(l_acc);
    HTP.PRN(',"invoices":');
    lob_out(l_inv);
    HTP.PRN(',"unaccounted":');
    lob_out(l_una);
    HTP.PRN('}');

EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":"false","error":"' || REPLACE(REPLACE(SQLERRM, '"', '\"'), CHR(10), ' ') || '"}');
END;
/

-- Compile check — must return NO rows. If it returns rows, fix those lines first.
SELECT line, position, text FROM user_errors WHERE name = 'RR_AP_PAYABLES_TB_JSON' ORDER BY sequence;

-- Optional: run it directly in SQL Developer (no ORDS) and see the JSON in Dbms Output:
--   SET SERVEROUTPUT ON SIZE UNLIMITED
--   DECLARE
--     n OWA.VC_ARR; v OWA.VC_ARR;
--   BEGIN
--     n(1) := 'REQUEST_PROTOCOL'; v(1) := 'HTTP';
--     OWA.INIT_CGI_ENV(1, n, v);
--     RR_AP_PAYABLES_TB_JSON('2026-09-30', 'BUIMERC CORP_DIFC_INVST');
--     OWA_UTIL.SHOWPAGE;
--   END;
--   /

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/reports/trial-balance',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Open accounted AP liability as of date by account/supplier/invoice + GL balance + unaccounted items',
        p_source         => q'[
BEGIN
    RR_AP_PAYABLES_TB_JSON(
        p_as_of_date        => :P_AS_OF_DATE,
        p_business_unit     => :P_BUSINESS_UNIT,
        p_liability_account => :P_LIABILITY_ACCOUNT,
        p_supplier_number   => :P_SUPPLIER_NUMBER,
        p_currency          => :P_CURRENCY
    );
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
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template = 'ap/reports/trial-balance';

-- Try:  GET .../reerp/ap/reports/trial-balance?P_AS_OF_DATE=2026-09-30&P_BUSINESS_UNIT=BUIMERC CORP_DIFC_INVST
