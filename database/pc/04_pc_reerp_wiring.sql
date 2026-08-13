-- ============================================================
-- Petty Cash — Wire all PC handlers into the REERP module
-- File: database/pc/04_pc_reerp_wiring.sql
-- Run order: 4th (after 01, 02, 03)
--
-- The frontend calls /ords/bcldifc/reerp/pc/...
-- (APEX_DB_CONFIG.baseUrl = .../reerp, pc.service BASE = .../reerp/pc)
-- This file adds all PC templates + handlers to the existing
-- 'reerp' module WITHOUT deleting any other reerp endpoints.
--
-- Safe to re-run — ORDS.DEFINE_HANDLER replaces existing handlers.
-- ============================================================

BEGIN

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 1: pc/registers  (GET search + POST create)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/registers');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- GET /reerp/pc/registers
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
               r.START_DATE, r.END_DATE, r.COMMENTS,
               r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
               r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT,
               r.CREATED_BY, r.CREATION_DATE,
               NVL(SUM(t.DEBIT_AMOUNT),0) - NVL(SUM(t.CREDIT_AMOUNT),0) AS BALANCE,
               NVL(SUM(t.DEBIT_AMOUNT),0)  AS TOTAL_DEBIT,
               NVL(SUM(t.CREDIT_AMOUNT),0) AS TOTAL_CREDIT
        FROM   RR_PC_REGISTERS r
        LEFT JOIN RR_PC_TRANSACTIONS t ON t.REGISTER_ID = r.REGISTER_ID
        WHERE  (:q        IS NULL OR UPPER(r.REGISTER_NAME) LIKE ''%''||UPPER(:q)||''%'')
        AND    (:status   IS NULL OR r.STATUS        = :status)
        AND    (:bu       IS NULL OR r.BUSINESS_UNIT = :bu)
        AND    (:dateFrom IS NULL OR r.START_DATE >= TO_DATE(:dateFrom,''YYYY-MM-DD''))
        AND    (:dateTo   IS NULL OR r.END_DATE   <= TO_DATE(:dateTo,  ''YYYY-MM-DD''))
        GROUP BY r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
                 r.START_DATE, r.END_DATE, r.COMMENTS,
                 r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
                 r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT,
                 r.CREATED_BY, r.CREATION_DATE
        ORDER BY r.REGISTER_ID DESC;
