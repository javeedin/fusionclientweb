-- =============================================================================
-- PATCH 84: Add unique constraint on (VALUE_SET_CODE, VALUE)
--
-- PROBLEM:
--   IDX_RR_VSV_UK covers (VALUE_SET_CODE, VALUE_ID) — that is a surrogate-key
--   uniqueness only. There is no constraint preventing the same VALUE code
--   from being inserted twice into the same VALUE_SET_CODE.
--
-- FIX:
--   Create a unique index IDX_RR_VSV_CODE_VAL_UK on (VALUE_SET_CODE, VALUE).
--   This allows the same value code in different value sets but rejects
--   duplicates within the same value set.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the block below.
-- =============================================================================

DECLARE
BEGIN
    -- Drop if already exists (idempotent re-run)
    BEGIN
        EXECUTE IMMEDIATE 'DROP INDEX IDX_RR_VSV_CODE_VAL_UK';
        DBMS_OUTPUT.PUT_LINE('Existing index dropped.');
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -1418 THEN NULL; -- index does not exist, fine
            ELSE RAISE;
            END IF;
    END;

    -- Create the correct business-uniqueness index
    EXECUTE IMMEDIATE
        'CREATE UNIQUE INDEX IDX_RR_VSV_CODE_VAL_UK ' ||
        'ON RR_VALUE_SET_VALUES (VALUE_SET_CODE, VALUE)';

    DBMS_OUTPUT.PUT_LINE('IDX_RR_VSV_CODE_VAL_UK created on (VALUE_SET_CODE, VALUE).');
END;
/
