-- =============================================================================
-- Add 'Balance Refund' and 'Opening Fund Balance' to RR_PC_TXN_TYPE_CK
-- Run in SQL Workshop > SQL Commands (as schema owner)
-- =============================================================================

DECLARE
    l_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_exists
    FROM   user_constraints
    WHERE  table_name      = 'RR_PC_TRANSACTIONS'
    AND    constraint_name = 'RR_PC_TXN_TYPE_CK';

    IF l_exists > 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS DROP CONSTRAINT RR_PC_TXN_TYPE_CK';
    END IF;

    EXECUTE IMMEDIATE q'[ALTER TABLE RR_PC_TRANSACTIONS
        ADD CONSTRAINT RR_PC_TXN_TYPE_CK
        CHECK (TRANSACTION_TYPE IN (
            'Balance Refill',
            'Balance Refund',
            'Opening Fund Balance',
            'Expense',
            'Adjustment',
            'Balance Return',
            'Balance Brought Fwd'
        ))]';

    DBMS_OUTPUT.PUT_LINE('Constraint RR_PC_TXN_TYPE_CK updated successfully.');
END;
/

COMMIT;