BEGIN
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'', TRUE);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR rec IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''registerId'',      rec.REGISTER_ID);
        APEX_JSON.WRITE(''registerName'',    rec.REGISTER_NAME);
        APEX_JSON.WRITE(''businessUnit'',    rec.BUSINESS_UNIT);
        APEX_JSON.WRITE(''startDate'',       TO_CHAR(rec.START_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''endDate'',         TO_CHAR(rec.END_DATE,   ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''comments'',        rec.COMMENTS);
        APEX_JSON.WRITE(''cashAccountCcid'', rec.CASH_ACCOUNT_CCID);
        APEX_JSON.WRITE(''cashAccountDesc'', rec.CASH_ACCOUNT_DESC);
        APEX_JSON.WRITE(''currency'',        NVL(rec.CURRENCY,''AED''));
        APEX_JSON.WRITE(''status'',          rec.STATUS);
        APEX_JSON.WRITE(''ownedBy'',         rec.OWNED_BY);
        APEX_JSON.WRITE(''limit'',           rec.CASH_LIMIT);
        APEX_JSON.WRITE(''balance'',         rec.BALANCE);
        APEX_JSON.WRITE(''totalDebit'',      rec.TOTAL_DEBIT);
        APEX_JSON.WRITE(''totalCredit'',     rec.TOTAL_CREDIT);
        APEX_JSON.WRITE(''createdBy'',       rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',    TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
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

    -- POST /reerp/pc/registers
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_id  NUMBER;
    l_err VARCHAR2(4000);
BEGIN
    RR_PC_PKG.create_register(p_json => :body_text, p_id => l_id, p_error => l_err);
    IF l_err IS NOT NULL THEN
        :status_code := CASE WHEN l_err LIKE ''BLOCKED:%'' THEN 400 ELSE 500 END;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(REPLACE(l_err,''BLOCKED:'','''')) || ''}'');
    ELSE
        :status_code := 201;
        HTP.PRN(''{"success":true,"registerId":'' || l_id || '',"message":"Register created"}'');
    END IF;
END;
'
    );

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 2: pc/registers/:registerId  (GET + PUT + DELETE)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/registers/:registerId');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- GET /reerp/pc/registers/:registerId
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers/:registerId',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    CURSOR c IS
        SELECT r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
               r.START_DATE, r.END_DATE, r.COMMENTS,
               r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
               r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT,
               r.CREATED_BY, r.CREATION_DATE,
               NVL(SUM(t.DEBIT_AMOUNT),0) - NVL(SUM(t.CREDIT_AMOUNT),0) AS BALANCE,
               NVL(SUM(t.DEBIT_AMOUNT),0)  AS TOTAL_DEBIT,
               NVL(SUM(t.CREDIT_AMOUNT),0) AS TOTAL_CREDIT
        FROM   RR_PC_REGISTERS r
        LEFT JOIN RR_PC_TRANSACTIONS t ON t.REGISTER_ID = r.REGISTER_ID
        WHERE  r.REGISTER_ID = :registerId
        GROUP BY r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
                 r.START_DATE, r.END_DATE, r.COMMENTS,
                 r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
                 r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT,
                 r.CREATED_BY, r.CREATION_DATE;
    rec c%ROWTYPE;
BEGIN
    OPEN c; FETCH c INTO rec; CLOSE c;
    IF rec.REGISTER_ID IS NULL THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Register not found"}'');
        RETURN;
    END IF;
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'',         TRUE);
    APEX_JSON.WRITE(''registerId'',      rec.REGISTER_ID);
    APEX_JSON.WRITE(''registerName'',    rec.REGISTER_NAME);
    APEX_JSON.WRITE(''businessUnit'',    rec.BUSINESS_UNIT);
    APEX_JSON.WRITE(''startDate'',       TO_CHAR(rec.START_DATE, ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''endDate'',         TO_CHAR(rec.END_DATE,   ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''comments'',        rec.COMMENTS);
    APEX_JSON.WRITE(''cashAccountCcid'', rec.CASH_ACCOUNT_CCID);
    APEX_JSON.WRITE(''cashAccountDesc'', rec.CASH_ACCOUNT_DESC);
    APEX_JSON.WRITE(''currency'',        NVL(rec.CURRENCY,''AED''));
    APEX_JSON.WRITE(''status'',          rec.STATUS);
    APEX_JSON.WRITE(''ownedBy'',         rec.OWNED_BY);
    APEX_JSON.WRITE(''limit'',           rec.CASH_LIMIT);
    APEX_JSON.WRITE(''balance'',         rec.BALANCE);
    APEX_JSON.WRITE(''totalDebit'',      rec.TOTAL_DEBIT);
    APEX_JSON.WRITE(''totalCredit'',     rec.TOTAL_CREDIT);
    APEX_JSON.WRITE(''createdBy'',       rec.CREATED_BY);
    APEX_JSON.WRITE(''creationDate'',    TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
    APEX_JSON.CLOSE_OBJECT;
    HTP.PRN(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
END;
'
    );

    -- PUT /reerp/pc/registers/:registerId
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers/:registerId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.update_register(
        p_register_id => :registerId,
        p_json        => :body_text,
        p_rows        => l_rows,
        p_error       => l_err
    );
    IF l_err IS NOT NULL THEN
        :status_code := CASE WHEN l_err LIKE ''BLOCKED:%'' THEN 400 ELSE 500 END;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(REPLACE(l_err,''BLOCKED:'','''')) || ''}'');
    ELSIF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Register not found"}'');
    ELSE
        :status_code := 200;
        HTP.PRN(''{"success":true,"message":"Register updated"}'');
    END IF;
END;
'
    );

    -- DELETE /reerp/pc/registers/:registerId
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers/:registerId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.delete_register(p_register_id => :registerId, p_rows => l_rows, p_error => l_err);
    IF l_err LIKE ''BLOCKED:%'' THEN
        :status_code := 400;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(REPLACE(l_err,''BLOCKED:'','''')) || ''}'');
    ELSIF l_err IS NOT NULL THEN
        :status_code := 500;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(l_err) || ''}'');
    ELSIF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Register not found"}'');
    ELSE
        :status_code := 200;
        HTP.PRN(''{"success":true,"message":"Register deleted"}'');
    END IF;
END;
'
    );

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 3: pc/registers/:registerId/transactions  (GET)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/registers/:registerId/transactions');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/registers/:registerId/transactions',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT t.TRANSACTION_ID, t.REGISTER_ID, t.LINE_NUMBER,
               t.TRANSACTION_DATE, t.TRANSACTION_TYPE, t.EXPENSE_TYPE,
               t.CHARGE_ACCOUNT_CCID, t.CHARGE_ACCOUNT_DESC,
               t.ACCOUNTING_DATE, t.ACCOUNTING_PERIOD,
               t.POSTING_STATUS, t.CURRENCY,
               t.DEBIT_AMOUNT, t.CREDIT_AMOUNT,
               t.COMMENTS, t.REFERENCE_NO, t.ATTACHMENT,
               t.EMPLOYEE_NAME, t.RECEIPT_STATUS,
               t.BANK_TXN_ID,
               t.CREATED_BY, t.CREATION_DATE,
               SUM(t.DEBIT_AMOUNT - t.CREDIT_AMOUNT) OVER (
                   PARTITION BY t.REGISTER_ID
                   ORDER BY t.TRANSACTION_DATE, t.LINE_NUMBER
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS RUNNING_BALANCE
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
        APEX_JSON.WRITE(''accountingDate'',   TO_CHAR(rec.ACCOUNTING_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''accountingPeriod'', rec.ACCOUNTING_PERIOD);
        APEX_JSON.WRITE(''postingStatus'',    rec.POSTING_STATUS);
        APEX_JSON.WRITE(''currency'',         NVL(rec.CURRENCY,''AED''));
        APEX_JSON.WRITE(''debitAmount'',      rec.DEBIT_AMOUNT);
        APEX_JSON.WRITE(''creditAmount'',     rec.CREDIT_AMOUNT);
        APEX_JSON.WRITE(''comments'',         rec.COMMENTS);
        APEX_JSON.WRITE(''referenceNo'',      rec.REFERENCE_NO);
        APEX_JSON.WRITE(''attachment'',       rec.ATTACHMENT);
        APEX_JSON.WRITE(''hasAttachment'',   CASE WHEN rec.ATTACHMENT IS NOT NULL THEN ''Y'' ELSE ''N'' END);
        APEX_JSON.WRITE(''employeeName'',    rec.EMPLOYEE_NAME);
        APEX_JSON.WRITE(''receiptStatus'',   rec.RECEIPT_STATUS);
        IF rec.BANK_TXN_ID IS NOT NULL THEN
            APEX_JSON.WRITE(''bankTxnId'', rec.BANK_TXN_ID);
        ELSE
            APEX_JSON.WRITE(''bankTxnId'', TO_CHAR(NULL));
        END IF;
        APEX_JSON.WRITE(''createdBy'',        rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',     TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
        APEX_JSON.WRITE(''runningBalance'',   rec.RUNNING_BALANCE);
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

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 4: pc/transactions  (POST create)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/transactions');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_id   NUMBER;
    l_line NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.create_transaction(p_json => :body_text, p_id => l_id, p_line => l_line, p_error => l_err);
    IF l_err LIKE ''NOT_FOUND:%'' THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(REPLACE(l_err,''NOT_FOUND:'','''')) || ''}'');
    ELSIF l_err LIKE ''BLOCKED:%'' THEN
        :status_code := 400;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(REPLACE(l_err,''BLOCKED:'','''')) || ''}'');
    ELSIF l_err IS NOT NULL THEN
        :status_code := 500;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(l_err) || ''}'');
    ELSE
        :status_code := 201;
        HTP.PRN(''{"success":true,"transactionId":'' || l_id || '',"lineNumber":'' || l_line || '',"message":"Transaction created"}'');
    END IF;
END;
'
    );

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 5: pc/transactions/:transactionId (GET + PUT + DELETE)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/transactions/:transactionId');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions/:transactionId',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    CURSOR c IS
        SELECT t.TRANSACTION_ID, t.REGISTER_ID, t.LINE_NUMBER,
               t.TRANSACTION_DATE, t.TRANSACTION_TYPE, t.EXPENSE_TYPE,
               t.CHARGE_ACCOUNT_CCID, t.CHARGE_ACCOUNT_DESC,
               t.ACCOUNTING_DATE, t.ACCOUNTING_PERIOD, t.POSTING_STATUS, t.CURRENCY,
               t.DEBIT_AMOUNT, t.CREDIT_AMOUNT,
               t.COMMENTS, t.REFERENCE_NO, t.ATTACHMENT,
               t.EMPLOYEE_NAME, t.RECEIPT_STATUS,
               t.BANK_TXN_ID,
               t.CREATED_BY, t.CREATION_DATE, t.LAST_UPDATED_BY, t.LAST_UPDATE_DATE
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
    APEX_JSON.WRITE(''success'',           TRUE);
    APEX_JSON.WRITE(''transactionId'',     rec.TRANSACTION_ID);
    APEX_JSON.WRITE(''registerId'',        rec.REGISTER_ID);
    APEX_JSON.WRITE(''lineNumber'',        rec.LINE_NUMBER);
    APEX_JSON.WRITE(''transactionDate'',   TO_CHAR(rec.TRANSACTION_DATE,  ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''transactionType'',   rec.TRANSACTION_TYPE);
    APEX_JSON.WRITE(''expenseType'',       rec.EXPENSE_TYPE);
    APEX_JSON.WRITE(''chargeAccountCcid'', rec.CHARGE_ACCOUNT_CCID);
    APEX_JSON.WRITE(''chargeAccountDesc'', rec.CHARGE_ACCOUNT_DESC);
    APEX_JSON.WRITE(''accountingDate'',    TO_CHAR(rec.ACCOUNTING_DATE,   ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''accountingPeriod'',  rec.ACCOUNTING_PERIOD);
    APEX_JSON.WRITE(''postingStatus'',     rec.POSTING_STATUS);
    APEX_JSON.WRITE(''currency'',          NVL(rec.CURRENCY,''AED''));
    APEX_JSON.WRITE(''debitAmount'',       rec.DEBIT_AMOUNT);
    APEX_JSON.WRITE(''creditAmount'',      rec.CREDIT_AMOUNT);
    APEX_JSON.WRITE(''comments'',          rec.COMMENTS);
    APEX_JSON.WRITE(''referenceNo'',       rec.REFERENCE_NO);
    APEX_JSON.WRITE(''attachment'',        rec.ATTACHMENT);
    APEX_JSON.WRITE(''hasAttachment'',    CASE WHEN rec.ATTACHMENT IS NOT NULL THEN ''Y'' ELSE ''N'' END);
    APEX_JSON.WRITE(''employeeName'',     rec.EMPLOYEE_NAME);
    APEX_JSON.WRITE(''receiptStatus'',    rec.RECEIPT_STATUS);
    IF rec.BANK_TXN_ID IS NOT NULL THEN
        APEX_JSON.WRITE(''bankTxnId'', rec.BANK_TXN_ID);
    ELSE
        APEX_JSON.WRITE(''bankTxnId'', TO_CHAR(NULL));
    END IF;
    APEX_JSON.WRITE(''createdBy'',         rec.CREATED_BY);
    APEX_JSON.WRITE(''creationDate'',      TO_CHAR(rec.CREATION_DATE,     ''DD-MON-YYYY''));
    APEX_JSON.WRITE(''lastUpdatedBy'',     rec.LAST_UPDATED_BY);
    APEX_JSON.WRITE(''lastUpdateDate'',    TO_CHAR(rec.LAST_UPDATE_DATE,  ''DD-MON-YYYY''));
    APEX_JSON.CLOSE_OBJECT;
    HTP.PRN(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
END;
'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions/:transactionId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.update_transaction(p_transaction_id => :transactionId, p_json => :body_text, p_rows => l_rows, p_error => l_err);
    IF l_err IS NOT NULL THEN
        :status_code := 500;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(l_err) || ''}'');
    ELSIF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Transaction not found"}'');
    ELSE
        :status_code := 200;
        HTP.PRN(''{"success":true,"message":"Transaction updated"}'');
    END IF;
END;
'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions/:transactionId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.delete_transaction(p_transaction_id => :transactionId, p_rows => l_rows, p_error => l_err);
    IF l_err IS NOT NULL THEN
        :status_code := 500;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(l_err) || ''}'');
    ELSIF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Transaction not found"}'');
    ELSE
        :status_code := 200;
        HTP.PRN(''{"success":true,"message":"Transaction deleted"}'');
    END IF;
END;
'
    );

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 6: pc/transactions/:transactionId/attachment (GET)
    -- Returns the CLOB attachment data in chunks via HTP.PRN
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/transactions/:transactionId/attachment');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions/:transactionId/attachment',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    l_data     CLOB;
    l_fname    VARCHAR2(1000);
    l_offset   INTEGER := 1;
    l_amount   INTEGER := 4000;
    l_len      INTEGER;
BEGIN
    BEGIN
        SELECT ATTACHMENT_DATA, ATTACHMENT
        INTO   l_data, l_fname
        FROM   RR_PC_TRANSACTIONS
        WHERE  TRANSACTION_ID = :transactionId;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Transaction not found"}'');
        RETURN;
    END;
    IF l_data IS NULL THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"No attachment stored"}'');
        RETURN;
    END IF;
    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(l_data);
    HTP.PRN(''{"success":true,"fileName":'' || APEX_JSON.STRINGIFY(l_fname) || '','' ||
             ''"attachmentData":"'');
    WHILE l_offset <= l_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(l_data, l_amount, l_offset));
        l_offset := l_offset + l_amount;
    END LOOP;
    HTP.PRN(''"}'');
END;
'
    );

    -- ══════════════════════════════════════════════════════════
    -- TEMPLATE 7: pc/openperiods  (GET open AP periods)
    -- ══════════════════════════════════════════════════════════
    BEGIN
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'pc/openperiods');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/openperiods',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT period_name_id,
               TO_CHAR(start_date, ''YYYY-MM-DD'') AS start_date,
               TO_CHAR(end_date,   ''YYYY-MM-DD'') AS end_date,
               period_year, period_number, closing_status
        FROM   rr_accounting_periods_status
        WHERE  application_id = 200
        AND    closing_status = ''O''
        AND    NVL(adjustment_period_flag, ''N'') = ''N''
        ORDER BY period_year, period_number;
BEGIN
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'', TRUE);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR rec IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''periodName'',   rec.period_name_id);
        APEX_JSON.WRITE(''startDate'',    rec.start_date);
        APEX_JSON.WRITE(''endDate'',      rec.end_date);
        APEX_JSON.WRITE(''periodYear'',   rec.period_year);
        APEX_JSON.WRITE(''periodNumber'', rec.period_number);
        APEX_JSON.WRITE(''status'',       rec.closing_status);
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

-- ============================================================
-- PATCH: pc/transactions/:transactionId/status
-- Updates ONLY POSTING_STATUS — does not touch any other column
-- Body: { "postingStatus": "Posted"|"Unposted"|"Error", "updatedBy": "..." }
-- ============================================================
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'pc/transactions/:transactionId/status',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'pc/transactions/:transactionId/status'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'pc/transactions/:transactionId/status',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_mimes_allowed  => 'application/json',
        p_source         => '
DECLARE
    l_status   VARCHAR2(20);
    l_by       VARCHAR2(150);
    l_rows     NUMBER;
BEGIN
    APEX_JSON.PARSE(:body_text);
    l_status := APEX_JSON.GET_VARCHAR2(p_path => ''postingStatus'');
    l_by     := NVL(APEX_JSON.GET_VARCHAR2(p_path => ''updatedBy''), ''SYSTEM'');

    IF l_status IS NULL THEN
        :status_code := 400;
        HTP.PRN(''{"success":false,"message":"postingStatus is required"}'');
        RETURN;
    END IF;

    UPDATE RR_PC_TRANSACTIONS
    SET    POSTING_STATUS   = l_status,
           LAST_UPDATED_BY  = l_by,
           LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE  TRANSACTION_ID   = :transactionId;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN(''{"success":false,"message":"Transaction not found"}'');
    ELSE
        :status_code := 200;
        HTP.PRN(''{"success":true,"message":"Posting status updated"}'');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(SQLERRM) || ''}'');
END;
'
    );

    COMMIT;
END;
/

-- ============================================================
-- Verify after running:
--   SELECT pattern, method FROM user_ords_handlers
--   WHERE module_name = 'reerp' AND pattern LIKE 'pc/%'
--   ORDER BY pattern, method;
-- ============================================================
