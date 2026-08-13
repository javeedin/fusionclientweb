-- ============================================================
-- Add ORDS GET handler for gl/segment-values.
-- Returns distinct values for each segment column from
-- V_GL_JOURNAL_LINES_SEGMENTS, plus sources and categories.
-- Accepts optional ledger_name bind variable.
-- Run in APEX SQL Workshop.
-- ============================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/segment-values',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'GL Segment Values — distinct filter lists'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/segment-values',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL Segment Values — distinct filter lists',
        p_source         => q'[
DECLARE
    v_ledger VARCHAR2(240) := :ledger_name;
BEGIN
    APEX_JSON.OPEN_OBJECT;

    -- companies
    APEX_JSON.OPEN_ARRAY('companies');
    FOR r IN (
        SELECT DISTINCT COMPANY
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND COMPANY IS NOT NULL
        ORDER BY COMPANY
    ) LOOP
        APEX_JSON.WRITE(r.COMPANY);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- lobs
    APEX_JSON.OPEN_ARRAY('lobs');
    FOR r IN (
        SELECT DISTINCT LOB
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND LOB IS NOT NULL
        ORDER BY LOB
    ) LOOP
        APEX_JSON.WRITE(r.LOB);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- departments
    APEX_JSON.OPEN_ARRAY('departments');
    FOR r IN (
        SELECT DISTINCT DEPARTMENT
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND DEPARTMENT IS NOT NULL
        ORDER BY DEPARTMENT
    ) LOOP
        APEX_JSON.WRITE(r.DEPARTMENT);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- subAccounts
    APEX_JSON.OPEN_ARRAY('subAccounts');
    FOR r IN (
        SELECT DISTINCT SUB_ACCOUNT
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND SUB_ACCOUNT IS NOT NULL
        ORDER BY SUB_ACCOUNT
    ) LOOP
        APEX_JSON.WRITE(r.SUB_ACCOUNT);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- analyses
    APEX_JSON.OPEN_ARRAY('analyses');
    FOR r IN (
        SELECT DISTINCT ANALYSIS
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND ANALYSIS IS NOT NULL
        ORDER BY ANALYSIS
    ) LOOP
        APEX_JSON.WRITE(r.ANALYSIS);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- intercompanies
    APEX_JSON.OPEN_ARRAY('intercompanies');
    FOR r IN (
        SELECT DISTINCT INTERCOMPANY
        FROM V_GL_JOURNAL_LINES_SEGMENTS
        WHERE (v_ledger IS NULL OR LEDGER_NAME = v_ledger)
          AND INTERCOMPANY IS NOT NULL
        ORDER BY INTERCOMPANY
    ) LOOP
        APEX_JSON.WRITE(r.INTERCOMPANY);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- sources
    APEX_JSON.OPEN_ARRAY('sources');
    FOR r IN (
        SELECT DISTINCT USER_JE_SOURCE_NAME
        FROM RR_GL_JOURNAL_BATCHES
        WHERE USER_JE_SOURCE_NAME IS NOT NULL
        ORDER BY 1
    ) LOOP
        APEX_JSON.WRITE(r.USER_JE_SOURCE_NAME);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- categories
    APEX_JSON.OPEN_ARRAY('categories');
    FOR r IN (
        SELECT DISTINCT USER_JE_CATEGORY_NAME
        FROM RR_GL_JE_HEADERS
        WHERE USER_JE_CATEGORY_NAME IS NOT NULL
        ORDER BY 1
    ) LOOP
        APEX_JSON.WRITE(r.USER_JE_CATEGORY_NAME);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
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
