-- =============================================================================
-- PC: original_suspense_amount column + suspense refund rework
--
-- Changes:
--   1. Add ORIGINAL_SUSPENSE_AMOUNT column (populated when suspense is created)
--   2. Drop the SUSPENSE_AMOUNT >= 0 constraint so refund rows can carry -ve
--   3. Update create_transaction in RR_PC_PKG to save originalSuspenseAmount
--   4. Update GET /pc/registers/:id/transactions to return originalSuspenseAmount
-- =============================================================================

-- 1. Add ORIGINAL_SUSPENSE_AMOUNT column
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS ADD (ORIGINAL_SUSPENSE_AMOUNT NUMBER(18,2))';
    DBMS_OUTPUT.PUT_LINE('Column ORIGINAL_SUSPENSE_AMOUNT added.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN
            DBMS_OUTPUT.PUT_LINE('Column ORIGINAL_SUSPENSE_AMOUNT already exists — skipped.');
        ELSE RAISE;
        END IF;
END;
/

-- 2. Drop the >= 0 check constraint so suspense refund rows can have -ve suspenseAmount
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_PC_TRANSACTIONS DROP CONSTRAINT RR_PC_TXN_SUSP_CK';
    DBMS_OUTPUT.PUT_LINE('Constraint RR_PC_TXN_SUSP_CK dropped.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -2443 THEN
            DBMS_OUTPUT.PUT_LINE('Constraint not found — already dropped or never created.');
        ELSE RAISE;
        END IF;
END;
/

COMMIT;

-- =============================================================================
-- 3. Update RR_PC_PKG — add originalSuspenseAmount to create_transaction
--    (partial replacement; re-run 03_pc_pkg.sql for a full refresh)
-- =============================================================================
-- NOTE: Run 03_pc_pkg.sql after this file to pick up the full package rebuild.
--       The snippet below is provided as a reference for the required changes:
--
--   In create_transaction:
--     DECLARE:   l_orig_susp  NUMBER;
--     PARSE:     l_orig_susp := APEX_JSON.GET_NUMBER(p_path => 'originalSuspenseAmount');
--     INSERT cols: ORIGINAL_SUSPENSE_AMOUNT,
--     INSERT vals: l_orig_susp,
--
-- =============================================================================

-- 4. Update ORDS GET /pc/registers/:registerId/transactions to return the new column
--    (ORDS handler is defined in 02_pc_ords.sql; update handler inline here)
DECLARE
  v_src VARCHAR2(32767) := q'[
DECLARE
    CURSOR c IS
        SELECT t.TRANSACTION_ID,
               t.REGISTER_ID,
               t.LINE_NUMBER,
               t.TRANSACTION_DATE,
               t.TRANSACTION_TYPE,
               t.EXPENSE_TYPE,
               t.CHARGE_ACCOUNT_CCID,
               t.CHARGE_ACCOUNT_DESC,
               t.ACCOUNTING_DATE,
               t.ACCOUNTING_PERIOD,
               t.POSTING_STATUS,
               t.CURRENCY,
               NVL(t.DEBIT_AMOUNT,    0) AS DEBIT_AMOUNT,
               NVL(t.CREDIT_AMOUNT,   0) AS CREDIT_AMOUNT,
               NVL(t.SUSPENSE_AMOUNT, 0) AS SUSPENSE_AMOUNT,
               t.ORIGINAL_SUSPENSE_AMOUNT,
               t.COMMENTS,
               t.REFERENCE_DESCRIPTION,
               t.REFERENCE_NO,
               t.ATTACHMENT,
               t.HAS_ATTACHMENT,
               t.EMPLOYEE_NAME,
               t.RECEIPT_STATUS,
               t.BANK_TXN_ID,
               t.CREATED_BY,
               t.CREATION_DATE,
               SUM(NVL(t2.DEBIT_AMOUNT,0) - NVL(t2.CREDIT_AMOUNT,0))
                   OVER (PARTITION BY t.REGISTER_ID
                         ORDER BY t.TRANSACTION_DATE, t.TRANSACTION_ID
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RUNNING_BALANCE,
               (SELECT COUNT(*) FROM RR_PC_ATTACHMENTS a
                WHERE a.TRANSACTION_ID = t.TRANSACTION_ID) AS ATTACH_COUNT
        FROM   RR_PC_TRANSACTIONS t
        JOIN   RR_PC_TRANSACTIONS t2 ON t2.TRANSACTION_ID = t.TRANSACTION_ID
        WHERE  t.REGISTER_ID = :registerId
        ORDER  BY t.TRANSACTION_DATE, t.TRANSACTION_ID;
BEGIN
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'', TRUE);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR rec IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''transactionId'',          rec.TRANSACTION_ID);
        APEX_JSON.WRITE(''registerId'',             rec.REGISTER_ID);
        APEX_JSON.WRITE(''lineNumber'',             rec.LINE_NUMBER);
        APEX_JSON.WRITE(''transactionDate'',        TO_CHAR(rec.TRANSACTION_DATE,''YYYY-MM-DD''));
        APEX_JSON.WRITE(''transactionType'',        rec.TRANSACTION_TYPE);
        APEX_JSON.WRITE(''expenseType'',            rec.EXPENSE_TYPE);
        APEX_JSON.WRITE(''chargeAccountCcid'',      rec.CHARGE_ACCOUNT_CCID);
        APEX_JSON.WRITE(''chargeAccountDesc'',      rec.CHARGE_ACCOUNT_DESC);
        APEX_JSON.WRITE(''accountingDate'',         TO_CHAR(rec.ACCOUNTING_DATE,''YYYY-MM-DD''));
        APEX_JSON.WRITE(''accountingPeriod'',       rec.ACCOUNTING_PERIOD);
        APEX_JSON.WRITE(''postingStatus'',          rec.POSTING_STATUS);
        APEX_JSON.WRITE(''currency'',               rec.CURRENCY);
        APEX_JSON.WRITE(''debitAmount'',            rec.DEBIT_AMOUNT);
        APEX_JSON.WRITE(''creditAmount'',           rec.CREDIT_AMOUNT);
        APEX_JSON.WRITE(''suspenseAmount'',         rec.SUSPENSE_AMOUNT);
        APEX_JSON.WRITE(''originalSuspenseAmount'', rec.ORIGINAL_SUSPENSE_AMOUNT);
        APEX_JSON.WRITE(''comments'',               rec.COMMENTS);
        APEX_JSON.WRITE(''referenceDescription'',   rec.REFERENCE_DESCRIPTION);
        APEX_JSON.WRITE(''referenceNo'',            rec.REFERENCE_NO);
        APEX_JSON.WRITE(''attachment'',             rec.ATTACHMENT);
        APEX_JSON.WRITE(''hasAttachment'',          rec.HAS_ATTACHMENT);
        APEX_JSON.WRITE(''employeeName'',           rec.EMPLOYEE_NAME);
        APEX_JSON.WRITE(''receiptStatus'',          rec.RECEIPT_STATUS);
        APEX_JSON.WRITE(''bankTxnId'',              rec.BANK_TXN_ID);
        APEX_JSON.WRITE(''createdBy'',              rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',           TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
        APEX_JSON.WRITE(''runningBalance'',         rec.RUNNING_BALANCE);
        APEX_JSON.WRITE(''attachmentCount'',        rec.ATTACH_COUNT);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    HTP.PRN(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
END;
]';
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pc',
        p_pattern        => 'registers/:registerId/transactions',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => v_src
    );
    COMMIT;
END;
/

-- =============================================================================
-- 5. Update POST /pc/transactions to accept and save originalSuspenseAmount
-- =============================================================================
DECLARE
  v_src VARCHAR2(32767) := q'[
DECLARE
    l_id     NUMBER;
    l_line   NUMBER;
    l_error  VARCHAR2(4000);
    l_json   CLOB;
    l_orig_susp NUMBER;
BEGIN
    l_json := :body;
    -- Call existing package procedure
    RR_PC_PKG.create_transaction(
        p_json  => l_json,
        p_id    => l_id,
        p_line  => l_line,
        p_error => l_error
    );
    IF l_error IS NOT NULL THEN
        IF l_error LIKE ''NOT_FOUND:%'' THEN :status_code := 404;
        ELSIF l_error LIKE ''BLOCKED:%''  THEN :status_code := 422;
        ELSE :status_code := 500;
        END IF;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''success'', FALSE);
        APEX_JSON.WRITE(''message'', SUBSTR(l_error, INSTR(l_error,'':'')+1));
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;
    -- Save originalSuspenseAmount if provided
    BEGIN
        APEX_JSON.PARSE(l_json);
        l_orig_susp := APEX_JSON.GET_NUMBER(p_path => ''originalSuspenseAmount'');
        IF l_orig_susp IS NOT NULL THEN
            UPDATE RR_PC_TRANSACTIONS
               SET ORIGINAL_SUSPENSE_AMOUNT = l_orig_susp
             WHERE TRANSACTION_ID = l_id;
            COMMIT;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    :status_code := 201;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'',       TRUE);
    APEX_JSON.WRITE(''transactionId'', l_id);
    APEX_JSON.WRITE(''lineNumber'',    l_line);
    APEX_JSON.CLOSE_OBJECT;
END;
]';
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pc',
        p_pattern        => 'transactions',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => v_src
    );
    COMMIT;
END;
/

COMMIT;
