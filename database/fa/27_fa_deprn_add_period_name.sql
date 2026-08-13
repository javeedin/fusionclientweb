-- =============================================================================
-- 27_FA_DEPRN_ADD_PERIOD_NAME.SQL
--
-- Adds PERIOD_NAME column to RR_FA_DEPRN_DETAIL and RR_FA_DEPRN_SUMMARY.
-- Safe to re-run (column additions are idempotent via EXECUTE IMMEDIATE).
-- Run BEFORE re-running 22_fa_deprn_pkg.sql.
-- =============================================================================

DECLARE
    PROCEDURE add_col_if_missing (
        p_table  IN VARCHAR2,
        p_column IN VARCHAR2,
        p_ddl    IN VARCHAR2
    ) IS
        v_exists NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_exists
        FROM   USER_TAB_COLUMNS
        WHERE  TABLE_NAME  = UPPER(p_table)
        AND    COLUMN_NAME = UPPER(p_column);

        IF v_exists = 0 THEN
            EXECUTE IMMEDIATE p_ddl;
            DBMS_OUTPUT.PUT_LINE('Added column ' || p_column || ' to ' || p_table);
        ELSE
            DBMS_OUTPUT.PUT_LINE('Column ' || p_column || ' already exists on ' || p_table || ' — skipped');
        END IF;
    END;
BEGIN
    add_col_if_missing(
        'RR_FA_DEPRN_DETAIL',
        'PERIOD_NAME',
        'ALTER TABLE RR_FA_DEPRN_DETAIL ADD (PERIOD_NAME VARCHAR2(30))'
    );

    add_col_if_missing(
        'RR_FA_DEPRN_SUMMARY',
        'PERIOD_NAME',
        'ALTER TABLE RR_FA_DEPRN_SUMMARY ADD (PERIOD_NAME VARCHAR2(30))'
    );
END;
/
