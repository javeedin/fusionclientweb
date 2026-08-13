-- ============================================================
-- PATCH 63: Add business_unit filter to cash/reconciliation/systxns
--
-- Root cause:
--   The systxns handler has no WHERE clause on :business_unit,
--   so passing business_unit=X in the URL has no effect — all
--   business units' AP payments, AR receipts, and GL journals
--   are returned regardless.
--
-- Fix:
--   Add  AND (:business_unit IS NULL OR UPPER(x.BUSINESS_UNIT) LIKE '%'||UPPER(:business_unit)||'%')
--   to all three UNION branches (AP_PAYMENT, AR_RECEIPT, GL_JOURNAL).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the single BEGIN...END; block below.
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
        p_comments       => 'System transactions for bank recon — AP Payments, AR Receipts, GL Journals — with business_unit filter',
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_buf   VARCHAR2(32767);
    v_first BOOLEAN := TRUE;
    v_limit NUMBER  := NVL(:row_limit, 500);

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
            p.PAYEE,
            p.SUPPLIER_NUMBER,
            p.PAYMENT_MODE                                            AS PAYMENT_METHOD,
            TO_CHAR(p.CLEARING_DATE, 'YYYY-MM-DD')                   AS CLEARING_DATE,
            NULL                                                      AS CUSTOMER_NAME,
            NULL                                                      AS CUSTOMER_NUMBER,
            NULL                                                      AS RECEIPT_METHOD,
            NULL                                                      AS ACCOUNT_CODE,
            NULL                                                      AS ACCOUNT_DESCRIPTION,
            NULL                                                      AS JOURNAL_CATEGORY,
            NULL                                                      AS LINE_DESCRIPTION,
            p.RECONCILED_FLAG
        FROM   RR_AP_PAYMENTS_ALL p
        WHERE  (:txn_type IS NULL OR :txn_type = 'AP_PAYMENT')
        AND    (:bank_account IS NULL
                OR UPPER(p.DISBURSEMENT_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:business_unit IS NULL
                OR UPPER(p.BUSINESS_UNIT) LIKE '%' || UPPER(:business_unit) || '%')
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
            NULL                                                      AS PAYEE,
            NULL                                                      AS SUPPLIER_NUMBER,
            NULL                                                      AS PAYMENT_METHOD,
            NULL                                                      AS CLEARING_DATE,
            r.CUSTOMER_NAME,
            r.CUSTOMER_NUMBER,
            r.RECEIPT_METHOD,
            NULL                                                      AS ACCOUNT_CODE,
            NULL                                                      AS ACCOUNT_DESCRIPTION,
            NULL                                                      AS JOURNAL_CATEGORY,
            NULL                                                      AS LINE_DESCRIPTION,
            r.RECONCILED_FLAG
        FROM   RR_AR_RECEIPTS_ALL r
        WHERE  (:txn_type IS NULL OR :txn_type = 'AR_RECEIPT')
        AND    (:bank_account IS NULL
                OR UPPER(r.BANK_ACCOUNT_NAME) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:business_unit IS NULL
                OR UPPER(r.BUSINESS_UNIT) LIKE '%' || UPPER(:business_unit) || '%')
        AND    (:date_from IS NULL OR r.RECEIPT_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to   IS NULL OR r.RECEIPT_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min IS NULL OR r.RECEIPT_AMOUNT >= TO_NUMBER(:amount_min))
        AND    (:amount_max IS NULL OR r.RECEIPT_AMOUNT <= TO_NUMBER(:amount_max))
        AND    (:reference IS NULL
                OR UPPER(r.RECEIPT_NUMBER)    LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(r.RECEIPT_REFERENCE) LIKE '%' || UPPER(:reference) || '%')
        AND    (:payment_status IS NULL)
        AND    r.RECONCILED_FLAG = NVL(:reconciled, 'N')

        UNION ALL

        -- ── GL Journal Lines ─────────────────────────────────────────────
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
            NULL                                                      AS PAYEE,
            NULL                                                      AS SUPPLIER_NUMBER,
            NULL                                                      AS PAYMENT_METHOD,
            NULL                                                      AS CLEARING_DATE,
            NULL                                                      AS CUSTOMER_NAME,
            NULL                                                      AS CUSTOMER_NUMBER,
            NULL                                                      AS RECEIPT_METHOD,
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
        AND    (:business_unit IS NULL
                OR UPPER(h.BUSINESS_UNIT) LIKE '%' || UPPER(:business_unit) || '%')
        AND    (:date_from IS NULL OR h.JOURNAL_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
        AND    (:date_to   IS NULL OR h.JOURNAL_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
        AND    (:amount_min IS NULL OR (NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0)) >= TO_NUMBER(:amount_min))
        AND    (:amount_max IS NULL OR (NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0)) <= TO_NUMBER(:amount_max))
        AND    (:reference IS NULL
                OR UPPER(h.JE_HEADER_NAME) LIKE '%' || UPPER(:reference) || '%'
                OR UPPER(h.JE_BATCH_NAME)  LIKE '%' || UPPER(:reference) || '%')
        AND    (:payment_status IS NULL)
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
]'
    );
    COMMIT;
END;
/
