-- ============================================================
-- Fix: re-register the GET gl/journals/headers handler under
--      the CORRECT module 'reerp' (not 'gl') and add operator
--      params so Starts-with / Contains / Ends-with / Equals work.
--
-- Run in APEX SQL Workshop AFTER:
--   38_update_manage_journals_pkg_spec.sql
--   37_fix_search_operators_and_batch_desc.sql
-- ============================================================

-- The template already exists under reerp (created by file 11 for POST).
-- Re-declare it safely (EXCEPTION WHEN OTHERS ignores duplicate).
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/headers',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'GL Journal Headers search + sync endpoint'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Re-register the GET handler under reerp with operator support
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/headers',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Search journals - supports batchOp/journalOp operators and batch description search',
        p_source         => q'[
DECLARE
    v_from_date DATE := NULL;
    v_to_date   DATE := NULL;
BEGIN
    IF :ledger IS NULL THEN
        :status_code := 400;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'ledger is a mandatory parameter');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    IF :period IS NULL AND :from_date IS NULL AND :to_date IS NULL THEN
        :status_code := 400;
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

    :status_code := 200;

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
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET reerp/gl/journals/headers registered with operator support');
END;
/

COMMIT;
