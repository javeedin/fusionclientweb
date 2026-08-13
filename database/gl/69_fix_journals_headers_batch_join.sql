-- ============================================================
-- PATCH 69: Fix gl/journals/headers — wrong JOIN column + default ledger
--
-- Two problems:
--
-- 1. WRONG JOIN COLUMN
--    search_journals_json joins:
--      LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
--    But journals created via journals/create (patch 61) INSERT into
--    RR_GL_JE_HEADERS using column JE_BATCH_ID (not BATCH_ID).
--    So h.BATCH_ID is NULL for new journals → batch info comes back NULL.
--    Fix: join on h.JE_BATCH_ID = b.JE_BATCH_ID
--
-- 2. DEFAULT LEDGER IN journals/create
--    v_ledger_name := NVL(sstr(v_batch_obj,'ledgerName'), 'BUIMERC LEDGER');
--    If the frontend ever sends an empty string or omits ledgerName, the
--    journal is stored with 'BUIMERC LEDGER', not the real ledger.
--    The search then asks for 'SB LEDGER' and gets nothing.
--    Fix: remove the hardcoded default — let it fail visibly if missing.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run STEP 1 (package body) first, then STEP 2 (journals/create handler).
-- ============================================================


-- ── STEP 1: Fix search package — use h.JE_BATCH_ID in the JOIN ───────────────
CREATE OR REPLACE PACKAGE BODY RR_MANAGE_JOURNALS_PKG AS

    PROCEDURE search_journals_json(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2 DEFAULT NULL,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_batch_name_op     IN VARCHAR2 DEFAULT 'C',
        p_journal_name      IN VARCHAR2 DEFAULT NULL,
        p_journal_name_op   IN VARCHAR2 DEFAULT 'C',
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_journal_desc_op   IN VARCHAR2 DEFAULT 'C',
        p_category          IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_offset            IN NUMBER   DEFAULT 0,
        p_limit             IN NUMBER   DEFAULT 500,
        p_from_date         IN DATE     DEFAULT NULL,
        p_to_date           IN DATE     DEFAULT NULL
    ) IS
        v_count NUMBER;

        CURSOR c_headers IS
            SELECT
                b.BATCH_SYNC_ID                     AS BATCH_ID,
                b.JE_BATCH_ID,
                b.BATCH_NAME,
                b.BATCH_DESCRIPTION,
                b.USER_JE_SOURCE_NAME               AS SOURCE,
                b.STATUS,
                b.STATUS_MEANING,
                b.APPROVAL_STATUS_MEANING,
                b.POSTED_DATE,
                h.HEADER_ID,
                h.JE_HEADER_ID,
                h.JOURNAL_NAME,
                h.JOURNAL_DESCRIPTION,
                h.PERIOD_NAME,
                h.USER_JE_CATEGORY_NAME             AS CATEGORY,
                h.LEDGER_NAME,
                h.LEGAL_ENTITY_NAME,
                h.CURRENCY_CODE,
                h.CURRENCY_CONVERSION_RATE,
                h.USER_CURRENCY_CONVERSION_TYPE,
                h.RUNNING_TOTAL_DR                  AS ENTERED_DEBIT,
                h.RUNNING_TOTAL_CR                  AS ENTERED_CREDIT,
                h.RUNNING_TOTAL_ACCOUNTED_DR        AS ACCOUNTED_DEBIT,
                h.RUNNING_TOTAL_ACCOUNTED_CR        AS ACCOUNTED_CREDIT,
                h.DEFAULT_EFFECTIVE_DATE            AS EFFECTIVE_DATE,
                h.EXTERNAL_REFERENCE,
                h.CREATION_DATE
            FROM RR_GL_JE_HEADERS h
            LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = h.JE_BATCH_ID
            WHERE UPPER(h.LEDGER_NAME) = UPPER(p_ledger)
              AND (p_period IS NULL OR UPPER(h.PERIOD_NAME) = UPPER(p_period))
              AND (p_batch_name IS NULL
                   OR UPPER(NVL(b.BATCH_NAME,''))        LIKE CASE UPPER(NVL(p_batch_name_op,'C'))
                                                                 WHEN 'S' THEN UPPER(p_batch_name) || '%'
                                                                 WHEN 'E' THEN '%' || UPPER(p_batch_name)
                                                                 WHEN 'X' THEN UPPER(p_batch_name)
                                                                 ELSE '%' || UPPER(p_batch_name) || '%'
                                                               END
                   OR UPPER(NVL(b.BATCH_DESCRIPTION,'')) LIKE CASE UPPER(NVL(p_batch_name_op,'C'))
                                                                 WHEN 'S' THEN UPPER(p_batch_name) || '%'
                                                                 WHEN 'E' THEN '%' || UPPER(p_batch_name)
                                                                 WHEN 'X' THEN UPPER(p_batch_name)
                                                                 ELSE '%' || UPPER(p_batch_name) || '%'
                                                               END)
              AND (p_journal_name IS NULL
                   OR UPPER(NVL(h.JOURNAL_NAME,'')) LIKE CASE UPPER(NVL(p_journal_name_op,'C'))
                                                              WHEN 'S' THEN UPPER(p_journal_name) || '%'
                                                              WHEN 'E' THEN '%' || UPPER(p_journal_name)
                                                              WHEN 'X' THEN UPPER(p_journal_name)
                                                              ELSE '%' || UPPER(p_journal_name) || '%'
                                                            END)
              AND (p_journal_desc IS NULL
                   OR UPPER(NVL(h.JOURNAL_DESCRIPTION,'')) LIKE CASE UPPER(NVL(p_journal_desc_op,'C'))
                                                                    WHEN 'S' THEN UPPER(p_journal_desc) || '%'
                                                                    WHEN 'E' THEN '%' || UPPER(p_journal_desc)
                                                                    WHEN 'X' THEN UPPER(p_journal_desc)
                                                                    ELSE '%' || UPPER(p_journal_desc) || '%'
                                                                  END)
              AND (p_category IS NULL OR UPPER(h.USER_JE_CATEGORY_NAME) = UPPER(p_category))
              AND (p_source IS NULL OR b.USER_JE_SOURCE_NAME = p_source)
              AND (p_status_meaning IS NULL OR b.STATUS_MEANING = p_status_meaning)
              AND (p_from_date IS NULL OR h.DEFAULT_EFFECTIVE_DATE >= p_from_date)
              AND (p_to_date   IS NULL OR h.DEFAULT_EFFECTIVE_DATE <= p_to_date)
            ORDER BY h.CREATION_DATE DESC
            OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY;

        CURSOR c_lines(p_je_header_id NUMBER) IS
            SELECT
                l.LINE_ID,
                l.JE_LINE_NUMBER       AS LINE_NUM,
                l.ACCOUNT_COMBINATION  AS ACCOUNT,
                l.DESCRIPTION,
                l.ENTERED_DR,
                l.ENTERED_CR,
                l.ACCOUNTED_DR,
                l.ACCOUNTED_CR,
                l.CURRENCY_CODE        AS CURRENCY,
                l.CURRENCY_CONVERSION_RATE,
                vsv.DESCRIPTION        AS ACCOUNT_DESCRIPTION
            FROM RR_GL_JE_LINES_ALL l
            LEFT JOIN RR_VALUE_SET_VALUES vsv
                ON  vsv.VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
                AND vsv.VALUE = TRIM(REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, '[^-]+', 1, 4))
            WHERE l.JE_HEADER_ID = p_je_header_id
            ORDER BY l.JE_LINE_NUMBER;

    BEGIN
        v_count := get_journal_count(
            p_ledger, p_period,
            p_batch_name, p_batch_name_op,
            p_journal_name, p_journal_name_op,
            p_journal_desc, p_journal_desc_op,
            p_category, p_source, p_status_meaning,
            p_from_date, p_to_date
        );

        APEX_JSON.INITIALIZE_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',    TRUE);
        APEX_JSON.WRITE('totalCount', v_count);
        APEX_JSON.WRITE('offset',     p_offset);
        APEX_JSON.WRITE('limit',      p_limit);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r_header IN c_headers LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('batchId',               r_header.BATCH_ID);
            APEX_JSON.WRITE('jeBatchId',             r_header.JE_BATCH_ID);
            APEX_JSON.WRITE('batchName',             r_header.BATCH_NAME);
            APEX_JSON.WRITE('batchDescription',      r_header.BATCH_DESCRIPTION);
            APEX_JSON.WRITE('source',                r_header.SOURCE);
            APEX_JSON.WRITE('status',                r_header.STATUS);
            APEX_JSON.WRITE('statusMeaning',         r_header.STATUS_MEANING);
            APEX_JSON.WRITE('approvalStatusMeaning', r_header.APPROVAL_STATUS_MEANING);
            APEX_JSON.WRITE('postedDate',            TO_CHAR(r_header.POSTED_DATE, 'YYYY-MM-DD'));
            APEX_JSON.WRITE('headerId',              r_header.HEADER_ID);
            APEX_JSON.WRITE('jeHeaderId',            r_header.JE_HEADER_ID);
            APEX_JSON.WRITE('journalName',           r_header.JOURNAL_NAME);
            APEX_JSON.WRITE('journalDescription',    r_header.JOURNAL_DESCRIPTION);
            APEX_JSON.WRITE('periodName',            r_header.PERIOD_NAME);
            APEX_JSON.WRITE('category',              r_header.CATEGORY);
            APEX_JSON.WRITE('ledgerName',            r_header.LEDGER_NAME);
            APEX_JSON.WRITE('legalEntityName',       r_header.LEGAL_ENTITY_NAME);
            APEX_JSON.WRITE('currencyCode',          r_header.CURRENCY_CODE);
            APEX_JSON.WRITE('conversionRate',        NVL(r_header.CURRENCY_CONVERSION_RATE, 1));
            APEX_JSON.WRITE('conversionRateType',    r_header.USER_CURRENCY_CONVERSION_TYPE);
            APEX_JSON.WRITE('enteredDebit',          r_header.ENTERED_DEBIT);
            APEX_JSON.WRITE('enteredCredit',         r_header.ENTERED_CREDIT);
            APEX_JSON.WRITE('accountedDebit',        r_header.ACCOUNTED_DEBIT);
            APEX_JSON.WRITE('accountedCredit',       r_header.ACCOUNTED_CREDIT);
            APEX_JSON.WRITE('effectiveDate',         TO_CHAR(r_header.EFFECTIVE_DATE, 'YYYY-MM-DD'));
            APEX_JSON.WRITE('externalReference',     r_header.EXTERNAL_REFERENCE);
            APEX_JSON.WRITE('creationDate',          TO_CHAR(r_header.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS'));

            APEX_JSON.OPEN_ARRAY('lines');
            FOR r_line IN c_lines(r_header.JE_HEADER_ID) LOOP
                APEX_JSON.OPEN_OBJECT;
                APEX_JSON.WRITE('lineId',             r_line.LINE_ID);
                APEX_JSON.WRITE('lineNum',            r_line.LINE_NUM);
                APEX_JSON.WRITE('account',            r_line.ACCOUNT);
                APEX_JSON.WRITE('description',        r_line.DESCRIPTION);
                APEX_JSON.WRITE('enteredDr',          r_line.ENTERED_DR);
                APEX_JSON.WRITE('enteredCr',          r_line.ENTERED_CR);
                APEX_JSON.WRITE('accountedDr',        r_line.ACCOUNTED_DR);
                APEX_JSON.WRITE('accountedCr',        r_line.ACCOUNTED_CR);
                APEX_JSON.WRITE('currency',           r_line.CURRENCY);
                APEX_JSON.WRITE('conversionRate',     NVL(r_line.CURRENCY_CONVERSION_RATE, 1));
                APEX_JSON.WRITE('accountDescription', r_line.ACCOUNT_DESCRIPTION);
                APEX_JSON.CLOSE_OBJECT;
            END LOOP;
            APEX_JSON.CLOSE_ARRAY;

            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;

    END search_journals_json;

    -- --------------------------------------------------------
    FUNCTION get_journal_count(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2 DEFAULT NULL,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_batch_name_op     IN VARCHAR2 DEFAULT 'C',
        p_journal_name      IN VARCHAR2 DEFAULT NULL,
        p_journal_name_op   IN VARCHAR2 DEFAULT 'C',
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_journal_desc_op   IN VARCHAR2 DEFAULT 'C',
        p_category          IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_from_date         IN DATE     DEFAULT NULL,
        p_to_date           IN DATE     DEFAULT NULL
    ) RETURN NUMBER IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
        INTO v_count
        FROM RR_GL_JE_HEADERS h
        LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = h.JE_BATCH_ID
        WHERE UPPER(h.LEDGER_NAME) = UPPER(p_ledger)
          AND (p_period IS NULL OR UPPER(h.PERIOD_NAME) = UPPER(p_period))
          AND (p_batch_name IS NULL
               OR UPPER(NVL(b.BATCH_NAME,''))        LIKE CASE UPPER(NVL(p_batch_name_op,'C'))
                                                             WHEN 'S' THEN UPPER(p_batch_name) || '%'
                                                             WHEN 'E' THEN '%' || UPPER(p_batch_name)
                                                             WHEN 'X' THEN UPPER(p_batch_name)
                                                             ELSE '%' || UPPER(p_batch_name) || '%'
                                                           END
               OR UPPER(NVL(b.BATCH_DESCRIPTION,'')) LIKE CASE UPPER(NVL(p_batch_name_op,'C'))
                                                             WHEN 'S' THEN UPPER(p_batch_name) || '%'
                                                             WHEN 'E' THEN '%' || UPPER(p_batch_name)
                                                             WHEN 'X' THEN UPPER(p_batch_name)
                                                             ELSE '%' || UPPER(p_batch_name) || '%'
                                                           END)
          AND (p_journal_name IS NULL
               OR UPPER(NVL(h.JOURNAL_NAME,'')) LIKE CASE UPPER(NVL(p_journal_name_op,'C'))
                                                          WHEN 'S' THEN UPPER(p_journal_name) || '%'
                                                          WHEN 'E' THEN '%' || UPPER(p_journal_name)
                                                          WHEN 'X' THEN UPPER(p_journal_name)
                                                          ELSE '%' || UPPER(p_journal_name) || '%'
                                                        END)
          AND (p_journal_desc IS NULL
               OR UPPER(NVL(h.JOURNAL_DESCRIPTION,'')) LIKE CASE UPPER(NVL(p_journal_desc_op,'C'))
                                                                WHEN 'S' THEN UPPER(p_journal_desc) || '%'
                                                                WHEN 'E' THEN '%' || UPPER(p_journal_desc)
                                                                WHEN 'X' THEN UPPER(p_journal_desc)
                                                                ELSE '%' || UPPER(p_journal_desc) || '%'
                                                              END)
          AND (p_category IS NULL OR UPPER(h.USER_JE_CATEGORY_NAME) = UPPER(p_category))
          AND (p_source IS NULL OR b.USER_JE_SOURCE_NAME = p_source)
          AND (p_status_meaning IS NULL OR b.STATUS_MEANING = p_status_meaning)
          AND (p_from_date IS NULL OR h.DEFAULT_EFFECTIVE_DATE >= p_from_date)
          AND (p_to_date   IS NULL OR h.DEFAULT_EFFECTIVE_DATE <= p_to_date);

        RETURN v_count;
    END get_journal_count;

    -- --------------------------------------------------------
    FUNCTION get_periods RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT PERIOD_NAME FROM RR_GL_JE_HEADERS
            WHERE PERIOD_NAME IS NOT NULL ORDER BY PERIOD_NAME DESC;
        RETURN v_cursor;
    END get_periods;

    FUNCTION get_sources RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT USER_JE_SOURCE_NAME FROM RR_GL_JOURNAL_BATCHES
            WHERE USER_JE_SOURCE_NAME IS NOT NULL ORDER BY USER_JE_SOURCE_NAME;
        RETURN v_cursor;
    END get_sources;

    FUNCTION get_categories RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT USER_JE_CATEGORY_NAME FROM RR_GL_JE_HEADERS
            WHERE USER_JE_CATEGORY_NAME IS NOT NULL ORDER BY USER_JE_CATEGORY_NAME;
        RETURN v_cursor;
    END get_categories;

    FUNCTION get_ledgers RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT LEDGER_NAME FROM RR_GL_JE_HEADERS
            WHERE LEDGER_NAME IS NOT NULL ORDER BY LEDGER_NAME;
        RETURN v_cursor;
    END get_ledgers;

    FUNCTION get_batch_statuses RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT STATUS_MEANING FROM RR_GL_JOURNAL_BATCHES
            WHERE STATUS_MEANING IS NOT NULL ORDER BY STATUS_MEANING;
        RETURN v_cursor;
    END get_batch_statuses;

END RR_MANAGE_JOURNALS_PKG;
/


-- ── STEP 2: Fix journals/create — remove wrong default ledger + use NAME col ──
-- The header INSERT in patch 61 used column NAME (not JOURNAL_NAME).
-- The default 'BUIMERC LEDGER' causes mismatches when search asks for 'SB LEDGER'.
-- Fix: raise an error if ledgerName is missing instead of silently defaulting.
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
        p_comments       => 'Create GL journal: nested {batch,header,lines} → RR_GL_JOURNAL_BATCHES + RR_GL_JE_HEADERS + RR_GL_JE_LINES_ALL',
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

    -- Batch fields
    v_batch_name    VARCHAR2(240);
    v_batch_desc    VARCHAR2(4000);
    v_ledger_name   VARCHAR2(240);
    v_ledger_id     NUMBER;
    v_acct_period   VARCHAR2(30);
    v_ctrl_total    NUMBER;
    v_batch_status  VARCHAR2(30);
    v_batch_source  VARCHAR2(240);
    v_created_by    VARCHAR2(240);

    -- Header fields
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

    -- Line fields
    v_ent_dr        NUMBER;
    v_ent_cr        NUMBER;
    v_acc_dr        NUMBER;
    v_acc_cr        NUMBER;
    v_eff_rate      NUMBER;

    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN
            RETURN NULL;
        END IF;
        DECLARE v VARCHAR2(32767) := p_obj.get_string(p_key);
        BEGIN
            RETURN CASE WHEN v = '' THEN NULL ELSE v END;
        END;
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
        RETURN CASE WHEN l_s IS NOT NULL THEN TO_DATE(SUBSTR(l_s,1,10),'YYYY-MM-DD') ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
BEGIN
    -- ── Parse JSON ───────────────────────────────────────────────────────────
    v_step       := 'Parsing JSON';
    v_root       := JSON_OBJECT_T.parse(v_body);
    v_batch_obj  := v_root.get_object('batch');
    v_header_obj := v_root.get_object('header');
    v_lines_arr  := v_root.get_array('lines');

    -- ── Batch fields ─────────────────────────────────────────────────────────
    v_step        := 'Reading batch fields';
    v_batch_name  := sstr(v_batch_obj, 'batchName');
    v_batch_desc  := sstr(v_batch_obj, 'batchDescription');
    v_ledger_name := sstr(v_batch_obj, 'ledgerName');   -- no default: fail if missing
    v_ledger_id   := NVL(snum(v_batch_obj, 'ledgerId'), 1);
    v_acct_period := sstr(v_batch_obj, 'accountingPeriod');
    v_ctrl_total  := NVL(snum(v_batch_obj, 'controlTotal'), 0);
    v_batch_status:= NVL(sstr(v_batch_obj, 'status'), 'NEW');
    v_batch_source:= sstr(v_batch_obj, 'batchSource');
    v_created_by  := NVL(sstr(v_batch_obj, 'createdBy'), 'ERP_USER');

    -- Validate required fields
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

    -- ── Header fields ────────────────────────────────────────────────────────
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

    -- ── Insert batch into RR_GL_JOURNAL_BATCHES ───────────────────────────────
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

    -- ── Insert header into RR_GL_JE_HEADERS ──────────────────────────────────
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
        v_header_desc, v_total_dr, v_total_cr, v_total_dr, v_total_cr
    );

    -- ── Insert lines into RR_GL_JE_LINES_ALL ─────────────────────────────────
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
            REFERENCE1,  REFERENCE2,  REFERENCE3,  REFERENCE4,  REFERENCE5,
            REFERENCE6,  REFERENCE7,  REFERENCE8,  REFERENCE9,  REFERENCE10,
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
            sstr(v_line_obj, 'reference1'),
            sstr(v_line_obj, 'reference2'),
            sstr(v_line_obj, 'reference3'),
            sstr(v_line_obj, 'reference4'),
            sstr(v_line_obj, 'reference5'),
            sstr(v_line_obj, 'reference6'),
            sstr(v_line_obj, 'reference7'),
            sstr(v_line_obj, 'reference8'),
            sstr(v_line_obj, 'reference9'),
            sstr(v_line_obj, 'reference10'),
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
