-- ============================================================
-- PATCH 65: Unified bank reconciliation view + single webservice
--
-- Creates:
--   1. VIEW  RR_V_BANK_RECON_SYSTXNS
--      Combines AP Payments, External Transactions, and Bank
--      Transfer GL Lines into one consistent row format.
--
--   2. ORDS handler  cash/reconciliation/systxns  (replaces old)
--      Single endpoint over the view with filters:
--        bank_account  (REQUIRED -- returns empty if omitted)
--        business_unit
--        source         AP_PAYMENT | EXTERNAL_TXN | BANK_TRANSFER
--        recon_status   RECONCILED | UNRECONCILED (default UNRECONCILED)
--        date_from / date_to  YYYY-MM-DD
--        amount_min / amount_max
--        reference
--        row_limit      default 500
--
-- HOW TO RUN:
--   APEX SQL Workshop -> SQL Commands
--   Run STEP 1 first, then STEP 2 (each BEGIN...END; separately).
-- ============================================================


-- STEP 1: Create or replace the view
CREATE OR REPLACE VIEW RR_V_BANK_RECON_SYSTXNS AS

    -- AP Payments
    SELECT
        'AP_PAYMENT'                            AS SOURCE,
        TO_CHAR(p.CHECK_ID)                     AS TXN_ID,
        p.PAYMENT_NUMBER                        AS TXN_NUMBER,
        p.PAYMENT_REFERENCE                     AS REFERENCE,
        p.PAYMENT_DATE                          AS TXN_DATE,
        p.PAYMENT_AMOUNT                        AS AMOUNT,
        p.PAYMENT_CURRENCY                      AS CURRENCY_CODE,
        p.PAYMENT_STATUS                        AS STATUS,
        p.DISBURSEMENT_BANK_ACCOUNT_NAME        AS BANK_ACCOUNT_NAME,
        p.BUSINESS_UNIT                         AS BUSINESS_UNIT,
        p.PAYEE                                 AS COUNTERPARTY_NAME,
        p.SUPPLIER_NUMBER                       AS COUNTERPARTY_NUMBER,
        p.PAYMENT_MODE                          AS PAYMENT_METHOD,
        p.CLEARING_DATE                         AS CLEARING_DATE,
        NVL(p.RECONCILED_FLAG, 'N')             AS RECONCILED_FLAG,
        NULL                                    AS DESCRIPTION,
        NULL                                    AS ACCOUNTING_CLASS,
        NULL                                    AS JE_HEADER_ID,
        NULL                                    AS JE_LINE_NUMBER,
        NULL                                    AS ACCOUNT_COMBINATION,
        NULL                                    AS TRANSFER_ID,
        p.CREATED_BY,
        p.CREATION_DATE
    FROM RR_AP_PAYMENTS_ALL p

UNION ALL

    -- External Transactions
    SELECT
        'EXTERNAL_TXN'                          AS SOURCE,
        TO_CHAR(e.EXTERNAL_TRANSACTION_ID)      AS TXN_ID,
        NVL(e.CHECK_NUMBER, TO_CHAR(e.TRANSACTION_ID))
                                                AS TXN_NUMBER,
        e.REFERENCE_TEXT                        AS REFERENCE,
        e.TRANSACTION_DATE                      AS TXN_DATE,
        e.AMOUNT                                AS AMOUNT,
        e.CURRENCY_CODE,
        e.STATUS,
        e.BANK_ACCOUNT_NAME,
        e.BUSINESS_UNIT_NAME                    AS BUSINESS_UNIT,
        e.PAYEE_NAME                            AS COUNTERPARTY_NAME,
        NULL                                    AS COUNTERPARTY_NUMBER,
        e.PAYMENT_METHOD,
        e.CLEARED_DATE                          AS CLEARING_DATE,
        NVL(e.RECONCILED_FLAG, 'N')             AS RECONCILED_FLAG,
        e.DESCRIPTION,
        NULL                                    AS ACCOUNTING_CLASS,
        NULL                                    AS JE_HEADER_ID,
        NULL                                    AS JE_LINE_NUMBER,
        e.ASSET_ACCOUNT_COMBINATION             AS ACCOUNT_COMBINATION,
        e.TRANSFER_ID,
        e.CREATED_BY,
        e.CREATION_DATE
    FROM RR_EXTERNAL_CASH_TRANSACTIONS e

