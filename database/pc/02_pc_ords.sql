-- ============================================================
-- Petty Cash Module — ORDS REST Handlers
-- File: database/pc/02_pc_ords.sql
-- Run order: 2nd (after 01_pc_tables.sql, before 03_pc_pkg.sql)
-- ============================================================
-- All business logic lives in RR_PC_PKG (03_pc_pkg.sql).
-- Handlers here are thin: call package, return JSON.
--
-- Endpoints:
--   GET    /pc/registers                          — search registers
--   POST   /pc/registers                          — create register
--   GET    /pc/registers/:registerId              — single register + balance
--   PUT    /pc/registers/:registerId              — update register header
--   DELETE /pc/registers/:registerId              — delete (no transactions only)
--   GET    /pc/registers/:registerId/transactions — lines with running balance
--   POST   /pc/transactions                       — create transaction
--   PUT    /pc/transactions/:transactionId        — edit transaction
--   DELETE /pc/transactions/:transactionId        — delete transaction
-- ============================================================

-- Drop existing module first so all templates/handlers are recreated cleanly
BEGIN
    ORDS.DELETE_MODULE(p_module_name => 'pc');
EXCEPTION
    WHEN OTHERS THEN NULL;  -- ignore ORA-20001 if module does not exist yet
END;
/

BEGIN
    -- ── MODULE ─────────────────────────────────────────────────────────────
    ORDS.DEFINE_MODULE(
        p_module_name    => 'pc',
        p_base_path      => '/pc/',
        p_items_per_page => 1000,
        p_status         => 'PUBLISHED'
    );

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 1: /pc/registers
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'registers'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- GET /pc/registers  — Search registers
    -- Params: q (name contains), status, dateFrom (YYYY-MM-DD), dateTo
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT r.REGISTER_ID,
               r.REGISTER_NAME,
               r.BUSINESS_UNIT,
               r.START_DATE,
               r.END_DATE,
               r.COMMENTS,
               r.CASH_ACCOUNT_CCID,
               r.CASH_ACCOUNT_DESC,
               r.CURRENCY,
               r.STATUS,
               r.OWNED_BY,
               r.CASH_LIMIT,
               r.CREATED_BY,
               r.CREATION_DATE,
               NVL(SUM(t.DEBIT_AMOUNT),0) - NVL(SUM(t.CREDIT_AMOUNT),0) AS BALANCE,
               NVL(SUM(t.DEBIT_AMOUNT),0)  AS TOTAL_DEBIT,
               NVL(SUM(t.CREDIT_AMOUNT),0) AS TOTAL_CREDIT
        FROM   RR_PC_REGISTERS r
        LEFT JOIN RR_PC_TRANSACTIONS t ON t.REGISTER_ID = r.REGISTER_ID
        WHERE  (:q        IS NULL OR UPPER(r.REGISTER_NAME) LIKE ''%''||UPPER(:q)||''%'')
        AND    (:status   IS NULL OR r.STATUS       = :status)
        AND    (:bu       IS NULL OR r.BUSINESS_UNIT = :bu)
        AND    (:dateFrom IS NULL OR r.START_DATE >= TO_DATE(:dateFrom,''YYYY-MM-DD''))
        AND    (:dateTo   IS NULL OR r.END_DATE   <= TO_DATE(:dateTo,  ''YYYY-MM-DD''))
        GROUP BY r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT, r.START_DATE, r.END_DATE,
                 r.COMMENTS, r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
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
        APEX_JSON.WRITE(''balance'',         rec.BALANCE);
        APEX_JSON.WRITE(''totalDebit'',      rec.TOTAL_DEBIT);
        APEX_JSON.WRITE(''totalCredit'',     rec.TOTAL_CREDIT);
        APEX_JSON.WRITE(''ownedBy'',         rec.OWNED_BY);
        APEX_JSON.WRITE(''limit'',           rec.CASH_LIMIT);
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

    -- ──────────────────────────────────────────────────────────────────────
    -- POST /pc/registers  — Create register  →  RR_PC_PKG.create_register
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers',
        p_method      => 'POST',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_id    NUMBER;
    l_err   VARCHAR2(4000);
