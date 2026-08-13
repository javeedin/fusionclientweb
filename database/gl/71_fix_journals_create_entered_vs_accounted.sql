-- ============================================================
-- PATCH 71: Fix journals/create — compute RUNNING_TOTAL_ACCOUNTED
--           separately from RUNNING_TOTAL (entered)
--
-- Problem:
--   The header INSERT stores the same value for both:
--     RUNNING_TOTAL_DR = v_total_dr  (entered in journal currency)
--     RUNNING_TOTAL_ACCOUNTED_DR = v_total_dr  (WRONG — should be in AED)
--
--   For a USD journal with rate 3.67, if entered = 39.51 USD:
--     RUNNING_TOTAL_DR          should = 39.51  (USD)
--     RUNNING_TOTAL_ACCOUNTED_DR should = 145.00 (AED = 39.51 × 3.67)
--   But both were stored as 145 (aedValue sent from frontend as runningTotalDr).
--
--   After the frontend fix (runningTotalDr = fromAmt/pmtAmt in journal ccy),
--   the backend now receives the entered amount but still uses it for both
--   entered and accounted. Fix: compute accounted = ROUND(entered × rate, 2).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the single BEGIN...END; block below.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'journals/create',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'journals/create',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Create GL journal: nested {batch,header,lines} — entered totals separate from accounted totals',
        p_source         => q'[