UNION ALL

    -- Bank Transfers (GL Journal Lines -- BANK_ASSET lines only)
    -- REFERENCE1 = bank_transfer_id  REFERENCE2 = transfer_number
    -- REFERENCE3 = accounting_class  (may be blank in existing data)
    -- REFERENCE4 = business_unit     REFERENCE5 = event_type (BANKTFR-DISBURSE|BANKTFR-RECEIPT)
    -- REFERENCE7 = bank_account_name (may be blank on older rows; fallback via RR_BANK_ACCOUNT_TRANSFERS)
    --
    -- Fix 1: INNER JOIN on RR_BANK_ACCOUNT_TRANSFERS ensures only genuine bank-transfer GL lines
    --        appear here; external-transaction GL lines whose REFERENCE1 is not a valid transfer ID
    --        are automatically excluded.
    -- Fix 2: COALESCE falls back to FROM/TO_BANK_ACCOUNT_NAME when REFERENCE7 is blank so that
    --        unreconciled transfers without REFERENCE7 are still visible to the user.
    SELECT
        'BANK_TRANSFER'                                  AS SOURCE,
        TO_CHAR(l.JE_HEADER_ID) || '-' || TO_CHAR(l.JE_LINE_NUMBER)
                                                         AS TXN_ID,
        l.REFERENCE1                                     AS TXN_NUMBER,
        l.REFERENCE2                                     AS REFERENCE,
        TRUNC(NVL(h.DEFAULT_EFFECTIVE_DATE, b.CREATION_DATE))
                                                         AS TXN_DATE,
        NVL(l.ENTERED_DR, l.ENTERED_CR)                 AS AMOUNT,
        l.CURRENCY_CODE,
        b.STATUS,
        COALESCE(
            l.REFERENCE7,
            CASE l.REFERENCE5
                WHEN 'BANKTFR-DISBURSE' THEN bt.FROM_BANK_ACCOUNT_NAME
                WHEN 'BANKTFR-RECEIPT'  THEN bt.TO_BANK_ACCOUNT_NAME
            END
        )                                                AS BANK_ACCOUNT_NAME,
        l.REFERENCE4                                     AS BUSINESS_UNIT,
        NULL                                             AS COUNTERPARTY_NAME,
        NULL                                             AS COUNTERPARTY_NUMBER,
        NULL                                             AS PAYMENT_METHOD,
        NULL                                             AS CLEARING_DATE,
        NVL(l.RECONCILED_FLAG, 'N')                     AS RECONCILED_FLAG,
        l.DESCRIPTION,
        l.REFERENCE3                                     AS ACCOUNTING_CLASS,
        l.JE_HEADER_ID,
        l.JE_LINE_NUMBER,
        l.ACCOUNT_COMBINATION,
        NULL                                             AS TRANSFER_ID,
        l.CREATED_BY,
        l.CREATION_DATE
    FROM RR_GL_JE_LINES_ALL    l
    JOIN RR_GL_JE_HEADERS      h  ON h.JE_HEADER_ID  = l.JE_HEADER_ID
    JOIN RR_GL_JOURNAL_BATCHES b  ON b.JE_BATCH_ID   = l.BATCH_ID
    JOIN RR_BANK_ACCOUNT_TRANSFERS bt
                                  ON TO_CHAR(bt.BANK_ACCOUNT_TRANSFER_ID) = l.REFERENCE1
    WHERE l.REFERENCE5 IN ('BANKTFR-DISBURSE', 'BANKTFR-RECEIPT')
/


-- STEP 2: Replace cash/reconciliation/systxns handler
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
        p_comments       => 'Unified system transactions for bank recon -- AP Payments + External Txns + Bank Transfers (requires bank_account)',
        p_source         => q'[
DECLARE
    l_bank_acct    VARCHAR2(360) := :bank_account;
    l_bus_unit     VARCHAR2(360) := :business_unit;
    l_source       VARCHAR2(30)  := :source;        -- AP_PAYMENT | EXTERNAL_TXN | BANK_TRANSFER
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
        WHERE l_bank_acct IS NOT NULL
          AND UPPER(BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_bank_acct) || '%'
          AND (l_bus_unit     IS NULL OR UPPER(BUSINESS_UNIT) LIKE '%' || UPPER(l_bus_unit) || '%')
          AND (l_source       IS NULL OR SOURCE = l_source)
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
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('{"status":"success","items":['));

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
