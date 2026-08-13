-- =============================================================================
-- Patch 85 – Bank transfer: use only the AED GL journal
-- =============================================================================
-- Oracle creates two GL journals per bank transfer (one per leg / currency).
-- For reconciliation we want only the AED-denominated journal.
-- Fix: in every GL scalar subquery add
--   AND (ap.SOURCE_TABLE <> 'RR_BANK_ACCOUNT_TRANSFERS'
--        OR NVL(gh2.CURRENCY_CODE,'AED') = 'AED')
-- GL_COUNT and GL_HEADER_ID previously skipped the gh2 join — they now
-- include it so the currency filter can be applied consistently.
-- =============================================================================


CREATE OR REPLACE PACKAGE BODY RR_AP_RECON_PKG AS

    FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"'); END;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"'||esc(p)||'"' END; END;

    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null'
                    ELSE TRIM(TRAILING '.' FROM TO_CHAR(p,'FM999999999999990.9999'))
               END;
    END;

    FUNCTION jbool(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN CASE WHEN UPPER(p) IN ('Y','YES','TRUE','1') THEN 'true' ELSE 'false' END; END;

    FUNCTION get_recon(
        p_period_name        VARCHAR2 DEFAULT NULL,
        p_business_unit      VARCHAR2 DEFAULT NULL,
        p_ledger_name        VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT NULL,
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

        -- AP source columns
        v_source_table   VARCHAR2(60);
        v_source_id      NUMBER;
        v_ap_number      VARCHAR2(100);
        v_ap_amount      NUMBER;
        v_ap_date        VARCHAR2(20);
        v_ap_status      VARCHAR2(80);
        v_ap_supplier    VARCHAR2(360);
        v_business_unit  VARCHAR2(100);
        v_ap_currency    VARCHAR2(15);

        -- SLA aggregates
        v_sla_count      NUMBER;
        v_sla_status     VARCHAR2(20);
        v_sla_period     VARCHAR2(15);
        v_ledger_name    VARCHAR2(100);
        v_sla_currency   VARCHAR2(15);
        v_sla_entered_dr NUMBER;
        v_sla_entered_cr NUMBER;
        v_sla_line_count NUMBER;

        -- GL via scalar subqueries
        v_gl_count        NUMBER;
        v_gl_header_id    NUMBER;
        v_gl_journal      VARCHAR2(240);
        v_gl_batch_status VARCHAR2(30);
        v_gl_entered_dr   NUMBER;
        v_gl_entered_cr   NUMBER;
        v_gl_dr_account   VARCHAR2(100);
        v_gl_cr_account   VARCHAR2(100);

        -- Three-way derived
        v_ap_vs_sla_diff NUMBER;
        v_sla_vs_gl_diff NUMBER;
        v_ap_matches_sla VARCHAR2(1);
        v_sla_matches_gl VARCHAR2(1);
        v_fully_balanced VARCHAR2(1);
        v_sla_exists     VARCHAR2(1);
        v_gl_exists      VARCHAR2(1);

        -- Summary accumulators
        v_sum_ap_dr       NUMBER := 0;
        v_sum_sla_dr      NUMBER := 0;
        v_sum_gl_dr       NUMBER := 0;
        v_sum_ap_sla_diff NUMBER := 0;
        v_sum_sla_gl_diff NUMBER := 0;
        v_total_rows      NUMBER := 0;
        v_no_sla_count    NUMBER := 0;
        v_no_gl_count     NUMBER := 0;

        -- WHERE / HAVING
        v_where  VARCHAR2(4000) := ' WHERE 1=1';
        v_having VARCHAR2(4000) := '';

        -- Reusable fragments (set once, referenced 9 times)
        --   v_src_match_sh  : SLA LEFT JOIN  (alias sh)
        --   v_src_match_sh2 : scalar subqueries (alias sh2)
        --   v_bt_ccy        : bank-transfer AED currency filter on gh2
        v_src_match_sh  VARCHAR2(300);
        v_src_match_sh2 VARCHAR2(300);
        v_bt_ccy        VARCHAR2(200);   -- applied wherever gh2 is joined

    BEGIN

        -- Exact match for AP_INVOICES / AP_PAYMENTS; LIKE for bank transfers
        -- (Oracle CE module stores a different source_table name in SLA)
        v_src_match_sh  :=
            '(sh.SOURCE_TABLE = ap.SOURCE_TABLE' ||
            ' OR (ap.SOURCE_TABLE = ''RR_BANK_ACCOUNT_TRANSFERS''' ||
            ' AND UPPER(sh.SOURCE_TABLE) LIKE ''%BANK%TRANSFER%''))';

        v_src_match_sh2 :=
            '(sh2.SOURCE_TABLE = ap.SOURCE_TABLE' ||
            ' OR (ap.SOURCE_TABLE = ''RR_BANK_ACCOUNT_TRANSFERS''' ||
            ' AND UPPER(sh2.SOURCE_TABLE) LIKE ''%BANK%TRANSFER%''))';

        -- For bank transfers Oracle posts two journals (one per transfer leg).
        -- We want only the AED journal; non-bank-transfer rows pass through.
        v_bt_ccy :=
            ' AND (ap.SOURCE_TABLE <> ''RR_BANK_ACCOUNT_TRANSFERS''' ||
            ' OR NVL(gh2.CURRENCY_CODE,''AED'') = ''AED'')';

        -- ── WHERE filters on AP columns ──────────────────────────────────────────
        IF p_business_unit IS NOT NULL THEN
            v_where := v_where || ' AND ap.BUSINESS_UNIT = ''' || p_business_unit || '''';
        END IF;
        IF p_source_table IS NOT NULL THEN
            v_where := v_where || ' AND ap.SOURCE_TABLE = ''' || p_source_table || '''';
        END IF;
        IF p_date_from IS NOT NULL THEN
            v_where := v_where || ' AND ap.AP_DATE >= ''' || p_date_from || '''';
        END IF;
        IF p_date_to IS NOT NULL THEN
            v_where := v_where || ' AND ap.AP_DATE <= ''' || p_date_to || '''';
        END IF;

        -- ── HAVING filters on SLA aggregates ────────────────────────────────────
        IF p_period_name IS NOT NULL THEN
            v_having := ' HAVING MAX(sh.PERIOD_NAME) = ''' || p_period_name || '''';
        END IF;
        IF p_accounting_status IS NOT NULL THEN
            IF v_having IS NULL OR LENGTH(v_having) = 0 THEN
                v_having := ' HAVING MAX(sh.ACCOUNTING_STATUS) = ''' || p_accounting_status || '''';
            ELSE
                v_having := v_having || ' AND MAX(sh.ACCOUNTING_STATUS) = ''' || p_accounting_status || '''';
            END IF;
        END IF;
        IF p_ledger_name IS NOT NULL THEN
            IF v_having IS NULL OR LENGTH(v_having) = 0 THEN
                v_having := ' HAVING MAX(sh.LEDGER_NAME) = ''' || p_ledger_name || '''';
            ELSE
                v_having := v_having || ' AND MAX(sh.LEDGER_NAME) = ''' || p_ledger_name || '''';
            END IF;
        END IF;

        -- ── Main query ───────────────────────────────────────────────────────────
        v_sql :=
            'SELECT' ||
            '  ap.SOURCE_TABLE,' ||
            '  ap.SOURCE_ID,' ||
            '  ap.AP_NUMBER,' ||
            '  ap.AP_AMOUNT,' ||
            '  ap.AP_DATE,' ||
            '  ap.AP_STATUS,' ||
            '  ap.AP_SUPPLIER,' ||
            '  ap.BUSINESS_UNIT,' ||
            '  ap.AP_CURRENCY,' ||
            -- SLA aggregates (LEFT JOIN — may be 0 for unposted transactions)
            '  COUNT(DISTINCT sh.HEADER_ID)                                                          SLA_COUNT,' ||
            '  MAX(sh.ACCOUNTING_STATUS)                                                              SLA_STATUS,' ||
            '  MAX(sh.PERIOD_NAME)                                                                    SLA_PERIOD_NAME,' ||
            '  MAX(sh.LEDGER_NAME)                                                                    LEDGER_NAME,' ||
            '  MAX(sh.CURRENCY_CODE)                                                                  SLA_CURRENCY,' ||
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''DR'' THEN NVL(sl.ENTERED_DR,0) ELSE 0 END),0)       SLA_ENTERED_DR,' ||
            '  NVL(SUM(CASE WHEN sl.LINE_TYPE=''CR'' THEN NVL(sl.ENTERED_CR,0) ELSE 0 END),0)       SLA_ENTERED_CR,' ||
            '  COUNT(sl.LINE_ID)                                                                      SLA_LINE_COUNT,' ||

            -- ── GL scalar subqueries ─────────────────────────────────────────────
            -- GL_COUNT: now joins gh2 so we can apply the AED currency filter
            '  (SELECT COUNT(DISTINCT sh2.GL_HEADER_ID)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || ')                                                                            GL_COUNT,' ||

            -- GL_HEADER_ID: same join + AED filter for bank transfers
            '  (SELECT MAX(sh2.GL_HEADER_ID)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || ')                                                                            GL_HEADER_ID,' ||

            -- GL_JOURNAL_NAME
            '  (SELECT MAX(gh2.JOURNAL_NAME)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || ')                                                                            GL_JOURNAL_NAME,' ||

            -- GL_BATCH_STATUS
            '  (SELECT MAX(gb2.STATUS)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '     JOIN RR_GL_JOURNAL_BATCHES gb2 ON gb2.JE_BATCH_ID = gh2.BATCH_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || ')                                                                            GL_BATCH_STATUS,' ||

            -- GL_ENTERED_DR
            '  NVL((SELECT SUM(NVL(gh2.RUNNING_TOTAL_DR,0))' ||
            '         FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '         JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '        WHERE ' || v_src_match_sh2 ||
            '          AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || '),0)                                                                         GL_ENTERED_DR,' ||

            -- GL_ENTERED_CR
            '  NVL((SELECT SUM(NVL(gh2.RUNNING_TOTAL_CR,0))' ||
            '         FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '         JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '        WHERE ' || v_src_match_sh2 ||
            '          AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            v_bt_ccy || '),0)                                                                         GL_ENTERED_CR,' ||

            -- GL_DR_ACCOUNT
            '  (SELECT MIN(l2.ACCOUNT_COMBINATION)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '     JOIN RR_GL_JE_LINES_ALL l2 ON l2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            '      AND NVL(l2.ENTERED_DR,0) > 0' ||
            v_bt_ccy || ')                                                                            GL_DR_ACCOUNT,' ||

            -- GL_CR_ACCOUNT
            '  (SELECT MIN(l2.ACCOUNT_COMBINATION)' ||
            '     FROM RR_SLA_ACCOUNTING_HEADERS sh2' ||
            '     JOIN RR_GL_JE_HEADERS gh2 ON gh2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '     JOIN RR_GL_JE_LINES_ALL l2 ON l2.JE_HEADER_ID = sh2.GL_HEADER_ID' ||
            '    WHERE ' || v_src_match_sh2 ||
            '      AND sh2.SOURCE_ID = ap.SOURCE_ID' ||
            '      AND NVL(l2.ENTERED_CR,0) > 0' ||
            v_bt_ccy || ')                                                                            GL_CR_ACCOUNT' ||

            ' FROM (' ||
            -- AP Invoices
            '  SELECT ''AP_INVOICES'' SOURCE_TABLE, i.INVOICE_ID SOURCE_ID,' ||
            '         i.INVOICE_NUMBER AP_NUMBER,' ||
            '         i.INVOICE_AMOUNT AP_AMOUNT,' ||
            '         TO_CHAR(i.INVOICE_DATE,''YYYY-MM-DD'') AP_DATE,' ||
            '         i.VALIDATION_STATUS AP_STATUS,' ||
            '         i.SUPPLIER          AP_SUPPLIER,' ||
            '         i.BUSINESS_UNIT,' ||
            '         i.INVOICE_CURRENCY  AP_CURRENCY' ||
            '  FROM RR_AP_INVOICES_ALL i' ||
            '  UNION ALL' ||
            -- AP Payments
            '  SELECT ''AP_PAYMENTS'', p.CHECK_ID,' ||
            '         p.PAYMENT_NUMBER,' ||
            '         p.PAYMENT_AMOUNT,' ||
            '         TO_CHAR(p.PAYMENT_DATE,''YYYY-MM-DD''),' ||
            '         p.PAYMENT_STATUS,' ||
            '         p.THIRD_PARTY_SUPPLIER,' ||
            '         p.BUSINESS_UNIT,' ||
            '         p.PAYMENT_CURRENCY' ||
            '  FROM RR_AP_PAYMENTS_ALL p' ||
            '  UNION ALL' ||
            -- Bank Transfers
            '  SELECT ''RR_BANK_ACCOUNT_TRANSFERS'', bt.BANK_ACCOUNT_TRANSFER_ID,' ||
            '         TO_CHAR(bt.BANK_ACCOUNT_TRANSFER_NUMBER),' ||
            '         bt.PAYMENT_AMOUNT,' ||
            '         TO_CHAR(bt.TRANSACTION_DATE,''YYYY-MM-DD''),' ||
            '         bt.STATUS,' ||
            '         bt.MEMO,' ||
            '         bt.BUSINESS_UNIT,' ||
            '         bt.FROM_CURRENCY_CODE' ||
            '  FROM RR_BANK_ACCOUNT_TRANSFERS bt' ||
            ') ap' ||

            -- SLA LEFT JOIN: exact for invoices/payments, LIKE for bank transfers
            ' LEFT JOIN RR_SLA_ACCOUNTING_HEADERS sh' ||
            '        ON sh.SOURCE_ID = ap.SOURCE_ID' ||
            '       AND ' || v_src_match_sh ||

            ' LEFT JOIN RR_SLA_ACCOUNTING_LINES sl ON sl.HEADER_ID = sh.HEADER_ID' ||

            v_where ||

            ' GROUP BY ap.SOURCE_TABLE, ap.SOURCE_ID, ap.AP_NUMBER, ap.AP_AMOUNT,' ||
            '          ap.AP_DATE, ap.AP_STATUS, ap.AP_SUPPLIER, ap.BUSINESS_UNIT, ap.AP_CURRENCY' ||

            v_having ||

            ' ORDER BY ap.AP_DATE DESC NULLS LAST, ap.SOURCE_ID DESC' ||
            ' OFFSET ' || NVL(p_offset,0) || ' ROWS FETCH NEXT ' || NVL(p_limit,500) || ' ROWS ONLY';

        v_result := '{"summary":null,"items":[';

        OPEN v_cur FOR v_sql;
        LOOP
            FETCH v_cur INTO
                v_source_table, v_source_id, v_ap_number, v_ap_amount,
                v_ap_date, v_ap_status, v_ap_supplier, v_business_unit, v_ap_currency,
                v_sla_count, v_sla_status, v_sla_period, v_ledger_name, v_sla_currency,
                v_sla_entered_dr, v_sla_entered_cr, v_sla_line_count,
                v_gl_count, v_gl_header_id, v_gl_journal, v_gl_batch_status,
                v_gl_entered_dr, v_gl_entered_cr, v_gl_dr_account, v_gl_cr_account;
            EXIT WHEN v_cur%NOTFOUND;

            v_sla_exists     := CASE WHEN NVL(v_sla_count,0) > 0 THEN 'Y' ELSE 'N' END;
            v_gl_exists      := CASE WHEN NVL(v_gl_count,0)  > 0 THEN 'Y' ELSE 'N' END;

            v_ap_vs_sla_diff := ABS(NVL(v_ap_amount,0) - NVL(v_sla_entered_dr,0));
            v_sla_vs_gl_diff := ABS(NVL(v_sla_entered_dr,0) - NVL(v_gl_entered_dr,0));

            v_ap_matches_sla := CASE WHEN v_sla_exists='Y' AND v_ap_vs_sla_diff < 0.01 THEN 'Y' ELSE 'N' END;
            v_sla_matches_gl := CASE WHEN v_sla_exists='Y' AND v_gl_exists='Y' AND v_sla_vs_gl_diff < 0.01 THEN 'Y' ELSE 'N' END;
            v_fully_balanced := CASE WHEN v_ap_matches_sla='Y' AND v_sla_matches_gl='Y' THEN 'Y' ELSE 'N' END;

            v_total_rows      := v_total_rows      + 1;
            v_sum_ap_dr       := v_sum_ap_dr       + NVL(v_ap_amount,0);
            v_sum_sla_dr      := v_sum_sla_dr      + NVL(v_sla_entered_dr,0);
            v_sum_gl_dr       := v_sum_gl_dr       + NVL(v_gl_entered_dr,0);
            v_sum_ap_sla_diff := v_sum_ap_sla_diff + v_ap_vs_sla_diff;
            v_sum_sla_gl_diff := v_sum_sla_gl_diff + v_sla_vs_gl_diff;
            IF v_sla_exists = 'N' THEN v_no_sla_count := v_no_sla_count + 1; END IF;
            IF v_gl_exists  = 'N' THEN v_no_gl_count  := v_no_gl_count  + 1; END IF;

            v_result := v_result || v_sep || '{' ||
                '"sourceTable":'      || jstr(v_source_table)      ||
                ',"sourceId":'        || jnum(v_source_id)          ||
                ',"apNumber":'        || jstr(v_ap_number)          ||
                ',"apAmount":'        || jnum(v_ap_amount)          ||
                ',"apDate":'          || jstr(v_ap_date)            ||
                ',"apStatus":'        || jstr(v_ap_status)          ||
                ',"apSupplier":'      || jstr(v_ap_supplier)        ||
                ',"businessUnit":'    || jstr(v_business_unit)      ||
                ',"apCurrency":'      || jstr(v_ap_currency)        ||
                ',"slaCount":'        || jnum(v_sla_count)          ||
                ',"slaExists":'       || jbool(v_sla_exists)        ||
                ',"slaStatus":'       || jstr(v_sla_status)         ||
                ',"slaPeriodName":'   || jstr(v_sla_period)         ||
                ',"ledgerName":'      || jstr(v_ledger_name)        ||
                ',"slaCurrency":'     || jstr(v_sla_currency)       ||
                ',"slaEnteredDr":'    || jnum(v_sla_entered_dr)     ||
                ',"slaEnteredCr":'    || jnum(v_sla_entered_cr)     ||
                ',"slaLineCount":'    || jnum(v_sla_line_count)     ||
                ',"glCount":'         || jnum(v_gl_count)           ||
                ',"glExists":'        || jbool(v_gl_exists)         ||
                ',"glHeaderId":'      || jnum(v_gl_header_id)       ||
                ',"glJournalName":'   || jstr(v_gl_journal)         ||
                ',"glBatchStatus":'   || jstr(v_gl_batch_status)    ||
                ',"glEnteredDr":'     || jnum(v_gl_entered_dr)      ||
                ',"glEnteredCr":'     || jnum(v_gl_entered_cr)      ||
                ',"glDrAccount":'     || jstr(v_gl_dr_account)      ||
                ',"glCrAccount":'     || jstr(v_gl_cr_account)      ||
                ',"apVsSlaDiff":'     || jnum(v_ap_vs_sla_diff)     ||
                ',"slaVsGlDiff":'     || jnum(v_sla_vs_gl_diff)     ||
                ',"apMatchesSla":'    || jbool(v_ap_matches_sla)    ||
                ',"slaMatchesGl":'    || jbool(v_sla_matches_gl)    ||
                ',"isFullyBalanced":' || jbool(v_fully_balanced)    ||
                '}';
            v_sep := ',';
        END LOOP;
        CLOSE v_cur;

        v_result := REPLACE(v_result, '"summary":null',
            '"summary":{'                                                            ||
                '"totalRows":'        || jnum(v_total_rows)                         ||
                ',"apTotalDr":'       || jnum(v_sum_ap_dr)                          ||
                ',"slaTotalDr":'      || jnum(v_sum_sla_dr)                         ||
                ',"glTotalDr":'       || jnum(v_sum_gl_dr)                          ||
                ',"apVsSlaDiff":'     || jnum(v_sum_ap_sla_diff)                    ||
                ',"slaVsGlDiff":'     || jnum(v_sum_sla_gl_diff)                    ||
                ',"noSlaCount":'      || jnum(v_no_sla_count)                       ||
                ',"noGlCount":'       || jnum(v_no_gl_count)                        ||
                ',"isFullyBalanced":' || jbool(CASE WHEN v_sum_ap_sla_diff < 0.01
                                                     AND v_sum_sla_gl_diff < 0.01
                                                     AND v_no_sla_count = 0
                                                     AND v_no_gl_count  = 0
                                                    THEN 'Y' ELSE 'N' END)          ||
                '}'
        );

        RETURN v_result || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            IF v_cur%ISOPEN THEN CLOSE v_cur; END IF;
            RETURN '{"error":true,"message":"'||REPLACE(SQLERRM,'"','\"')||'"}';
    END get_recon;

END RR_AP_RECON_PKG;
/
