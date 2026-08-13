-- =============================================================================
-- Patch 81 – Three-way AP ↔ SLA ↔ GL Reconciliation
-- =============================================================================
-- Enhances RR_AP_RECON_PKG.get_recon() to also join the originating AP
-- transaction (RR_AP_INVOICES_ALL or RR_AP_PAYMENTS_ALL) so the response
-- carries AP amount alongside SLA and GL amounts.
--
-- New response fields per row:
--   apAmount         NUMBER   – invoice or payment amount (null for prepayments)
--   apNumber         VARCHAR2 – invoice number or check number
--   apDate           VARCHAR2 – invoice date or payment date  (YYYY-MM-DD)
--   apStatus         VARCHAR2 – invoice/payment status
--   apSupplier       VARCHAR2 – supplier / third-party name
--   apVsSlaDiff      NUMBER   – ABS(apAmount – slaEnteredDr)
--   slaVsGlDiff      NUMBER   – ABS(slaEnteredDr – glEnteredDr)  [was "difference"]
--   apMatchesSla     BOOLEAN  – apVsSlaDiff < 0.01
--   slaMatchesGl     BOOLEAN  – slaVsGlDiff < 0.01 AND glHeaderId IS NOT NULL
--   isFullyBalanced  BOOLEAN  – apMatchesSla AND slaMatchesGl
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Replace package spec (add nothing – body changes only need spec recompile)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE RR_AP_RECON_PKG AS

    FUNCTION get_recon(
        p_period_name        VARCHAR2 DEFAULT NULL,
        p_business_unit      VARCHAR2 DEFAULT NULL,
        p_ledger_name        VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT 'AP',
        p_accounting_status  VARCHAR2 DEFAULT NULL,
        p_source_table       VARCHAR2 DEFAULT NULL,
        p_date_from          VARCHAR2 DEFAULT NULL,
        p_date_to            VARCHAR2 DEFAULT NULL,
        p_limit              NUMBER   DEFAULT 500,
        p_offset             NUMBER   DEFAULT 0
    ) RETURN CLOB;

END RR_AP_RECON_PKG;
/


