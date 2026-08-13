-- ============================================================
-- Fix: search operators (Starts with / Contains / Ends with / Equals)
--      and also search BATCH_DESCRIPTION alongside BATCH_NAME.
--
-- New params added to search_journals_json and get_journal_count:
--   p_batch_name_op    VARCHAR2 DEFAULT 'C'  (S=Starts, C=Contains, E=Ends, X=Equals)
--   p_journal_desc_op  VARCHAR2 DEFAULT 'C'
--
-- ORDS handler updated to pass :batchOp and :journalOp bind variables.
-- ============================================================

CREATE OR REPLACE PACKAGE BODY RR_MANAGE_JOURNALS_PKG AS

    -- --------------------------------------------------------
    -- Helper: build a LIKE pattern from value + operator code
    --   op: S=starts-with  C=contains  E=ends-with  X=equals
    -- --------------------------------------------------------
    FUNCTION build_like_pattern(p_value IN VARCHAR2, p_op IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE NVL(UPPER(p_op), 'C')
            WHEN 'S' THEN UPPER(p_value) || '%'
            WHEN 'E' THEN '%' || UPPER(p_value)
            WHEN 'X' THEN UPPER(p_value)
            ELSE           '%' || UPPER(p_value) || '%'   -- C (contains) is default
        END;
    END build_like_pattern;

    PROCEDURE search_journals_json(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2 DEFAULT NULL,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_batch_name_op     IN VARCHAR2 DEFAULT 'C',
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_journal_desc_op   IN VARCHAR2 DEFAULT 'C',
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_offset            IN NUMBER   DEFAULT 0,
        p_limit             IN NUMBER   DEFAULT 500,
        p_from_date         IN DATE     DEFAULT NULL,
        p_to_date           IN DATE     DEFAULT NULL
    ) IS
        v_count        NUMBER;
        v_batch_like   VARCHAR2(500);
        v_journal_like VARCHAR2(500);

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
            LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
            WHERE h.LEDGER_NAME = p_ledger
              AND (p_period IS NULL OR h.PERIOD_NAME = p_period)
              AND (p_batch_name IS NULL OR
                   UPPER(b.BATCH_NAME)        LIKE v_batch_like OR
                   UPPER(b.BATCH_DESCRIPTION) LIKE v_batch_like)
              AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE v_journal_like)
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
        v_batch_like   := build_like_pattern(p_batch_name,   p_batch_name_op);
        v_journal_like := build_like_pattern(p_journal_desc,  p_journal_desc_op);

        v_count := get_journal_count(
            p_ledger, p_period, p_batch_name, p_batch_name_op,
            p_journal_desc, p_journal_desc_op, p_source, p_status_meaning,
            p_from_date, p_to_date
        );

        APEX_JSON.INITIALIZE_OUTPUT;
        APEX_JSON.OPEN_OBJECT;

        APEX_JSON.WRITE('success',     TRUE);
        APEX_JSON.WRITE('totalCount',  v_count);
        APEX_JSON.WRITE('offset',      p_offset);
        APEX_JSON.WRITE('limit',       p_limit);

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

    FUNCTION get_journal_count(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2 DEFAULT NULL,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_batch_name_op     IN VARCHAR2 DEFAULT 'C',
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_journal_desc_op   IN VARCHAR2 DEFAULT 'C',
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_from_date         IN DATE     DEFAULT NULL,
        p_to_date           IN DATE     DEFAULT NULL
    ) RETURN NUMBER IS
        v_count        NUMBER;
        v_batch_like   VARCHAR2(500);
        v_journal_like VARCHAR2(500);
    BEGIN
        v_batch_like   := build_like_pattern(p_batch_name,  p_batch_name_op);
        v_journal_like := build_like_pattern(p_journal_desc, p_journal_desc_op);

        SELECT COUNT(*)
        INTO v_count
        FROM RR_GL_JE_HEADERS h
        LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
        WHERE h.LEDGER_NAME = p_ledger
          AND (p_period IS NULL OR h.PERIOD_NAME = p_period)
          AND (p_batch_name IS NULL OR
               UPPER(b.BATCH_NAME)        LIKE v_batch_like OR
               UPPER(b.BATCH_DESCRIPTION) LIKE v_batch_like)
          AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE v_journal_like)
          AND (p_source IS NULL OR b.USER_JE_SOURCE_NAME = p_source)
          AND (p_status_meaning IS NULL OR b.STATUS_MEANING = p_status_meaning)
          AND (p_from_date IS NULL OR h.DEFAULT_EFFECTIVE_DATE >= p_from_date)
          AND (p_to_date   IS NULL OR h.DEFAULT_EFFECTIVE_DATE <= p_to_date);

        RETURN v_count;
    END get_journal_count;

    FUNCTION get_periods RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT PERIOD_NAME
            FROM RR_GL_JE_HEADERS
            WHERE PERIOD_NAME IS NOT NULL
            ORDER BY PERIOD_NAME DESC;
        RETURN v_cursor;
    END get_periods;

    FUNCTION get_sources RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT USER_JE_SOURCE_NAME
            FROM RR_GL_JOURNAL_BATCHES
            WHERE USER_JE_SOURCE_NAME IS NOT NULL
            ORDER BY USER_JE_SOURCE_NAME;
        RETURN v_cursor;
    END get_sources;

    FUNCTION get_categories RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT USER_JE_CATEGORY_NAME
            FROM RR_GL_JE_HEADERS
            WHERE USER_JE_CATEGORY_NAME IS NOT NULL
            ORDER BY USER_JE_CATEGORY_NAME;
        RETURN v_cursor;
    END get_categories;

    FUNCTION get_ledgers RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT LEDGER_NAME
            FROM RR_GL_JE_HEADERS
            WHERE LEDGER_NAME IS NOT NULL
            ORDER BY LEDGER_NAME;
        RETURN v_cursor;
    END get_ledgers;

    FUNCTION get_batch_statuses RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT STATUS_MEANING
            FROM RR_GL_JOURNAL_BATCHES
            WHERE STATUS_MEANING IS NOT NULL
            ORDER BY STATUS_MEANING;
        RETURN v_cursor;
    END get_batch_statuses;

