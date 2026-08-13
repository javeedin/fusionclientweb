-- ============================================================
-- Petty Cash — Patch: add REFERENCE_DESCRIPTION column
-- File: database/pc/08_pc_reference_description.sql
-- ============================================================
-- 1. Add REFERENCE_DESCRIPTION to RR_PC_TRANSACTIONS (idempotent)
-- 2. Patch create_transaction and update_transaction in RR_PC_PKG
-- 3. Redefine GET registers/:registerId/transactions to return it
-- 4. Redefine GET transactions/:transactionId to return it
-- Run once after 07_pc_attachments.sql.
-- ============================================================

-- ── 1. Add column (idempotent) ────────────────────────────
DECLARE
    l_cnt NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_cnt
    FROM   USER_TAB_COLUMNS
    WHERE  TABLE_NAME  = 'RR_PC_TRANSACTIONS'
    AND    COLUMN_NAME = 'REFERENCE_DESCRIPTION';
    IF l_cnt = 0 THEN
        EXECUTE IMMEDIATE
            'ALTER TABLE RR_PC_TRANSACTIONS ADD (REFERENCE_DESCRIPTION VARCHAR2(500))';
        DBMS_OUTPUT.PUT_LINE('Column REFERENCE_DESCRIPTION added.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('Column REFERENCE_DESCRIPTION already exists — skipped.');
    END IF;
END;
/

-- ── 2. Patch package: create_transaction + update_transaction ──
-- (full CREATE OR REPLACE PACKAGE BODY — must stay in sync with 03_pc_pkg.sql)
CREATE OR REPLACE PACKAGE BODY RR_PC_PKG AS

    FUNCTION parse_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(p_str, 'YYYY-MM-DD');
    END parse_date;

    -- ══════════════════════════════════════════════════════════
    -- create_register  (unchanged — keep for package completeness)
    -- ══════════════════════════════════════════════════════════
    PROCEDURE create_register (
        p_json     IN  CLOB,
        p_id       OUT NUMBER,
        p_error    OUT VARCHAR2
    ) IS
        l_name     VARCHAR2(200);
        l_bu       VARCHAR2(240);
        l_start    DATE;
        l_end      DATE;
        l_comments VARCHAR2(1000);
        l_ccid     NUMBER;
        l_acc_desc VARCHAR2(400);
        l_currency VARCHAR2(10);
        l_status   VARCHAR2(50);
        l_owned_by VARCHAR2(240);
        l_limit    NUMBER;
        l_by       VARCHAR2(150);
    BEGIN
        p_error := NULL;
        APEX_JSON.PARSE(p_json);
        l_name     := APEX_JSON.GET_VARCHAR2(p_path => 'registerName');
        l_bu       := APEX_JSON.GET_VARCHAR2(p_path => 'businessUnit');
        l_start    := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'startDate'));
        l_end      := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'endDate'));
        l_comments := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ccid     := APEX_JSON.GET_NUMBER  (p_path => 'cashAccountCcid');
        l_acc_desc := APEX_JSON.GET_VARCHAR2(p_path => 'cashAccountDesc');
        l_currency := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'currency'), 'AED');
        l_status   := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'status'), 'DRAFT');
        l_owned_by := APEX_JSON.GET_VARCHAR2(p_path => 'ownedBy');
        l_limit    := APEX_JSON.GET_NUMBER  (p_path => 'limit');
        l_by       := APEX_JSON.GET_VARCHAR2(p_path => 'createdBy');

        INSERT INTO RR_PC_REGISTERS (
            REGISTER_NAME, BUSINESS_UNIT, START_DATE, END_DATE,
            COMMENTS, CASH_ACCOUNT_CCID, CASH_ACCOUNT_DESC,
            CURRENCY, STATUS, OWNED_BY, CASH_LIMIT,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            l_name, l_bu, l_start, l_end,
            l_comments, l_ccid, l_acc_desc,
            l_currency, l_status, l_owned_by, l_limit,
            l_by, SYSTIMESTAMP, l_by, SYSTIMESTAMP
        ) RETURNING REGISTER_ID INTO p_id;
        COMMIT;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END create_register;

    -- ══════════════════════════════════════════════════════════
    -- update_register  (unchanged)
    -- ══════════════════════════════════════════════════════════
    PROCEDURE update_register (
        p_register_id  IN  NUMBER,
        p_json         IN  CLOB,
        p_rows         OUT NUMBER,
        p_error        OUT VARCHAR2
    ) IS
        l_name     VARCHAR2(200);
        l_bu       VARCHAR2(240);
        l_start    DATE;
        l_end      DATE;
        l_comments VARCHAR2(1000);
        l_ccid     NUMBER;
        l_acc_desc VARCHAR2(400);
        l_currency VARCHAR2(10);
        l_status   VARCHAR2(50);
        l_owned_by VARCHAR2(240);
        l_limit    NUMBER;
        l_by       VARCHAR2(150);
    BEGIN
        p_error := NULL;
        APEX_JSON.PARSE(p_json);
        l_name     := APEX_JSON.GET_VARCHAR2(p_path => 'registerName');
        l_bu       := APEX_JSON.GET_VARCHAR2(p_path => 'businessUnit');
        l_start    := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'startDate'));
        l_end      := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'endDate'));
        l_comments := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ccid     := APEX_JSON.GET_NUMBER  (p_path => 'cashAccountCcid');
        l_acc_desc := APEX_JSON.GET_VARCHAR2(p_path => 'cashAccountDesc');
        l_currency := APEX_JSON.GET_VARCHAR2(p_path => 'currency');
        l_status   := APEX_JSON.GET_VARCHAR2(p_path => 'status');
        l_owned_by := APEX_JSON.GET_VARCHAR2(p_path => 'ownedBy');
        l_limit    := APEX_JSON.GET_NUMBER  (p_path => 'limit');
        l_by       := APEX_JSON.GET_VARCHAR2(p_path => 'updatedBy');

        UPDATE RR_PC_REGISTERS SET
            REGISTER_NAME       = NVL(l_name,     REGISTER_NAME),
            BUSINESS_UNIT       = NVL(l_bu,       BUSINESS_UNIT),
            START_DATE          = NVL(l_start,    START_DATE),
            END_DATE            = NVL(l_end,       END_DATE),
            COMMENTS            = NVL(l_comments, COMMENTS),
            CASH_ACCOUNT_CCID   = NVL(l_ccid,     CASH_ACCOUNT_CCID),
            CASH_ACCOUNT_DESC   = NVL(l_acc_desc, CASH_ACCOUNT_DESC),
            CURRENCY            = NVL(l_currency, CURRENCY),
            STATUS              = NVL(l_status,   STATUS),
            OWNED_BY            = NVL(l_owned_by, OWNED_BY),
            CASH_LIMIT          = NVL(l_limit,    CASH_LIMIT),
            LAST_UPDATED_BY     = l_by,
            LAST_UPDATE_DATE    = SYSTIMESTAMP
        WHERE REGISTER_ID = p_register_id;

        p_rows := SQL%ROWCOUNT;
        COMMIT;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END update_register;

    -- ══════════════════════════════════════════════════════════
    -- delete_register  (unchanged)
    -- ══════════════════════════════════════════════════════════
    PROCEDURE delete_register (
        p_register_id  IN  NUMBER,
        p_rows         OUT NUMBER,
        p_error        OUT VARCHAR2
    ) IS
    BEGIN
        p_error := NULL;
        DELETE FROM RR_PC_REGISTERS WHERE REGISTER_ID = p_register_id;
        p_rows := SQL%ROWCOUNT;
        COMMIT;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END delete_register;

    -- ══════════════════════════════════════════════════════════
    -- create_transaction  — UPDATED: adds referenceDescription
    -- ══════════════════════════════════════════════════════════
    PROCEDURE create_transaction (
        p_json   IN  CLOB,
        p_id     OUT NUMBER,
        p_line   OUT NUMBER,
        p_error  OUT VARCHAR2
    ) IS
        l_reg_id        NUMBER;
        l_reg_status    VARCHAR2(50);
        l_next_line     NUMBER;
        l_txn_date      DATE;
        l_txn_type      VARCHAR2(100);
        l_exp_type      VARCHAR2(200);
        l_ca_ccid       NUMBER;
        l_ca_desc       VARCHAR2(400);
        l_bank_txn_id   NUMBER;
        l_acc_date      DATE;
        l_post_stat     VARCHAR2(50);
        l_currency      VARCHAR2(10);
        l_debit         NUMBER;
        l_credit        NUMBER;
        l_comments      VARCHAR2(1000);
        l_ref_no        VARCHAR2(200);
        l_ref_desc      VARCHAR2(500);   -- NEW
        l_attach        VARCHAR2(1000);
        l_attach_data   CLOB;
        l_emp_name      VARCHAR2(200);
        l_receipt_stat  VARCHAR2(3);
        l_by            VARCHAR2(150);
        l_period_cnt    NUMBER;
        l_period        VARCHAR2(30);
    BEGIN
        p_error := NULL;
        APEX_JSON.PARSE(p_json);

        l_reg_id := APEX_JSON.GET_NUMBER(p_path => 'registerId');

        BEGIN
            SELECT STATUS INTO l_reg_status
            FROM   RR_PC_REGISTERS
            WHERE  REGISTER_ID = l_reg_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            p_error := 'NOT_FOUND:Register ' || l_reg_id || ' not found';
            RETURN;
        END;

        IF l_reg_status != 'ACTIVE' THEN
            p_error := 'BLOCKED:Register is ' || l_reg_status || ' — only Active registers accept transactions';
            RETURN;
        END IF;

        l_txn_date     := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'transactionDate'));
        l_txn_type     := APEX_JSON.GET_VARCHAR2(p_path => 'transactionType');
        l_exp_type     := APEX_JSON.GET_VARCHAR2(p_path => 'expenseType');
        l_ca_ccid      := APEX_JSON.GET_NUMBER  (p_path => 'chargeAccountCcid');
        l_ca_desc      := APEX_JSON.GET_VARCHAR2(p_path => 'chargeAccountDesc');
        l_acc_date     := NVL(parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'accountingDate')), l_txn_date);
        l_post_stat    := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'postingStatus'), 'Unposted');
        l_currency     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'currency'), 'AED');
        l_debit        := NVL(APEX_JSON.GET_NUMBER  (p_path => 'debitAmount'),  0);
        l_credit       := NVL(APEX_JSON.GET_NUMBER  (p_path => 'creditAmount'), 0);
        l_comments     := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ref_no       := APEX_JSON.GET_VARCHAR2(p_path => 'referenceNo');
        l_ref_desc     := APEX_JSON.GET_VARCHAR2(p_path => 'referenceDescription');  -- NEW
        l_attach       := APEX_JSON.GET_VARCHAR2(p_path => 'attachment');
        l_attach_data  := APEX_JSON.GET_CLOB    (p_path => 'attachmentData');
        l_emp_name     := APEX_JSON.GET_VARCHAR2(p_path => 'employeeName');
        l_receipt_stat := APEX_JSON.GET_VARCHAR2(p_path => 'receiptStatus');
        l_by           := APEX_JSON.GET_VARCHAR2(p_path => 'createdBy');
        l_bank_txn_id  := APEX_JSON.GET_NUMBER  (p_path => 'bankTxnId');

        IF l_txn_type != 'Balance Brought Fwd' THEN
            SELECT COUNT(*), MAX(period_name_id)
            INTO   l_period_cnt, l_period
            FROM   rr_accounting_periods_status
            WHERE  application_id         = 200
            AND    closing_status         = 'O'
            AND    NVL(adjustment_period_flag,'N') = 'N'
            AND    l_acc_date BETWEEN start_date AND end_date;

            IF l_period_cnt = 0 THEN
                p_error := 'BLOCKED:Accounting date ' || TO_CHAR(l_acc_date,'DD-Mon-YYYY')
                           || ' does not fall within an open AP period. Please check period status.';
                RETURN;
            END IF;
        END IF;

        SELECT NVL(MAX(LINE_NUMBER), 0) + 1 INTO l_next_line
        FROM   RR_PC_TRANSACTIONS
        WHERE  REGISTER_ID = l_reg_id;

        INSERT INTO RR_PC_TRANSACTIONS (
            REGISTER_ID,         LINE_NUMBER,
            TRANSACTION_DATE,    TRANSACTION_TYPE,    EXPENSE_TYPE,
            CHARGE_ACCOUNT_CCID, CHARGE_ACCOUNT_DESC,
            ACCOUNTING_DATE,     ACCOUNTING_PERIOD,   POSTING_STATUS,
            CURRENCY,            DEBIT_AMOUNT,        CREDIT_AMOUNT,
            COMMENTS,            REFERENCE_NO,        REFERENCE_DESCRIPTION,  -- NEW
            ATTACHMENT,          ATTACHMENT_DATA,
            EMPLOYEE_NAME,       RECEIPT_STATUS,
            BANK_TXN_ID,
            CREATED_BY,          CREATION_DATE,
            LAST_UPDATED_BY,     LAST_UPDATE_DATE
        ) VALUES (
            l_reg_id,    l_next_line,
            l_txn_date,  l_txn_type,  l_exp_type,
            l_ca_ccid,   l_ca_desc,
            l_acc_date,  l_period,    l_post_stat,
            l_currency,  l_debit,     l_credit,
            l_comments,  l_ref_no,    l_ref_desc,    -- NEW
            l_attach,    l_attach_data,
            l_emp_name,  l_receipt_stat,
            l_bank_txn_id,
            l_by,        SYSTIMESTAMP,
            l_by,        SYSTIMESTAMP
        ) RETURNING TRANSACTION_ID INTO p_id;

        p_line := l_next_line;
        COMMIT;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END create_transaction;

    -- ══════════════════════════════════════════════════════════
    -- update_transaction  — UPDATED: adds referenceDescription
    -- ══════════════════════════════════════════════════════════
    PROCEDURE update_transaction (
        p_transaction_id  IN  NUMBER,
        p_json            IN  CLOB,
        p_rows            OUT NUMBER,
        p_error           OUT VARCHAR2
    ) IS
        l_txn_date      DATE;
        l_txn_type      VARCHAR2(100);
        l_exp_type      VARCHAR2(200);
        l_ca_ccid       NUMBER;
        l_ca_desc       VARCHAR2(400);
        l_acc_date      DATE;
        l_post_stat     VARCHAR2(50);
        l_currency      VARCHAR2(10);
        l_debit         NUMBER;
        l_credit        NUMBER;
        l_comments      VARCHAR2(1000);
        l_ref_no        VARCHAR2(200);
        l_ref_desc      VARCHAR2(500);   -- NEW
        l_attach        VARCHAR2(1000);
        l_attach_data   CLOB;
        l_emp_name      VARCHAR2(200);
        l_receipt_stat  VARCHAR2(3);
        l_by            VARCHAR2(150);
        l_period_cnt    NUMBER;
        l_period        VARCHAR2(30);
        l_bank_txn_id   NUMBER;
    BEGIN
        p_error := NULL;
        APEX_JSON.PARSE(p_json);

        l_txn_date     := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'transactionDate'));
        l_txn_type     := APEX_JSON.GET_VARCHAR2(p_path => 'transactionType');
        l_exp_type     := APEX_JSON.GET_VARCHAR2(p_path => 'expenseType');
        l_ca_ccid      := APEX_JSON.GET_NUMBER  (p_path => 'chargeAccountCcid');
        l_ca_desc      := APEX_JSON.GET_VARCHAR2(p_path => 'chargeAccountDesc');
        l_acc_date     := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'accountingDate'));
        l_post_stat    := APEX_JSON.GET_VARCHAR2(p_path => 'postingStatus');
        l_currency     := APEX_JSON.GET_VARCHAR2(p_path => 'currency');
        l_debit        := APEX_JSON.GET_NUMBER  (p_path => 'debitAmount');
        l_credit       := APEX_JSON.GET_NUMBER  (p_path => 'creditAmount');
        l_comments     := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ref_no       := APEX_JSON.GET_VARCHAR2(p_path => 'referenceNo');
        l_ref_desc     := APEX_JSON.GET_VARCHAR2(p_path => 'referenceDescription');  -- NEW
        l_attach       := APEX_JSON.GET_VARCHAR2(p_path => 'attachment');
        l_attach_data  := APEX_JSON.GET_CLOB    (p_path => 'attachmentData');
        l_emp_name     := APEX_JSON.GET_VARCHAR2(p_path => 'employeeName');
        l_receipt_stat := APEX_JSON.GET_VARCHAR2(p_path => 'receiptStatus');
        l_by           := APEX_JSON.GET_VARCHAR2(p_path => 'updatedBy');
        l_bank_txn_id  := APEX_JSON.GET_NUMBER  (p_path => 'bankTxnId');

        IF l_acc_date IS NOT NULL THEN
            SELECT COUNT(*), MAX(period_name_id)
            INTO   l_period_cnt, l_period
            FROM   rr_accounting_periods_status
            WHERE  application_id                = 200
            AND    closing_status                = 'O'
            AND    NVL(adjustment_period_flag,'N') = 'N'
            AND    l_acc_date BETWEEN start_date AND end_date;

            IF l_period_cnt = 0 THEN
                p_error := 'BLOCKED:Accounting date ' || TO_CHAR(l_acc_date,'DD-Mon-YYYY')
                           || ' does not fall within an open AP period.';
                p_rows  := 0;
                RETURN;
            END IF;
        END IF;

        UPDATE RR_PC_TRANSACTIONS SET
            TRANSACTION_DATE      = NVL(l_txn_date,    TRANSACTION_DATE),
            TRANSACTION_TYPE      = NVL(l_txn_type,    TRANSACTION_TYPE),
            EXPENSE_TYPE          = NVL(l_exp_type,    EXPENSE_TYPE),
            CHARGE_ACCOUNT_CCID   = NVL(l_ca_ccid,    CHARGE_ACCOUNT_CCID),
            CHARGE_ACCOUNT_DESC   = NVL(l_ca_desc,    CHARGE_ACCOUNT_DESC),
            ACCOUNTING_DATE       = NVL(l_acc_date,   ACCOUNTING_DATE),
            ACCOUNTING_PERIOD     = NVL(l_period,     ACCOUNTING_PERIOD),
            POSTING_STATUS        = NVL(l_post_stat,  POSTING_STATUS),
            CURRENCY              = NVL(l_currency,   CURRENCY),
            DEBIT_AMOUNT          = NVL(l_debit,      DEBIT_AMOUNT),
            CREDIT_AMOUNT         = NVL(l_credit,     CREDIT_AMOUNT),
            COMMENTS              = NVL(l_comments,   COMMENTS),
            REFERENCE_NO          = NVL(l_ref_no,     REFERENCE_NO),
            REFERENCE_DESCRIPTION = NVL(l_ref_desc,   REFERENCE_DESCRIPTION),  -- NEW
            ATTACHMENT            = NVL(l_attach,     ATTACHMENT),
            ATTACHMENT_DATA       = NVL(l_attach_data,ATTACHMENT_DATA),
            EMPLOYEE_NAME         = NVL(l_emp_name,   EMPLOYEE_NAME),
            RECEIPT_STATUS        = NVL(l_receipt_stat,RECEIPT_STATUS),
            BANK_TXN_ID           = NVL(l_bank_txn_id,BANK_TXN_ID),
            LAST_UPDATED_BY       = l_by,
            LAST_UPDATE_DATE      = SYSTIMESTAMP
        WHERE TRANSACTION_ID = p_transaction_id;

        p_rows := SQL%ROWCOUNT;
        COMMIT;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END update_transaction;

    -- ══════════════════════════════════════════════════════════
    -- delete_transaction  (unchanged)
    -- ══════════════════════════════════════════════════════════
    PROCEDURE delete_transaction (
        p_transaction_id  IN  NUMBER,
        p_rows            OUT NUMBER,
        p_error           OUT VARCHAR2
    ) IS
    BEGIN
        p_error := NULL;
        DELETE FROM RR_PC_TRANSACTIONS WHERE TRANSACTION_ID = p_transaction_id;
        p_rows := SQL%ROWCOUNT;
        COMMIT;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END delete_transaction;