-- ---------------------------------------------------------------------------
-- 2. Replace package body – three-way version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY RR_AP_RECON_PKG AS

    -- ── JSON helpers ──────────────────────────────────────────────────────────
    FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"');
    END;
    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || esc(p) || '"' END;
    END;
    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null'
                    ELSE TRIM(TRAILING '.' FROM TO_CHAR(p, 'FM999999999999990.9999'))
               END;
    END;
    FUNCTION jbool(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN UPPER(p) IN ('Y','YES','TRUE','1') THEN 'true' ELSE 'false' END;
    END;

    -- ── get_recon ─────────────────────────────────────────────────────────────
    FUNCTION get_recon(
        p_period_name        VARCHAR2 DEFAULT NULL,
        p_business_unit      VARCHAR2 DEFAULT NULL,
        p_ledger_name        VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT 'AP',
        p_accounting_status  VARCHAR2 DEFAULT NULL,
        p_source_table       VARCHAR2 DEFAULT NULL,
        p_date_from          VARCHAR2 DEFAULT NULL,
        p_date_to            VARCHAR2 DEFAULT NULL,
        p_limit              NUMBER   DEFAULT 500,
        p_offset             NUMBER   DEFAULT 0
    ) RETURN CLOB IS

        v_sql      CLOB;
        v_cur      SYS_REFCURSOR;
        v_result   CLOB;
        v_sep      VARCHAR2(1) := '';

        -- SLA header
        v_sla_header_id    NUMBER;
        v_module_name      VARCHAR2(60);
        v_source_table     VARCHAR2(60);
        v_source_id        NUMBER;
        v_source_number    VARCHAR2(100);
        v_source_type      VARCHAR2(60);
        v_event_type_code  VARCHAR2(60);
        v_accounting_date  VARCHAR2(20);
        v_period_name      VARCHAR2(15);
        v_business_unit    VARCHAR2(100);
        v_ledger_name      VARCHAR2(100);
        v_currency_code    VARCHAR2(15);
        v_acct_status      VARCHAR2(20);
        v_posting_status   VARCHAR2(20);
        v_gl_batch_id      NUMBER;
        v_gl_batch_name    VARCHAR2(240);
        v_gl_header_id     NUMBER;
        v_posted_date      VARCHAR2(30);
        -- SLA line aggregates
        v_sla_entered_dr   NUMBER;
        v_sla_entered_cr   NUMBER;
        v_sla_accounted_dr NUMBER;
        v_sla_accounted_cr NUMBER;
        v_sla_line_count   NUMBER;
        -- GL header
        v_gl_journal_name  VARCHAR2(240);
        v_gl_period        VARCHAR2(15);
        v_gl_category      VARCHAR2(80);
        v_gl_source        VARCHAR2(80);
        v_gl_batch_status  VARCHAR2(30);
        v_gl_entered_dr    NUMBER;
        v_gl_entered_cr    NUMBER;
        v_gl_accounted_dr  NUMBER;
        v_gl_accounted_cr  NUMBER;
        v_gl_line_count    NUMBER;
        -- AP transaction (three-way)
        v_ap_amount        NUMBER;
        v_ap_number        VARCHAR2(100);
        v_ap_date          VARCHAR2(20);
        v_ap_status        VARCHAR2(80);
        v_ap_supplier      VARCHAR2(360);

        -- Computed
        v_ap_vs_sla_diff   NUMBER;
        v_sla_vs_gl_diff   NUMBER;
        v_ap_matches_sla   VARCHAR2(1);
        v_sla_matches_gl   VARCHAR2(1);
        v_fully_balanced   VARCHAR2(1);

        -- Summary accumulators
        v_sum_ap_dr        NUMBER := 0;
        v_sum_sla_dr       NUMBER := 0;
        v_sum_gl_dr        NUMBER := 0;
        v_sum_ap_sla_diff  NUMBER := 0;
        v_sum_sla_gl_diff  NUMBER := 0;
        v_total_rows       NUMBER := 0;

        v_where   VARCHAR2(4000) := ' WHERE 1=1';

    BEGIN

        -- ── Build WHERE ───────────────────────────────────────────────────────
        IF p_module_name IS NOT NULL THEN
            v_where := v_where || ' AND h.MODULE_NAME = ''' || p_module_name || '''';
        END IF;
        IF p_period_name IS NOT NULL THEN
            v_where := v_where || ' AND h.PERIOD_NAME = ''' || p_period_name || '''';
        END IF;
        IF p_business_unit IS NOT NULL THEN
            v_where := v_where || ' AND h.BUSINESS_UNIT = ''' || p_business_unit || '''';
        END IF;
        IF p_ledger_name IS NOT NULL THEN
            v_where := v_where || ' AND h.LEDGER_NAME = ''' || p_ledger_name || '''';
        END IF;
        IF p_accounting_status IS NOT NULL THEN
            v_where := v_where || ' AND h.ACCOUNTING_STATUS = ''' || p_accounting_status || '''';
        END IF;
        IF p_source_table IS NOT NULL THEN
            v_where := v_where || ' AND h.SOURCE_TABLE = ''' || p_source_table || '''';
        END IF;
        IF p_date_from IS NOT NULL THEN
            v_where := v_where || ' AND h.ACCOUNTING_DATE >= TO_DATE(''' || p_date_from || ''',''YYYY-MM-DD'')';
        END IF;
        IF p_date_to IS NOT NULL THEN
            v_where := v_where || ' AND h.ACCOUNTING_DATE <= TO_DATE(''' || p_date_to || ''',''YYYY-MM-DD'')';
        END IF;

        -- ── Main query — one row per SLA header ───────────────────────────────
        -- AP amount: CASE on SOURCE_TABLE picks the right AP table.
        -- Both invoice and payment tables are left-joined; only one will match
        -- (the other NULLs out), and COALESCE picks the non-null value.
        v_sql :=
            'SELECT' ||
            -- SLA header
            '  h.HEADER_ID,' ||
            '  h.MODULE_NAME,' ||
            '  h.SOURCE_TABLE,' ||
            '  h.SOURCE_ID,' ||
            '  h.SOURCE_NUMBER,' ||
            '  h.SOURCE_TYPE,' ||
            '  h.EVENT_TYPE_CODE,' ||
            '  TO_CHAR(h.ACCOUNTING_DATE,''YYYY-MM-DD'') ACCOUNTING_DATE,' ||
            '  h.PERIOD_NAME,' ||
            '  h.BUSINESS_UNIT,' ||
            '  h.LEDGER_NAME,' ||
            '  h.CURRENCY_CODE,' ||
            '  h.ACCOUNTING_STATUS,' ||
            '  h.POSTING_STATUS,' ||
            '  h.GL_BATCH_ID,' ||
            '  h.GL_BATCH_NAME,' ||
            '  h.GL_HEADER_ID,' ||
            '  TO_CHAR(h.POSTED_DATE,''YYYY-MM-DD HH24:MI:SS'') POSTED_DATE,' ||
            -- SLA line aggregates
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''DR'' THEN NVL(sl.ENTERED_DR,0) ELSE 0 END),0)  SLA_ENTERED_DR,' ||
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''CR'' THEN NVL(sl.ENTERED_CR,0) ELSE 0 END),0)  SLA_ENTERED_CR,' ||
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''DR'' THEN NVL(sl.ACCOUNTED_DR,0) ELSE 0 END),0) SLA_ACCOUNTED_DR,' ||
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''CR'' THEN NVL(sl.ACCOUNTED_CR,0) ELSE 0 END),0) SLA_ACCOUNTED_CR,' ||
            '  COUNT(sl.LINE_ID) SLA_LINE_COUNT,' ||
            -- GL header
            '  gh.JOURNAL_NAME,' ||
            '  gh.PERIOD_NAME                  GL_PERIOD_NAME,' ||
            '  gh.USER_JE_CATEGORY_NAME        GL_CATEGORY,' ||
            '  gb.USER_JE_SOURCE_NAME          GL_SOURCE,' ||
            '  gb.STATUS                       GL_BATCH_STATUS,' ||
            '  NVL(gh.RUNNING_TOTAL_DR,0)      GL_ENTERED_DR,' ||
            '  NVL(gh.RUNNING_TOTAL_CR,0)      GL_ENTERED_CR,' ||
            '  NVL(gh.RUNNING_TOTAL_ACCOUNTED_DR,0) GL_ACCOUNTED_DR,' ||
            '  NVL(gh.RUNNING_TOTAL_ACCOUNTED_CR,0) GL_ACCOUNTED_CR,' ||
            '  NVL(gll.GL_LINE_COUNT,0)        GL_LINE_COUNT,' ||
            -- AP transaction fields (COALESCE between invoice and payment)
            '  COALESCE(inv.INVOICE_AMOUNT,   pmt.PAYMENT_AMOUNT)   AP_AMOUNT,' ||
            '  COALESCE(inv.INVOICE_NUMBER,   pmt.PAYMENT_NUMBER)     AP_NUMBER,' ||
            '  COALESCE(TO_CHAR(inv.INVOICE_DATE,''YYYY-MM-DD''),' ||
            '           TO_CHAR(pmt.PAYMENT_DATE,''YYYY-MM-DD''))    AP_DATE,' ||
            '  COALESCE(inv.VALIDATION_STATUS, pmt.PAYMENT_STATUS)   AP_STATUS,' ||
            '  COALESCE(inv.SUPPLIER,         pmt.THIRD_PARTY_SUPPLIER) AP_SUPPLIER' ||
            ' FROM RR_SLA_ACCOUNTING_HEADERS h' ||
            -- SLA lines
            ' LEFT JOIN RR_SLA_ACCOUNTING_LINES sl' ||
            '        ON sl.HEADER_ID = h.HEADER_ID' ||
            -- GL header
            ' LEFT JOIN RR_GL_JE_HEADERS gh' ||
            '        ON gh.JE_HEADER_ID = h.GL_HEADER_ID' ||
            -- GL batch
            ' LEFT JOIN RR_GL_JOURNAL_BATCHES gb' ||
            '        ON gb.JE_BATCH_ID = gh.BATCH_ID' ||
            -- GL line count
            ' LEFT JOIN (SELECT JE_HEADER_ID, COUNT(*) GL_LINE_COUNT' ||
            '              FROM RR_GL_JE_LINES_ALL' ||
            '             GROUP BY JE_HEADER_ID) gll' ||
            '        ON gll.JE_HEADER_ID = gh.JE_HEADER_ID' ||
            -- AP invoices (join only when source is AP_INVOICES)
            ' LEFT JOIN RR_AP_INVOICES_ALL inv' ||
            '        ON h.SOURCE_TABLE = ''AP_INVOICES''' ||
            '       AND inv.INVOICE_ID = h.SOURCE_ID' ||
            -- AP payments (join only when source is AP_PAYMENTS)
            ' LEFT JOIN RR_AP_PAYMENTS_ALL pmt' ||
            '        ON h.SOURCE_TABLE = ''AP_PAYMENTS''' ||
            '       AND pmt.CHECK_ID = h.SOURCE_ID' ||
            v_where ||
            ' GROUP BY' ||
            '  h.HEADER_ID, h.MODULE_NAME, h.SOURCE_TABLE, h.SOURCE_ID,' ||
            '  h.SOURCE_NUMBER, h.SOURCE_TYPE, h.EVENT_TYPE_CODE,' ||
            '  h.ACCOUNTING_DATE, h.PERIOD_NAME, h.BUSINESS_UNIT,' ||
            '  h.LEDGER_NAME, h.CURRENCY_CODE, h.ACCOUNTING_STATUS,' ||
            '  h.POSTING_STATUS, h.GL_BATCH_ID, h.GL_BATCH_NAME,' ||
            '  h.GL_HEADER_ID, h.POSTED_DATE,' ||
            '  gh.JOURNAL_NAME, gh.PERIOD_NAME,' ||
            '  gh.USER_JE_CATEGORY_NAME, gb.USER_JE_SOURCE_NAME,' ||
            '  gb.STATUS,' ||
            '  gh.RUNNING_TOTAL_DR, gh.RUNNING_TOTAL_CR,' ||
            '  gh.RUNNING_TOTAL_ACCOUNTED_DR, gh.RUNNING_TOTAL_ACCOUNTED_CR,' ||
            '  gll.GL_LINE_COUNT,' ||
            '  inv.INVOICE_AMOUNT, inv.INVOICE_NUMBER, inv.INVOICE_DATE, inv.VALIDATION_STATUS, inv.SUPPLIER,' ||
            '  pmt.PAYMENT_AMOUNT, pmt.PAYMENT_NUMBER, pmt.PAYMENT_DATE, pmt.PAYMENT_STATUS, pmt.THIRD_PARTY_SUPPLIER' ||
            ' ORDER BY h.ACCOUNTING_DATE DESC, h.HEADER_ID DESC' ||
            ' OFFSET ' || NVL(p_offset, 0) || ' ROWS' ||
            ' FETCH NEXT ' || NVL(p_limit, 500) || ' ROWS ONLY';

        -- ── Stream rows into JSON ─────────────────────────────────────────────
        v_result := '{"summary":null,"items":[';

        OPEN v_cur FOR v_sql;
        LOOP
            FETCH v_cur INTO
                v_sla_header_id, v_module_name, v_source_table, v_source_id,
                v_source_number, v_source_type, v_event_type_code,
                v_accounting_date, v_period_name, v_business_unit,
                v_ledger_name, v_currency_code, v_acct_status, v_posting_status,
                v_gl_batch_id, v_gl_batch_name, v_gl_header_id, v_posted_date,
                v_sla_entered_dr, v_sla_entered_cr, v_sla_accounted_dr, v_sla_accounted_cr, v_sla_line_count,
                v_gl_journal_name, v_gl_period, v_gl_category, v_gl_source, v_gl_batch_status,
                v_gl_entered_dr, v_gl_entered_cr, v_gl_accounted_dr, v_gl_accounted_cr, v_gl_line_count,
                v_ap_amount, v_ap_number, v_ap_date, v_ap_status, v_ap_supplier;
            EXIT WHEN v_cur%NOTFOUND;

            -- Three-way differences
            v_ap_vs_sla_diff := ABS(NVL(v_ap_amount, 0) - NVL(v_sla_entered_dr, 0));
            v_sla_vs_gl_diff := ABS(NVL(v_sla_entered_dr, 0) - NVL(v_gl_entered_dr, 0));
            v_ap_matches_sla := CASE WHEN v_ap_amount IS NOT NULL AND v_ap_vs_sla_diff < 0.01 THEN 'Y' ELSE 'N' END;
            v_sla_matches_gl := CASE WHEN v_gl_header_id IS NOT NULL AND v_sla_vs_gl_diff < 0.01 THEN 'Y' ELSE 'N' END;
            v_fully_balanced := CASE WHEN v_ap_matches_sla = 'Y' AND v_sla_matches_gl = 'Y' THEN 'Y' ELSE 'N' END;

            -- Accumulators
            v_total_rows      := v_total_rows     + 1;
            v_sum_ap_dr       := v_sum_ap_dr      + NVL(v_ap_amount,      0);
            v_sum_sla_dr      := v_sum_sla_dr     + NVL(v_sla_entered_dr, 0);
            v_sum_gl_dr       := v_sum_gl_dr      + NVL(v_gl_entered_dr,  0);
            v_sum_ap_sla_diff := v_sum_ap_sla_diff + v_ap_vs_sla_diff;
            v_sum_sla_gl_diff := v_sum_sla_gl_diff + v_sla_vs_gl_diff;

            v_result := v_result || v_sep || '{'  ||
                -- SLA header
                '"slaHeaderId":'       || jnum(v_sla_header_id)   ||
                ',"moduleName":'       || jstr(v_module_name)      ||
                ',"sourceTable":'      || jstr(v_source_table)     ||
                ',"sourceId":'         || jnum(v_source_id)        ||
                ',"sourceNumber":'     || jstr(v_source_number)    ||
                ',"sourceType":'       || jstr(v_source_type)      ||
                ',"eventTypeCode":'    || jstr(v_event_type_code)  ||
                ',"accountingDate":'   || jstr(v_accounting_date)  ||
                ',"periodName":'       || jstr(v_period_name)      ||
                ',"businessUnit":'     || jstr(v_business_unit)    ||
                ',"ledgerName":'       || jstr(v_ledger_name)      ||
                ',"currencyCode":'     || jstr(v_currency_code)    ||
                ',"accountingStatus":' || jstr(v_acct_status)      ||
                ',"postingStatus":'    || jstr(v_posting_status)   ||
                ',"glBatchId":'        || jnum(v_gl_batch_id)      ||
                ',"glBatchName":'      || jstr(v_gl_batch_name)    ||
                ',"glHeaderId":'       || jnum(v_gl_header_id)     ||
                ',"postedDate":'       || jstr(v_posted_date)      ||
                -- SLA amounts
                ',"slaEnteredDr":'     || jnum(v_sla_entered_dr)   ||
                ',"slaEnteredCr":'     || jnum(v_sla_entered_cr)   ||
                ',"slaAccountedDr":'   || jnum(v_sla_accounted_dr) ||
                ',"slaAccountedCr":'   || jnum(v_sla_accounted_cr) ||
                ',"slaLineCount":'     || jnum(v_sla_line_count)   ||
                -- GL amounts
                ',"glJournalName":'    || jstr(v_gl_journal_name)  ||
                ',"glPeriodName":'     || jstr(v_gl_period)        ||
                ',"glCategory":'       || jstr(v_gl_category)      ||
                ',"glSource":'         || jstr(v_gl_source)        ||
                ',"glBatchStatus":'    || jstr(v_gl_batch_status)  ||
                ',"glEnteredDr":'      || jnum(v_gl_entered_dr)    ||
                ',"glEnteredCr":'      || jnum(v_gl_entered_cr)    ||
                ',"glAccountedDr":'    || jnum(v_gl_accounted_dr)  ||
                ',"glAccountedCr":'    || jnum(v_gl_accounted_cr)  ||
                ',"glLineCount":'      || jnum(v_gl_line_count)    ||
                -- AP transaction
                ',"apAmount":'         || jnum(v_ap_amount)        ||
                ',"apNumber":'         || jstr(v_ap_number)        ||
                ',"apDate":'           || jstr(v_ap_date)          ||
                ',"apStatus":'         || jstr(v_ap_status)        ||
                ',"apSupplier":'       || jstr(v_ap_supplier)      ||
                -- Three-way balance
                ',"apVsSlaDiff":'      || jnum(v_ap_vs_sla_diff)   ||
                ',"slaVsGlDiff":'      || jnum(v_sla_vs_gl_diff)   ||
                ',"apMatchesSla":'     || jbool(v_ap_matches_sla)  ||
                ',"slaMatchesGl":'     || jbool(v_sla_matches_gl)  ||
                ',"isFullyBalanced":'  || jbool(v_fully_balanced)  ||
                '}';
            v_sep := ',';
        END LOOP;
        CLOSE v_cur;

        -- ── Summary ───────────────────────────────────────────────────────────
        v_result := REPLACE(
            v_result,
            '"summary":null',
            '"summary":{'                                                    ||
                '"totalRows":'        || jnum(v_total_rows)                 ||
                ',"apTotalDr":'       || jnum(v_sum_ap_dr)                  ||
                ',"slaTotalDr":'      || jnum(v_sum_sla_dr)                 ||
                ',"glTotalDr":'       || jnum(v_sum_gl_dr)                  ||
                ',"apVsSlaDiff":'     || jnum(v_sum_ap_sla_diff)            ||
                ',"slaVsGlDiff":'     || jnum(v_sum_sla_gl_diff)            ||
                ',"isFullyBalanced":' || jbool(CASE WHEN v_sum_ap_sla_diff < 0.01
                                                     AND v_sum_sla_gl_diff < 0.01
                                                    THEN 'Y' ELSE 'N' END)  ||
                '}'
        );

        RETURN v_result || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            IF v_cur%ISOPEN THEN CLOSE v_cur; END IF;
            RETURN '{"error":true,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_recon;

END RR_AP_RECON_PKG;
/
