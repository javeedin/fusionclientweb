-- ============================================================
-- PATCH 85: RR_UPDATE_JOURNALS procedure + PUT /journals/update/:batchId
--
-- Correct column mapping (from actual DDL):
--
--  RR_GL_JOURNAL_BATCHES  — PK: BATCH_SYNC_ID, unique: JE_BATCH_ID
--    accountingPeriod  → DEFAULT_PERIOD_NAME
--    runningTotalDr/Cr → RUNNING_TOTAL_DR/CR  (entered)
--                     → RUNNING_TOTAL_ACCT_DR/CR  (accounted = × conv_rate)
--    batchSource       → USER_JE_SOURCE_NAME
--    ledgerId          → LEDGER_ID  (VARCHAR2)
--
--  RR_GL_JE_HEADERS  — PK: HEADER_ID (identity), FK: BATCH_ID
--    journalName       → JOURNAL_NAME
--    description       → JOURNAL_DESCRIPTION
--    jeCategory        → USER_JE_CATEGORY_NAME
--    jeSource          → USER_JE_SOURCE_NAME
--    defaultEffDate    → DEFAULT_EFFECTIVE_DATE  (no ACCOUNTING_DATE column)
--    (no STATUS, ACTUAL_FLAG, JE_CATEGORY, JE_SOURCE, DEFAULT_PERIOD_NAME)
--
--  RR_GL_JE_LINES_ALL — PK: LINE_ID (identity), FKs: BATCH_ID, JE_HEADER_ID
--    columns identical to what create handler writes — no changes needed
--
-- Run each block separately in APEX SQL Workshop → SQL Commands.
-- ============================================================


