-- =============================================================================
-- RR_BANK_RECONCILIATION.SQL
-- Bank Reconciliation: ORDS REST Handlers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. GET cash/reconciliation/stmtlines
--    Returns bank statement lines filtered by reconciliation status and other params
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/stmtlines',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_result CLOB;
    v_limit  NUMBER := NVL(:row_limit, 500);
BEGIN
    SELECT JSON_OBJECT(
               'status' VALUE 'success',
               'items'  VALUE JSON_ARRAYAGG(
                   JSON_OBJECT(
                       'lineId'              VALUE LINE_ID,
                       'statementId'         VALUE STATEMENT_ID,
                       'statementNumber'     VALUE STATEMENT_NUMBER,
                       'lineNumber'          VALUE LINE_NUMBER,
                       'transactionDate'     VALUE TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD'),
                       'valueDate'           VALUE TO_CHAR(VALUE_DATE,       'YYYY-MM-DD'),
                       'amount'              VALUE AMOUNT,
                       'transactionCode'     VALUE TRANSACTION_CODE,
                       'description'         VALUE DESCRIPTION,
                       'reference'           VALUE REFERENCE,
                       'bankTxnReference'    VALUE BANK_TXN_REFERENCE,
                       'counterpartyName'    VALUE COUNTERPARTY_NAME,
                       'counterpartyAccount' VALUE COUNTERPARTY_ACCOUNT,
                       'reconStatus'         VALUE RECON_STATUS,
                       'reconAmount'         VALUE RECON_AMOUNT,
                       'reconTxnType'        VALUE RECON_TXN_TYPE,
                       'reconTxnNumber'      VALUE RECON_TXN_NUMBER,
                       'reconNotes'          VALUE RECON_NOTES,
                       'reconDate'           VALUE TO_CHAR(RECON_DATE, 'YYYY-MM-DD'),
                       'bankAccountName'     VALUE BANK_ACCOUNT_NAME,
                       'bankAccountNumber'   VALUE BANK_ACCOUNT_NUMBER,
                       'currencyCode'        VALUE CURRENCY_CODE,
                       'externalTxnId'       VALUE EXTERNAL_TXN_ID,
                       'externalTxnRef'      VALUE EXTERNAL_TXN_REF
                       ABSENT ON NULL
                   ) ORDER BY TRANSACTION_DATE DESC, LINE_ID DESC
                   RETURNING CLOB
               )
               RETURNING CLOB
           )
    INTO   v_result
    FROM  (
        SELECT l.LINE_ID, l.STATEMENT_ID, l.LINE_NUMBER,
               l.TRANSACTION_DATE, l.VALUE_DATE, l.AMOUNT,
               l.TRANSACTION_CODE, l.DESCRIPTION, l.REFERENCE,
               l.BANK_TXN_REFERENCE, l.COUNTERPARTY_NAME, l.COUNTERPARTY_ACCOUNT,
               l.RECON_STATUS, l.RECON_AMOUNT, l.RECON_TXN_TYPE,
               l.RECON_TXN_NUMBER, l.RECON_NOTES, l.RECON_DATE,
               h.STATEMENT_NUMBER, h.BANK_ACCOUNT_NAME,
               h.BANK_ACCOUNT_NUMBER, h.CURRENCY_CODE,
               l.EXTERNAL_TXN_ID, l.EXTERNAL_TXN_REF
        FROM   RR_BANK_STATEMENT_LINES  l
        JOIN   RR_BANK_STATEMENT_HEADER h ON l.STATEMENT_ID = h.STATEMENT_ID
        WHERE  (:bank_account  IS NULL
                OR UPPER(h.BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(:bank_account) || '%'
                OR UPPER(h.BANK_ACCOUNT_NUMBER) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:recon_status  IS NULL OR l.RECON_STATUS = :recon_status)
        AND    (:date_from     IS NULL OR l.TRANSACTION_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to       IS NULL OR l.TRANSACTION_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min    IS NULL OR l.AMOUNT >= TO_NUMBER(:amount_min))
        AND    (:amount_max    IS NULL OR l.AMOUNT <= TO_NUMBER(:amount_max))
        AND    (:statement_id  IS NULL OR l.STATEMENT_ID = TO_NUMBER(:statement_id))
        AND    (:reference     IS NULL
                OR UPPER(l.REFERENCE)   LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(l.DESCRIPTION) LIKE '%' || UPPER(:reference) || '%')
        FETCH  FIRST v_limit ROWS ONLY
    );

    HTP.P(v_result);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 2. GET cash/reconciliation/systxns
--    Returns system transactions (AP Payments, AR Receipts, GL Journals) for
--    reconciliation against bank statement lines.
--
--    Parameters:
--      :bank_account   - filter by bank account name (partial match)
--      :date_from      - YYYY-MM-DD
--      :date_to        - YYYY-MM-DD
--      :amount_min     - numeric
--      :amount_max     - numeric
--      :reference      - partial match on txn number / reference
--      :payment_status - exact match on status (AP only)
--      :txn_type       - AP_PAYMENT | AR_RECEIPT | GL_JOURNAL (NULL = all)
--      :reconciled     - Y | N (default N = unreconciled)
--      :row_limit      - max rows (default 500)
--
--    NOTE: Table names RR_AR_RECEIPTS_ALL and RR_GL_JE_LINES are assumed.
--          Adjust column names to match your actual schema.
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/systxns',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_buf   VARCHAR2(32767);
    v_first BOOLEAN := TRUE;
    v_limit NUMBER  := NVL(:row_limit, 500);

    -- Unified cursor across AP, AR, GL
    CURSOR c_data IS
        -- ── AP Payments ──────────────────────────────────────────────────
        SELECT
            'AP_PAYMENT'                                              AS SOURCE,
            p.CHECK_ID                                                AS TXN_ID,
            p.PAYMENT_NUMBER                                          AS TXN_NUMBER,
            p.PAYMENT_REFERENCE                                       AS REFERENCE,
            TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD')                    AS TXN_DATE,
            REGEXP_REPLACE(TO_CHAR(NVL(p.PAYMENT_AMOUNT,0),'FM99999999999999990.9999999999'),'\.$','')
                                                                      AS AMOUNT,
            p.PAYMENT_CURRENCY                                        AS CURRENCY_CODE,
            p.PAYMENT_STATUS                                          AS TXN_STATUS,
            p.DISBURSEMENT_BANK_ACCOUNT_NAME                          AS BANK_ACCOUNT_NAME,
            p.BUSINESS_UNIT,
            -- AP specific
            p.PAYEE,
            p.SUPPLIER_NUMBER,
            p.PAYMENT_MODE                                            AS PAYMENT_METHOD,
            TO_CHAR(p.CLEARING_DATE, 'YYYY-MM-DD')                   AS CLEARING_DATE,
            -- AR specific (NULL for AP)
            NULL                                                      AS CUSTOMER_NAME,
            NULL                                                      AS CUSTOMER_NUMBER,
            NULL                                                      AS RECEIPT_METHOD,
            -- GL specific (NULL for AP)
            NULL                                                      AS ACCOUNT_CODE,
            NULL                                                      AS ACCOUNT_DESCRIPTION,
            NULL                                                      AS JOURNAL_CATEGORY,
            NULL                                                      AS LINE_DESCRIPTION,
            p.RECONCILED_FLAG
        FROM   RR_AP_PAYMENTS_ALL p
        WHERE  (:txn_type IS NULL OR :txn_type = 'AP_PAYMENT')
        AND    (:bank_account IS NULL
                OR UPPER(p.DISBURSEMENT_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:date_from IS NULL OR p.PAYMENT_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to   IS NULL OR p.PAYMENT_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min IS NULL OR p.PAYMENT_AMOUNT >= TO_NUMBER(:amount_min))
        AND    (:amount_max IS NULL OR p.PAYMENT_AMOUNT <= TO_NUMBER(:amount_max))
        AND    (:reference IS NULL
                OR UPPER(p.PAYMENT_NUMBER)    LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(p.PAYMENT_REFERENCE) LIKE '%' || UPPER(:reference) || '%')
        AND    (:payment_status IS NULL OR p.PAYMENT_STATUS = :payment_status)
        AND    p.RECONCILED_FLAG = NVL(:reconciled, 'N')

        UNION ALL

        -- ── AR Receipts ──────────────────────────────────────────────────
        -- NOTE: Adjust table/column names to match your AR receipts table
        SELECT
            'AR_RECEIPT'                                              AS SOURCE,
            r.RECEIPT_ID                                              AS TXN_ID,
            r.RECEIPT_NUMBER                                          AS TXN_NUMBER,
            r.RECEIPT_REFERENCE                                       AS REFERENCE,
            TO_CHAR(r.RECEIPT_DATE, 'YYYY-MM-DD')                    AS TXN_DATE,
            REGEXP_REPLACE(TO_CHAR(NVL(r.RECEIPT_AMOUNT,0),'FM99999999999999990.9999999999'),'\.$','')
                                                                      AS AMOUNT,
            r.CURRENCY_CODE,
            r.RECEIPT_STATUS                                          AS TXN_STATUS,
            r.BANK_ACCOUNT_NAME,
            r.BUSINESS_UNIT,
            -- AP specific (NULL for AR)
            NULL                                                      AS PAYEE,
            NULL                                                      AS SUPPLIER_NUMBER,
            NULL                                                      AS PAYMENT_METHOD,
            NULL                                                      AS CLEARING_DATE,
            -- AR specific
            r.CUSTOMER_NAME,
            r.CUSTOMER_NUMBER,
            r.RECEIPT_METHOD,
            -- GL specific (NULL for AR)
            NULL                                                      AS ACCOUNT_CODE,
            NULL                                                      AS ACCOUNT_DESCRIPTION,
            NULL                                                      AS JOURNAL_CATEGORY,
            NULL                                                      AS LINE_DESCRIPTION,
            r.RECONCILED_FLAG
        FROM   RR_AR_RECEIPTS_ALL r
        WHERE  (:txn_type IS NULL OR :txn_type = 'AR_RECEIPT')
        AND    (:bank_account IS NULL
                OR UPPER(r.BANK_ACCOUNT_NAME) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:date_from IS NULL OR r.RECEIPT_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to   IS NULL OR r.RECEIPT_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min IS NULL OR r.RECEIPT_AMOUNT >= TO_NUMBER(:amount_min))
        AND    (:amount_max IS NULL OR r.RECEIPT_AMOUNT <= TO_NUMBER(:amount_max))
        AND    (:reference IS NULL
                OR UPPER(r.RECEIPT_NUMBER)    LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(r.RECEIPT_REFERENCE) LIKE '%' || UPPER(:reference) || '%')
        AND    (:payment_status IS NULL)   -- AR receipts don't use payment_status
        AND    r.RECONCILED_FLAG = NVL(:reconciled, 'N')

        UNION ALL

        -- ── GL Journal Lines ─────────────────────────────────────────────
        -- NOTE: Adjust table/column names to match your GL journal lines table
        SELECT
            'GL_JOURNAL'                                              AS SOURCE,
            l.JE_LINE_ID                                              AS TXN_ID,
            h.JE_HEADER_NAME                                          AS TXN_NUMBER,
            h.JE_BATCH_NAME                                           AS REFERENCE,
            TO_CHAR(h.JOURNAL_DATE, 'YYYY-MM-DD')                    AS TXN_DATE,
            REGEXP_REPLACE(
                TO_CHAR(NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0),
                        'FM99999999999999990.9999999999'),'\.$','')   AS AMOUNT,
            h.CURRENCY_CODE,
            h.STATUS                                                  AS TXN_STATUS,
            h.BANK_ACCOUNT_NAME,
            h.BUSINESS_UNIT,
            -- AP specific (NULL for GL)
            NULL                                                      AS PAYEE,
            NULL                                                      AS SUPPLIER_NUMBER,
            NULL                                                      AS PAYMENT_METHOD,
            NULL                                                      AS CLEARING_DATE,
            -- AR specific (NULL for GL)
            NULL                                                      AS CUSTOMER_NAME,
            NULL                                                      AS CUSTOMER_NUMBER,
            NULL                                                      AS RECEIPT_METHOD,
            -- GL specific
            l.CODE_COMBINATION                                        AS ACCOUNT_CODE,
            l.ACCOUNT_DESCRIPTION,
            h.JE_CATEGORY                                             AS JOURNAL_CATEGORY,
            l.DESCRIPTION                                             AS LINE_DESCRIPTION,
            l.RECONCILED_FLAG
        FROM   RR_GL_JE_LINES    l
        JOIN   RR_GL_JE_HEADERS  h ON l.JE_HEADER_ID = h.JE_HEADER_ID
        WHERE  (:txn_type IS NULL OR :txn_type = 'GL_JOURNAL')
        AND    (:bank_account IS NULL
                OR UPPER(h.BANK_ACCOUNT_NAME) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:date_from IS NULL OR h.JOURNAL_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to   IS NULL OR h.JOURNAL_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min IS NULL OR (NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0)) >= TO_NUMBER(:amount_min))
        AND    (:amount_max IS NULL OR (NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0)) <= TO_NUMBER(:amount_max))
        AND    (:reference IS NULL
                OR UPPER(h.JE_HEADER_NAME) LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(h.JE_BATCH_NAME)  LIKE '%' || UPPER(:reference) || '%')
        AND    (:payment_status IS NULL)   -- GL journals don't use payment_status
        AND    l.RECONCILED_FLAG = NVL(:reconciled, 'N')

        ORDER  BY TXN_DATE DESC, TXN_ID DESC
        FETCH  FIRST v_limit ROWS ONLY;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"status":"success","items":[');

    FOR r IN c_data LOOP
        IF NOT v_first THEN
            DBMS_LOB.APPEND(v_clob, ',');
        END IF;
        v_first := FALSE;

        v_buf :=
            '{"txnId":'               || r.TXN_ID                                                    ||
            ',"txnNumber":'           || APEX_JSON.STRINGIFY(NVL(r.TXN_NUMBER,''))                   ||
            ',"reference":'           || APEX_JSON.STRINGIFY(NVL(r.REFERENCE,''))                    ||
            ',"txnDate":'             || APEX_JSON.STRINGIFY(NVL(r.TXN_DATE,''))                     ||
            ',"amount":'              || r.AMOUNT                                                     ||
            ',"currencyCode":'        || APEX_JSON.STRINGIFY(NVL(r.CURRENCY_CODE,''))                ||
            ',"txnStatus":'           || APEX_JSON.STRINGIFY(NVL(r.TXN_STATUS,''))                   ||
            ',"bankAccountName":'     || APEX_JSON.STRINGIFY(NVL(r.BANK_ACCOUNT_NAME,''))            ||
            ',"businessUnit":'        || APEX_JSON.STRINGIFY(NVL(r.BUSINESS_UNIT,''))                ||
            ',"payee":'               || APEX_JSON.STRINGIFY(NVL(r.PAYEE,''))                        ||
            ',"supplierNumber":'      || APEX_JSON.STRINGIFY(NVL(r.SUPPLIER_NUMBER,''))              ||
            ',"paymentMethod":'       || APEX_JSON.STRINGIFY(NVL(r.PAYMENT_METHOD,''))               ||
            ',"clearingDate":'        || APEX_JSON.STRINGIFY(NVL(r.CLEARING_DATE,''))                ||
            ',"customerName":'        || APEX_JSON.STRINGIFY(NVL(r.CUSTOMER_NAME,''))                ||
            ',"customerNumber":'      || APEX_JSON.STRINGIFY(NVL(r.CUSTOMER_NUMBER,''))              ||
            ',"receiptMethod":'       || APEX_JSON.STRINGIFY(NVL(r.RECEIPT_METHOD,''))               ||
            ',"accountCode":'         || APEX_JSON.STRINGIFY(NVL(r.ACCOUNT_CODE,''))                 ||
            ',"accountDescription":'  || APEX_JSON.STRINGIFY(NVL(r.ACCOUNT_DESCRIPTION,''))          ||
            ',"journalCategory":'     || APEX_JSON.STRINGIFY(NVL(r.JOURNAL_CATEGORY,''))             ||
            ',"lineDescription":'     || APEX_JSON.STRINGIFY(NVL(r.LINE_DESCRIPTION,''))             ||
            ',"reconciledFlag":'      || APEX_JSON.STRINGIFY(NVL(r.RECONCILED_FLAG,'N'))             ||
            ',"source":'              || APEX_JSON.STRINGIFY(r.SOURCE)                               ||
            '}';
        DBMS_LOB.APPEND(v_clob, v_buf);
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0
    );
    COMMIT;
END;
/