DECLARE
    v_body          CLOB := :body_text;
    v_root          JSON_OBJECT_T;
    v_batch_obj     JSON_OBJECT_T;
    v_header_obj    JSON_OBJECT_T;
    v_lines_arr     JSON_ARRAY_T;
    v_line_obj      JSON_OBJECT_T;

    v_je_batch_id   NUMBER;
    v_je_header_id  NUMBER;
    v_line_num      NUMBER := 0;
    v_step          VARCHAR2(200);

    v_batch_name    VARCHAR2(240);
    v_batch_desc    VARCHAR2(4000);
    v_ledger_name   VARCHAR2(240);
    v_ledger_id     NUMBER;
    v_acct_period   VARCHAR2(30);
    v_ctrl_total    NUMBER;
    v_batch_status  VARCHAR2(30);
    v_batch_source  VARCHAR2(240);
    v_created_by    VARCHAR2(240);

    v_header_name   VARCHAR2(240);
    v_header_desc   VARCHAR2(4000);
    v_period_name   VARCHAR2(30);
    v_currency      VARCHAR2(15);
    v_je_category   VARCHAR2(80);
    v_je_source     VARCHAR2(80);
    v_eff_date      DATE;
    v_total_dr      NUMBER;
    v_total_cr      NUMBER;
    v_conv_rate     NUMBER;

    v_ent_dr        NUMBER;
    v_ent_cr        NUMBER;
    v_acc_dr        NUMBER;
    v_acc_cr        NUMBER;
    v_eff_rate      NUMBER;

    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        DECLARE v VARCHAR2(32767) := p_obj.get_string(p_key);
        BEGIN RETURN CASE WHEN v = '' THEN NULL ELSE v END; END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION snum(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION sdate(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN DATE IS
        l_s VARCHAR2(100);
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        l_s := p_obj.get_string(p_key);
        RETURN CASE WHEN l_s IS NOT NULL THEN TO_DATE(SUBSTR(l_s,1,10),'YYYY-MM-DD') ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
BEGIN
    v_step      := 'Parsing JSON';
    v_root      := JSON_OBJECT_T.parse(v_body);
    v_batch_obj := v_root.get_object('batch');
    v_header_obj:= v_root.get_object('header');
    v_lines_arr := v_root.get_array('lines');

    v_step        := 'Reading batch fields';
    v_batch_name  := sstr(v_batch_obj, 'batchName');
    v_batch_desc  := sstr(v_batch_obj, 'batchDescription');
    v_ledger_name := sstr(v_batch_obj, 'ledgerName');
    v_ledger_id   := NVL(snum(v_batch_obj, 'ledgerId'), 1);
    v_acct_period := sstr(v_batch_obj, 'accountingPeriod');
    v_ctrl_total  := NVL(snum(v_batch_obj, 'controlTotal'), 0);
    v_batch_status:= NVL(sstr(v_batch_obj, 'status'), 'NEW');
    v_batch_source:= sstr(v_batch_obj, 'batchSource');
    v_created_by  := NVL(sstr(v_batch_obj, 'createdBy'), 'ERP_USER');

    IF v_ledger_name IS NULL THEN
        :status_code := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('message', 'batch.ledgerName is required');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;
    IF v_batch_name IS NULL THEN
        :status_code := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('message', 'batch.batchName is required');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    v_step        := 'Reading header fields';
    v_header_name := NVL(sstr(v_header_obj, 'journalName'), v_batch_name);
    v_header_desc := sstr(v_header_obj, 'description');
    v_period_name := NVL(sstr(v_header_obj, 'periodName'), v_acct_period);
    v_currency    := NVL(sstr(v_header_obj, 'currencyCode'), 'AED');
    v_je_category := NVL(sstr(v_header_obj, 'jeCategory'), 'Cash Management');
    v_je_source   := NVL(sstr(v_header_obj, 'jeSource'),   'Cash Management');
    v_eff_date    := NVL(NVL(sdate(v_header_obj, 'currencyConversionDate'),
                             sdate(v_header_obj, 'defaultEffectiveDate')), SYSDATE);
    v_total_dr    := NVL(snum(v_header_obj, 'runningTotalDr'), 0);
    v_total_cr    := NVL(snum(v_header_obj, 'runningTotalCr'), 0);
    v_conv_rate   := NVL(snum(v_header_obj, 'currencyConversionRate'), 1);
    IF v_conv_rate <= 0 THEN v_conv_rate := 1; END IF;

    v_step := 'Inserting batch';
    INSERT INTO RR_GL_JOURNAL_BATCHES (
        BATCH_NAME, BATCH_DESCRIPTION, LEDGER_NAME, LEDGER_ID,
        ACCOUNTING_PERIOD, CONTROL_TOTAL, STATUS, STATUS_MEANING,
        RUNNING_TOTAL_DR, RUNNING_TOTAL_CR, USER_JE_SOURCE_NAME, CREATED_BY
    ) VALUES (
        v_batch_name, v_batch_desc, v_ledger_name, v_ledger_id,
        v_acct_period, v_ctrl_total, v_batch_status,
        CASE v_batch_status WHEN 'P' THEN 'Posted' WHEN 'NEW' THEN 'Unposted' ELSE v_batch_status END,
        v_total_dr, v_total_cr,
        NVL(v_batch_source, 'Manual'),
        v_created_by
    ) RETURNING JE_BATCH_ID INTO v_je_batch_id;

    v_step := 'Getting header sequence';
    SELECT RR_JE_HEADER_ID_SEQ.NEXTVAL INTO v_je_header_id FROM DUAL;

    v_step := 'Inserting header';
    INSERT INTO RR_GL_JE_HEADERS (
        JE_HEADER_ID, JE_BATCH_ID, NAME, STATUS,
        LEDGER_ID, LEDGER_NAME,
        PERIOD_NAME, DEFAULT_PERIOD_NAME,
        CURRENCY_CODE, CURRENCY_CONVERSION_RATE, CURRENCY_CONVERSION_TYPE,
        ACTUAL_FLAG, JE_SOURCE, JE_CATEGORY,
        ACCOUNTING_DATE, DEFAULT_EFFECTIVE_DATE,
        LEGAL_ENTITY_NAME, LEGAL_ENTITY_ID, ORG_ID,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
        DESCRIPTION, RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
        RUNNING_TOTAL_ACCOUNTED_DR, RUNNING_TOTAL_ACCOUNTED_CR
    ) VALUES (
        v_je_header_id, v_je_batch_id, v_header_name, 'Posted',
        v_ledger_id, v_ledger_name,
        v_period_name, v_period_name,
        v_currency, v_conv_rate, 'User',
        'A', v_je_source, v_je_category,
        v_eff_date, v_eff_date,
        NULL, NULL, NULL,
        SYSDATE, v_created_by, SYSDATE, v_created_by,
        v_header_desc,
        v_total_dr,                              -- entered in journal currency
        v_total_cr,
        ROUND(v_total_dr * v_conv_rate, 2),      -- accounted in ledger currency (AED)
        ROUND(v_total_cr * v_conv_rate, 2)
    );

    v_step := 'Processing lines';
    FOR i IN 0 .. v_lines_arr.get_size() - 1 LOOP
        v_line_obj := JSON_OBJECT_T(v_lines_arr.get(i));
        v_line_num := v_line_num + 1;

        v_ent_dr   := snum(v_line_obj, 'enteredDr');
        v_ent_cr   := snum(v_line_obj, 'enteredCr');
        v_eff_rate := NVL(snum(v_line_obj, 'currencyConversionRate'), NVL(v_conv_rate, 1));
        IF v_eff_rate <= 0 THEN v_eff_rate := 1; END IF;

        v_acc_dr := NVL(snum(v_line_obj, 'accountedDr'), ROUND(NVL(v_ent_dr,0) * v_eff_rate, 2));
        v_acc_cr := NVL(snum(v_line_obj, 'accountedCr'), ROUND(NVL(v_ent_cr,0) * v_eff_rate, 2));

        v_step := 'Inserting line ' || v_line_num;
        INSERT INTO RR_GL_JE_LINES_ALL (
            BATCH_ID, JE_HEADER_ID, JE_LINE_NUMBER,
            ENTERED_DR, ENTERED_CR, ACCOUNTED_DR, ACCOUNTED_CR,
            STAT_AMOUNT, DESCRIPTION,
            CURRENCY_CODE, CURRENCY_CONVERSION_DATE,
            CURRENCY_CONVERSION_RATE, USER_CURRENCY_CONVERSION_TYPE,
            ACCOUNT_COMBINATION, CHART_OF_ACCOUNTS_NAME,
            REFERENCE1, REFERENCE2, REFERENCE3, REFERENCE4, REFERENCE5,
            REFERENCE6, REFERENCE7, REFERENCE8, REFERENCE9, REFERENCE10,
            RECONCILED_FLAG,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            v_je_batch_id, v_je_header_id, v_line_num,
            v_ent_dr, v_ent_cr, v_acc_dr, v_acc_cr,
            snum(v_line_obj, 'statAmount'),
            sstr(v_line_obj, 'description'),
            NVL(sstr(v_line_obj, 'currencyCode'), v_currency),
            NVL(sdate(v_line_obj, 'currencyConversionDate'), v_eff_date),
            v_eff_rate,
            NVL(sstr(v_line_obj, 'userCurrencyConversionType'), 'User'),
            sstr(v_line_obj, 'accountCombination'),
            NVL(sstr(v_line_obj, 'chartOfAccountsName'), 'Chart of Accounts'),
            sstr(v_line_obj, 'reference1'), sstr(v_line_obj, 'reference2'),
            sstr(v_line_obj, 'reference3'), sstr(v_line_obj, 'reference4'),
            sstr(v_line_obj, 'reference5'), sstr(v_line_obj, 'reference6'),
            sstr(v_line_obj, 'reference7'), sstr(v_line_obj, 'reference8'),
            sstr(v_line_obj, 'reference9'), sstr(v_line_obj, 'reference10'),
            NVL(sstr(v_line_obj, 'reconciledFlag'), 'N'),
            NVL(sstr(v_line_obj, 'createdBy'), v_created_by),
            SYSDATE,
            NVL(sstr(v_line_obj, 'createdBy'), v_created_by),
            SYSDATE
        );
    END LOOP;

    COMMIT;

    :status_code := 201;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',       TRUE);
    APEX_JSON.WRITE('jeBatchId',     v_je_batch_id);
    APEX_JSON.WRITE('jeHeaderId',    v_je_header_id);
    APEX_JSON.WRITE('linesInserted', v_line_num);
    APEX_JSON.WRITE('batchName',     v_batch_name);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('step',    v_step);
        APEX_JSON.WRITE('message', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/
