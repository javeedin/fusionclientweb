-- ============================================================
-- APEX REST Handlers for Manage Journals API
-- Tables: RR_GL_JOURNAL_BATCHES, RR_GL_HEADERS, RR_GL_LINES_ALL
-- Created for ReactERP
-- ============================================================

-- First, create the REST module (if not exists)
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'gl',
        p_base_path      => '/gl/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'General Ledger REST APIs'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Module may already exist
END;
/

-- ============================================================
-- GET /gl/journals - Search journals with nested JSON
-- Mandatory: ledger, period
-- Optional: batchName, journalDesc, source, statusMeaning
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'journals',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Manage Journals - Search and List with nested JSON'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'journals',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Search journals - returns nested JSON (batch + header + lines)',
        p_source         => q'[
BEGIN
    -- Validate mandatory parameters
    IF :ledger IS NULL OR :period IS NULL THEN
        :status := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'ledger and period are mandatory parameters');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    :status := 200;

    -- Call package procedure - writes JSON directly
    RR_MANAGE_JOURNALS_PKG.search_journals_json(
        p_ledger         => :ledger,
        p_period         => :period,
        p_batch_name     => :batchName,
        p_journal_desc   => :journalDesc,
        p_source         => :source,
        p_status_meaning => :statusMeaning,
        p_offset         => NVL(:offset, 0),
        p_limit          => NVL(:limit, 25)
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

-- ============================================================
-- GET /gl/journals/:id/lines - Get journal lines by header ID
-- (Kept for direct line access if needed)
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'journals/:id/lines',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get journal lines by header ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'journals/:id/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get journal lines for a specific header',
        p_source         => '
            SELECT
                LINE_ID as "lineId",
                JE_LINE_NUMBER as "lineNum",
                JE_HEADER_ID as "jeHeaderId",
                BATCH_ID as "batchId",
                ACCOUNT_COMBINATION as "account",
                CHART_OF_ACCOUNTS_NAME as "chartOfAccountsName",
                DESCRIPTION as "description",
                ENTERED_DR as "enteredDr",
                ENTERED_CR as "enteredCr",
                ACCOUNTED_DR as "accountedDr",
                ACCOUNTED_CR as "accountedCr",
                CURRENCY_CODE as "currency",
                STAT_AMOUNT as "statAmount",
                RECONCILIATION_REFERENCE as "reconciliationReference"
            FROM RR_GL_JE_LINES_ALL
            WHERE JE_HEADER_ID = :id
            ORDER BY JE_LINE_NUMBER
        '
    );
    COMMIT;
END;
/

-- ============================================================
-- GET /gl/lookups/periods - Get distinct periods
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/periods',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Get distinct accounting periods'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/periods',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct accounting periods for dropdown',
        p_source         => '
            SELECT DISTINCT PERIOD_NAME as "value", PERIOD_NAME as "label"
            FROM RR_GL_HEADERS
            WHERE PERIOD_NAME IS NOT NULL
            ORDER BY PERIOD_NAME DESC
        '
    );
    COMMIT;
END;
/

-- ============================================================
-- GET /gl/lookups/sources - Get distinct sources
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/sources',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Get distinct journal sources'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/sources',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct journal sources for dropdown',
        p_source         => '
            SELECT DISTINCT USER_JE_SOURCE_NAME as "value", USER_JE_SOURCE_NAME as "label"
            FROM RR_GL_JOURNAL_BATCHES
            WHERE USER_JE_SOURCE_NAME IS NOT NULL
            ORDER BY USER_JE_SOURCE_NAME
        '
    );
    COMMIT;
END;
/

-- ============================================================
-- GET /gl/lookups/categories - Get distinct categories
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/categories',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Get distinct journal categories'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/categories',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct journal categories for dropdown',
        p_source         => '
            SELECT DISTINCT USER_JE_CATEGORY_NAME as "value", USER_JE_CATEGORY_NAME as "label"
            FROM RR_GL_HEADERS
            WHERE USER_JE_CATEGORY_NAME IS NOT NULL
            ORDER BY USER_JE_CATEGORY_NAME
        '
    );
    COMMIT;
END;
/

-- ============================================================
-- GET /gl/lookups/ledgers - Get distinct ledgers
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/ledgers',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Get distinct ledgers'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/ledgers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct ledgers for dropdown',
        p_source         => '
            SELECT DISTINCT LEDGER_NAME as "value", LEDGER_NAME as "label"
            FROM RR_GL_HEADERS
            WHERE LEDGER_NAME IS NOT NULL
            ORDER BY LEDGER_NAME
        '
    );
    COMMIT;
END;
/

-- ============================================================
-- GET /gl/lookups/batch-statuses - Get distinct batch statuses
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/batch-statuses',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Get distinct batch statuses'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'lookups/batch-statuses',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct batch statuses for dropdown',
        p_source         => '
            SELECT DISTINCT STATUS_MEANING as "value", STATUS_MEANING as "label"
            FROM RR_GL_JOURNAL_BATCHES
            WHERE STATUS_MEANING IS NOT NULL
            ORDER BY STATUS_MEANING
        '
    );
    COMMIT;
END;
/

COMMIT;