-- ── STEP 1: Create / replace the stored procedure ────────────────────────────
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

    -- Batch fields
    v_batch_name    VARCHAR2(4000);
    v_batch_desc    VARCHAR2(4000);
    v_ledger_name   VARCHAR2(100);
    v_ledger_id     VARCHAR2(100);      -- VARCHAR2 in RR_GL_JOURNAL_BATCHES
    v_period_name   VARCHAR2(50);
    v_ctrl_total    NUMBER;
    v_batch_status  VARCHAR2(10);
    v_batch_source  VARCHAR2(100);
    v_updated_by    VARCHAR2(100);

    -- Header fields
    v_journal_name  VARCHAR2(240);
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
    v_legal_entity  VARCHAR2(240);
    v_ledger_id_num NUMBER;

    -- Line vars
    v_line_num      NUMBER := 0;
    v_ent_dr        NUMBER;
    v_ent_cr        NUMBER;
    v_acc_dr        NUMBER;
    v_acc_cr        NUMBER;
    v_eff_rate      NUMBER;
    -- Line field vars (pre-extracted before INSERT to avoid local-function-in-SQL error)
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

    -- ── Parse JSON ───────────────────────────────────────────────────────────
    p_step       := 'Parsing JSON';
    v_root       := JSON_OBJECT_T.parse(p_json);
    v_batch_obj  := v_root.get_object('batch');
    v_header_obj := v_root.get_object('header');
    v_lines_arr  := v_root.get_array('lines');

    -- ── Batch fields ─────────────────────────────────────────────────────────
    p_step        := 'Reading batch fields';
    v_batch_name  := sstr(v_batch_obj, 'batchName');
    v_batch_desc  := sstr(v_batch_obj, 'batchDescription');
    v_ledger_name := sstr(v_batch_obj, 'ledgerName');
    v_ledger_id   := sstr(v_batch_obj, 'ledgerId');    -- stored as VARCHAR2
    v_period_name := sstr(v_batch_obj, 'accountingPeriod');
    v_ctrl_total  := NVL(snum(v_batch_obj, 'controlTotal'), 0);
    v_batch_status:= NVL(sstr(v_batch_obj, 'status'), 'NEW');
    v_batch_source:= NVL(sstr(v_batch_obj, 'batchSource'), 'Manual');
    v_updated_by  := NVL(sstr(v_batch_obj, 'createdBy'), 'ERP_USER');

    -- ── Header fields ────────────────────────────────────────────────────────
    p_step         := 'Reading header fields';
    v_journal_name := NVL(sstr(v_header_obj, 'journalName'), v_batch_name);
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
    v_legal_entity := sstr(v_header_obj, 'legalEntityName');
    v_ledger_id_num:= snum(v_header_obj, 'ledgerId');

    p_batch_name := v_batch_name;

    -- ── UPDATE RR_GL_JOURNAL_BATCHES (find by JE_BATCH_ID) ───────────────────
    p_step := 'Updating batch';
    UPDATE RR_GL_JOURNAL_BATCHES SET
        BATCH_NAME              = NVL(v_batch_name,   BATCH_NAME),
        BATCH_DESCRIPTION       = v_batch_desc,
        DEFAULT_PERIOD_NAME     = NVL(v_period_name,  DEFAULT_PERIOD_NAME),
        STATUS                  = NVL(v_batch_status, STATUS),
        STATUS_MEANING          = CASE NVL(v_batch_status, STATUS)
                                    WHEN 'P'   THEN 'Posted'
                                    WHEN 'NEW' THEN 'Unposted'
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
        RAISE_APPLICATION_ERROR(-20001, 'Batch ID ' || p_batch_id || ' not found in RR_GL_JOURNAL_BATCHES');
    END IF;

    -- ── Resolve JE_HEADER_ID from existing header (BATCH_ID = JE_BATCH_ID) ──
    p_step := 'Resolving header';
    BEGIN
        SELECT JE_HEADER_ID INTO p_je_header_id
        FROM   RR_GL_JE_HEADERS
        WHERE  BATCH_ID = p_batch_id
        AND    ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            -- Fallback: generate an ID from current max
            SELECT NVL(MAX(JE_HEADER_ID), 500000000) + 1
            INTO   p_je_header_id
            FROM   RR_GL_JE_HEADERS;
    END;

    -- ── UPDATE RR_GL_JE_HEADERS ──────────────────────────────────────────────
    p_step := 'Updating header';
    UPDATE RR_GL_JE_HEADERS SET
        JOURNAL_NAME                 = NVL(v_journal_name, JOURNAL_NAME),
        JOURNAL_DESCRIPTION          = v_journal_desc,
        DESCRIPTION                  = SUBSTR(NVL(v_journal_desc, DESCRIPTION), 1, 100),
        PERIOD_NAME                  = NVL(v_hdr_period,   PERIOD_NAME),
        DEFAULT_EFFECTIVE_DATE       = NVL(v_eff_date,     DEFAULT_EFFECTIVE_DATE),
        CURRENCY_CONVERSION_DATE     = NVL(v_conv_date,    CURRENCY_CONVERSION_DATE),
        CURRENCY_CODE                = NVL(v_currency,     CURRENCY_CODE),
        CURRENCY_CONVERSION_RATE     = NVL(v_conv_rate,    CURRENCY_CONVERSION_RATE),
        USER_CURRENCY_CONVERSION_TYPE= 'User',
        USER_JE_CATEGORY_NAME        = NVL(v_je_category,  USER_JE_CATEGORY_NAME),
        USER_JE_SOURCE_NAME          = NVL(v_je_source,    USER_JE_SOURCE_NAME),
        LEGAL_ENTITY_NAME            = v_legal_entity,
        LEDGER_NAME                  = NVL(v_ledger_name,  LEDGER_NAME),
        LEDGER_ID                    = NVL(v_ledger_id_num, LEDGER_ID),
        RUNNING_TOTAL_DR             = v_total_dr,
        RUNNING_TOTAL_CR             = v_total_cr,
        RUNNING_TOTAL_ACCOUNTED_DR   = ROUND(v_total_dr * v_conv_rate, 2),
        RUNNING_TOTAL_ACCOUNTED_CR   = ROUND(v_total_cr * v_conv_rate, 2),
        LAST_UPDATED_BY              = v_updated_by,
        LAST_UPDATE_DATE             = SYSTIMESTAMP
    WHERE BATCH_ID = p_batch_id;

    IF SQL%ROWCOUNT = 0 THEN
        -- Header missing — insert it (HEADER_ID is auto-identity)
        INSERT INTO RR_GL_JE_HEADERS (
            BATCH_ID,              JE_HEADER_ID,
            JOURNAL_NAME,          JOURNAL_DESCRIPTION,        DESCRIPTION,
            PERIOD_NAME,           DEFAULT_EFFECTIVE_DATE,     CURRENCY_CONVERSION_DATE,
            CURRENCY_CODE,         CURRENCY_CONVERSION_RATE,   USER_CURRENCY_CONVERSION_TYPE,
            USER_JE_CATEGORY_NAME, USER_JE_SOURCE_NAME,
            LEGAL_ENTITY_NAME,     LEDGER_NAME,                LEDGER_ID,
            POSTING_STATUS,
            RUNNING_TOTAL_DR,             RUNNING_TOTAL_CR,
            RUNNING_TOTAL_ACCOUNTED_DR,   RUNNING_TOTAL_ACCOUNTED_CR,
            CREATED_BY,            CREATION_DATE,
            LAST_UPDATED_BY,       LAST_UPDATE_DATE
        ) VALUES (
            p_batch_id,            p_je_header_id,
            v_journal_name,        v_journal_desc,             SUBSTR(v_journal_desc, 1, 100),
            v_hdr_period,          v_eff_date,                 v_conv_date,
            v_currency,            v_conv_rate,                'User',
            v_je_category,         v_je_source,
            v_legal_entity,        v_ledger_name,              v_ledger_id_num,
            'Unposted',
            v_total_dr,                   v_total_cr,
            ROUND(v_total_dr * v_conv_rate, 2),
            ROUND(v_total_cr * v_conv_rate, 2),
            v_updated_by,          SYSTIMESTAMP,
            v_updated_by,          SYSTIMESTAMP
        );
    END IF;

    -- ── DELETE old lines, re-INSERT from payload ─────────────────────────────
    p_step := 'Deleting old lines';
    DELETE FROM RR_GL_JE_LINES_ALL WHERE BATCH_ID = p_batch_id;

    p_step := 'Inserting new lines';
    FOR i IN 0 .. v_lines_arr.get_size() - 1 LOOP
        v_line_obj := JSON_OBJECT_T(v_lines_arr.get(i));
        v_line_num := v_line_num + 1;

        -- Pre-extract all values into local variables (local functions cannot be called inside SQL)
        v_ent_dr       := snum(v_line_obj, 'enteredDr');
        v_ent_cr       := snum(v_line_obj, 'enteredCr');
        v_eff_rate     := NVL(snum(v_line_obj, 'currencyConversionRate'), v_conv_rate);
        IF NVL(v_eff_rate, 0) <= 0 THEN v_eff_rate := 1; END IF;
        v_acc_dr       := NVL(snum(v_line_obj, 'accountedDr'), ROUND(NVL(v_ent_dr, 0) * v_eff_rate, 2));
        v_acc_cr       := NVL(snum(v_line_obj, 'accountedCr'), ROUND(NVL(v_ent_cr, 0) * v_eff_rate, 2));
        v_l_stat_amt   := snum(v_line_obj, 'statAmount');
        v_l_desc       := sstr(v_line_obj, 'description');
        v_l_currency   := NVL(sstr(v_line_obj, 'currencyCode'), v_currency);
        v_l_conv_date  := NVL(sdate(v_line_obj, 'currencyConversionDate'), v_conv_date);
        v_l_conv_type  := NVL(sstr(v_line_obj, 'userCurrencyConversionType'), 'User');
        v_l_account    := sstr(v_line_obj, 'accountCombination');
        v_l_coa        := NVL(sstr(v_line_obj, 'chartOfAccountsName'), 'Chart of Accounts');
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

        INSERT INTO RR_GL_JE_LINES_ALL (
            BATCH_ID,              JE_HEADER_ID,             JE_LINE_NUMBER,
            ENTERED_DR,            ENTERED_CR,
            ACCOUNTED_DR,          ACCOUNTED_CR,
            STAT_AMOUNT,           DESCRIPTION,
            CURRENCY_CODE,         CURRENCY_CONVERSION_DATE, CURRENCY_CONVERSION_RATE,
            USER_CURRENCY_CONVERSION_TYPE,
            ACCOUNT_COMBINATION,   CHART_OF_ACCOUNTS_NAME,
            REFERENCE1,  REFERENCE2,  REFERENCE3,  REFERENCE4,  REFERENCE5,
            REFERENCE6,  REFERENCE7,  REFERENCE8,  REFERENCE9,  REFERENCE10,
            RECONCILED_FLAG,
            CREATED_BY,  CREATION_DATE,  LAST_UPDATED_BY,  LAST_UPDATE_DATE
        ) VALUES (
            p_batch_id,      p_je_header_id,   v_line_num,
            v_ent_dr,        v_ent_cr,
            v_acc_dr,        v_acc_cr,
            v_l_stat_amt,    v_l_desc,
            v_l_currency,    v_l_conv_date,    v_eff_rate,
            v_l_conv_type,
            v_l_account,     v_l_coa,
            v_l_ref1,  v_l_ref2,  v_l_ref3,  v_l_ref4,  v_l_ref5,
            v_l_ref6,  v_l_ref7,  v_l_ref8,  v_l_ref9,  v_l_ref10,
            v_l_recon,
            v_l_created_by,  SYSTIMESTAMP,  v_l_created_by,  SYSTIMESTAMP
        );
    END LOOP;

    p_lines_replaced := v_line_num;
    p_step           := 'Done';
    p_message        := NULL;
    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_message := SQLERRM;
