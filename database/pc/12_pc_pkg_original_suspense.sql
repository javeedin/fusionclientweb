-- =============================================================================
-- PC: Add ORIGINAL_SUSPENSE_AMOUNT to create_transaction
--
-- The column was added in 11_pc_original_suspense_and_refund.sql.
-- This file updates the package body so create_transaction parses and
-- inserts the value directly — no secondary UPDATE needed.
-- =============================================================================

create or replace PACKAGE BODY RR_PC_PKG AS

    -- ──────────────────────────────────────────────────────────
    -- Internal helper: parse a date string safely
    -- Accepts YYYY-MM-DD or NULL
    -- ──────────────────────────────────────────────────────────
    FUNCTION parse_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(p_str, 'YYYY-MM-DD');
    END parse_date;

    -- ══════════════════════════════════════════════════════════
    -- create_register
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

        IF l_name IS NULL THEN
            p_error := 'registerName is required';
            RETURN;
        END IF;
        IF l_bu IS NULL THEN
            p_error := 'businessUnit is required';
            RETURN;
        END IF;
        IF l_status NOT IN ('DRAFT','ACTIVE') THEN
            p_error := 'status must be DRAFT or ACTIVE when creating a register';
            RETURN;
        END IF;

        INSERT INTO RR_PC_REGISTERS (
            REGISTER_NAME, BUSINESS_UNIT, START_DATE, END_DATE, COMMENTS,
            CASH_ACCOUNT_CCID, CASH_ACCOUNT_DESC, CURRENCY,
            STATUS, OWNED_BY, CASH_LIMIT, CREATED_BY, CREATION_DATE,
            LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            l_name, l_bu, l_start, l_end, l_comments,
            l_ccid, l_acc_desc, l_currency,
            l_status, l_owned_by, l_limit, l_by, SYSTIMESTAMP,
            l_by, SYSTIMESTAMP
        ) RETURNING REGISTER_ID INTO p_id;

        COMMIT;

    EXCEPTION
        WHEN DUP_VAL_ON_INDEX THEN
            p_error := 'Register name already exists';
        WHEN OTHERS THEN
            ROLLBACK;
            p_error := SQLERRM;
    END create_register;

    -- ══════════════════════════════════════════════════════════
    -- update_register
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
        l_balance  NUMBER;
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

        -- Validate INACTIVE transition: balance must be zero
        IF l_status = 'INACTIVE' THEN
            SELECT NVL(SUM(DEBIT_AMOUNT),0) - NVL(SUM(CREDIT_AMOUNT),0)
            INTO   l_balance
            FROM   RR_PC_TRANSACTIONS
            WHERE  REGISTER_ID = p_register_id;

            IF l_balance != 0 THEN
                p_error := 'BLOCKED:Cannot set Inactive — register balance must be zero (current balance: '
                           || TO_CHAR(ABS(l_balance),'FM999999990.00') || ')';
                p_rows  := 0;
                RETURN;
            END IF;
        END IF;

        UPDATE RR_PC_REGISTERS SET
            REGISTER_NAME     = NVL(l_name,     REGISTER_NAME),
            BUSINESS_UNIT     = NVL(l_bu,       BUSINESS_UNIT),
            START_DATE        = NVL(l_start,    START_DATE),
            END_DATE          = l_end,
            COMMENTS          = l_comments,
            CASH_ACCOUNT_CCID = l_ccid,
            CASH_ACCOUNT_DESC = l_acc_desc,
            CURRENCY          = NVL(l_currency, CURRENCY),
            STATUS            = NVL(l_status,   STATUS),
            OWNED_BY          = l_owned_by,
            CASH_LIMIT        = l_limit,
            LAST_UPDATED_BY   = l_by,
            LAST_UPDATE_DATE  = SYSTIMESTAMP
        WHERE REGISTER_ID = p_register_id;

        p_rows := SQL%ROWCOUNT;
        COMMIT;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END update_register;

    -- ══════════════════════════════════════════════════════════
    -- delete_register
    -- ══════════════════════════════════════════════════════════
    PROCEDURE delete_register (
        p_register_id  IN  NUMBER,
        p_rows         OUT NUMBER,
        p_error        OUT VARCHAR2
    ) IS
        l_txn_count NUMBER;
        l_status    VARCHAR2(50);
    BEGIN
        p_error := NULL;

        BEGIN
            SELECT STATUS INTO l_status
            FROM   RR_PC_REGISTERS
            WHERE  REGISTER_ID = p_register_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            p_rows := 0; RETURN;
        END;

        IF l_status != 'DRAFT' THEN
            p_error := 'BLOCKED:Only Draft registers can be deleted — this register is ' || l_status;
            p_rows  := 0;
            RETURN;
        END IF;

        SELECT COUNT(*) INTO l_txn_count
        FROM   RR_PC_TRANSACTIONS
        WHERE  REGISTER_ID = p_register_id;

        IF l_txn_count > 0 THEN
            p_error := 'BLOCKED:Cannot delete register with existing transactions (' || l_txn_count || ')';
            p_rows  := 0;
            RETURN;
        END IF;

        DELETE FROM RR_PC_REGISTERS WHERE REGISTER_ID = p_register_id;
        p_rows := SQL%ROWCOUNT;
        IF p_rows > 0 THEN COMMIT; END IF;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END delete_register;

    -- ══════════════════════════════════════════════════════════
    -- create_transaction
    -- ══════════════════════════════════════════════════════════
    PROCEDURE create_transaction (
        p_json   IN  CLOB,
        p_id     OUT NUMBER,
        p_line   OUT NUMBER,
        p_error  OUT VARCHAR2
    ) IS
        l_reg_id      NUMBER;
        l_reg_status  VARCHAR2(50);
        l_next_line   NUMBER;
        l_txn_date    DATE;
        l_txn_type    VARCHAR2(100);
        l_exp_type    VARCHAR2(200);
        l_ca_ccid     NUMBER;
        l_ca_desc     VARCHAR2(400);
        l_bank_txn_id NUMBER;
        l_acc_date    DATE;
        l_post_stat   VARCHAR2(50);
        l_currency    VARCHAR2(10);
        l_debit       NUMBER;
        l_credit      NUMBER;
        l_comments      VARCHAR2(1000);
        l_ref_no        VARCHAR2(200);
        l_attach        VARCHAR2(1000);
        l_attach_data   CLOB;
        l_emp_name      VARCHAR2(200);
        l_receipt_stat  VARCHAR2(3);
        l_by            VARCHAR2(150);
        l_period_cnt    NUMBER;
        l_period        VARCHAR2(30);
        l_suspense      NUMBER;
        l_orig_susp     NUMBER;
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

        l_txn_date  := parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'transactionDate'));
        l_txn_type  := APEX_JSON.GET_VARCHAR2(p_path => 'transactionType');
        l_exp_type  := APEX_JSON.GET_VARCHAR2(p_path => 'expenseType');
        l_ca_ccid   := APEX_JSON.GET_NUMBER  (p_path => 'chargeAccountCcid');
        l_ca_desc   := APEX_JSON.GET_VARCHAR2(p_path => 'chargeAccountDesc');
        l_acc_date  := NVL(parse_date(APEX_JSON.GET_VARCHAR2(p_path => 'accountingDate')), l_txn_date);
        l_post_stat := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'postingStatus'), 'Unposted');
        l_currency  := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'currency'), 'AED');
        l_debit     := NVL(APEX_JSON.GET_NUMBER  (p_path => 'debitAmount'),   0);
        l_credit    := NVL(APEX_JSON.GET_NUMBER  (p_path => 'creditAmount'),  0);
        l_suspense  := NVL(APEX_JSON.GET_NUMBER  (p_path => 'suspenseAmount'), 0);
        l_orig_susp :=     APEX_JSON.GET_NUMBER  (p_path => 'originalSuspenseAmount');
        l_comments     := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ref_no       := APEX_JSON.GET_VARCHAR2(p_path => 'referenceNo');
        l_attach       := APEX_JSON.GET_VARCHAR2(p_path => 'attachment');
        l_attach_data  := APEX_JSON.GET_CLOB    (p_path => 'attachmentData');
        l_emp_name     := APEX_JSON.GET_VARCHAR2(p_path => 'employeeName');
        l_receipt_stat := APEX_JSON.GET_VARCHAR2(p_path => 'receiptStatus');
        l_by           := APEX_JSON.GET_VARCHAR2(p_path => 'createdBy');
        l_bank_txn_id  := APEX_JSON.GET_NUMBER  (p_path => 'bankTxnId');

        -- Validate accounting date against open AP periods (application_id = 200)
        -- Balance Brought Fwd bypasses the period gate (carry-forward marker).
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
            SUSPENSE_AMOUNT,     ORIGINAL_SUSPENSE_AMOUNT,
            COMMENTS,            REFERENCE_NO,        ATTACHMENT,
            ATTACHMENT_DATA,     EMPLOYEE_NAME,       RECEIPT_STATUS,
            BANK_TXN_ID,
            CREATED_BY,          CREATION_DATE,
            LAST_UPDATED_BY,     LAST_UPDATE_DATE
        ) VALUES (
            l_reg_id,    l_next_line,
            l_txn_date,  l_txn_type,  l_exp_type,
            l_ca_ccid,   l_ca_desc,
            l_acc_date,  l_period,    l_post_stat,
            l_currency,  l_debit,     l_credit,
            l_suspense,  l_orig_susp,
            l_comments,  l_ref_no,    l_attach,
            l_attach_data, l_emp_name, l_receipt_stat,
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
    -- update_transaction
    -- ══════════════════════════════════════════════════════════
    PROCEDURE update_transaction (
        p_transaction_id  IN  NUMBER,
        p_json            IN  CLOB,
        p_rows            OUT NUMBER,
        p_error           OUT VARCHAR2
    ) IS
        l_txn_date    DATE;
        l_txn_type    VARCHAR2(100);
        l_exp_type    VARCHAR2(200);
        l_ca_ccid     NUMBER;
        l_ca_desc     VARCHAR2(400);
        l_acc_date    DATE;
        l_post_stat   VARCHAR2(50);
        l_currency    VARCHAR2(10);
        l_debit       NUMBER;
        l_credit      NUMBER;
        l_comments      VARCHAR2(1000);
        l_ref_no        VARCHAR2(200);
        l_attach        VARCHAR2(1000);
        l_attach_data   CLOB;
        l_emp_name      VARCHAR2(200);
        l_receipt_stat  VARCHAR2(3);
        l_by            VARCHAR2(150);
        l_period_cnt    NUMBER;
        l_period        VARCHAR2(30);
        l_bank_txn_id   NUMBER;
        l_suspense      NUMBER;
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
        l_suspense     := APEX_JSON.GET_NUMBER  (p_path => 'suspenseAmount');
        l_comments     := APEX_JSON.GET_VARCHAR2(p_path => 'comments');
        l_ref_no       := APEX_JSON.GET_VARCHAR2(p_path => 'referenceNo');
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
            TRANSACTION_DATE    = NVL(l_txn_date,  TRANSACTION_DATE),
            TRANSACTION_TYPE    = NVL(l_txn_type,    TRANSACTION_TYPE),
            EXPENSE_TYPE        = NVL(l_exp_type,    EXPENSE_TYPE),
            CHARGE_ACCOUNT_CCID = NVL(l_ca_ccid,    CHARGE_ACCOUNT_CCID),
            CHARGE_ACCOUNT_DESC = NVL(l_ca_desc,    CHARGE_ACCOUNT_DESC),
            ACCOUNTING_DATE     = NVL(l_acc_date,   ACCOUNTING_DATE),
            ACCOUNTING_PERIOD   = NVL(l_period,     ACCOUNTING_PERIOD),
            POSTING_STATUS      = NVL(l_post_stat,  POSTING_STATUS),
            CURRENCY            = NVL(l_currency,   CURRENCY),
            DEBIT_AMOUNT        = NVL(l_debit,      DEBIT_AMOUNT),
            CREDIT_AMOUNT       = NVL(l_credit,     CREDIT_AMOUNT),
            SUSPENSE_AMOUNT     = NVL(l_suspense,   SUSPENSE_AMOUNT),
            COMMENTS            = NVL(l_comments,   COMMENTS),
            REFERENCE_NO        = NVL(l_ref_no,     REFERENCE_NO),
            ATTACHMENT          = NVL(l_attach,     ATTACHMENT),
            ATTACHMENT_DATA     = NVL(l_attach_data,  ATTACHMENT_DATA),
            EMPLOYEE_NAME       = NVL(l_emp_name,   EMPLOYEE_NAME),
            RECEIPT_STATUS      = NVL(l_receipt_stat, RECEIPT_STATUS),
            BANK_TXN_ID         = NVL(l_bank_txn_id, BANK_TXN_ID),
            LAST_UPDATED_BY     = l_by,
            LAST_UPDATE_DATE    = SYSTIMESTAMP
        WHERE TRANSACTION_ID = p_transaction_id;

        p_rows := SQL%ROWCOUNT;
        COMMIT;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END update_transaction;

    -- ══════════════════════════════════════════════════════════
    -- delete_transaction
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
        IF p_rows > 0 THEN COMMIT; END IF;

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
    END delete_transaction;

END RR_PC_PKG;
/
