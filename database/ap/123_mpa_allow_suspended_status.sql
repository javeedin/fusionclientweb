-- ============================================================
-- PATCH 123: allow POSTING_STATUS = 'Suspended' on MPA schedule
--
-- The check constraint RR_AP_MPA_POST_CK originally allowed only
-- ('Not Posted','Posted','Error'). The Suspend feature sets
-- POSTING_STATUS = 'Suspended', which violated the constraint:
--   ORA-02290: check constraint (BCLDIFC.RR_AP_MPA_POST_CK) violated
--
-- Fix: drop and recreate the constraint (in ONE block, so the drop always
-- runs before the add — avoids ORA-02264 "name already used").
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- Safe to re-run.
-- ============================================================

BEGIN
    -- Drop the old constraint if present (ignore "does not exist").
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE DROP CONSTRAINT RR_AP_MPA_POST_CK';
        DBMS_OUTPUT.PUT_LINE('Dropped existing RR_AP_MPA_POST_CK.');
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -2443 THEN
                DBMS_OUTPUT.PUT_LINE('RR_AP_MPA_POST_CK did not exist — nothing to drop.');
            ELSE
                RAISE;
            END IF;
    END;

    -- Recreate including 'Suspended'.
    EXECUTE IMMEDIATE q'[
        ALTER TABLE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
        ADD CONSTRAINT RR_AP_MPA_POST_CK
        CHECK (POSTING_STATUS IN ('Not Posted','Posted','Error','Suspended'))
    ]';
    DBMS_OUTPUT.PUT_LINE('Recreated RR_AP_MPA_POST_CK with Suspended allowed.');
END;
/

-- Verify
SELECT constraint_name, search_condition
FROM   user_constraints
WHERE  constraint_name = 'RR_AP_MPA_POST_CK';
