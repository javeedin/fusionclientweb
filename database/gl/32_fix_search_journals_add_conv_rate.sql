-- ============================================================
-- Fix: add CURRENCY_CONVERSION_RATE + USER_CURRENCY_CONVERSION_TYPE
-- to the search_journals_json cursor and JSON output so the
-- ManageJournals edit panel can pre-populate the conversion rate
-- instead of defaulting to 1.
-- ============================================================

CREATE OR REPLACE PACKAGE BODY RR_MANAGE_JOURNALS_PKG AS

    PROCEDURE search_journals_json(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2 DEFAULT NULL,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
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
            LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
            WHERE h.LEDGER_NAME = p_ledger
              AND (p_period IS NULL OR h.PERIOD_NAME = p_period)
              AND (p_batch_name IS NULL OR UPPER(b.BATCH_NAME) LIKE '%' || UPPER(p_batch_name) || '%')
              AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE '%' || UPPER(p_journal_desc) || '%')
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
            p_ledger, p_period, p_batch_name,
            p_journal_desc, p_source, p_status_meaning,
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
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
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
        LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
        WHERE h.LEDGER_NAME = p_ledger
          AND (p_period IS NULL OR h.PERIOD_NAME = p_period)
          AND (p_batch_name IS NULL OR UPPER(b.BATCH_NAME) LIKE '%' || UPPER(p_batch_name) || '%')
          AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE '%' || UPPER(p_journal_desc) || '%')
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
