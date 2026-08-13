-- ============================================================
-- Petty Cash — Patch: fix GET transactions handler
-- File: database/pc/07b_pc_fix_txn_handler.sql
-- ============================================================
-- Fixes ORA-00904 "HAS_ATTACHMENT" invalid identifier.
-- HAS_ATTACHMENT is not a real column on RR_PC_TRANSACTIONS;
-- it is computed as CASE WHEN ATTACHMENT IS NOT NULL THEN 'Y' ELSE 'N'.
-- Run this if 07_pc_attachments.sql was already deployed.
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/transactions',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    v_clob CLOB;
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
               t.DEBIT_AMOUNT,
               t.CREDIT_AMOUNT,
               t.COMMENTS,
               t.REFERENCE_NO,
               t.ATTACHMENT,
               CASE WHEN t.ATTACHMENT IS NOT NULL THEN ''Y'' ELSE ''N'' END AS HAS_ATTACHMENT,
               t.EMPLOYEE_NAME,
               t.RECEIPT_STATUS,
               t.BANK_TXN_ID,
               t.CREATED_BY,
               t.CREATION_DATE,
               SUM(t.DEBIT_AMOUNT - t.CREDIT_AMOUNT) OVER (
                   PARTITION BY t.REGISTER_ID
                   ORDER BY t.TRANSACTION_DATE, t.LINE_NUMBER
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS RUNNING_BALANCE,
               (SELECT COUNT(*) FROM RR_PC_ATTACHMENTS a
                WHERE  a.TRANSACTION_ID = t.TRANSACTION_ID) AS ATTACHMENT_COUNT
        FROM   RR_PC_TRANSACTIONS t
        WHERE  t.REGISTER_ID = :registerId
        ORDER BY t.TRANSACTION_DATE, t.LINE_NUMBER;
BEGIN
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'', TRUE);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR rec IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''transactionId'',    rec.TRANSACTION_ID);
        APEX_JSON.WRITE(''registerId'',       rec.REGISTER_ID);
        APEX_JSON.WRITE(''lineNumber'',       rec.LINE_NUMBER);
        APEX_JSON.WRITE(''transactionDate'',  TO_CHAR(rec.TRANSACTION_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''transactionType'',  rec.TRANSACTION_TYPE);
        APEX_JSON.WRITE(''expenseType'',      rec.EXPENSE_TYPE);
        APEX_JSON.WRITE(''chargeAccountCcid'',rec.CHARGE_ACCOUNT_CCID);
        APEX_JSON.WRITE(''chargeAccountDesc'',rec.CHARGE_ACCOUNT_DESC);
        APEX_JSON.WRITE(''accountingDate'',   TO_CHAR(rec.ACCOUNTING_DATE,  ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''accountingPeriod'', rec.ACCOUNTING_PERIOD);
        APEX_JSON.WRITE(''postingStatus'',    rec.POSTING_STATUS);
        APEX_JSON.WRITE(''currency'',         NVL(rec.CURRENCY, ''AED''));
        APEX_JSON.WRITE(''debitAmount'',      rec.DEBIT_AMOUNT);
        APEX_JSON.WRITE(''creditAmount'',     rec.CREDIT_AMOUNT);
        APEX_JSON.WRITE(''comments'',         rec.COMMENTS);
        APEX_JSON.WRITE(''referenceNo'',      rec.REFERENCE_NO);
        APEX_JSON.WRITE(''attachment'',       rec.ATTACHMENT);
        APEX_JSON.WRITE(''hasAttachment'',    rec.HAS_ATTACHMENT);
        APEX_JSON.WRITE(''employeeName'',     rec.EMPLOYEE_NAME);
        APEX_JSON.WRITE(''receiptStatus'',    rec.RECEIPT_STATUS);
        APEX_JSON.WRITE(''bankTxnId'',        rec.BANK_TXN_ID);
        APEX_JSON.WRITE(''createdBy'',        rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',     TO_CHAR(rec.CREATION_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''runningBalance'',   rec.RUNNING_BALANCE);
        APEX_JSON.WRITE(''attachmentCount'',  rec.ATTACHMENT_COUNT);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    HTP.PRN(v_clob);
END;
'
    );
    COMMIT;
END;
/