END RR_MANAGE_JOURNALS_PKG;
/

-- ============================================================
-- Update the ORDS GET handler to pass batchOp and journalOp
-- This rewrites the handler under module 'gl', pattern 'journals/headers'
-- ============================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'journals/headers',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Search journals with operator support (Starts with / Contains / Ends with / Equals)',
        p_source         => q'[
DECLARE
    v_from_date DATE := NULL;
    v_to_date   DATE := NULL;
BEGIN
    IF :ledger IS NULL THEN
        :status := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'ledger is a mandatory parameter');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    IF :period IS NULL AND :from_date IS NULL AND :to_date IS NULL THEN
        :status := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'period or accounting date range (from_date / to_date) is required');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    IF :from_date IS NOT NULL THEN
        v_from_date := TO_DATE(:from_date, 'YYYY-MM-DD');
    END IF;
    IF :to_date IS NOT NULL THEN
        v_to_date := TO_DATE(:to_date, 'YYYY-MM-DD');
    END IF;

    :status := 200;

    RR_MANAGE_JOURNALS_PKG.search_journals_json(
        p_ledger          => :ledger,
        p_period          => :period,
        p_batch_name      => :batchName,
        p_batch_name_op   => NVL(:batchOp, 'C'),
        p_journal_desc    => :journalDesc,
        p_journal_desc_op => NVL(:journalOp, 'C'),
        p_source          => :source,
        p_status_meaning  => :statusMeaning,
        p_offset          => NVL(:offset, 0),
        p_limit           => NVL(:limit, 1000),
        p_from_date       => v_from_date,
        p_to_date         => v_to_date
    );

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/

COMMIT;
