-- ============================================================
-- Petty Cash Module — Transfer to New Register: DB Constraints
-- File: database/pc/06_pc_transfer.sql
-- Run order: 6th (after 05_pc_voucher_no.sql)
-- ============================================================
-- Changes:
--   1. RR_PC_REGISTERS STATUS constraint: add 'Transferred'
--   2. RR_PC_TRANSACTIONS TRANSACTION_TYPE constraint:
--      add 'Balance Brought Fwd', 'Balance Return'
-- ============================================================

-- ── 1. Register STATUS constraint ─────────────────────────────
DECLARE
    l_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_exists
    FROM   user_constraints
    WHERE  table_name       = 'RR_PC_REGISTERS'
    AND    constraint_name  = 'RR_PC_REG_STATUS_CK';

    IF l_exists > 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_REGISTERS DROP CONSTRAINT RR_PC_REG_STATUS_CK';
    END IF;

    EXECUTE IMMEDIATE q'[ALTER TABLE RR_PC_REGISTERS
        ADD CONSTRAINT RR_PC_REG_STATUS_CK
        CHECK (STATUS IN ('DRAFT','ACTIVE','INACTIVE','CLOSED','Transferred'))]';
END;
/

-- ── 2. Transaction TRANSACTION_TYPE constraint ─────────────────
DECLARE
    l_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_exists
    FROM   user_constraints
    WHERE  table_name       = 'RR_PC_TRANSACTIONS'
    AND    constraint_name  = 'RR_PC_TXN_TYPE_CK';

    IF l_exists > 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS DROP CONSTRAINT RR_PC_TXN_TYPE_CK';
    END IF;

    EXECUTE IMMEDIATE q'[ALTER TABLE RR_PC_TRANSACTIONS
        ADD CONSTRAINT RR_PC_TXN_TYPE_CK
        CHECK (TRANSACTION_TYPE IN (
            'Balance Refill',
            'Expense',
            'Adjustment',
            'Balance Return',
            'Balance Brought Fwd'
        ))]';
END;
/

COMMIT;
