-- ============================================================
-- Update RR_MANAGE_JOURNALS_PKG spec to add operator params
-- and expose the build_like_pattern helper.
-- Run AFTER 37_fix_search_operators_and_batch_desc.sql
-- ============================================================

CREATE OR REPLACE PACKAGE RR_MANAGE_JOURNALS_PKG AS

    -- Helper: build LIKE pattern (S=starts, C=contains, E=ends, X=equals)
    FUNCTION build_like_pattern(p_value IN VARCHAR2, p_op IN VARCHAR2) RETURN VARCHAR2;

    -- Search journals and write JSON directly to HTP buffer
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
    );

    -- Get total count for pagination
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
    ) RETURN NUMBER;

    -- Get distinct values for dropdowns
    FUNCTION get_periods RETURN SYS_REFCURSOR;
    FUNCTION get_sources RETURN SYS_REFCURSOR;
    FUNCTION get_categories RETURN SYS_REFCURSOR;
    FUNCTION get_ledgers RETURN SYS_REFCURSOR;
    FUNCTION get_batch_statuses RETURN SYS_REFCURSOR;

END RR_MANAGE_JOURNALS_PKG;
/
