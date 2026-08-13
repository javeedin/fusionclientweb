-- ============================================================
-- PATCH 79: Fix stmtlines RECON_STATUS filter — 'N' means UNRECONCILED
--
-- Problem:
--   Statement lines store RECON_STATUS = 'N' for unreconciled rows,
--   not the string 'UNRECONCILED'. Patch 77 added a NVL(...,'UNRECONCILED')
--   fallback for NULL, but 'N' still doesn't match 'UNRECONCILED'.
--
-- Fix:
--   Normalize 'N' and NULL → 'UNRECONCILED' in the WHERE clause using
--   CASE so both stored values map to the filter string the frontend sends.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the single BEGIN...END; block below.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/reconciliation/stmtlines',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/stmtlines',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Bank statement lines — normalises N/NULL RECON_STATUS to UNRECONCILED for filter',
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
               l.RECON_STATUS,
               l.RECON_AMOUNT, l.RECON_TXN_TYPE,
               l.RECON_TXN_NUMBER, l.RECON_NOTES, l.RECON_DATE,
               h.STATEMENT_NUMBER, h.BANK_ACCOUNT_NAME,
               h.BANK_ACCOUNT_NUMBER, h.CURRENCY_CODE,
               l.EXTERNAL_TXN_ID, l.EXTERNAL_TXN_REF
        FROM   RR_BANK_STATEMENT_LINES  l
        JOIN   RR_BANK_STATEMENT_HEADER h ON l.STATEMENT_ID = h.STATEMENT_ID
        WHERE  (:bank_account  IS NULL
                OR UPPER(h.BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(:bank_account) || '%'
                OR UPPER(h.BANK_ACCOUNT_NUMBER) LIKE '%' || UPPER(:bank_account) || '%')
        AND    (:recon_status  IS NULL
                OR (CASE WHEN NVL(l.RECON_STATUS, 'N') IN ('N', 'UNRECONCILED')
                         THEN 'UNRECONCILED'
                         ELSE l.RECON_STATUS
                    END) = :recon_status)
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
    WHEN NO_DATA_FOUND THEN
        HTP.P('{"status":"success","items":[]}');
    WHEN OTHERS THEN
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
