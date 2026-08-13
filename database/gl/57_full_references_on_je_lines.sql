-- ============================================================
-- PATCH 57: Full REFERENCE1-10 + RECONCILED_FLAG on GL journal lines
--
-- Updates both the stored procedure (RR_INSERT_GL_JOURNALS_POST)
-- and the ORDS journals/create handler to read and persist all
-- ten reference columns and the RECONCILED_FLAG on every line.
--
-- Prerequisite: Patch 56 must have been run first (adds
-- RECONCILED_FLAG column to RR_GL_LINES_ALL).
-- NOTE: RR_GL_JE_LINES_ALL already has REFERENCE6-10 per the
-- table DDL; no ALTER TABLE needed here.
--
-- HOW TO RUN:
--   SQL Workshop → SQL Commands
--   Run the two BEGIN...END; blocks separately.
-- ============================================================


-- ── STEP 1: Replace RR_INSERT_GL_JOURNALS_POST ──────────────────────────────
CREATE OR REPLACE PROCEDURE RR_INSERT_GL_JOURNALS_POST (
    p_json_input   IN  CLOB,
    p_json_output  OUT CLOB
)
AS
    l_batch_id       NUMBER;
    l_header_id      NUMBER;
    l_line_id        NUMBER;
    l_line_count     NUMBER := 0;
    l_result_obj     JSON_OBJECT_T := JSON_OBJECT_T();
    l_input_obj      JSON_OBJECT_T;
    l_batch_obj      JSON_OBJECT_T;
    l_header_obj     JSON_OBJECT_T;
    l_lines_arr      JSON_ARRAY_T;
    l_line_obj       JSON_OBJECT_T;
    l_step           VARCHAR2(200);

    -- Batch variables
    v_batch_name            VARCHAR2(500);
    v_batch_description     VARCHAR2(2000);
    v_batch_ledger_name     VARCHAR2(500);
    v_batch_ledger_id       NUMBER;
    v_batch_status          VARCHAR2(100);
    v_batch_period          VARCHAR2(100);
    v_batch_control_total   NUMBER;
    v_batch_total_dr        NUMBER;
    v_batch_total_cr        NUMBER;
    v_batch_source          VARCHAR2(500);
    v_batch_created_by      VARCHAR2(500);

    -- Header variables
    v_header_ledger_id          NUMBER;
    v_header_ledger_name        VARCHAR2(500);
    v_header_je_category        VARCHAR2(500);
    v_header_je_source          VARCHAR2(500);
    v_header_period_name        VARCHAR2(100);
    v_header_journal_name       VARCHAR2(500);
    v_header_description        VARCHAR2(2000);
    v_header_currency           VARCHAR2(50);
    v_header_conv_type          VARCHAR2(100);
    v_header_conv_date          DATE;
    v_header_conv_rate          NUMBER;
    v_header_status             VARCHAR2(100);
    v_header_total_dr           NUMBER;
    v_header_total_cr           NUMBER;
    v_header_created_by         VARCHAR2(500);
    v_header_effective_date     DATE;

    -- Line variables
    v_line_entered_dr       NUMBER;
    v_line_entered_cr       NUMBER;
    v_line_accounted_dr     NUMBER;
    v_line_accounted_cr     NUMBER;
    v_line_stat_amount      NUMBER;
    v_line_description      VARCHAR2(2000);
    v_line_currency         VARCHAR2(50);
    v_line_conv_date        DATE;
    v_line_conv_rate        NUMBER;
    v_line_conv_type        VARCHAR2(100);
    v_line_account_comb     VARCHAR2(500);
    v_line_coa_name         VARCHAR2(500);
    -- All ten reference columns
    v_line_ref1             VARCHAR2(500);
    v_line_ref2             VARCHAR2(500);
    v_line_ref3             VARCHAR2(500);
    v_line_ref4             VARCHAR2(500);
    v_line_ref5             VARCHAR2(500);
    v_line_ref6             VARCHAR2(500);
    v_line_ref7             VARCHAR2(500);
    v_line_ref8             VARCHAR2(500);
    v_line_ref9             VARCHAR2(500);
    v_line_ref10            VARCHAR2(500);
    v_line_reconciled       VARCHAR2(1);
    v_line_created_by       VARCHAR2(500);

    v_eff_rate              NUMBER;

    -- Company-segment pre-validation
    v_first_company         VARCHAR2(100);
    v_line_company          VARCHAR2(100);
    v_mismatch_found        BOOLEAN        := FALSE;
    v_mismatch_detail       VARCHAR2(32767) := '';
    v_val_reference_no      VARCHAR2(200);
    v_first_combination     VARCHAR2(500);

    FUNCTION safe_get_string(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null() THEN
            RETURN p_obj.get_string(p_key);
        END IF;
        RETURN NULL;
    EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_get_number(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null() THEN
            RETURN p_obj.get_number(p_key);
        END IF;
        RETURN NULL;
    EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_get_date(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN DATE IS
        l_date_str VARCHAR2(100);
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null() THEN
            l_date_str := p_obj.get_string(p_key);
            IF l_date_str IS NOT NULL THEN
                BEGIN
                    RETURN TO_DATE(SUBSTR(l_date_str, 1, 10), 'YYYY-MM-DD');
                EXCEPTION WHEN OTHERS THEN RETURN NULL;
                END;
            END IF;
        END IF;
        RETURN NULL;
    EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
    END;

BEGIN
    l_step := 'Parsing JSON input';
    l_input_obj  := JSON_OBJECT_T.parse(p_json_input);
    l_batch_obj  := l_input_obj.get_Object('batch');
    l_header_obj := l_input_obj.get_Object('header');
    l_lines_arr  := l_input_obj.get_Array('lines');

    -- Read fields needed before validation
    v_batch_name         := safe_get_string(l_batch_obj,  'batchName');
    v_batch_created_by   := safe_get_string(l_batch_obj,  'createdBy');
    v_header_je_category := safe_get_string(l_header_obj, 'jeCategory');

    -- ── PRE-VALIDATION: scan all lines for company segment mismatch ───────────
    l_step := 'Pre-validating company segments';
    FOR i IN 0 .. l_lines_arr.get_size() - 1 LOOP
        l_line_obj          := JSON_OBJECT_T(l_lines_arr.get(i));
        v_line_account_comb := safe_get_string(l_line_obj, 'accountCombination');
        v_line_company      := REGEXP_SUBSTR(v_line_account_comb, '[^-]+', 1, 1);

        IF i = 0 THEN
            v_first_company     := v_line_company;
            v_first_combination := v_line_account_comb;
            v_val_reference_no  := safe_get_string(l_line_obj, 'reference1');
        ELSIF v_line_company IS NOT NULL
              AND v_first_company IS NOT NULL
              AND v_line_company != v_first_company
        THEN
            v_mismatch_found := TRUE;
            IF v_mismatch_detail IS NOT NULL THEN
                v_mismatch_detail := v_mismatch_detail || ',';
            END IF;
            v_mismatch_detail := v_mismatch_detail
                || '{"line":' || (i + 1)
                || ',"combination":"' || REPLACE(v_line_account_comb, '"', '\"')
                || '","company":"' || v_line_company || '"}';
        END IF;
    END LOOP;

    -- ── Reject if mismatch found ──────────────────────────────────────────────
    IF v_mismatch_found THEN
        BEGIN
            INSERT INTO RR_GL_VALIDATION_LOG (
                LOG_ID, MODULE, REFERENCE_NO, BATCH_NAME,
                RESULT, ERROR_COUNT,
                ERROR_CATEGORIES, ERROR_SUMMARY,
                ERROR_DETAIL, GL_PAYLOAD,
                CREATED_BY
            ) VALUES (
                RR_GL_VAL_LOG_SEQ.NEXTVAL,
                'GL_JOURNAL',
                v_val_reference_no,
                v_batch_name,
                'FAILED', 1,
                'COMPANY_SEGMENT_MISMATCH',
                'Journal rejected: lines span multiple company segments. '
                    || 'First line company: ' || v_first_company
                    || ' (' || v_first_combination || ').',
                TO_CLOB(
                    '[{"line":1,"combination":"'
                    || REPLACE(v_first_combination, '"', '\"')
                    || '","company":"' || v_first_company || '"},'
                    || v_mismatch_detail || ']'
                ),
                p_json_input,
                v_batch_created_by
            );
            COMMIT;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        l_result_obj.put('status',          'ERROR');
        l_result_obj.put('validationError', 'COMPANY_SEGMENT_MISMATCH');
        l_result_obj.put('message',
            'Journal rejected: account combinations span multiple company segments. '
            || 'All lines must belong to the same company (segment 1). '
            || 'First line company: ' || v_first_company || '. '
            || 'Details logged to RR_GL_VALIDATION_LOG.');
        p_json_output := l_result_obj.to_clob();
        RETURN;
    END IF;

    -- ── Validation passed — proceed with inserts ──────────────────────────────
    l_step := 'Getting sequence values';
    l_batch_id  := RR_GL_BATCH_SEQ.NEXTVAL;
    l_header_id := RR_GL_HEADER_SEQ.NEXTVAL;

    -- ── Batch ────────────────────────────────────────────────────────────────
    l_step := 'Extracting batch values';
    v_batch_description   := safe_get_string(l_batch_obj, 'batchDescription');
    v_batch_ledger_name   := safe_get_string(l_batch_obj, 'ledgerName');
    v_batch_ledger_id     := safe_get_number(l_batch_obj, 'ledgerId');
    v_batch_status        := NVL(safe_get_string(l_batch_obj, 'status'), 'NEW');
    v_batch_period        := safe_get_string(l_batch_obj, 'accountingPeriod');
    v_batch_control_total := safe_get_number(l_batch_obj, 'controlTotal');
    v_batch_total_dr      := safe_get_number(l_batch_obj, 'runningTotalDr');
    v_batch_total_cr      := safe_get_number(l_batch_obj, 'runningTotalCr');
    v_batch_source        := safe_get_string(l_batch_obj, 'batchSource');

    l_step := 'Inserting batch';
    INSERT INTO RR_GL_JOURNAL_BATCHES (
        BATCH_SYNC_ID, JE_BATCH_ID, BATCH_NAME, BATCH_DESCRIPTION,
        LEDGER_NAME, LEDGER_ID, STATUS_MEANING, DEFAULT_PERIOD_NAME,
        CONTROL_TOTAL, RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
        USER_JE_SOURCE_NAME,
        CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
    ) VALUES (
        l_batch_id, l_batch_id, v_batch_name, v_batch_description,
        v_batch_ledger_name, v_batch_ledger_id, v_batch_status, v_batch_period,
        v_batch_control_total, v_batch_total_dr, v_batch_total_cr,
        v_batch_source,
        v_batch_created_by, SYSDATE, v_batch_created_by, SYSDATE
    );

    -- ── Header ───────────────────────────────────────────────────────────────
    l_step := 'Extracting header values';
    v_header_ledger_id      := safe_get_number(l_header_obj, 'ledgerId');
    v_header_ledger_name    := safe_get_string(l_header_obj, 'ledgerName');
    v_header_je_source      := safe_get_string(l_header_obj, 'jeSource');
    v_header_period_name    := safe_get_string(l_header_obj, 'periodName');
    v_header_journal_name   := safe_get_string(l_header_obj, 'journalName');
    v_header_description    := safe_get_string(l_header_obj, 'description');
    v_header_currency       := safe_get_string(l_header_obj, 'currencyCode');
    v_header_conv_type      := safe_get_string(l_header_obj, 'currencyConversionType');
    v_header_conv_date      := safe_get_date(l_header_obj,   'currencyConversionDate');
    v_header_conv_rate      := safe_get_number(l_header_obj, 'currencyConversionRate');
    v_header_status         := safe_get_string(l_header_obj, 'status');
    v_header_total_dr       := safe_get_number(l_header_obj, 'runningTotalDr');
    v_header_total_cr       := safe_get_number(l_header_obj, 'runningTotalCr');
    v_header_created_by     := safe_get_string(l_header_obj, 'createdBy');
    v_header_effective_date := safe_get_date(l_header_obj,   'defaultEffectiveDate');

    l_step := 'Inserting header';
    INSERT INTO RR_GL_JE_HEADERS (
        JE_HEADER_ID, BATCH_ID,
        LEDGER_ID, LEDGER_NAME,
        USER_JE_CATEGORY_NAME, USER_JE_SOURCE_NAME,
        PERIOD_NAME, JOURNAL_NAME, JOURNAL_DESCRIPTION,
        CURRENCY_CODE, USER_CURRENCY_CONVERSION_TYPE,
        CURRENCY_CONVERSION_DATE, CURRENCY_CONVERSION_RATE,
        DEFAULT_EFFECTIVE_DATE, POSTING_STATUS,
        RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
        CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
    ) VALUES (
        l_header_id, l_batch_id,
        v_header_ledger_id, v_header_ledger_name,
        v_header_je_category, v_header_je_source,
        v_header_period_name, v_header_journal_name, v_header_description,
        v_header_currency, v_header_conv_type,
        v_header_conv_date, v_header_conv_rate,
        NVL(v_header_effective_date, SYSDATE), NVL(v_header_status, 'NEW'),
        NVL(v_header_total_dr, 0), NVL(v_header_total_cr, 0),
        v_header_created_by, SYSDATE, v_header_created_by, SYSDATE
    );

    -- ── Lines ────────────────────────────────────────────────────────────────
    l_step := 'Processing lines';
    FOR i IN 0 .. l_lines_arr.get_size() - 1 LOOP
        l_line_obj   := JSON_OBJECT_T(l_lines_arr.get(i));
        l_line_id    := RR_GL_LINE_SEQ.NEXTVAL;
        l_line_count := l_line_count + 1;

        l_step := 'Extracting line ' || l_line_count || ' values';
        v_line_entered_dr   := safe_get_number(l_line_obj, 'enteredDr');
        v_line_entered_cr   := safe_get_number(l_line_obj, 'enteredCr');
        v_line_stat_amount  := safe_get_number(l_line_obj, 'statAmount');
        v_line_description  := safe_get_string(l_line_obj, 'description');
        v_line_currency     := safe_get_string(l_line_obj, 'currencyCode');
        v_line_conv_date    := safe_get_date(l_line_obj,   'currencyConversionDate');
        v_line_conv_rate    := safe_get_number(l_line_obj, 'currencyConversionRate');
        v_line_conv_type    := safe_get_string(l_line_obj, 'userCurrencyConversionType');
        v_line_account_comb := safe_get_string(l_line_obj, 'accountCombination');
        v_line_coa_name     := safe_get_string(l_line_obj, 'chartOfAccountsName');
        -- Read all ten reference columns from the JSON line
        v_line_ref1         := safe_get_string(l_line_obj, 'reference1');
        v_line_ref2         := safe_get_string(l_line_obj, 'reference2');
        v_line_ref3         := safe_get_string(l_line_obj, 'reference3');
        v_line_ref4         := safe_get_string(l_line_obj, 'reference4');
        v_line_ref5         := safe_get_string(l_line_obj, 'reference5');
        v_line_ref6         := safe_get_string(l_line_obj, 'reference6');
        v_line_ref7         := safe_get_string(l_line_obj, 'reference7');
        v_line_ref8         := safe_get_string(l_line_obj, 'reference8');
        v_line_ref9         := safe_get_string(l_line_obj, 'reference9');
        v_line_ref10        := safe_get_string(l_line_obj, 'reference10');
        v_line_reconciled   := NVL(safe_get_string(l_line_obj, 'reconciledFlag'), 'N');
        v_line_created_by   := safe_get_string(l_line_obj, 'createdBy');

        -- ── Accounted DR/CR ──────────────────────────────────────────────────
        v_eff_rate := NVL(v_line_conv_rate, NVL(v_header_conv_rate, 1));
        IF v_eff_rate IS NULL OR v_eff_rate <= 0 THEN
            v_eff_rate := 1;
        END IF;

        IF UPPER(NVL(v_header_je_category, '')) = 'REVALUATION' THEN
            v_line_accounted_dr := safe_get_number(l_line_obj, 'accountedDr');
            v_line_accounted_cr := safe_get_number(l_line_obj, 'accountedCr');
            IF v_line_accounted_dr IS NULL THEN
                v_line_accounted_dr := ROUND(NVL(v_line_entered_dr, 0) * v_eff_rate, 2);
            END IF;
            IF v_line_accounted_cr IS NULL THEN
                v_line_accounted_cr := ROUND(NVL(v_line_entered_cr, 0) * v_eff_rate, 2);
            END IF;
        ELSE
            v_line_accounted_dr := ROUND(NVL(v_line_entered_dr, 0) * v_eff_rate, 2);
            v_line_accounted_cr := ROUND(NVL(v_line_entered_cr, 0) * v_eff_rate, 2);
        END IF;

        l_step := 'Inserting line ' || l_line_count;
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
            l_batch_id, l_header_id, l_line_count,
            v_line_entered_dr, v_line_entered_cr,
            v_line_accounted_dr, v_line_accounted_cr,
            v_line_stat_amount, v_line_description,
            v_line_currency, v_line_conv_date,
            v_line_conv_rate, v_line_conv_type,
            v_line_account_comb, v_line_coa_name,
            v_line_ref1,  v_line_ref2,  v_line_ref3,  v_line_ref4,  v_line_ref5,
            v_line_ref6,  v_line_ref7,  v_line_ref8,  v_line_ref9,  v_line_ref10,
            v_line_reconciled,
            v_line_created_by, SYSDATE, v_line_created_by, SYSDATE
        );
    END LOOP;

    COMMIT;

    l_result_obj.put('status',     'SUCCESS');
    l_result_obj.put('jeBatchId',  l_batch_id);
    l_result_obj.put('jeHeaderId', l_header_id);
    l_result_obj.put('lineCount',  l_line_count);
    p_json_output := l_result_obj.to_clob();

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        l_result_obj := JSON_OBJECT_T();
        l_result_obj.put('status',  'ERROR');
        l_result_obj.put('step',    l_step);
        l_result_obj.put('message', SQLERRM);
        l_result_obj.put('sqlcode', SQLCODE);
        p_json_output := l_result_obj.to_clob();
END RR_INSERT_GL_JOURNALS_POST;
/


-- ── STEP 2: Update journals/create ORDS handler (reference1-10 + reconciled) ─
-- This replaces the handler written in patch 56 with the full reference set.
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
        p_comments       => 'Create a GL journal batch + header + lines (reference1-10, reconciled_flag)',
        p_source         => q'[
DECLARE
    v_body          CLOB          := :body_text;
    v_root          APEX_JSON.t_values;

    v_batch_name    VARCHAR2(240);
    v_je_batch_id   NUMBER;
    v_je_header_id  NUMBER;
    v_currency      VARCHAR2(15);
    v_conv_rate     NUMBER;
    v_acctg_date    DATE;
    v_created_by    VARCHAR2(100) := 'ERP_USER';
    v_period_name   VARCHAR2(40);
    v_ledger_id     NUMBER;
    v_ledger_name   VARCHAR2(240);
    v_je_source     VARCHAR2(100);
    v_je_category   VARCHAR2(100);
    v_legal_entity  VARCHAR2(240);
    v_business_unit VARCHAR2(240);

    v_line_count    NUMBER;
    v_line_num      NUMBER := 0;
BEGIN
    APEX_JSON.PARSE(v_root, v_body);

    -- ── Batch ──
    v_batch_name    := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'batchName');
    v_period_name   := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'periodName');
    v_ledger_id     := NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'ledgerId'), 1);
    v_ledger_name   := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'ledgerName'), 'BUIMERC LEDGER');
    v_currency      := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'currency'), 'AED');
    v_conv_rate     := NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'conversionRate'), 1);
    v_acctg_date    := NVL(TO_DATE(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'accountingDate'), 'YYYY-MM-DD'), SYSDATE);
    v_je_source     := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'jeSource'), 'Cash Management');
    v_je_category   := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'jeCategory'), 'Bank Transfer');
    v_legal_entity  := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'legalEntity');
    v_business_unit := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'businessUnit');
    v_created_by    := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'createdBy'), 'ERP_USER');

    -- ── Batch ID ──
    SELECT NVL(MAX(JE_BATCH_ID), 0) + 1
      INTO v_je_batch_id
      FROM RR_GL_JE_BATCHES;

    INSERT INTO RR_GL_JE_BATCHES (
        JE_BATCH_ID, NAME, STATUS, PERIOD_NAME, ACTUAL_FLAG,
        DEFAULT_PERIOD_NAME, SET_OF_BOOKS_ID,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
        DESCRIPTION
    ) VALUES (
        v_je_batch_id,
        v_batch_name,
        'Posted',
        v_period_name,
        'A',
        v_period_name,
        v_ledger_id,
        SYSDATE, v_created_by, SYSDATE, v_created_by,
        APEX_JSON.get_varchar2(p_values => v_root, p_path => 'batchDescription')
    );

    -- ── Header ID ──
    SELECT RR_JE_HEADER_ID_SEQ.NEXTVAL INTO v_je_header_id FROM DUAL;

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
        v_je_header_id, v_je_batch_id,
        NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'journalName'), v_batch_name),
        'Posted',
        v_ledger_id, v_ledger_name,
        v_period_name, v_period_name,
        v_currency, v_conv_rate, 'User',
        'A', v_je_source, v_je_category,
        v_acctg_date, v_acctg_date,
        v_legal_entity, NULL, NULL,
        SYSDATE, v_created_by, SYSDATE, v_created_by,
        APEX_JSON.get_varchar2(p_values => v_root, p_path => 'journalDescription'),
        0, 0, 0, 0
    );

    -- ── Lines ──
    v_line_count := APEX_JSON.get_count(p_values => v_root, p_path => 'lines');

    FOR i IN 1 .. NVL(v_line_count, 0) LOOP
        v_line_num := v_line_num + 1;

        INSERT INTO RR_GL_LINES_ALL (
            JE_HEADER_ID, JE_LINE_NUMBER, BATCH_ID,
            ENTERED_DR, ENTERED_CR, ACCOUNTED_DR, ACCOUNTED_CR,
            DESCRIPTION, CURRENCY_CODE, ACCOUNT_COMBINATION,
            CHART_OF_ACCOUNTS_NAME,
            REFERENCE1,  REFERENCE2,  REFERENCE3,  REFERENCE4,  REFERENCE5,
            REFERENCE6,  REFERENCE7,  REFERENCE8,  REFERENCE9,  REFERENCE10,
            RECONCILED_FLAG,
            CREATED_BY
        ) VALUES (
            v_je_header_id, v_line_num, v_je_batch_id,
            APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredDr',  p0 => i),
            APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredCr',  p0 => i),
            NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].accountedDr', p0 => i),
                APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredDr',   p0 => i)),
            NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].accountedCr', p0 => i),
                APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredCr',   p0 => i)),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].description',        p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].currencyCode',   p0 => i), v_currency),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].accountCombination', p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].chartOfAccountsName', p0 => i), 'Chart of Accounts'),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference1',  p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference2', p0 => i), v_batch_name),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference3',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference4',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference5',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference6',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference7',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference8',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference9',  p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference10', p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reconciledFlag', p0 => i), 'N'),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].createdBy', p0 => i), v_created_by)
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
        APEX_JSON.WRITE('message', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/
