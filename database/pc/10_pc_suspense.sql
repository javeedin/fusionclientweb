-- =============================================================================
-- PC Suspense Amount — patch file
-- Run in SQL Workshop > SQL Commands (as schema owner)
-- After running this, also re-run 03_pc_pkg.sql and 02_pc_ords.sql
-- =============================================================================

-- 1. Add SUSPENSE_AMOUNT column to RR_PC_TRANSACTIONS
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS ADD (SUSPENSE_AMOUNT NUMBER(18,2) DEFAULT 0)';
    DBMS_OUTPUT.PUT_LINE('Column SUSPENSE_AMOUNT added.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN
            DBMS_OUTPUT.PUT_LINE('Column SUSPENSE_AMOUNT already exists — skipped.');
        ELSE
            RAISE;
        END IF;
END;
/

-- 2. Add check constraint (>= 0)
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS ADD CONSTRAINT RR_PC_TXN_SUSP_CK CHECK (SUSPENSE_AMOUNT >= 0)';
    DBMS_OUTPUT.PUT_LINE('Constraint RR_PC_TXN_SUSP_CK added.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -2264 THEN
            DBMS_OUTPUT.PUT_LINE('Constraint already exists — skipped.');
        ELSE
            RAISE;
        END IF;
END;
/

COMMIT;
-- After this, re-run database/pc/03_pc_pkg.sql  (adds suspenseAmount to create_transaction)
-- After this, re-run database/pc/02_pc_ords.sql  (returns suspenseAmount in GET response)
