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
-- GL comparison uses the SAME basis as the GL Trial Balance (RR_V_STANDARD_TB):
--   * a line counts by its journal PERIOD (RR_GL_JE_HEADERS.PERIOD_NAME), a GL,
--     non-adjusting period of the fiscal calendar, on a journal with a ledger;
--   * as of D: every period before D's month, plus D's own period — all of it
--     when D is the last day of the month (= the GL TB for that period), else
--     its lines dated <= D;
--   * PTD: the lines of that period (= the GL TB period activity).
--   * the business unit's ledger only (RR_GL_BUSINESS_UNITS.PRIMARY_LEDGER_ID →
--     RR_LEDGERS.LEDGER_NAME, or P_LEDGER), as the GL TB filters ledger_name;
--     glByLedger shows the balance per ledger so another ledger is visible.
-- Lines without a valid period/ledger, or whose period differs from their date,
-- are reported as glByDate (the old date-based balance) so the gap is visible.
-- GL balance (accounted CR − DR) of every
-- liability account used by invoices in scope, PLUS every other GL combination of the
-- same company + natural account (or matching the account filter) — the GL Trial
-- Balance adds up all combinations of a natural account, so this report does too.
-- Same journals and date as the GL Trial Balance report (no journal-status filter).
--
-- The logic lives in procedure RR_AP_PAYABLES_TB_JSON so compile errors show up
-- when this script runs (see the user_errors check) instead of as ORDS-25001.
--
-- Parameters:
--   P_AS_OF_DATE        YYYY-MM-DD (required unless P_PERIOD is given)
--   P_BUSINESS_UNIT     optional, exact BU name
--   P_LIABILITY_ACCOUNT optional, full combination (01-00-00-2313101-…) or natural
--                       account only (2313101 = 4th segment)
--   P_SUPPLIER_NUMBER   optional
--   P_CURRENCY          optional invoice currency (AED, USD, …)
--   P_LEDGER            optional GL ledger name (default: the business unit's primary
--                       ledger; all ledgers when none can be resolved)
--   P_PERIOD            optional YYYY-MM → PTD mode: closing = last day of the month,
--                       opening = day before it starts; per account/supplier/invoice:
--                       opening + invoices − payments − prepayments = closing, and the
--                       GL opening / period movement / closing for the same account.
--                       When given, P_AS_OF_DATE is ignored. Invoice rows, pending items
--                       and glLines are limited to the period; opening/closing
--                       totals still cover everything open at those dates.
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
--   totals:      { tb_total, gl_balance, difference, unaccounted_effect,
--                  outstanding = total outstanding regardless of accounting status
--                  (dashboard formula on the liability account filter, AED) },
--   supplierOutstanding: per supplier, the Payables dashboard "Total Outstanding"
--                (suppliers/balance/outstanding formula: all non-cancelled invoices,
--                every payment/prepayment, invoice currency, today) bridged to the
--                Payables Balance of this report:
--                  dashboard − not_accounted − other_accounts − timing + fx = payables_balance
--                  not_accounted : invoices with no accounting (or accounted after D)
--                  other_accounts: accounted invoices on another liability account
--                  timing        : payments / prepayments / voids / cancellations not
--                                  accounted by D, overpaid invoices the dashboard floors at 0
--                  fx            : functional (AED at the invoice rate) − invoice currency
--   glBySupplier: GL balance of the liability account(s) (same basis as gl_balance)
--                per supplier — a line is linked through its REFERENCE5/REFERENCE2
--                tag (invoice / payment / prepayment application), else through
--                REFERENCE1 = an invoice or payment number; glUnlinked lists the
--                rest (manual journals, adjustments). Σ(outstanding − GL) per
--                supplier − Σ unlinked = outstanding − GL balance.
--   supplierInvoices: the invoices behind each supplier row (dashboard remaining vs
--                Payables open) with the bucket they fall in,
--   As-of mode only — monthly Account Analysis (roll-forward up to D):
--   glMonthly:   [{ account, month 'YYYY-MM', dr, cr, lines }]          GL lines per month
--   apMonthly:   [{ account, month, invoices, cancellations, payments, prepayments }]
--                Payables movement per month, functional. Each invoice's events
--                (accounted, paid, void, prepaid, cancelled) land in the month they
--                took effect — never before the invoice itself was accounted — and a
--                cancellation reverses what was still open, so the months add up to
--                the trial balance (up to cent rounding). }
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
    p_currency          IN VARCHAR2 DEFAULT NULL,
    p_period            IN VARCHAR2 DEFAULT NULL,  -- 'YYYY-MM': PTD mode (opening/activity/closing)
    p_ledger            IN VARCHAR2 DEFAULT NULL   -- GL ledger name; default = the BU's primary ledger
) AS
    l_asof      DATE;                -- closing date (as-of date, or period end)
    l_open      DATE;                -- opening cutoff (day before period start); far past when no period
    l_start     DATE;                -- period start (NULL = as-of mode)
    l_bu        VARCHAR2(240) := TRIM(p_business_unit);
    l_acct      VARCHAR2(240) := TRIM(p_liability_account);
    l_supp      VARCHAR2(100) := TRIM(p_supplier_number);
    l_ccy       VARCHAR2(15)  := UPPER(TRIM(p_currency));
    l_full_acct BOOLEAN;

    l_inv      CLOB;
    l_una      CLOB;
    l_acc      CLOB;
    l_gll      CLOB;               -- PTD mode: GL lines of the period on the liability accounts
    l_gl_cnt   PLS_INTEGER := 0;
    l_gl_cap   CONSTANT PLS_INTEGER := 20000;
    l_docs     CLOB;               -- PTD mode: payment / prepayment documents with period activity
    l_mgl      CLOB;               -- as-of mode: GL debits/credits per account and month
    l_map      CLOB;               -- as-of mode: Payables movement per account and month
    l_mg_first BOOLEAN := TRUE;
    l_doc_first BOOLEAN := TRUE;
    l_active   BOOLEAN;
    l_first    BOOLEAN;
    l_chunk    CONSTANT INTEGER := 8000;    -- chars; keeps each HTP chunk < 32767 bytes even for multibyte text

    TYPE t_num  IS TABLE OF NUMBER INDEX BY VARCHAR2(240);
    TYPE t_set  IS TABLE OF NUMBER INDEX BY VARCHAR2(400);
    a_total    t_num;           -- account -> TB closing (functional)
    a_open     t_num;           -- account -> TB opening (functional)
    a_inv      t_num;           -- account -> invoices in period
    a_pay      t_num;           -- account -> payments in period
    a_app      t_num;           -- account -> prepayments applied in period
    a_invcnt   t_num;           -- account -> open invoice count
    a_suppcnt  t_num;           -- account -> distinct supplier count
    s_seen     t_set;           -- account|supplier seen
    s_comp     t_set;           -- companies (segment 1) of the invoice liability accounts
    s_pair     t_set;           -- company|natural account of the invoice liability accounts
    l_seg1     VARCHAR2(60);
    l_seg4     VARCHAR2(60);
    l_full_yn  VARCHAR2(1);     -- l_full_acct for use inside SQL (no BOOLEAN in SQL)
    l_gl_bydate NUMBER;          -- GL by accounting date only (pre-TB-basis figure, diagnostic)
    l_gl_bdtot  NUMBER := 0;
    l_ledger   VARCHAR2(240) := TRIM(p_ledger);
    l_by_ledger t_num;          -- ledger -> GL balance (TB basis, all ledgers) of the accounts
    l_lg_key   VARCHAR2(240);
    -- 4. supplier outstanding bridge (dashboard formula → Payables Balance)
    TYPE t_str IS TABLE OF VARCHAR2(400) INDEX BY VARCHAR2(240);
    so_name    t_str;
    so_cnt     t_num;
    so_dash    t_num;
    so_na      t_num;           -- not accounted
    so_oa      t_num;           -- other liability accounts
    so_tm      t_num;           -- timing / floors
    so_fx      t_num;           -- functional − entered
    so_tb      t_num;           -- payables balance (functional)
    so_out     t_num;           -- total outstanding: dashboard formula, liability account filter, AED
    l_out_tot  NUMBER := 0;
    a_out      t_num;           -- liability account -> total outstanding (AED)
    -- 5. GL per supplier
    gs_net     t_num;           -- supplier -> GL balance (Cr − Dr)
    gs_cnt     t_num;
    gs_name    t_str;
    l_unl      CLOB;
    l_unl_cnt  PLS_INTEGER := 0;
    l_unl_cap  CONSTANT PLS_INTEGER := 5000;
    l_unl_tot  NUMBER := 0;
    l_out_fn   NUMBER;
    l_sk       VARCHAR2(240);
    l_bucket   VARCHAR2(20);
    l_open_e   NUMBER;
    l_open_f   NUMBER;
    l_sup      CLOB;
    l_supinv   CLOB;
    l_si_cnt   PLS_INTEGER := 0;
    l_si_cap   CONSTANT PLS_INTEGER := 30000;
    a_key      VARCHAR2(240);
    l_gl       NUMBER;
    l_gl_open  NUMBER;
    l_tb_tot   NUMBER := 0;
    l_tb_open  NUMBER := 0;
    l_gl_otot  NUMBER := 0;
    l_inv_tot  NUMBER := 0;
    l_pay_tot  NUMBER := 0;
    l_app_tot  NUMBER := 0;
    l_show     BOOLEAN;
    o_fn NUMBER; c_fn NUMBER; i_fn NUMBER; p_fn NUMBER; a_fn NUMBER;
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
    IF TRIM(p_period) IS NOT NULL THEN
        -- PTD mode: period = calendar month; closing = last day, opening = day before
        BEGIN
            l_start := TO_DATE(TRIM(p_period) || '-01', 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_start := NULL;
        END;
        IF l_start IS NULL THEN
            OWA_UTIL.MIME_HEADER('application/json', TRUE);
            HTP.PRN('{"success":"false","error":"P_PERIOD must be YYYY-MM"}');
            RETURN;
        END IF;
        l_asof := LAST_DAY(l_start);
        l_open := l_start - 1;
    ELSE
        BEGIN
            l_asof := TO_DATE(TRIM(p_as_of_date), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_asof := NULL;
        END;
        IF l_asof IS NULL THEN
            OWA_UTIL.MIME_HEADER('application/json', TRUE);
            HTP.PRN('{"success":"false","error":"P_AS_OF_DATE (YYYY-MM-DD) or P_PERIOD (YYYY-MM) is required"}');
            RETURN;
        END IF;
        l_open := DATE '1000-01-01';   -- nothing is open that early: opening = 0
    END IF;
    l_full_acct := INSTR(NVL(l_acct, 'x'), '-') > 0;
    l_full_yn   := CASE WHEN INSTR(NVL(l_acct, 'x'), '-') > 0 THEN 'Y' ELSE 'N' END;
    -- GL ledger: the BU's primary ledger (as the GL Trial Balance is run per ledger)
    IF l_ledger IS NULL AND l_bu IS NOT NULL THEN
        BEGIN
            SELECT l.LEDGER_NAME INTO l_ledger
            FROM   RR_GL_BUSINESS_UNITS bu
            JOIN   RR_LEDGERS l ON l.LEDGER_ID = bu.PRIMARY_LEDGER_ID
            WHERE  bu.BUSINESS_UNIT_NAME = l_bu
            AND    ROWNUM = 1;
        EXCEPTION WHEN OTHERS THEN l_ledger := NULL;   -- unknown: all ledgers
        END;
    END IF;
    -- use the ledger name exactly as the journals carry it (case/spacing may differ);
    -- a name no journal uses would zero the GL side, so then compare all ledgers
    IF l_ledger IS NOT NULL THEN
        BEGIN
            SELECT LEDGER_NAME INTO l_ledger
            FROM (SELECT h.LEDGER_NAME FROM RR_GL_JE_HEADERS h
                  WHERE  UPPER(TRIM(h.LEDGER_NAME)) = UPPER(TRIM(l_ledger))
                  ORDER BY CASE WHEN h.LEDGER_NAME = l_ledger THEN 0 ELSE 1 END)
            WHERE ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN l_ledger := NULL;
        END;
    END IF;

    DBMS_LOB.CREATETEMPORARY(l_inv, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_una, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_acc, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_gll, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_docs, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_mgl, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_map, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_sup, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_supinv, TRUE);
    DBMS_LOB.CREATETEMPORARY(l_unl, TRUE);

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
        pay_rows AS (
            -- one row per invoice-payment: amount, when it took effect, when it was voided
            SELECT ri.INVOICE_ID,
                   NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0) AS amt,
                   CASE WHEN p.SYNC_STATUS = 'SYNCED'
                        THEN TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE))
                        ELSE gp.gl_date END AS eff_date,
                   CASE WHEN NVL(p.PAYMENT_STATUS, 'x') = 'Voided' THEN
                        CASE WHEN p.SYNC_STATUS = 'SYNCED'
                             THEN TRUNC(COALESCE(p.VOID_ACCOUNTING_DATE, p.VOID_DATE, p.PAYMENT_DATE))
                             ELSE gv.gl_date END
                   END AS void_date
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
            LEFT JOIN gl_post gp ON gp.ref5 = 'AP-PAYMENT'      AND gp.ref2 = TO_CHAR(p.CHECK_ID)
            LEFT JOIN gl_post gv ON gv.ref5 = 'AP-PAYMENT-VOID' AND gv.ref2 = TO_CHAR(p.CHECK_ID)
        ),
        pay AS (
            SELECT INVOICE_ID,
                   SUM(CASE WHEN eff_date <= l_asof AND (void_date IS NULL OR void_date > l_asof) THEN amt ELSE 0 END) AS paid,
                   SUM(CASE WHEN eff_date <= l_open AND (void_date IS NULL OR void_date > l_open) THEN amt ELSE 0 END) AS paid_open
            FROM   pay_rows
            WHERE  eff_date <= l_asof
            GROUP BY INVOICE_ID
        ),
        app AS (
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(NVL(ap.APPLIED_AMOUNT, 0)) AS applied,
                   SUM(CASE WHEN (CASE WHEN NVL(ap.SYNC_STATUS, 'NEW') = 'SYNCED' OR tgt.SYNC_STATUS = 'SYNCED'
                                       THEN TRUNC(COALESCE(ap.APPLICATION_ACCOUNTING_DATE, tgt.ACCOUNTING_DATE, tgt.INVOICE_DATE))
                                       ELSE ga.gl_date END) <= l_open
                            THEN NVL(ap.APPLIED_AMOUNT, 0) ELSE 0 END) AS applied_open
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
        , flags AS (
            SELECT inv.*,
                   CASE WHEN inv.acct_date <= l_asof AND (inv.cancel_date IS NULL OR inv.cancel_date > l_asof) THEN 1 ELSE 0 END AS in_close,
                   CASE WHEN inv.acct_date <= l_open AND (inv.cancel_date IS NULL OR inv.cancel_date > l_open) THEN 1 ELSE 0 END AS in_open,
                   NVL(pay.paid, 0) AS paid,         NVL(pay.paid_open, 0)   AS paid_open,
                   NVL(app.applied, 0) AS applied,   NVL(app.applied_open, 0) AS applied_open
            FROM   inv
            LEFT JOIN pay ON pay.INVOICE_ID = inv.INVOICE_ID
            LEFT JOIN app ON app.INVOICE_ID = inv.INVOICE_ID
            WHERE  inv.acct_date <= l_asof
        )
        SELECT f.*,
               f.in_close * (f.amt - f.paid - f.applied)                     AS open_entered,
               f.in_open  * (f.amt - f.paid_open - f.applied_open)           AS opening_entered,
               f.in_close * f.amt     - f.in_open * f.amt                    AS inv_ptd,
               f.in_close * f.paid    - f.in_open * f.paid_open              AS pay_ptd,
               f.in_close * f.applied - f.in_open * f.applied_open           AS app_ptd
        FROM   flags f
        WHERE  f.in_close = 1 OR f.in_open = 1
        ORDER  BY f.acct, f.SUPPLIER, f.INVOICE_DATE, f.INVOICE_NUMBER
    ) LOOP
        a_key := NVL(r.acct, '(no liability account)');
        -- account list for the GL comparison: every account in scope, even with 0 open
        IF NOT a_total.EXISTS(a_key) AND acct_ok(r.acct) THEN
            a_total(a_key) := 0; a_open(a_key) := 0; a_inv(a_key) := 0; a_pay(a_key) := 0; a_app(a_key) := 0;
            a_invcnt(a_key) := 0; a_suppcnt(a_key) := 0;
        END IF;
        c_fn := ROUND(r.open_entered    * r.rate, 2);
        o_fn := ROUND(r.opening_entered * r.rate, 2);
        i_fn := ROUND(r.inv_ptd * r.rate, 2);
        p_fn := ROUND(r.pay_ptd * r.rate, 2);
        a_fn := ROUND(r.app_ptd * r.rate, 2);
        -- as-of mode: open invoices only; PTD mode: anything open at either end or moved in the period
        l_show := ROUND(r.open_entered, 2) != 0
               OR (l_start IS NOT NULL AND (o_fn != 0 OR i_fn != 0 OR p_fn != 0 OR a_fn != 0));
        -- PTD mode lists only invoices with activity IN the period (invoice accounted,
        -- paid, prepaid, cancelled or voided in it); opening/closing totals still use all
        l_active := l_start IS NULL OR i_fn != 0 OR p_fn != 0 OR a_fn != 0;
        IF l_show AND acct_ok(r.acct) THEN
            a_total(a_key) := a_total(a_key) + c_fn;
            a_open(a_key)  := a_open(a_key)  + o_fn;
            a_inv(a_key)   := a_inv(a_key)   + i_fn;
            a_pay(a_key)   := a_pay(a_key)   + p_fn;
            a_app(a_key)   := a_app(a_key)   + a_fn;
        END IF;
        IF l_show AND l_active AND acct_ok(r.acct) THEN
            a_invcnt(a_key) := a_invcnt(a_key) + 1;
            IF NOT s_seen.EXISTS(a_key || '|' || r.SUPPLIER_NUMBER) THEN
                s_seen(a_key || '|' || r.SUPPLIER_NUMBER) := 1;
                a_suppcnt(a_key) := a_suppcnt(a_key) + 1;
            END IF;
            IF NOT l_first THEN lob_add(l_inv, ','); END IF;
            l_first := FALSE;
            lob_add(l_inv,
                '{"account":'             || js(a_key)
             || ',"supplier_number":'     || js(r.SUPPLIER_NUMBER)
             || ',"supplier_name":'       || js(r.SUPPLIER)
             || ',"invoice_id":'          || jn(r.INVOICE_ID)
             || ',"invoice_number":'      || js(r.INVOICE_NUMBER)
             || ',"invoice_type":'        || js(r.INVOICE_TYPE)
             || ',"invoice_date":'        || jd(r.INVOICE_DATE)
             || ',"accounting_date":'     || jd(r.acct_date)
             || ',"currency":'            || js(r.ccy)
             || ',"rate":'                || jr(r.rate)
             || ',"invoice_amount":'      || jn(r.amt)
             || ',"paid_amount":'         || jn(r.in_close * r.paid)
             || ',"prepaid_amount":'      || jn(r.in_close * r.applied)
             || ',"open_entered":'        || jn(r.open_entered)
             || ',"open_functional":'     || jn(c_fn)
             || ',"opening_functional":'  || jn(o_fn)
             || ',"invoices_ptd":'        || jn(i_fn)
             || ',"payments_ptd":'        || jn(p_fn)
             || ',"prepayments_ptd":'     || jn(a_fn)
             || ',"synced":'              || CASE WHEN r.synced = 'Y' THEN 'true' ELSE 'false' END
             || '}');
        END IF;
    END LOOP;
    lob_add(l_inv, ']');

    -- ── 1b. as-of mode: Payables movement per account and month ────────────
    -- Same effective dates as section 1. An event before its invoice was
    -- accounted counts from the invoice's month (the trial balance only sees
    -- it from then); events on/after the cancellation are dropped and the
    -- cancellation reverses everything still open, as the trial balance does.
    IF l_start IS NULL THEN
        l_first := TRUE;
        FOR m IN (
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
                SELECT i.INVOICE_ID,
                       NVL(i.LIABILITY_DISTRIBUTION, '(no liability account)') AS acct,
                       CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                            ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END AS rate,
                       NVL(i.INVOICE_AMOUNT, 0) AS amt,
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
            pr AS (
                SELECT ri.INVOICE_ID,
                       NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0) AS amt,
                       CASE WHEN p.SYNC_STATUS = 'SYNCED'
                            THEN TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE))
                            ELSE gp.gl_date END AS eff_date,
                       CASE WHEN NVL(p.PAYMENT_STATUS, 'x') = 'Voided' THEN
                            CASE WHEN p.SYNC_STATUS = 'SYNCED'
                                 THEN TRUNC(COALESCE(p.VOID_ACCOUNTING_DATE, p.VOID_DATE, p.PAYMENT_DATE))
                                 ELSE gv.gl_date END
                       END AS void_date
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
                LEFT JOIN gl_post gp ON gp.ref5 = 'AP-PAYMENT'      AND gp.ref2 = TO_CHAR(p.CHECK_ID)
                LEFT JOIN gl_post gv ON gv.ref5 = 'AP-PAYMENT-VOID' AND gv.ref2 = TO_CHAR(p.CHECK_ID)
            ),
            apl AS (
                SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                       NVL(ap.APPLIED_AMOUNT, 0) AS amt,
                       CASE WHEN NVL(ap.SYNC_STATUS, 'NEW') = 'SYNCED' OR tgt.SYNC_STATUS = 'SYNCED'
                            THEN TRUNC(COALESCE(ap.APPLICATION_ACCOUNTING_DATE, tgt.ACCOUNTING_DATE, tgt.INVOICE_DATE))
                            ELSE ga.gl_date END AS eff_date
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL inv_r
                       ON ap.INVOICE_ID IS NULL AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                LEFT JOIN RR_AP_INVOICES_ALL tgt
                       ON tgt.INVOICE_ID = COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
                LEFT JOIN gl_post ga ON ga.ref5 = 'AP-PREPAYMENT-APPLICATION' AND ga.ref2 = TO_CHAR(ap.APPLICATION_ID)
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            ),
            ev AS (
                SELECT inv.INVOICE_ID, inv.acct, inv.rate, inv.cancel_date, 'INV' AS typ,
                       inv.acct_date AS ev_date, inv.amt AS a
                FROM   inv
                WHERE  inv.acct_date IS NOT NULL
                UNION ALL
                SELECT inv.INVOICE_ID, inv.acct, inv.rate, inv.cancel_date, 'PAY',
                       GREATEST(pr.eff_date, inv.acct_date), -pr.amt
                FROM   pr JOIN inv ON inv.INVOICE_ID = pr.INVOICE_ID
                WHERE  inv.acct_date IS NOT NULL AND pr.eff_date IS NOT NULL
                UNION ALL
                SELECT inv.INVOICE_ID, inv.acct, inv.rate, inv.cancel_date, 'PAY',
                       GREATEST(pr.void_date, pr.eff_date, inv.acct_date), pr.amt
                FROM   pr JOIN inv ON inv.INVOICE_ID = pr.INVOICE_ID
                WHERE  inv.acct_date IS NOT NULL AND pr.eff_date IS NOT NULL AND pr.void_date IS NOT NULL
                UNION ALL
                SELECT inv.INVOICE_ID, inv.acct, inv.rate, inv.cancel_date, 'APP',
                       GREATEST(apl.eff_date, inv.acct_date), -apl.amt
                FROM   apl JOIN inv ON inv.INVOICE_ID = apl.INVOICE_ID
                WHERE  inv.acct_date IS NOT NULL AND apl.eff_date IS NOT NULL
            ),
            kept AS (
                SELECT * FROM ev
                WHERE  ev_date <= l_asof
                AND    (cancel_date IS NULL OR ev_date < cancel_date)
            ),
            all_ev AS (
                SELECT acct, typ, ev_date, a * rate AS fa FROM kept
                UNION ALL
                SELECT acct, 'CAN', cancel_date, -SUM(a) * rate
                FROM   kept
                WHERE  cancel_date <= l_asof
                GROUP BY INVOICE_ID, acct, rate, cancel_date
            )
            SELECT acct, TO_CHAR(TRUNC(ev_date, 'MM'), 'YYYY-MM') AS mon,
                   SUM(CASE WHEN typ = 'INV' THEN fa ELSE 0 END) AS inv_fa,
                   SUM(CASE WHEN typ = 'CAN' THEN fa ELSE 0 END) AS can_fa,
                   SUM(CASE WHEN typ = 'PAY' THEN fa ELSE 0 END) AS pay_fa,
                   SUM(CASE WHEN typ = 'APP' THEN fa ELSE 0 END) AS app_fa
            FROM   all_ev
            GROUP BY acct, TRUNC(ev_date, 'MM')
            ORDER BY acct, TRUNC(ev_date, 'MM')
        ) LOOP
            IF acct_ok(CASE WHEN m.acct = '(no liability account)' THEN NULL ELSE m.acct END)
               AND (ROUND(m.inv_fa, 2) != 0 OR ROUND(m.can_fa, 2) != 0
                    OR ROUND(m.pay_fa, 2) != 0 OR ROUND(m.app_fa, 2) != 0) THEN
                IF NOT l_first THEN lob_add(l_map, ','); END IF;
                l_first := FALSE;
                lob_add(l_map,
                    '{"account":'        || js(m.acct)
                 || ',"month":'          || js(m.mon)
                 || ',"invoices":'       || jn(ROUND(m.inv_fa, 2))
                 || ',"cancellations":'  || jn(ROUND(m.can_fa, 2))
                 || ',"payments":'       || jn(ROUND(m.pay_fa, 2))
                 || ',"prepayments":'    || jn(ROUND(m.app_fa, 2))
                 || '}');
            END IF;
        END LOOP;
    END IF;

    -- the account filter can name an account that no invoice uses: still compare it
    IF l_acct IS NOT NULL AND l_full_acct AND NOT a_total.EXISTS(l_acct) THEN
        a_total(l_acct) := 0; a_open(l_acct) := 0; a_inv(l_acct) := 0; a_pay(l_acct) := 0; a_app(l_acct) := 0;
        a_invcnt(l_acct) := 0; a_suppcnt(l_acct) := 0;
    END IF;

    -- GL-only combinations: the GL Trial Balance adds up EVERY combination of a
    -- natural account (e.g. all 01-…-2313101-… rows), not only the ones invoices use
    -- as liability account. Payments, voids or manual journals booked to another
    -- combination of the same account would otherwise be missing from the GL side.
    -- Included: same company + natural account as an invoice liability account, or,
    -- with the account filter, every combination matching it (in those companies).
    a_key := a_total.FIRST;
    WHILE a_key IS NOT NULL LOOP
        IF a_key != '(no liability account)' THEN
            l_seg1 := REGEXP_SUBSTR(a_key, '[^-]+', 1, 1);
            l_seg4 := REGEXP_SUBSTR(a_key, '[^-]+', 1, 4);
            s_comp(NVL(l_seg1, '?')) := 1;
            s_pair(NVL(l_seg1, '?') || '|' || NVL(l_seg4, '?')) := 1;
        END IF;
        a_key := a_total.NEXT(a_key);
    END LOOP;
    FOR c IN (
        SELECT DISTINCT l.ACCOUNT_COMBINATION AS combo
        FROM   RR_GL_JE_LINES_ALL l
        WHERE  l.ACCOUNT_COMBINATION IS NOT NULL
        AND    (l_acct IS NULL
                OR (l_full_yn = 'Y' AND l.ACCOUNT_COMBINATION = l_acct)
                OR (l_full_yn = 'N' AND REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, '[^-]+', 1, 4) = l_acct))
    ) LOOP
        IF NOT a_total.EXISTS(c.combo) THEN
            l_seg1 := NVL(REGEXP_SUBSTR(c.combo, '[^-]+', 1, 1), '?');
            l_seg4 := NVL(REGEXP_SUBSTR(c.combo, '[^-]+', 1, 4), '?');
            IF (l_acct IS NOT NULL AND (s_comp.COUNT = 0 OR s_comp.EXISTS(l_seg1)))
               OR (l_acct IS NULL AND s_pair.EXISTS(l_seg1 || '|' || l_seg4)) THEN
                a_total(c.combo) := 0; a_open(c.combo) := 0; a_inv(c.combo) := 0; a_pay(c.combo) := 0; a_app(c.combo) := 0;
                a_invcnt(c.combo) := 0; a_suppcnt(c.combo) := 0;
            END IF;
        END IF;
    END LOOP;

    -- ── 2. GL balance per liability account ────────────────────────────────
    lob_add(l_acc, '[');
    l_first := TRUE;
    a_key := a_total.FIRST;
    WHILE a_key IS NOT NULL LOOP
        -- GL Trial Balance basis (see header): by journal period, valid periods only
        SELECT NVL(SUM(CASE WHEN x.pm < TRUNC(l_asof, 'MM')
                              OR (x.pm = TRUNC(l_asof, 'MM') AND (l_asof = LAST_DAY(l_asof) OR x.d <= l_asof))
                            THEN x.net END), 0),
               NVL(SUM(CASE WHEN x.pm < TRUNC(l_open, 'MM')
                              OR (x.pm = TRUNC(l_open, 'MM') AND (l_open = LAST_DAY(l_open) OR x.d <= l_open))
                            THEN x.net END), 0),
               NVL(SUM(CASE WHEN x.d <= l_asof THEN x.raw_net END), 0)
        INTO   l_gl, l_gl_open, l_gl_bydate
        FROM (
            SELECT NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0) AS raw_net,
                   CASE WHEN h.LEDGER_NAME IS NOT NULL AND fp.PERIOD_NAME IS NOT NULL
                         AND (l_ledger IS NULL OR h.LEDGER_NAME = l_ledger)
                        THEN NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0) END AS net,
                   TRUNC(h.DEFAULT_EFFECTIVE_DATE) AS d,
                   TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                           'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') AS pm
            FROM   RR_GL_JE_LINES_ALL l
            JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
            LEFT JOIN (SELECT DISTINCT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
                       WHERE TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N') fp
                   ON fp.PERIOD_NAME = h.PERIOD_NAME
            WHERE  l.ACCOUNT_COMBINATION = a_key
        ) x;
        l_gl_bdtot := l_gl_bdtot + l_gl_bydate;
        -- same basis, every ledger: shows whether another ledger posts to the account
        FOR lg IN (
            SELECT NVL(h.LEDGER_NAME, '(no ledger)') AS ledger,
                   SUM(NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0)) AS bal
            FROM   RR_GL_JE_LINES_ALL l
            JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
            WHERE  l.ACCOUNT_COMBINATION = a_key
            AND    h.PERIOD_NAME IN (SELECT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
                                     WHERE TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N')
            AND   (TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                           'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') < TRUNC(l_asof, 'MM')
               OR (TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                           'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') = TRUNC(l_asof, 'MM')
                   AND (l_asof = LAST_DAY(l_asof) OR TRUNC(h.DEFAULT_EFFECTIVE_DATE) <= l_asof)))
            GROUP BY NVL(h.LEDGER_NAME, '(no ledger)')
        ) LOOP
            IF NOT l_by_ledger.EXISTS(lg.ledger) THEN l_by_ledger(lg.ledger) := 0; END IF;
            l_by_ledger(lg.ledger) := l_by_ledger(lg.ledger) + NVL(lg.bal, 0);
        END LOOP;

        l_tb_tot  := l_tb_tot  + a_total(a_key);
        l_tb_open := l_tb_open + a_open(a_key);
        l_gl_tot  := l_gl_tot  + l_gl;
        l_gl_otot := l_gl_otot + l_gl_open;
        l_inv_tot := l_inv_tot + a_inv(a_key);
        l_pay_tot := l_pay_tot + a_pay(a_key);
        l_app_tot := l_app_tot + a_app(a_key);
        IF NOT l_first THEN lob_add(l_acc, ','); END IF;
        l_first := FALSE;
        lob_add(l_acc,
            '{"account":'         || js(a_key)
         || ',"tb_total":'        || jn(a_total(a_key))
         || ',"gl_balance":'      || jn(l_gl)
         || ',"gl_by_date":'      || jn(l_gl_bydate)
         || ',"difference":'      || jn(a_total(a_key) - l_gl)
         || ',"tb_opening":'      || jn(a_open(a_key))
         || ',"invoices_ptd":'    || jn(a_inv(a_key))
         || ',"payments_ptd":'    || jn(a_pay(a_key))
         || ',"prepayments_ptd":' || jn(a_app(a_key))
         || ',"gl_opening":'      || jn(l_gl_open)
         || ',"gl_ptd":'          || jn(l_gl - l_gl_open)
         || ',"difference_opening":' || jn(a_open(a_key) - l_gl_open)
         || ',"difference_ptd":'  || jn((a_total(a_key) - a_open(a_key)) - (l_gl - l_gl_open))
         || ',"invoice_count":'   || jn(a_invcnt(a_key))
         || ',"supplier_count":'  || jn(a_suppcnt(a_key))
         || '}');
        -- as-of: GL debits/credits per month (monthly Account Analysis)
        IF l_start IS NULL THEN
            FOR g IN (
                -- by GL period, same basis as the GL balance above
                SELECT TO_CHAR(x.pm, 'YYYY-MM') AS mon,
                       SUM(x.dr) AS dr, SUM(x.cr) AS cr, COUNT(*) AS cnt
                FROM (
                    SELECT NVL(l.ACCOUNTED_DR, 0) AS dr, NVL(l.ACCOUNTED_CR, 0) AS cr,
                           TRUNC(h.DEFAULT_EFFECTIVE_DATE) AS d,
                           TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                                   'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') AS pm
                    FROM   RR_GL_JE_LINES_ALL l
                    JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
                    WHERE  l.ACCOUNT_COMBINATION = a_key
                    AND    h.LEDGER_NAME IS NOT NULL
                    AND    (l_ledger IS NULL OR h.LEDGER_NAME = l_ledger)
                    AND    h.PERIOD_NAME IN (SELECT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
                                             WHERE TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N')
                ) x
                WHERE  x.pm < TRUNC(l_asof, 'MM')
                   OR (x.pm = TRUNC(l_asof, 'MM') AND (l_asof = LAST_DAY(l_asof) OR x.d <= l_asof))
                GROUP BY x.pm
                ORDER BY x.pm
            ) LOOP
                IF NOT l_mg_first THEN lob_add(l_mgl, ','); END IF;
                l_mg_first := FALSE;
                lob_add(l_mgl,
                    '{"account":' || js(a_key)
                 || ',"month":'   || js(g.mon)
                 || ',"dr":'      || jn(g.dr)
                 || ',"cr":'      || jn(g.cr)
                 || ',"lines":'   || jn(g.cnt)
                 || '}');
            END LOOP;
        END IF;
        -- PTD: the GL lines behind the period movement, tagged by source
        IF l_start IS NOT NULL THEN
            FOR g IN (
                -- column names as used by the live GL services (patches 58/69, view 93)
                SELECT TRUNC(h.DEFAULT_EFFECTIVE_DATE) AS gl_date,
                       h.JOURNAL_NAME             AS journal_name,
                       b.USER_JE_SOURCE_NAME      AS je_source,
                       h.USER_JE_CATEGORY_NAME    AS je_category,
                       l.JE_HEADER_ID, l.REFERENCE1, l.REFERENCE2, l.REFERENCE5, l.DESCRIPTION,
                       NVL(l.ACCOUNTED_DR, 0) AS dr, NVL(l.ACCOUNTED_CR, 0) AS cr
                FROM   RR_GL_JE_LINES_ALL l
                JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
                LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = l.BATCH_ID
                WHERE  l.ACCOUNT_COMBINATION = a_key
                -- the lines of the GL period (GL Trial Balance basis)
                AND    h.LEDGER_NAME IS NOT NULL
                AND    (l_ledger IS NULL OR h.LEDGER_NAME = l_ledger)
                AND    TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                               'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') = l_start
                AND    h.PERIOD_NAME IN (SELECT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
                                         WHERE TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N')
                ORDER  BY h.DEFAULT_EFFECTIVE_DATE, l.JE_HEADER_ID
            ) LOOP
                EXIT WHEN l_gl_cnt >= l_gl_cap;
                IF l_gl_cnt > 0 THEN lob_add(l_gll, ','); END IF;
                l_gl_cnt := l_gl_cnt + 1;
                lob_add(l_gll,
                    '{"account":'      || js(a_key)
                 || ',"gl_date":'      || jd(g.gl_date)
                 || ',"journal":'      || js(g.journal_name)
                 || ',"je_header_id":' || jn(g.JE_HEADER_ID)
                 || ',"source":'       || js(g.je_source)
                 || ',"category":'     || js(g.je_category)
                 || ',"reference1":'   || js(g.REFERENCE1)
                 || ',"reference2":'   || js(g.REFERENCE2)
                 || ',"reference5":'   || js(g.REFERENCE5)
                 || ',"description":'  || js(SUBSTR(g.DESCRIPTION, 1, 400))
                 || ',"dr":'           || jn(g.dr)
                 || ',"cr":'           || jn(g.cr)
                 || ',"net":'          || jn(g.cr - g.dr)
                 || ',"from_ap":'      || CASE WHEN g.REFERENCE5 LIKE 'AP-%'
                                                 OR UPPER(g.je_source) LIKE '%PAYABLE%'
                                               THEN 'true' ELSE 'false' END
                 || '}');
            END LOOP;
        END IF;
        a_key := a_total.NEXT(a_key);
    END LOOP;
    lob_add(l_acc, ']');

    -- ── 2b. PTD: payment and prepayment documents with activity in the period ──
    -- (invoices are already in the invoice rows). Amount = effect on the liability
    -- in the period, functional at the invoice rate: payments/applications negative,
    -- a void in the period of an earlier payment positive. One row per document
    -- and liability account, so each can be matched to its own GL lines.
    IF l_start IS NOT NULL THEN
        FOR d IN (
            WITH gl_post AS (
                SELECT l.REFERENCE5 AS ref5, l.REFERENCE2 AS ref2,
                       MIN(TRUNC(h.DEFAULT_EFFECTIVE_DATE)) AS gl_date
                FROM   RR_GL_JE_LINES_ALL l
                JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
                WHERE  l.REFERENCE5 IN ('AP-PAYMENT','AP-PAYMENT-VOID','AP-PREPAYMENT-APPLICATION')
                GROUP BY l.REFERENCE5, l.REFERENCE2
            ),
            inv AS (
                SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.SUPPLIER_NUMBER, i.SUPPLIER,
                       NVL(i.LIABILITY_DISTRIBUTION, '(no liability account)') AS acct,
                       CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                            ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END AS rate
                FROM   RR_AP_INVOICES_ALL i
                WHERE  (l_bu   IS NULL OR i.BUSINESS_UNIT   = l_bu)
                AND    (l_supp IS NULL OR i.SUPPLIER_NUMBER = l_supp)
                AND    (l_ccy  IS NULL OR NVL(i.INVOICE_CURRENCY, 'AED') = l_ccy)
            ),
            pr AS (
                SELECT ri.CHECK_ID, p.PAYMENT_NUMBER, ri.INVOICE_ID,
                       NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0) AS amt,
                       CASE WHEN p.SYNC_STATUS = 'SYNCED'
                            THEN TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE))
                            ELSE gp.gl_date END AS eff_date,
                       CASE WHEN NVL(p.PAYMENT_STATUS, 'x') = 'Voided' THEN
                            CASE WHEN p.SYNC_STATUS = 'SYNCED'
                                 THEN TRUNC(COALESCE(p.VOID_ACCOUNTING_DATE, p.VOID_DATE, p.PAYMENT_DATE))
                                 ELSE gv.gl_date END
                       END AS void_date
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
                LEFT JOIN gl_post gp ON gp.ref5 = 'AP-PAYMENT'      AND gp.ref2 = TO_CHAR(p.CHECK_ID)
                LEFT JOIN gl_post gv ON gv.ref5 = 'AP-PAYMENT-VOID' AND gv.ref2 = TO_CHAR(p.CHECK_ID)
            ),
            ap_rows AS (
                SELECT ap.APPLICATION_ID,
                       ap.PREPAYMENT_NUMBER || ' -> ' || ap.INVOICE_NUMBER AS num,
                       COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                       NVL(ap.APPLIED_AMOUNT, 0) AS amt,
                       CASE WHEN NVL(ap.SYNC_STATUS, 'NEW') = 'SYNCED' OR tgt.SYNC_STATUS = 'SYNCED'
                            THEN TRUNC(COALESCE(ap.APPLICATION_ACCOUNTING_DATE, tgt.ACCOUNTING_DATE, tgt.INVOICE_DATE))
                            ELSE ga.gl_date END AS eff_date
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL inv_r
                       ON ap.INVOICE_ID IS NULL AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                LEFT JOIN RR_AP_INVOICES_ALL tgt
                       ON tgt.INVOICE_ID = COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
                LEFT JOIN gl_post ga ON ga.ref5 = 'AP-PREPAYMENT-APPLICATION' AND ga.ref2 = TO_CHAR(ap.APPLICATION_ID)
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            )
            SELECT 'PAYMENT' AS typ, pr.CHECK_ID AS id, MAX(pr.PAYMENT_NUMBER) AS num,
                   inv.acct, inv.SUPPLIER_NUMBER AS supp_no, MAX(inv.SUPPLIER) AS supp_name,
                   MIN(pr.eff_date) AS doc_date,
                   SUM(pr.amt * inv.rate * (
                         CASE WHEN pr.void_date BETWEEN l_start AND l_asof AND pr.eff_date <= l_asof THEN 1 ELSE 0 END
                       - CASE WHEN pr.eff_date  BETWEEN l_start AND l_asof THEN 1 ELSE 0 END)) AS effect
            FROM   pr
            JOIN   inv ON inv.INVOICE_ID = pr.INVOICE_ID
            WHERE  pr.eff_date BETWEEN l_start AND l_asof
               OR  (pr.void_date BETWEEN l_start AND l_asof AND pr.eff_date <= l_asof)
            GROUP BY pr.CHECK_ID, inv.acct, inv.SUPPLIER_NUMBER
            UNION ALL
            SELECT 'PREPAYMENT', ar.APPLICATION_ID, MAX(ar.num),
                   inv.acct, inv.SUPPLIER_NUMBER, MAX(inv.SUPPLIER),
                   MIN(ar.eff_date),
                   -SUM(ar.amt * inv.rate)
            FROM   ap_rows ar
            JOIN   inv ON inv.INVOICE_ID = ar.INVOICE_ID
            WHERE  ar.eff_date BETWEEN l_start AND l_asof
            GROUP BY ar.APPLICATION_ID, inv.acct, inv.SUPPLIER_NUMBER
            ORDER BY 7, 1, 3
        ) LOOP
            IF ROUND(d.effect, 2) != 0 AND acct_ok(CASE WHEN d.acct = '(no liability account)' THEN NULL ELSE d.acct END) THEN
                IF NOT l_doc_first THEN lob_add(l_docs, ','); END IF;
                l_doc_first := FALSE;
                lob_add(l_docs,
                    '{"type":'             || js(d.typ)
                 || ',"id":'               || jn(d.id)
                 || ',"number":'           || js(d.num)
                 || ',"account":'          || js(d.acct)
                 || ',"supplier_number":'  || js(d.supp_no)
                 || ',"supplier_name":'    || js(d.supp_name)
                 || ',"doc_date":'         || jd(d.doc_date)
                 || ',"amount":'           || jn(d.effect)
                 || '}');
            END IF;
        END LOOP;
    END IF;

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
        IF (u.acct IS NULL OR acct_ok(u.acct))
           AND (l_start IS NULL OR u.doc_date >= l_start) THEN   -- PTD: only items dated in the period
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

    -- ── 4. supplier outstanding: dashboard formula vs this report, per invoice ──
    FOR v IN (
        WITH gl_post AS (
            SELECT l.REFERENCE5 AS ref5, l.REFERENCE2 AS ref2,
                   MIN(TRUNC(h.DEFAULT_EFFECTIVE_DATE)) AS gl_date
            FROM   RR_GL_JE_LINES_ALL l
            JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
            WHERE  l.REFERENCE5 IN ('AP-INVOICE-CREATION','AP-INVOICE-CANCELLATION',
                                    'AP-PAYMENT','AP-PAYMENT-VOID','AP-PREPAYMENT-APPLICATION')
            GROUP BY l.REFERENCE5, l.REFERENCE2
        ),
        pay AS (
            SELECT x.INVOICE_ID,
                   SUM(CASE WHEN x.eff_date <= l_asof AND (x.void_date IS NULL OR x.void_date > l_asof)
                            THEN x.amt ELSE 0 END) AS paid_tb,
                   SUM(CASE WHEN x.p_status != 'Voided' AND x.ip_status != 'Voided'
                            THEN x.amt ELSE 0 END) AS paid_dash
            FROM (
                SELECT ri.INVOICE_ID,
                       NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0) AS amt,
                       NVL(p.PAYMENT_STATUS, 'Active')          AS p_status,
                       NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') AS ip_status,
                       CASE WHEN p.SYNC_STATUS = 'SYNCED'
                            THEN TRUNC(NVL(p.ACCOUNTING_DATE, p.PAYMENT_DATE))
                            ELSE gp.gl_date END AS eff_date,
                       CASE WHEN NVL(p.PAYMENT_STATUS, 'x') = 'Voided' THEN
                            CASE WHEN p.SYNC_STATUS = 'SYNCED'
                                 THEN TRUNC(COALESCE(p.VOID_ACCOUNTING_DATE, p.VOID_DATE, p.PAYMENT_DATE))
                                 ELSE gv.gl_date END
                       END AS void_date
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
                LEFT JOIN gl_post gp ON gp.ref5 = 'AP-PAYMENT'      AND gp.ref2 = TO_CHAR(p.CHECK_ID)
                LEFT JOIN gl_post gv ON gv.ref5 = 'AP-PAYMENT-VOID' AND gv.ref2 = TO_CHAR(p.CHECK_ID)
            ) x
            GROUP BY x.INVOICE_ID
        ),
        app AS (            -- prepayments applied TO an invoice
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(NVL(ap.APPLIED_AMOUNT, 0)) AS applied_dash,
                   SUM(CASE WHEN (CASE WHEN NVL(ap.SYNC_STATUS, 'NEW') = 'SYNCED' OR tgt.SYNC_STATUS = 'SYNCED'
                                       THEN TRUNC(COALESCE(ap.APPLICATION_ACCOUNTING_DATE, tgt.ACCOUNTING_DATE, tgt.INVOICE_DATE))
                                       ELSE ga.gl_date END) <= l_asof
                            THEN NVL(ap.APPLIED_AMOUNT, 0) ELSE 0 END) AS applied_tb
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                   ON ap.INVOICE_ID IS NULL AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            LEFT JOIN RR_AP_INVOICES_ALL tgt
                   ON tgt.INVOICE_ID = COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
            LEFT JOIN gl_post ga ON ga.ref5 = 'AP-PREPAYMENT-APPLICATION' AND ga.ref2 = TO_CHAR(ap.APPLICATION_ID)
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        ),
        app_out AS (        -- applied OUT of a prepayment invoice (dashboard only)
            SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(NVL(ap.APPLIED_AMOUNT, 0)) AS applied_out
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL prep_r
                   ON ap.PREPAYMENT_INVOICE_ID IS NULL AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
        )
        SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.INVOICE_TYPE, i.INVOICE_DATE,
               NVL(i.SUPPLIER_NUMBER, '(none)') AS supp_no, i.SUPPLIER AS supp_name,
               i.LIABILITY_DISTRIBUTION AS acct,
               NVL(i.INVOICE_CURRENCY, 'AED') AS ccy,
               CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1
                    ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END AS rate,
               NVL(i.INVOICE_AMOUNT, 0) AS amt,
               CASE WHEN i.SYNC_STATUS = 'SYNCED'
                    THEN TRUNC(NVL(i.ACCOUNTING_DATE, i.INVOICE_DATE))
                    ELSE gi.gl_date END AS acct_date,
               CASE WHEN NVL(i.CANCELED_FLAG, 'N') = 'Y' THEN
                    CASE WHEN i.SYNC_STATUS = 'SYNCED'
                         THEN TRUNC(COALESCE(i.CANCELED_DATE, i.CANCELLATION_DATE, i.INVOICE_DATE))
                         ELSE gc.gl_date END
               END AS cancel_date,
               NVL(pay.paid_tb, 0) AS paid_tb, NVL(app.applied_tb, 0) AS applied_tb,
               -- dashboard remaining (suppliers/balance/outstanding)
               CASE WHEN NVL(i.CANCELED_FLAG, 'N') = 'Y' THEN 0
                    WHEN NVL(i.INVOICE_AMOUNT, 0) < 0 THEN
                         NVL(i.INVOICE_AMOUNT, 0) - NVL(pay.paid_dash, 0)
                       - NVL(app.applied_dash, 0) - NVL(ao.applied_out, 0)
                    ELSE GREATEST(0, NVL(i.INVOICE_AMOUNT, 0) - NVL(pay.paid_dash, 0)
                       - NVL(app.applied_dash, 0) - NVL(ao.applied_out, 0))
               END AS dash_rem
        FROM   RR_AP_INVOICES_ALL i
        LEFT JOIN gl_post gi ON gi.ref5 = 'AP-INVOICE-CREATION'     AND gi.ref2 = TO_CHAR(i.INVOICE_ID)
        LEFT JOIN gl_post gc ON gc.ref5 = 'AP-INVOICE-CANCELLATION' AND gc.ref2 = TO_CHAR(i.INVOICE_ID)
        LEFT JOIN pay     ON pay.INVOICE_ID = i.INVOICE_ID
        LEFT JOIN app     ON app.INVOICE_ID = i.INVOICE_ID
        LEFT JOIN app_out ao ON ao.INVOICE_ID = i.INVOICE_ID
        WHERE  (l_bu   IS NULL OR i.BUSINESS_UNIT   = l_bu)
        AND    (l_supp IS NULL OR i.SUPPLIER_NUMBER = l_supp)
        AND    (l_ccy  IS NULL OR NVL(i.INVOICE_CURRENCY, 'AED') = l_ccy)
        ORDER  BY 5, i.INVOICE_DATE, i.INVOICE_NUMBER
    ) LOOP
        -- Payables open as this report computes it (section 1, as of D)
        IF v.acct_date <= l_asof AND (v.cancel_date IS NULL OR v.cancel_date > l_asof) THEN
            l_open_e := v.amt - v.paid_tb - v.applied_tb;
        ELSE
            l_open_e := 0;
        END IF;
        l_open_f := ROUND(l_open_e * v.rate, 2);
        IF v.acct_date IS NULL OR v.acct_date > l_asof THEN
            l_bucket := 'NOT_ACCOUNTED';
        ELSIF NOT NVL(acct_ok(v.acct), FALSE) THEN   -- NULL (no account, filter set) = not in the report
            l_bucket := 'OTHER_ACCOUNT';
        ELSE
            l_bucket := 'IN_REPORT';
        END IF;
        IF ROUND(v.dash_rem, 2) != 0 OR (l_bucket = 'IN_REPORT' AND l_open_f != 0) THEN
            l_sk := v.supp_no;
            IF NOT so_dash.EXISTS(l_sk) THEN
                so_name(l_sk) := SUBSTR(v.supp_name, 1, 400);
                so_cnt(l_sk) := 0; so_dash(l_sk) := 0; so_na(l_sk) := 0; so_oa(l_sk) := 0;
                so_tm(l_sk) := 0;  so_fx(l_sk) := 0;   so_tb(l_sk) := 0;  so_out(l_sk) := 0;
            END IF;
            -- total outstanding ignores accounting status (as the Payables dashboard),
            -- but keeps the liability account filter and converts at the invoice rate
            IF NVL(acct_ok(v.acct), FALSE) THEN
                l_out_fn := ROUND(v.dash_rem * v.rate, 2);
                so_out(l_sk) := so_out(l_sk) + l_out_fn;
                l_out_tot    := l_out_tot + l_out_fn;
                a_key := NVL(v.acct, '(no liability account)');
                IF NOT a_out.EXISTS(a_key) THEN a_out(a_key) := 0; END IF;
                a_out(a_key) := a_out(a_key) + l_out_fn;
            END IF;
            so_cnt(l_sk)  := so_cnt(l_sk) + 1;
            so_dash(l_sk) := so_dash(l_sk) + v.dash_rem;
            IF l_bucket = 'NOT_ACCOUNTED' THEN
                so_na(l_sk) := so_na(l_sk) + v.dash_rem;
            ELSIF l_bucket = 'OTHER_ACCOUNT' THEN
                so_oa(l_sk) := so_oa(l_sk) + v.dash_rem;
            ELSE
                so_tm(l_sk) := so_tm(l_sk) + (v.dash_rem - l_open_e);
                so_fx(l_sk) := so_fx(l_sk) + (l_open_f - l_open_e);
                so_tb(l_sk) := so_tb(l_sk) + l_open_f;
            END IF;
            IF l_si_cnt < l_si_cap THEN
                IF l_si_cnt > 0 THEN lob_add(l_supinv, ','); END IF;
                l_si_cnt := l_si_cnt + 1;
                lob_add(l_supinv,
                    '{"supplier_number":'   || js(v.supp_no)
                 || ',"invoice_id":'        || jn(v.INVOICE_ID)
                 || ',"invoice_number":'    || js(v.INVOICE_NUMBER)
                 || ',"invoice_type":'      || js(v.INVOICE_TYPE)
                 || ',"invoice_date":'      || jd(v.INVOICE_DATE)
                 || ',"accounting_date":'   || jd(v.acct_date)
                 || ',"account":'           || js(v.acct)
                 || ',"currency":'          || js(v.ccy)
                 || ',"invoice_amount":'    || jn(v.amt)
                 || ',"dashboard_remaining":' || jn(v.dash_rem)
                 || ',"payables_open":'     || jn(CASE WHEN l_bucket = 'IN_REPORT' THEN l_open_f ELSE 0 END)
                 || ',"bucket":'            || js(l_bucket)
                 || '}');
            END IF;
        END IF;
    END LOOP;
    lob_add(l_sup, '[');
    l_first := TRUE;
    l_sk := so_dash.FIRST;
    WHILE l_sk IS NOT NULL LOOP
        IF NOT l_first THEN lob_add(l_sup, ','); END IF;
        l_first := FALSE;
        lob_add(l_sup,
            '{"supplier_number":'  || js(l_sk)
         || ',"supplier_name":'    || js(so_name(l_sk))
         || ',"invoice_count":'    || jn(so_cnt(l_sk))
         || ',"dashboard":'        || jn(so_dash(l_sk))
         || ',"not_accounted":'    || jn(so_na(l_sk))
         || ',"other_accounts":'   || jn(so_oa(l_sk))
         || ',"timing":'           || jn(so_tm(l_sk))
         || ',"fx":'               || jn(so_fx(l_sk))
         || ',"payables_balance":' || jn(so_tb(l_sk))
         || ',"outstanding":'      || jn(so_out(l_sk))
         || '}');
        l_sk := so_dash.NEXT(l_sk);
    END LOOP;
    lob_add(l_sup, ']');

    -- ── 5. GL balance of the liability account(s) per supplier ─────────────
    a_key := a_total.FIRST;
    WHILE a_key IS NOT NULL LOOP
        FOR g IN (
            SELECT x.*,
                   COALESCE(x.s_tag, x.s_inv, x.s_pay) AS supp_no,
                   CASE WHEN x.s_tag IS NOT NULL THEN 'TAG'
                        WHEN x.s_inv IS NOT NULL THEN 'INVOICE_NUMBER'
                        WHEN x.s_pay IS NOT NULL THEN 'PAYMENT_NUMBER' END AS link
            FROM (
                SELECT TRUNC(h.DEFAULT_EFFECTIVE_DATE) AS gl_date, h.JOURNAL_NAME, h.USER_JE_CATEGORY_NAME AS category,
                       b.USER_JE_SOURCE_NAME AS source, l.JE_HEADER_ID,
                       l.REFERENCE1, l.REFERENCE2, l.REFERENCE5, l.DESCRIPTION,
                       NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0) AS net,
                       CASE
                         WHEN l.REFERENCE5 IN ('AP-INVOICE-CREATION','AP-INVOICE-CANCELLATION') THEN
                              (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_INVOICES_ALL i
                               WHERE TO_CHAR(i.INVOICE_ID) = l.REFERENCE2)
                         WHEN l.REFERENCE5 IN ('AP-PAYMENT','AP-PAYMENT-VOID') THEN
                              (SELECT MAX(p.SUPPLIER_NUMBER) FROM RR_AP_PAYMENTS_ALL p
                               WHERE TO_CHAR(p.CHECK_ID) = l.REFERENCE2)
                         WHEN l.REFERENCE5 = 'AP-PREPAYMENT-APPLICATION' THEN
                              (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_APPLIED_PREPAYMENTS ap
                               JOIN RR_AP_INVOICES_ALL i ON i.INVOICE_ID = ap.INVOICE_ID
                                                         OR i.INVOICE_NUMBER = ap.INVOICE_NUMBER
                               WHERE TO_CHAR(ap.APPLICATION_ID) = l.REFERENCE2)
                       END AS s_tag,
                       CASE WHEN l.REFERENCE1 IS NOT NULL THEN
                              (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_INVOICES_ALL i
                               WHERE i.INVOICE_NUMBER = l.REFERENCE1
                               AND   (l_bu IS NULL OR i.BUSINESS_UNIT = l_bu)) END AS s_inv,
                       CASE WHEN l.REFERENCE1 IS NOT NULL THEN
                              (SELECT MAX(p.SUPPLIER_NUMBER) FROM RR_AP_PAYMENTS_ALL p
                               WHERE p.PAYMENT_NUMBER = l.REFERENCE1
                               AND   (l_bu IS NULL OR p.BUSINESS_UNIT = l_bu)) END AS s_pay
                FROM   RR_GL_JE_LINES_ALL l
                JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
                LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = l.BATCH_ID
                WHERE  l.ACCOUNT_COMBINATION = a_key
                -- same basis as the GL balance (section 2)
                AND    h.LEDGER_NAME IS NOT NULL
                AND    (l_ledger IS NULL OR h.LEDGER_NAME = l_ledger)
                AND    h.PERIOD_NAME IN (SELECT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
                                         WHERE TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N')
                AND   (TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                               'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') < TRUNC(l_asof, 'MM')
                   OR (TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                               'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') = TRUNC(l_asof, 'MM')
                       AND (l_asof = LAST_DAY(l_asof) OR TRUNC(h.DEFAULT_EFFECTIVE_DATE) <= l_asof)))
            ) x
        ) LOOP
            IF g.supp_no IS NOT NULL THEN
                IF NOT gs_net.EXISTS(g.supp_no) THEN gs_net(g.supp_no) := 0; gs_cnt(g.supp_no) := 0; END IF;
                gs_net(g.supp_no) := gs_net(g.supp_no) + g.net;
                gs_cnt(g.supp_no) := gs_cnt(g.supp_no) + 1;
            ELSE
                l_unl_tot := l_unl_tot + g.net;
                IF l_unl_cnt < l_unl_cap THEN
                    IF l_unl_cnt > 0 THEN lob_add(l_unl, ','); END IF;
                    l_unl_cnt := l_unl_cnt + 1;
                    lob_add(l_unl,
                        '{"account":'      || js(a_key)
                     || ',"gl_date":'      || jd(g.gl_date)
                     || ',"journal":'      || js(g.JOURNAL_NAME)
                     || ',"je_header_id":' || jn(g.JE_HEADER_ID)
                     || ',"source":'       || js(g.source)
                     || ',"category":'     || js(g.category)
                     || ',"reference1":'   || js(g.REFERENCE1)
                     || ',"reference2":'   || js(g.REFERENCE2)
                     || ',"reference5":'   || js(g.REFERENCE5)
                     || ',"description":'  || js(SUBSTR(g.DESCRIPTION, 1, 400))
                     || ',"net":'          || jn(g.net)
                     || '}');
                END IF;
            END IF;
        END LOOP;
        a_key := a_total.NEXT(a_key);
    END LOOP;
    -- supplier names for suppliers that only appear in GL
    l_sk := gs_net.FIRST;
    WHILE l_sk IS NOT NULL LOOP
        IF so_name.EXISTS(l_sk) THEN
            gs_name(l_sk) := so_name(l_sk);
        ELSE
            BEGIN
                SELECT MAX(SUPPLIER) INTO gs_name(l_sk) FROM RR_AP_INVOICES_ALL WHERE SUPPLIER_NUMBER = l_sk;
            EXCEPTION WHEN OTHERS THEN gs_name(l_sk) := NULL;
            END;
        END IF;
        l_sk := gs_net.NEXT(l_sk);
    END LOOP;

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":"true","asOfDate":"' || TO_CHAR(l_asof, 'YYYY-MM-DD') || '"'
         || ',"mode":"' || CASE WHEN l_start IS NULL THEN 'ASOF' ELSE 'PTD' END || '"'
         || ',"periodStart":' || jd(l_start)
         || ',"openingDate":' || CASE WHEN l_start IS NULL THEN 'null' ELSE jd(l_open) END
         || ',"businessUnit":' || js(l_bu)
         || ',"ledger":' || js(l_ledger)
         || ',"totals":{"tb_total":' || jn(l_tb_tot)
         || ',"gl_balance":'         || jn(l_gl_tot)
         || ',"gl_by_date":'         || jn(l_gl_bdtot)
         || ',"difference":'         || jn(l_tb_tot - l_gl_tot)
         || ',"unaccounted_effect":' || jn(l_una_tot)
         || ',"outstanding":'        || jn(l_out_tot)
         || ',"tb_opening":'         || jn(l_tb_open)
         || ',"invoices_ptd":'       || jn(l_inv_tot)
         || ',"payments_ptd":'       || jn(l_pay_tot)
         || ',"prepayments_ptd":'    || jn(l_app_tot)
         || ',"gl_opening":'         || jn(l_gl_otot)
         || ',"gl_ptd":'             || jn(l_gl_tot - l_gl_otot)
         || ',"difference_opening":' || jn(l_tb_open - l_gl_otot)
         || ',"difference_ptd":'     || jn((l_tb_tot - l_tb_open) - (l_gl_tot - l_gl_otot)) || '}'
         || ',"accounts":');
    lob_out(l_acc);
    HTP.PRN(',"invoices":');
    lob_out(l_inv);
    HTP.PRN(',"unaccounted":');
    lob_out(l_una);
    HTP.PRN(',"glLinesCapped":' || CASE WHEN l_gl_cnt >= l_gl_cap THEN 'true' ELSE 'false' END);
    HTP.PRN(',"glLines":[');
    lob_out(l_gll);
    HTP.PRN('],"ptdDocs":[');
    lob_out(l_docs);
    HTP.PRN('],"glMonthly":[');
    lob_out(l_mgl);
    HTP.PRN('],"apMonthly":[');
    lob_out(l_map);
    HTP.PRN('],"supplierOutstanding":');
    lob_out(l_sup);
    HTP.PRN(',"supplierInvoicesCapped":' || CASE WHEN l_si_cnt >= l_si_cap THEN 'true' ELSE 'false' END);
    HTP.PRN(',"supplierInvoices":[');
    lob_out(l_supinv);
    HTP.PRN('],"glBySupplier":[');
    l_first := TRUE;
    l_sk := gs_net.FIRST;
    WHILE l_sk IS NOT NULL LOOP
        IF NOT l_first THEN HTP.PRN(','); END IF;
        l_first := FALSE;
        HTP.PRN('{"supplier_number":' || js(l_sk) || ',"supplier_name":' || js(gs_name(l_sk))
             || ',"gl":' || jn(gs_net(l_sk)) || ',"lines":' || jn(gs_cnt(l_sk)) || '}');
        l_sk := gs_net.NEXT(l_sk);
    END LOOP;
    HTP.PRN('],"glUnlinkedTotal":' || jn(l_unl_tot));
    HTP.PRN(',"glUnlinkedCapped":' || CASE WHEN l_unl_cnt >= l_unl_cap THEN 'true' ELSE 'false' END);
    HTP.PRN(',"glUnlinked":[');
    lob_out(l_unl);
    HTP.PRN('],"accountOutstanding":[');
    l_first := TRUE;
    a_key := a_out.FIRST;
    WHILE a_key IS NOT NULL LOOP
        IF NOT l_first THEN HTP.PRN(','); END IF;
        l_first := FALSE;
        HTP.PRN('{"account":' || js(a_key) || ',"outstanding":' || jn(a_out(a_key)) || '}');
        a_key := a_out.NEXT(a_key);
    END LOOP;
    HTP.PRN('],"glByLedger":[');
    l_first := TRUE;
    l_lg_key := l_by_ledger.FIRST;
    WHILE l_lg_key IS NOT NULL LOOP
        IF NOT l_first THEN HTP.PRN(','); END IF;
        l_first := FALSE;
        HTP.PRN('{"ledger":' || js(l_lg_key) || ',"balance":' || jn(l_by_ledger(l_lg_key)) || '}');
        l_lg_key := l_by_ledger.NEXT(l_lg_key);
    END LOOP;
    HTP.PRN(']');
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
        p_currency          => :P_CURRENCY,
        p_period            => :P_PERIOD,
        p_ledger            => :P_LEDGER
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
