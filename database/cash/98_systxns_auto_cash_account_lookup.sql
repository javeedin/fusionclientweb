-- ============================================================
-- PATCH 98: Auto-lookup cash_account in systxns GET handler
--
-- When source=GL_JOURNAL (or ALL) and no cash_account param
-- is passed, the handler now looks it up automatically from
-- RR_BANK_ACCOUNTS using the bank_account name.
-- This means the frontend only needs to pass bank_account —
-- no separate cash_account parameter required.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands  (single BEGIN...END; block)
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/reconciliation/systxns',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/systxns',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Unified system transactions — AP + External + Bank Transfers + GL Journals. Auto-resolves cash_account from RR_BANK_ACCOUNTS when not supplied.',
        p_source         => q'[
DECLARE
    l_bank_acct    VARCHAR2(360) := :bank_account;
    l_cash_acct    VARCHAR2(500) := :cash_account;  -- optional; auto-resolved if blank
    l_bus_unit     VARCHAR2(360) := :business_unit;
    l_source       VARCHAR2(30)  := :source;
    l_recon_status VARCHAR2(30)  := NVL(:recon_status, 'UNRECONCILED');
    l_date_from    VARCHAR2(30)  := :date_from;
    l_date_to      VARCHAR2(30)  := :date_to;
    l_amt_min      VARCHAR2(30)  := :amount_min;
    l_amt_max      VARCHAR2(30)  := :amount_max;
    l_reference    VARCHAR2(360) := :reference;
    l_limit        NUMBER        := NVL(TO_NUMBER(:row_limit), 500);

    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
    l_pos   INTEGER;
    l_len   INTEGER;
    l_chunk VARCHAR2(32767);

    CURSOR c_data IS
        SELECT
            SOURCE,
            TXN_ID,
            TXN_NUMBER,
            REFERENCE,
            TO_CHAR(TXN_DATE, 'YYYY-MM-DD')                           AS TXN_DATE,
            NVL(AMOUNT, 0)                                             AS AMOUNT,
            CURRENCY_CODE,
            STATUS,
            BANK_ACCOUNT_NAME,
            BUSINESS_UNIT,
            COUNTERPARTY_NAME,
            COUNTERPARTY_NUMBER,
            PAYMENT_METHOD,
            TO_CHAR(CLEARING_DATE, 'YYYY-MM-DD')                      AS CLEARING_DATE,
            RECONCILED_FLAG,
            DESCRIPTION,
            ACCOUNTING_CLASS,
            JE_HEADER_ID,
            JE_LINE_NUMBER,
            ACCOUNT_COMBINATION,
            TRANSFER_ID,
            CREATED_BY,
            TO_CHAR(CREATION_DATE, 'YYYY-MM-DD')                      AS CREATION_DATE
        FROM RR_V_BANK_RECON_SYSTXNS
        WHERE (
            -- Non-GL sources: filter by bank account name
            (SOURCE != 'GL_JOURNAL'
             AND l_bank_acct IS NOT NULL
             AND UPPER(BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_bank_acct) || '%')
            OR
            -- GL Journal: filter by resolved cash account combination
            (SOURCE = 'GL_JOURNAL'
             AND l_cash_acct IS NOT NULL
             AND ACCOUNT_COMBINATION = l_cash_acct)
        )
          AND (l_source       IS NULL OR SOURCE = l_source)
          AND (l_bus_unit     IS NULL OR UPPER(BUSINESS_UNIT) LIKE '%' || UPPER(l_bus_unit) || '%')
          AND (l_recon_status = 'ALL'
               OR (l_recon_status = 'RECONCILED'   AND RECONCILED_FLAG = 'Y')
               OR (l_recon_status = 'UNRECONCILED' AND NVL(RECONCILED_FLAG,'N') != 'Y'))
          AND (l_date_from    IS NULL OR TXN_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
          AND (l_date_to      IS NULL OR TXN_DATE <  TO_DATE(l_date_to,   'YYYY-MM-DD') + 1)
          AND (l_amt_min      IS NULL OR AMOUNT >= TO_NUMBER(l_amt_min))
          AND (l_amt_max      IS NULL OR AMOUNT <= TO_NUMBER(l_amt_max))
          AND (l_reference    IS NULL OR UPPER(TXN_NUMBER) LIKE '%' || UPPER(l_reference) || '%'
                                      OR UPPER(REFERENCE)  LIKE '%' || UPPER(l_reference) || '%')
        ORDER BY TXN_DATE DESC, TXN_ID DESC
        FETCH FIRST l_limit ROWS ONLY;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p;
    BEGIN
        IF v IS NULL THEN RETURN 'null'; END IF;
        v := REPLACE(v, '\',  '\\');
        v := REPLACE(v, '"',  '\"');
        v := REPLACE(v, CHR(10), '\n');
        v := REPLACE(v, CHR(13), '\r');
        v := REPLACE(v, CHR(9),  '\t');
        RETURN '"' || v || '"';
    END;

    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        RETURN REGEXP_REPLACE(TO_CHAR(p, 'FM99999999999999990.9999999999'), '\.$', '');
    END;
BEGIN
    -- ── Auto-resolve cash account from RR_BANK_ACCOUNTS ───────
    -- Needed so that GL_JOURNAL rows can be matched by account
    -- combination without the caller having to look it up first.
    IF l_cash_acct IS NULL AND l_bank_acct IS NOT NULL THEN
        BEGIN
            SELECT CASH_ACCOUNT_COMBINATION
              INTO l_cash_acct
              FROM RR_BANK_ACCOUNTS
             WHERE UPPER(BANK_ACCOUNT_NAME) = UPPER(l_bank_acct)
               AND CASH_ACCOUNT_COMBINATION IS NOT NULL
               AND ROWNUM = 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- Try partial match as fallback
                BEGIN
                    SELECT CASH_ACCOUNT_COMBINATION
                      INTO l_cash_acct
                      FROM RR_BANK_ACCOUNTS
                     WHERE UPPER(BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_bank_acct) || '%'
                       AND CASH_ACCOUNT_COMBINATION IS NOT NULL
                       AND ROWNUM = 1;
                EXCEPTION
                    WHEN NO_DATA_FOUND THEN l_cash_acct := NULL;
                END;
            WHEN OTHERS THEN l_cash_acct := NULL;
        END;
    END IF;

    -- ── Stream response ───────────────────────────────────────
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB(
        '{"status":"success"'
        || ',"cashAccount":' || jstr(l_cash_acct)
        || ',"items":['
    ));

    FOR r IN c_data LOOP
        IF NOT v_first THEN
            DBMS_LOB.APPEND(v_clob, TO_CLOB(','));
        END IF;
        v_first := FALSE;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(
            '{"source":'             || jstr(r.SOURCE)               ||
            ',"txnId":'              || jstr(r.TXN_ID)               ||
            ',"txnNumber":'          || jstr(r.TXN_NUMBER)           ||
            ',"reference":'          || jstr(r.REFERENCE)            ||
            ',"txnDate":'            || jstr(r.TXN_DATE)             ||
            ',"amount":'             || jnum(r.AMOUNT)               ||
            ',"currencyCode":'       || jstr(r.CURRENCY_CODE)        ||
            ',"status":'             || jstr(r.STATUS)               ||
            ',"bankAccountName":'    || jstr(r.BANK_ACCOUNT_NAME)    ||
            ',"businessUnit":'       || jstr(r.BUSINESS_UNIT)        ||
            ',"counterpartyName":'   || jstr(r.COUNTERPARTY_NAME)    ||
            ',"counterpartyNumber":' || jstr(r.COUNTERPARTY_NUMBER)  ||
            ',"paymentMethod":'      || jstr(r.PAYMENT_METHOD)       ||
            ',"clearingDate":'       || jstr(r.CLEARING_DATE)        ||
            ',"reconciledFlag":'     || jstr(r.RECONCILED_FLAG)      ||
            ',"description":'        || jstr(r.DESCRIPTION)          ||
            ',"accountingClass":'    || jstr(r.ACCOUNTING_CLASS)     ||
            ',"jeHeaderId":'         || NVL(TO_CHAR(r.JE_HEADER_ID), 'null') ||
            ',"jeLineNumber":'       || NVL(TO_CHAR(r.JE_LINE_NUMBER), 'null') ||
            ',"accountCombination":' || jstr(r.ACCOUNT_COMBINATION)  ||
            ',"transferId":'         || NVL(TO_CHAR(r.TRANSFER_ID), 'null') ||
            ',"createdBy":'          || jstr(r.CREATED_BY)           ||
            ',"creationDate":'       || jstr(r.CREATION_DATE)        ||
            '}'
        ));
    END LOOP;

    DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));

    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(v_clob);
    l_pos := 1;
    LOOP
        EXIT WHEN l_pos > l_len;
        l_chunk := DBMS_LOB.SUBSTR(v_clob, 32767, l_pos);
        HTP.PRN(l_chunk);
        l_pos := l_pos + 32767;
    END LOOP;
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/