END RR_UPDATE_JOURNALS;
/


-- ── STEP 2: Register the ORDS template (safe to re-run) ──────────────────────
BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'journals/update/:batchId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Update existing GL journal — calls RR_UPDATE_JOURNALS'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/


-- ── STEP 3: PUT handler — thin wrapper ───────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'journals/update/:batchId',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'journals/update/:batchId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Update GL journal: calls RR_UPDATE_JOURNALS procedure',
        p_source         => q'[
DECLARE
    v_je_header_id   NUMBER;
    v_lines_replaced NUMBER;
    v_batch_name     VARCHAR2(4000);
    v_step           VARCHAR2(200);
    v_message        VARCHAR2(4000);
BEGIN
    RR_UPDATE_JOURNALS(
        p_json           => :body_text,
        p_batch_id       => TO_NUMBER(:batchId),
        p_je_header_id   => v_je_header_id,
        p_lines_replaced => v_lines_replaced,
        p_batch_name     => v_batch_name,
        p_step           => v_step,
        p_message        => v_message
    );

    IF v_message IS NOT NULL THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('step',    v_step);
        APEX_JSON.WRITE('message', v_message);
        APEX_JSON.CLOSE_OBJECT;
    ELSE
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',       TRUE);
        APEX_JSON.WRITE('jeBatchId',     TO_NUMBER(:batchId));
        APEX_JSON.WRITE('jeHeaderId',    v_je_header_id);
        APEX_JSON.WRITE('linesReplaced', v_lines_replaced);
        APEX_JSON.WRITE('batchName',     v_batch_name);
        APEX_JSON.CLOSE_OBJECT;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
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
