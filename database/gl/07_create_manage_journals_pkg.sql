-- ============================================================
-- RR_MANAGE_JOURNALS_PKG - Package for Manage Journals API
-- Created for ReactERP - Oracle Fusion Data Sync
-- Tables: RR_GL_JOURNAL_BATCHES, RR_GL_HEADERS, RR_GL_LINES_ALL
-- Returns nested JSON: Batch fields -> Header fields -> Lines array
-- Uses APEX_JSON for clean JSON generation
-- ============================================================

CREATE OR REPLACE PACKAGE RR_MANAGE_JOURNALS_PKG AS

    -- Search journals and write JSON directly to HTP buffer
    PROCEDURE search_journals_json(
        p_ledger            IN VARCHAR2,           -- MANDATORY
        p_period            IN VARCHAR2,           -- MANDATORY
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_offset            IN NUMBER DEFAULT 0,
        p_limit             IN NUMBER DEFAULT 25
    );

    -- Get total count for pagination
    FUNCTION get_journal_count(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER;

    -- Get distinct values for dropdowns
    FUNCTION get_periods RETURN SYS_REFCURSOR;
    FUNCTION get_sources RETURN SYS_REFCURSOR;
    FUNCTION get_categories RETURN SYS_REFCURSOR;
    FUNCTION get_ledgers RETURN SYS_REFCURSOR;
    FUNCTION get_batch_statuses RETURN SYS_REFCURSOR;

END RR_MANAGE_JOURNALS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_MANAGE_JOURNALS_PKG AS

    -- Search journals and write JSON using APEX_JSON
    PROCEDURE search_journals_json(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL,
        p_offset            IN NUMBER DEFAULT 0,
        p_limit             IN NUMBER DEFAULT 25
    ) IS
        v_count NUMBER;

        -- Header cursor with batch info
        CURSOR c_headers IS
            SELECT
                -- Batch fields (from RR_GL_JOURNAL_BATCHES)
                b.BATCH_SYNC_ID AS BATCH_ID,
                b.JE_BATCH_ID,
                b.BATCH_NAME,
                b.BATCH_DESCRIPTION,
                b.USER_JE_SOURCE_NAME AS SOURCE,
                b.STATUS,
                b.STATUS_MEANING,
                b.APPROVAL_STATUS_MEANING,
                b.POSTED_DATE,
                -- Header fields (from RR_GL_HEADERS)
                h.HEADER_ID,
                h.JE_HEADER_ID,
                h.JOURNAL_NAME,
                h.JOURNAL_DESCRIPTION,
                h.PERIOD_NAME,
                h.USER_JE_CATEGORY_NAME AS CATEGORY,
                h.LEDGER_NAME,
                h.LEGAL_ENTITY_NAME,
                h.CURRENCY_CODE,
                h.RUNNING_TOTAL_DR AS ENTERED_DEBIT,
                h.RUNNING_TOTAL_CR AS ENTERED_CREDIT,
                h.RUNNING_TOTAL_ACCOUNTED_DR AS ACCOUNTED_DEBIT,
                h.RUNNING_TOTAL_ACCOUNTED_CR AS ACCOUNTED_CREDIT,
                h.DEFAULT_EFFECTIVE_DATE AS EFFECTIVE_DATE,
                h.EXTERNAL_REFERENCE,
                h.CREATION_DATE
            FROM RR_GL_HEADERS h
            LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
            WHERE h.LEDGER_NAME = p_ledger
              AND h.PERIOD_NAME = p_period
              AND (p_batch_name IS NULL OR UPPER(b.BATCH_NAME) LIKE '%' || UPPER(p_batch_name) || '%')
              AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE '%' || UPPER(p_journal_desc) || '%')
              AND (p_source IS NULL OR b.USER_JE_SOURCE_NAME = p_source)
              AND (p_status_meaning IS NULL OR b.STATUS_MEANING = p_status_meaning)
            ORDER BY h.CREATION_DATE DESC
            OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY;

        -- Line cursor
        CURSOR c_lines(p_je_header_id NUMBER) IS
            SELECT
                LINE_ID,
                JE_LINE_NUMBER AS LINE_NUM,
                ACCOUNT_COMBINATION AS ACCOUNT,
                DESCRIPTION,
                ENTERED_DR,
                ENTERED_CR,
                ACCOUNTED_DR,
                ACCOUNTED_CR,
                CURRENCY_CODE AS CURRENCY
            FROM RR_GL_LINES_ALL
            WHERE JE_HEADER_ID = p_je_header_id
            ORDER BY JE_LINE_NUMBER;

    BEGIN
        -- Get total count
        v_count := get_journal_count(
            p_ledger, p_period, p_batch_name,
            p_journal_desc, p_source, p_status_meaning
        );

        -- Initialize APEX_JSON
        APEX_JSON.INITIALIZE_OUTPUT;
        APEX_JSON.OPEN_OBJECT;

        -- Root level properties
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('totalCount', v_count);
        APEX_JSON.WRITE('offset', p_offset);
        APEX_JSON.WRITE('limit', p_limit);

        -- Open items array
        APEX_JSON.OPEN_ARRAY('items');

        -- Loop through headers
        FOR r_header IN c_headers LOOP
            APEX_JSON.OPEN_OBJECT;

            -- Batch fields first
            APEX_JSON.WRITE('batchId', r_header.BATCH_ID);
            APEX_JSON.WRITE('jeBatchId', r_header.JE_BATCH_ID);
            APEX_JSON.WRITE('batchName', r_header.BATCH_NAME);
            APEX_JSON.WRITE('batchDescription', r_header.BATCH_DESCRIPTION);
            APEX_JSON.WRITE('source', r_header.SOURCE);
            APEX_JSON.WRITE('status', r_header.STATUS);
            APEX_JSON.WRITE('statusMeaning', r_header.STATUS_MEANING);
            APEX_JSON.WRITE('approvalStatusMeaning', r_header.APPROVAL_STATUS_MEANING);
            APEX_JSON.WRITE('postedDate', TO_CHAR(r_header.POSTED_DATE, 'YYYY-MM-DD'));

            -- Header fields
            APEX_JSON.WRITE('headerId', r_header.HEADER_ID);
            APEX_JSON.WRITE('jeHeaderId', r_header.JE_HEADER_ID);
            APEX_JSON.WRITE('journalName', r_header.JOURNAL_NAME);
            APEX_JSON.WRITE('journalDescription', r_header.JOURNAL_DESCRIPTION);
            APEX_JSON.WRITE('periodName', r_header.PERIOD_NAME);
            APEX_JSON.WRITE('category', r_header.CATEGORY);
            APEX_JSON.WRITE('ledgerName', r_header.LEDGER_NAME);
            APEX_JSON.WRITE('legalEntityName', r_header.LEGAL_ENTITY_NAME);
            APEX_JSON.WRITE('currencyCode', r_header.CURRENCY_CODE);
            APEX_JSON.WRITE('enteredDebit', r_header.ENTERED_DEBIT);
            APEX_JSON.WRITE('enteredCredit', r_header.ENTERED_CREDIT);
            APEX_JSON.WRITE('accountedDebit', r_header.ACCOUNTED_DEBIT);
            APEX_JSON.WRITE('accountedCredit', r_header.ACCOUNTED_CREDIT);
            APEX_JSON.WRITE('effectiveDate', TO_CHAR(r_header.EFFECTIVE_DATE, 'YYYY-MM-DD'));
            APEX_JSON.WRITE('externalReference', r_header.EXTERNAL_REFERENCE);
            APEX_JSON.WRITE('creationDate', TO_CHAR(r_header.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS'));

            -- Open lines array
            APEX_JSON.OPEN_ARRAY('lines');

            -- Loop through lines for this header
            FOR r_line IN c_lines(r_header.JE_HEADER_ID) LOOP
                APEX_JSON.OPEN_OBJECT;
                APEX_JSON.WRITE('lineId', r_line.LINE_ID);
                APEX_JSON.WRITE('lineNum', r_line.LINE_NUM);
                APEX_JSON.WRITE('account', r_line.ACCOUNT);
                APEX_JSON.WRITE('description', r_line.DESCRIPTION);
                APEX_JSON.WRITE('enteredDr', r_line.ENTERED_DR);
                APEX_JSON.WRITE('enteredCr', r_line.ENTERED_CR);
                APEX_JSON.WRITE('accountedDr', r_line.ACCOUNTED_DR);
                APEX_JSON.WRITE('accountedCr', r_line.ACCOUNTED_CR);
                APEX_JSON.WRITE('currency', r_line.CURRENCY);
                APEX_JSON.CLOSE_OBJECT;
            END LOOP;

            -- Close lines array
            APEX_JSON.CLOSE_ARRAY;

            -- Close header object
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        -- Close items array
        APEX_JSON.CLOSE_ARRAY;

        -- Close root object
        APEX_JSON.CLOSE_OBJECT;

    END search_journals_json;

    -- Get total count for pagination
    FUNCTION get_journal_count(
        p_ledger            IN VARCHAR2,
        p_period            IN VARCHAR2,
        p_batch_name        IN VARCHAR2 DEFAULT NULL,
        p_journal_desc      IN VARCHAR2 DEFAULT NULL,
        p_source            IN VARCHAR2 DEFAULT NULL,
        p_status_meaning    IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
        INTO v_count
        FROM RR_GL_HEADERS h
        LEFT JOIN RR_GL_JOURNAL_BATCHES b ON h.BATCH_ID = b.JE_BATCH_ID
        WHERE h.LEDGER_NAME = p_ledger
          AND h.PERIOD_NAME = p_period
          AND (p_batch_name IS NULL OR UPPER(b.BATCH_NAME) LIKE '%' || UPPER(p_batch_name) || '%')
          AND (p_journal_desc IS NULL OR UPPER(h.JOURNAL_DESCRIPTION) LIKE '%' || UPPER(p_journal_desc) || '%')
          AND (p_source IS NULL OR b.USER_JE_SOURCE_NAME = p_source)
          AND (p_status_meaning IS NULL OR b.STATUS_MEANING = p_status_meaning);

        RETURN v_count;
    END get_journal_count;

    -- Get distinct periods from headers
    FUNCTION get_periods RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT PERIOD_NAME
            FROM RR_GL_HEADERS
            WHERE PERIOD_NAME IS NOT NULL
            ORDER BY PERIOD_NAME DESC;
        RETURN v_cursor;
    END get_periods;

    -- Get distinct sources from batches
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

    -- Get distinct categories from headers
    FUNCTION get_categories RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT USER_JE_CATEGORY_NAME
            FROM RR_GL_HEADERS
            WHERE USER_JE_CATEGORY_NAME IS NOT NULL
            ORDER BY USER_JE_CATEGORY_NAME;
        RETURN v_cursor;
    END get_categories;

    -- Get distinct ledgers from headers
    FUNCTION get_ledgers RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT DISTINCT LEDGER_NAME
            FROM RR_GL_HEADERS
            WHERE LEDGER_NAME IS NOT NULL
            ORDER BY LEDGER_NAME;
        RETURN v_cursor;
    END get_ledgers;

    -- Get distinct batch statuses from batches
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