END RR_PC_PKG;
/

-- ── 3. Redefine GET registers/:registerId/transactions ────
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
               t.REFERENCE_DESCRIPTION,
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
        APEX_JSON.WRITE(''transactionId'',        rec.TRANSACTION_ID);
        APEX_JSON.WRITE(''registerId'',           rec.REGISTER_ID);
        APEX_JSON.WRITE(''lineNumber'',           rec.LINE_NUMBER);
        APEX_JSON.WRITE(''transactionDate'',      TO_CHAR(rec.TRANSACTION_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''transactionType'',      rec.TRANSACTION_TYPE);
        APEX_JSON.WRITE(''expenseType'',          rec.EXPENSE_TYPE);
        APEX_JSON.WRITE(''chargeAccountCcid'',    rec.CHARGE_ACCOUNT_CCID);
        APEX_JSON.WRITE(''chargeAccountDesc'',    rec.CHARGE_ACCOUNT_DESC);
        APEX_JSON.WRITE(''accountingDate'',       TO_CHAR(rec.ACCOUNTING_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''accountingPeriod'',     rec.ACCOUNTING_PERIOD);
        APEX_JSON.WRITE(''postingStatus'',        rec.POSTING_STATUS);
        APEX_JSON.WRITE(''currency'',             NVL(rec.CURRENCY, ''AED''));
        APEX_JSON.WRITE(''debitAmount'',          rec.DEBIT_AMOUNT);
        APEX_JSON.WRITE(''creditAmount'',         rec.CREDIT_AMOUNT);
        APEX_JSON.WRITE(''comments'',             rec.COMMENTS);
        APEX_JSON.WRITE(''referenceNo'',          rec.REFERENCE_NO);
        APEX_JSON.WRITE(''referenceDescription'', rec.REFERENCE_DESCRIPTION);
        APEX_JSON.WRITE(''attachment'',           rec.ATTACHMENT);
        APEX_JSON.WRITE(''hasAttachment'',        rec.HAS_ATTACHMENT);
        APEX_JSON.WRITE(''employeeName'',         rec.EMPLOYEE_NAME);
        APEX_JSON.WRITE(''receiptStatus'',        rec.RECEIPT_STATUS);
        APEX_JSON.WRITE(''bankTxnId'',            rec.BANK_TXN_ID);
        APEX_JSON.WRITE(''createdBy'',            rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',         TO_CHAR(rec.CREATION_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''runningBalance'',       rec.RUNNING_BALANCE);
        APEX_JSON.WRITE(''attachmentCount'',      rec.ATTACHMENT_COUNT);
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

-- ── 4. Redefine GET transactions/:transactionId ───────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'transactions/:transactionId',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    CURSOR c IS
        SELECT t.TRANSACTION_ID, t.REGISTER_ID, t.LINE_NUMBER,
               t.TRANSACTION_DATE, t.TRANSACTION_TYPE, t.EXPENSE_TYPE,
               t.CHARGE_ACCOUNT_CCID, t.CHARGE_ACCOUNT_DESC,
               t.ACCOUNTING_DATE, t.ACCOUNTING_PERIOD, t.POSTING_STATUS, t.CURRENCY,
               t.DEBIT_AMOUNT, t.CREDIT_AMOUNT,
               t.COMMENTS, t.REFERENCE_NO, t.REFERENCE_DESCRIPTION, t.ATTACHMENT,
               t.CREATED_BY, t.CREATION_DATE,
               t.LAST_UPDATED_BY, t.LAST_UPDATE_DATE
        FROM   RR_PC_TRANSACTIONS t
        WHERE  t.TRANSACTION_ID = :transactionId;
    rec c%ROWTYPE;
BEGIN
    OPEN c; FETCH c INTO rec; CLOSE c;
    IF rec.TRANSACTION_ID IS NULL THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Transaction not found"}'');
        RETURN;
    END IF;
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'',                TRUE);
    APEX_JSON.WRITE(''transactionId'',          rec.TRANSACTION_ID);
    APEX_JSON.WRITE(''registerId'',             rec.REGISTER_ID);
    APEX_JSON.WRITE(''lineNumber'',             rec.LINE_NUMBER);
    APEX_JSON.WRITE(''transactionDate'',        TO_CHAR(rec.TRANSACTION_DATE,  ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''transactionType'',        rec.TRANSACTION_TYPE);
    APEX_JSON.WRITE(''expenseType'',            rec.EXPENSE_TYPE);
    APEX_JSON.WRITE(''chargeAccountCcid'',      rec.CHARGE_ACCOUNT_CCID);
    APEX_JSON.WRITE(''chargeAccountDesc'',      rec.CHARGE_ACCOUNT_DESC);
    APEX_JSON.WRITE(''accountingDate'',         TO_CHAR(rec.ACCOUNTING_DATE,   ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''accountingPeriod'',       rec.ACCOUNTING_PERIOD);
    APEX_JSON.WRITE(''postingStatus'',          rec.POSTING_STATUS);
    APEX_JSON.WRITE(''currency'',               NVL(rec.CURRENCY,''AED''));
    APEX_JSON.WRITE(''debitAmount'',            rec.DEBIT_AMOUNT);
    APEX_JSON.WRITE(''creditAmount'',           rec.CREDIT_AMOUNT);
    APEX_JSON.WRITE(''comments'',              rec.COMMENTS);
    APEX_JSON.WRITE(''referenceNo'',            rec.REFERENCE_NO);
    APEX_JSON.WRITE(''referenceDescription'',   rec.REFERENCE_DESCRIPTION);
    APEX_JSON.WRITE(''attachment'',             rec.ATTACHMENT);
    APEX_JSON.WRITE(''createdBy'',              rec.CREATED_BY);
    APEX_JSON.WRITE(''creationDate'',           TO_CHAR(rec.CREATION_DATE,     ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''lastUpdatedBy'',          rec.LAST_UPDATED_BY);
    APEX_JSON.WRITE(''lastUpdateDate'',         TO_CHAR(rec.LAST_UPDATE_DATE,  ''DD-MON-YYYY''));
    APEX_JSON.CLOSE_OBJECT;
    HTP.PRN(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
END;
'
    );
    COMMIT;
END;
/
