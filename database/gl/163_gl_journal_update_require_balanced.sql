-- ============================================================
-- 163_gl_journal_update_require_balanced.sql
-- RR_UPDATE_JOURNALS (PUT /journals/update/:batchId) — after replacing the
-- lines, checks accounted debits = credits for the batch BEFORE commit.
-- Unbalanced → ORA-20901 with the totals; the whole update (header, batch,
-- deleted + re-inserted lines) is rolled back, so the journal stays as it was.
-- Foreign-currency journals off by <= 0.01 per line (per-line rounding) get
-- the difference absorbed into the largest line, like 162 does on create.
--
-- Base: 86_fix_manual_batch_name.sql block 2 (identical otherwise).
-- Companion of 162_gl_journals_require_balanced.sql (create).
-- ============================================================

CREATE OR REPLACE PROCEDURE RR_UPDATE_JOURNALS (
    p_json           IN  CLOB,
    p_batch_id       IN  NUMBER,
    p_je_header_id   OUT NUMBER,
    p_lines_replaced OUT NUMBER,
    p_batch_name     OUT VARCHAR2,
    p_step           OUT VARCHAR2,
    p_message        OUT VARCHAR2
) AS
    v_root          JSON_OBJECT_T;
    v_batch_obj     JSON_OBJECT_T;
    v_header_obj    JSON_OBJECT_T;
    v_lines_arr     JSON_ARRAY_T;
    v_line_obj      JSON_OBJECT_T;

    -- Batch fields  (BATCH_NAME intentionally excluded from UPDATE)
    v_batch_desc    VARCHAR2(4000);
    v_ledger_name   VARCHAR2(100);
    v_ledger_id     VARCHAR2(100);
    v_period_name   VARCHAR2(50);
    v_ctrl_total    NUMBER;
    v_batch_status  VARCHAR2(50);
    v_batch_source  VARCHAR2(100);
    v_updated_by    VARCHAR2(100);

    -- Header fields  (JOURNAL_NAME intentionally excluded from UPDATE)
    v_journal_desc  VARCHAR2(4000);
    v_hdr_period    VARCHAR2(15);
    v_currency      VARCHAR2(15);
    v_je_category   VARCHAR2(80);
    v_je_source     VARCHAR2(100);
    v_eff_date      DATE;
    v_conv_date     DATE;
    v_total_dr      NUMBER;
    v_total_cr      NUMBER;
    v_conv_rate     NUMBER;
    v_ledger_id_num NUMBER;

    -- Line vars
    v_line_num      NUMBER := 0;
    v_ent_dr        NUMBER;
    v_ent_cr        NUMBER;
    v_acc_dr        NUMBER;
    v_acc_cr        NUMBER;
    v_eff_rate      NUMBER;

    -- Debit = credit check
    v_chk_dr        NUMBER;
    v_chk_cr        NUMBER;
    v_chk_fx        NUMBER;
    v_chk_diff      NUMBER;
    v_adj_line      NUMBER;
    v_adj_side      VARCHAR2(2);
    v_l_stat_amt    NUMBER;
    v_l_desc        VARCHAR2(4000);
    v_l_currency    VARCHAR2(15);
    v_l_conv_date   DATE;
    v_l_conv_type   VARCHAR2(30);
    v_l_account     VARCHAR2(250);
    v_l_coa         VARCHAR2(240);
    v_l_recon       VARCHAR2(1);
    v_l_created_by  VARCHAR2(100);
    v_l_ref1        VARCHAR2(240);
    v_l_ref2        VARCHAR2(240);
    v_l_ref3        VARCHAR2(240);
    v_l_ref4        VARCHAR2(240);
    v_l_ref5        VARCHAR2(240);
    v_l_ref6        VARCHAR2(240);
    v_l_ref7        VARCHAR2(240);
    v_l_ref8        VARCHAR2(240);
    v_l_ref9        VARCHAR2(240);
    v_l_ref10       VARCHAR2(240);

    -- ── JSON helpers ─────────────────────────────────────────────────────────
    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767);
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN
            RETURN NULL;
        END IF;
        v := p_obj.get_string(p_key);
        RETURN CASE WHEN v = '' THEN NULL ELSE v END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION snum(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN
            RETURN NULL;
        END IF;
        RETURN p_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION sdate(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN DATE IS
        l_s VARCHAR2(100);
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN
            RETURN NULL;
        END IF;
        l_s := p_obj.get_string(p_key);
        RETURN CASE WHEN l_s IS NOT NULL
                    THEN TO_DATE(SUBSTR(l_s, 1, 10), 'YYYY-MM-DD')
                    ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

BEGIN
    p_lines_replaced := 0;
    p_je_header_id   := NULL;

    p_step       := 'Parsing JSON';
    v_root       := JSON_OBJECT_T.parse(p_json);
    v_batch_obj  := v_root.get_object('batch');
    v_header_obj := v_root.get_object('header');
    v_lines_arr  := v_root.get_array('lines');

    p_step        := 'Reading batch fields';
    v_batch_desc  := sstr(v_batch_obj, 'batchDescription');
    v_ledger_name := sstr(v_batch_obj, 'ledgerName');
    v_ledger_id   := sstr(v_batch_obj, 'ledgerId');
    v_period_name := sstr(v_batch_obj, 'accountingPeriod');
    v_ctrl_total  := NVL(snum(v_batch_obj, 'controlTotal'), 0);
    v_batch_status:= NVL(sstr(v_batch_obj, 'status'), 'Unposted');
    v_batch_source:= NVL(sstr(v_batch_obj, 'batchSource'), 'Manual');
    v_updated_by  := NVL(sstr(v_batch_obj, 'createdBy'), 'ERP_USER');

    p_step         := 'Reading header fields';
    v_journal_desc := sstr(v_header_obj, 'description');
    v_hdr_period   := NVL(sstr(v_header_obj, 'periodName'), v_period_name);
    v_currency     := NVL(sstr(v_header_obj, 'currencyCode'), 'AED');
    v_je_category  := NVL(sstr(v_header_obj, 'jeCategory'), 'Manual');
    v_je_source    := NVL(sstr(v_header_obj, 'jeSource'), 'Manual');
    v_eff_date     := NVL(sdate(v_header_obj, 'defaultEffectiveDate'),
                      NVL(sdate(v_header_obj, 'currencyConversionDate'), SYSDATE));
    v_conv_date    := NVL(sdate(v_header_obj, 'currencyConversionDate'), v_eff_date);
    v_total_dr     := NVL(snum(v_header_obj, 'runningTotalDr'), 0);
    v_total_cr     := NVL(snum(v_header_obj, 'runningTotalCr'), 0);
    v_conv_rate    := NVL(snum(v_header_obj, 'currencyConversionRate'), 1);
    IF v_conv_rate <= 0 THEN v_conv_rate := 1; END IF;
    v_ledger_id_num:= snum(v_header_obj, 'ledgerId');

    -- Return the existing (unchanged) batch name in the OUT param
    SELECT BATCH_NAME INTO p_batch_name
    FROM   RR_GL_JOURNAL_BATCHES
    WHERE  JE_BATCH_ID = p_batch_id
    AND    ROWNUM = 1;

    -- ── UPDATE RR_GL_JOURNAL_BATCHES — BATCH_NAME intentionally excluded ──────
    p_step := 'Updating batch';
    UPDATE RR_GL_JOURNAL_BATCHES SET
        BATCH_DESCRIPTION       = v_batch_desc,
        DEFAULT_PERIOD_NAME     = NVL(v_period_name,  DEFAULT_PERIOD_NAME),
        STATUS                  = NVL(v_batch_status, STATUS),
        STATUS_MEANING          = CASE NVL(v_batch_status, STATUS)
                                    WHEN 'P'        THEN 'Posted'
                                    WHEN 'Posted'   THEN 'Posted'
                                    WHEN 'Unposted' THEN 'Unposted'
                                    WHEN 'NEW'      THEN 'Unposted'
                                    ELSE NVL(v_batch_status, STATUS)
                                  END,
        CONTROL_TOTAL           = v_ctrl_total,
        RUNNING_TOTAL_DR        = v_total_dr,
        RUNNING_TOTAL_CR        = v_total_cr,
        RUNNING_TOTAL_ACCT_DR   = ROUND(v_total_dr * v_conv_rate, 2),
        RUNNING_TOTAL_ACCT_CR   = ROUND(v_total_cr * v_conv_rate, 2),
        USER_JE_SOURCE_NAME     = NVL(v_batch_source, USER_JE_SOURCE_NAME),
        LEDGER_NAME             = NVL(v_ledger_name,  LEDGER_NAME),
        LEDGER_ID               = NVL(v_ledger_id,    LEDGER_ID),
        LAST_UPDATED_BY         = v_updated_by,
        LAST_UPDATE_DATE        = SYSTIMESTAMP
    WHERE JE_BATCH_ID = p_batch_id;

    IF SQL%ROWCOUNT = 0 THEN
        p_step    := 'Batch not found';
        p_message := 'No batch found with JE_BATCH_ID = ' || p_batch_id;
        RETURN;
    END IF;

    -- ── UPDATE RR_GL_JE_HEADERS — JOURNAL_NAME intentionally excluded ─────────
    p_step := 'Updating header';
    UPDATE RR_GL_JE_HEADERS SET
        JOURNAL_DESCRIPTION         = v_journal_desc,
        PERIOD_NAME                 = NVL(v_hdr_period,   PERIOD_NAME),
        CURRENCY_CODE               = NVL(v_currency,     CURRENCY_CODE),
        USER_JE_CATEGORY_NAME       = NVL(v_je_category,  USER_JE_CATEGORY_NAME),
        USER_JE_SOURCE_NAME         = NVL(v_je_source,    USER_JE_SOURCE_NAME),
        DEFAULT_EFFECTIVE_DATE      = NVL(v_eff_date,     DEFAULT_EFFECTIVE_DATE),
        CURRENCY_CONVERSION_DATE    = v_conv_date,
        CURRENCY_CONVERSION_RATE    = v_conv_rate,
        RUNNING_TOTAL_DR            = v_total_dr,
        RUNNING_TOTAL_CR            = v_total_cr,
        POSTING_STATUS              = NVL(v_batch_status, POSTING_STATUS),
        LAST_UPDATED_BY             = v_updated_by,
        LAST_UPDATE_DATE            = SYSTIMESTAMP
    WHERE BATCH_ID = p_batch_id
    RETURNING JE_HEADER_ID INTO p_je_header_id;

    IF SQL%ROWCOUNT = 0 THEN
        -- No header yet — insert one (fallback for batches without a header row)
        SELECT NVL(MAX(JE_HEADER_ID), 500000000) + 1
        INTO   p_je_header_id
        FROM   RR_GL_JE_HEADERS;

        INSERT INTO RR_GL_JE_HEADERS (
            JE_HEADER_ID, BATCH_ID,
            PERIOD_NAME, JOURNAL_NAME, JOURNAL_DESCRIPTION,
            CURRENCY_CODE, USER_JE_CATEGORY_NAME, USER_JE_SOURCE_NAME,
            DEFAULT_EFFECTIVE_DATE, CURRENCY_CONVERSION_DATE,
            CURRENCY_CONVERSION_RATE, POSTING_STATUS,
            RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            p_je_header_id, p_batch_id,
            v_hdr_period, p_batch_name, v_journal_desc,
            v_currency, v_je_category, v_je_source,
            v_eff_date, v_conv_date,
            v_conv_rate, v_batch_status,
            v_total_dr, v_total_cr,
            v_updated_by, SYSDATE, v_updated_by, SYSDATE
        );
    END IF;

    -- ── DELETE + re-INSERT lines ──────────────────────────────────────────────
    p_step := 'Replacing lines';
    DELETE FROM RR_GL_JE_LINES_ALL WHERE BATCH_ID = p_batch_id;

    FOR i IN 0 .. v_lines_arr.get_size() - 1 LOOP
        v_line_obj   := JSON_OBJECT_T(v_lines_arr.get(i));
        v_line_num   := v_line_num + 1;

        v_ent_dr       := NVL(snum(v_line_obj, 'enteredDr'),  0);
        v_ent_cr       := NVL(snum(v_line_obj, 'enteredCr'),  0);
        v_l_stat_amt   := snum(v_line_obj, 'statAmount');
        v_l_desc       := sstr(v_line_obj, 'description');
        v_l_currency   := NVL(sstr(v_line_obj, 'currencyCode'), v_currency);
        v_l_conv_date  := sdate(v_line_obj, 'currencyConversionDate');
        v_l_conv_type  := sstr(v_line_obj, 'userCurrencyConversionType');
        v_l_account    := sstr(v_line_obj, 'accountCombination');
        v_l_coa        := sstr(v_line_obj, 'chartOfAccountsName');
        v_l_recon      := NVL(sstr(v_line_obj, 'reconciledFlag'), 'N');
        v_l_created_by := NVL(sstr(v_line_obj, 'createdBy'), v_updated_by);
        v_l_ref1       := sstr(v_line_obj, 'reference1');
        v_l_ref2       := sstr(v_line_obj, 'reference2');
        v_l_ref3       := sstr(v_line_obj, 'reference3');
        v_l_ref4       := sstr(v_line_obj, 'reference4');
        v_l_ref5       := sstr(v_line_obj, 'reference5');
        v_l_ref6       := sstr(v_line_obj, 'reference6');
        v_l_ref7       := sstr(v_line_obj, 'reference7');
        v_l_ref8       := sstr(v_line_obj, 'reference8');
        v_l_ref9       := sstr(v_line_obj, 'reference9');
        v_l_ref10      := sstr(v_line_obj, 'reference10');

        v_eff_rate := NVL(snum(v_line_obj, 'currencyConversionRate'), v_conv_rate);
        IF v_eff_rate IS NULL OR v_eff_rate <= 0 THEN v_eff_rate := v_conv_rate; END IF;

        v_acc_dr := ROUND(v_ent_dr * v_eff_rate, 2);
        v_acc_cr := ROUND(v_ent_cr * v_eff_rate, 2);

        INSERT INTO RR_GL_JE_LINES_ALL (
            BATCH_ID, JE_HEADER_ID, JE_LINE_NUMBER,
            ENTERED_DR, ENTERED_CR, ACCOUNTED_DR, ACCOUNTED_CR,
            STAT_AMOUNT, DESCRIPTION,
            CURRENCY_CODE, CURRENCY_CONVERSION_DATE,
            CURRENCY_CONVERSION_RATE, USER_CURRENCY_CONVERSION_TYPE,
            ACCOUNT_COMBINATION, CHART_OF_ACCOUNTS_NAME,
            REFERENCE1,  REFERENCE2,  REFERENCE3,  REFERENCE4,  REFERENCE5,
            REFERENCE6,  REFERENCE7,  REFERENCE8,  REFERENCE9,  REFERENCE10,
            RECONCILED_FLAG,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            p_batch_id, p_je_header_id, v_line_num,
            v_ent_dr, v_ent_cr, v_acc_dr, v_acc_cr,
            v_l_stat_amt, v_l_desc,
            v_l_currency, v_l_conv_date,
            v_eff_rate, v_l_conv_type,
            v_l_account, v_l_coa,
            v_l_ref1,  v_l_ref2,  v_l_ref3,  v_l_ref4,  v_l_ref5,
            v_l_ref6,  v_l_ref7,  v_l_ref8,  v_l_ref9,  v_l_ref10,
            v_l_recon,
            v_l_created_by, SYSDATE, v_l_created_by, SYSDATE
        );

        p_lines_replaced := v_line_num;
    END LOOP;

    -- ── Debit = credit on the stored lines; unbalanced → error, all rolled back ──
    p_step := 'Checking debit = credit';
    SELECT NVL(SUM(ACCOUNTED_DR), 0), NVL(SUM(ACCOUNTED_CR), 0),
           NVL(MAX(CASE WHEN NVL(CURRENCY_CONVERSION_RATE, 1) != 1 THEN 1 ELSE 0 END), 0)
    INTO   v_chk_dr, v_chk_cr, v_chk_fx
    FROM   RR_GL_JE_LINES_ALL
    WHERE  BATCH_ID = p_batch_id;
    v_chk_diff := ROUND(v_chk_dr - v_chk_cr, 2);

    IF v_chk_diff != 0 THEN
        IF v_chk_fx = 1 AND ABS(v_chk_diff) <= 0.01 * v_line_num THEN
            -- foreign-currency per-line rounding: absorb into the largest line
            SELECT JE_LINE_NUMBER,
                   CASE WHEN NVL(ACCOUNTED_DR, 0) >= NVL(ACCOUNTED_CR, 0) THEN 'DR' ELSE 'CR' END
            INTO   v_adj_line, v_adj_side
            FROM  (SELECT JE_LINE_NUMBER, ACCOUNTED_DR, ACCOUNTED_CR
                   FROM   RR_GL_JE_LINES_ALL
                   WHERE  BATCH_ID = p_batch_id
                   ORDER  BY GREATEST(NVL(ACCOUNTED_DR, 0), NVL(ACCOUNTED_CR, 0)) DESC)
            WHERE  ROWNUM = 1;
            IF v_adj_side = 'DR' THEN
                UPDATE RR_GL_JE_LINES_ALL SET ACCOUNTED_DR = ACCOUNTED_DR - v_chk_diff
                WHERE  BATCH_ID = p_batch_id AND JE_LINE_NUMBER = v_adj_line;
            ELSE
                UPDATE RR_GL_JE_LINES_ALL SET ACCOUNTED_CR = ACCOUNTED_CR + v_chk_diff
                WHERE  BATCH_ID = p_batch_id AND JE_LINE_NUMBER = v_adj_line;
            END IF;
        ELSE
            RAISE_APPLICATION_ERROR(-20901,
                'Journal not saved: debits ' || TO_CHAR(v_chk_dr, 'FM999G999G999G990D00')
                || ' do not equal credits ' || TO_CHAR(v_chk_cr, 'FM999G999G999G990D00')
                || ' (difference ' || TO_CHAR(v_chk_diff, 'FM999G999G999G990D00')
                || '). The journal was left unchanged.');
        END IF;
    END IF;

    COMMIT;

    p_step    := 'Done';
    p_message := NULL;  -- NULL = success; any non-NULL value signals error to the ORDS handler

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_step    := 'ERROR';
        p_message := SQLERRM;
END RR_UPDATE_JOURNALS;
/

-- Compile check — must return NO rows
SELECT line, position, text FROM user_errors WHERE name = 'RR_UPDATE_JOURNALS' ORDER BY sequence;
