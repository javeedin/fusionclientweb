-- ============================================================
-- PATCH 86: Fix batch/journal naming for manual journals
--
-- Based on the original RR_INSERT_GL_JOURNALS_POST_OLD26052026.
-- Only change: after l_batch_id is obtained from the sequence,
-- BATCH_NAME and JOURNAL_NAME are overridden to "Manual - <batch_id>"
-- instead of using the arbitrary name sent by the frontend.
--
-- Also fixes RR_UPDATE_JOURNALS:
--   BATCH_NAME and JOURNAL_NAME are excluded from the UPDATE so
--   that sub-ledger batch names (BANK-…, AP-…) are never corrupted.
--
-- Run each block separately in APEX SQL Workshop → SQL Commands.
-- ============================================================


-- ── BLOCK 1: Replace RR_INSERT_GL_JOURNALS_POST ──────────────────────────────
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
    -- NOTE: v_batch_name from JSON is intentionally NOT used for the actual
    -- BATCH_NAME stored in DB.  It is read here only so v_batch_name is
    -- available for the validation log before we have l_batch_id.
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

    -- ── Canonical naming for manual journals ──────────────────────────────────
    -- Convention matches sub-ledger sources:  BANK-1000000149-1779703,
    --   AP-1000000149, etc.  For screen-created manual journals the format is:
    --      BATCH_NAME   = "Manual - <je_batch_id>"
    --      JOURNAL_NAME = "Manual - <je_batch_id>"
    -- The batchName / journalName sent by the frontend are ignored.
    v_batch_name          := 'Manual - ' || l_batch_id;
    v_header_journal_name := 'Manual - ' || l_batch_id;

    -- ── Batch ────────────────────────────────────────────────────────────────
    l_step := 'Extracting batch values';
    v_batch_description   := safe_get_string(l_batch_obj, 'batchDescription');
    v_batch_ledger_name   := safe_get_string(l_batch_obj, 'ledgerName');
    v_batch_ledger_id     := safe_get_number(l_batch_obj, 'ledgerId');
    v_batch_status        := NVL(safe_get_string(l_batch_obj, 'status'), 'Unposted');
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
    -- v_header_journal_name already set above from l_batch_id
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
        NVL(v_header_effective_date, SYSDATE), NVL(v_header_status, 'Unposted'),
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
    l_result_obj.put('batchName',  v_batch_name);
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


-- ── BLOCK 2: Replace RR_UPDATE_JOURNALS — never overwrite BATCH_NAME ─────────
-- BATCH_NAME was set correctly at creation time ("Manual - <id>").
-- Sub-ledger batches also have names like BANK-… that must not change.
-- JOURNAL_NAME follows the same rule.
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

BEGIN
    DBMS_OUTPUT.PUT_LINE('PATCH 86 applied:');
    DBMS_OUTPUT.PUT_LINE('  RR_INSERT_GL_JOURNALS_POST — batch/journal name = "Manual - <batch_id>"');
    DBMS_OUTPUT.PUT_LINE('  RR_UPDATE_JOURNALS — BATCH_NAME + JOURNAL_NAME excluded from UPDATE');
END;
/