BEGIN
    RR_PC_PKG.create_register(
        p_json  => :body_text,
        p_id    => l_id,
        p_error => l_err
    );
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

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 2: /pc/registers/:registerId
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- GET /pc/registers/:registerId  — Single register with live balance
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    CURSOR c IS
        SELECT r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
               r.START_DATE, r.END_DATE,
               r.COMMENTS, r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
               r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT,
               r.CREATED_BY, r.CREATION_DATE,
               NVL(SUM(t.DEBIT_AMOUNT),0) - NVL(SUM(t.CREDIT_AMOUNT),0) AS BALANCE,
               NVL(SUM(t.DEBIT_AMOUNT),0)  AS TOTAL_DEBIT,
               NVL(SUM(t.CREDIT_AMOUNT),0) AS TOTAL_CREDIT
        FROM   RR_PC_REGISTERS r
        LEFT JOIN RR_PC_TRANSACTIONS t ON t.REGISTER_ID = r.REGISTER_ID
        WHERE  r.REGISTER_ID = :registerId
        GROUP BY r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT,
                 r.START_DATE, r.END_DATE,
                 r.COMMENTS, r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC,
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
    APEX_JSON.WRITE(''balance'',         rec.BALANCE);
    APEX_JSON.WRITE(''totalDebit'',      rec.TOTAL_DEBIT);
    APEX_JSON.WRITE(''totalCredit'',     rec.TOTAL_CREDIT);
    APEX_JSON.WRITE(''ownedBy'',         rec.OWNED_BY);
    APEX_JSON.WRITE(''limit'',           rec.CASH_LIMIT);
    APEX_JSON.WRITE(''createdBy'',       rec.CREATED_BY);
    APEX_JSON.WRITE(''creationDate'',    TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
    APEX_JSON.CLOSE_OBJECT;
    HTP.PRN(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
END;
'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- PUT /pc/registers/:registerId  →  RR_PC_PKG.update_register
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId',
        p_method      => 'PUT',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
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
        :status_code := 500;
        HTP.PRN(''{"success":false,"message":'' || APEX_JSON.STRINGIFY(l_err) || ''}'');
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

    -- ──────────────────────────────────────────────────────────────────────
    -- DELETE /pc/registers/:registerId  →  RR_PC_PKG.delete_register
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId',
        p_method      => 'DELETE',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.delete_register(
        p_register_id => :registerId,
        p_rows        => l_rows,
        p_error       => l_err
    );
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

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 3: /pc/registers/:registerId/transactions
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/transactions'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- GET /pc/registers/:registerId/transactions
    -- Returns all lines ordered by date/line with running balance
    -- ──────────────────────────────────────────────────────────────────────
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
               NVL(t.SUSPENSE_AMOUNT, 0) AS SUSPENSE_AMOUNT,
               t.COMMENTS,
               t.REFERENCE_NO,
               t.ATTACHMENT,
               t.CREATED_BY,
               t.CREATION_DATE,
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
        APEX_JSON.WRITE(''chargeAccountCcid'',  rec.CHARGE_ACCOUNT_CCID);
        APEX_JSON.WRITE(''chargeAccountDesc'',  rec.CHARGE_ACCOUNT_DESC);
        APEX_JSON.WRITE(''accountingDate'',     TO_CHAR(rec.ACCOUNTING_DATE, ''DD-MON-YYYY''));
        APEX_JSON.WRITE(''accountingPeriod'',   rec.ACCOUNTING_PERIOD);
        APEX_JSON.WRITE(''postingStatus'',      rec.POSTING_STATUS);
        APEX_JSON.WRITE(''currency'',           NVL(rec.CURRENCY,''AED''));
        APEX_JSON.WRITE(''debitAmount'',        rec.DEBIT_AMOUNT);
        APEX_JSON.WRITE(''creditAmount'',       rec.CREDIT_AMOUNT);
        APEX_JSON.WRITE(''suspenseAmount'',     rec.SUSPENSE_AMOUNT);
        APEX_JSON.WRITE(''comments'',           rec.COMMENTS);
        APEX_JSON.WRITE(''referenceNo'',        rec.REFERENCE_NO);
        APEX_JSON.WRITE(''attachment'',         rec.ATTACHMENT);
        APEX_JSON.WRITE(''createdBy'',          rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',       TO_CHAR(rec.CREATION_DATE,''DD-MON-YYYY''));
        APEX_JSON.WRITE(''runningBalance'',     rec.RUNNING_BALANCE);
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

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 4: /pc/transactions
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'transactions'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- POST /pc/transactions  →  RR_PC_PKG.create_transaction
    -- Body: { registerId, transactionDate, transactionType, expenseType,
    --         chargeAccountCcid, chargeAccountDesc, accountingDate,
    --         postingStatus, currency, debitAmount, creditAmount,
    --         comments, referenceNo, attachment, createdBy }
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'transactions',
        p_method      => 'POST',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_id   NUMBER;
    l_line NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.create_transaction(
        p_json  => :body_text,
        p_id    => l_id,
        p_line  => l_line,
        p_error => l_err
    );
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
        HTP.PRN(''{"success":true,"transactionId":'' || l_id ||
                '',"lineNumber":'' || l_line ||
                '',"message":"Transaction created"}'');
    END IF;
END;
'
    );

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 5: /pc/transactions/:transactionId
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'transactions/:transactionId'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- GET /pc/transactions/:transactionId  — single transaction detail
    -- ──────────────────────────────────────────────────────────────────────
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
               t.COMMENTS, t.REFERENCE_NO, t.ATTACHMENT,
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

    -- ──────────────────────────────────────────────────────────────────────
    -- PUT /pc/transactions/:transactionId  →  RR_PC_PKG.update_transaction
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'transactions/:transactionId',
        p_method      => 'PUT',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.update_transaction(
        p_transaction_id => :transactionId,
        p_json           => :body_text,
        p_rows           => l_rows,
        p_error          => l_err
    );
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

    -- ──────────────────────────────────────────────────────────────────────
    -- DELETE /pc/transactions/:transactionId  →  RR_PC_PKG.delete_transaction
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'transactions/:transactionId',
        p_method      => 'DELETE',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_PKG.delete_transaction(
        p_transaction_id => :transactionId,
        p_rows           => l_rows,
        p_error          => l_err
    );
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

    -- ══════════════════════════════════════════════════════════════════════
    -- TEMPLATE 6: /pc/openperiods
    -- ══════════════════════════════════════════════════════════════════════
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'openperiods'
    );

    -- ──────────────────────────────────────────────────────────────────────
    -- GET /pc/openperiods  — open AP periods (application_id = 200)
    -- ──────────────────────────────────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'openperiods',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT period_name_id,
               TO_CHAR(start_date, ''YYYY-MM-DD'') AS start_date,
               TO_CHAR(end_date,   ''YYYY-MM-DD'') AS end_date,
               period_year,
               period_number,
               closing_status
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
