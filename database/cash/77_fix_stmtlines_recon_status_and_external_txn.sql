-- ============================================================
-- PATCH 77: Two fixes for bank reconciliation
--
-- Fix A: GET cash/reconciliation/stmtlines — null-safe RECON_STATUS
--   Problem:
--     The WHERE clause uses l.RECON_STATUS = :recon_status (exact match).
--     Statement lines with NULL RECON_STATUS are excluded even when
--     recon_status=UNRECONCILED is passed, because NULL = 'UNRECONCILED'
--     evaluates to NULL (not TRUE) in SQL.
--   Fix:
--     Use NVL(l.RECON_STATUS, 'UNRECONCILED') = :recon_status so that
--     NULL rows are treated as UNRECONCILED.
--
-- Fix B: PUT cash/reconciliation/systxns/:txnId — add EXTERNAL_TXN source
--   Problem:
--     RR_V_BANK_RECON_SYSTXNS emits source='EXTERNAL_TXN' for external
--     cash transactions.  Patch 75's unified endpoint only handles
--     ORA_MAN / ORA_BAT / ORA_STA — sending EXTERNAL_TXN returns
--     {"status":"error","message":"Unknown source: EXTERNAL_TXN"}.
--   Fix:
--     Add 'EXTERNAL_TXN' to the ELSIF branch that updates
--     RR_EXTERNAL_CASH_TRANSACTIONS.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run Fix A block, then Fix B block (each BEGIN...END; separately).
-- ============================================================


-- ── Fix A: stmtlines — null-safe RECON_STATUS filter ─────────
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
        p_comments       => 'Bank statement lines — null-safe RECON_STATUS filter',
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
               NVL(l.RECON_STATUS, 'UNRECONCILED')                        AS RECON_STATUS,
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
                OR NVL(l.RECON_STATUS, 'UNRECONCILED') = :recon_status)
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


-- ── Fix B: unified reconcile — add EXTERNAL_TXN source ───────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/reconciliation/systxns/:txnId',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/systxns/:txnId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Reconcile any system transaction — BANK_TRANSFER, AP_PAYMENT, EXTERNAL_TXN, ORA_MAN/BAT/STA',
        p_source         => q'[
DECLARE
    v_txn_id        NUMBER;
    v_source        VARCHAR2(50);
    v_recon_date    DATE    := SYSDATE;
    v_stmt_id       NUMBER;
    v_stmt_line_id  NUMBER;

    -- BANK_TRANSFER
    v_transfer_id   NUMBER;
    v_je_header_id  NUMBER;
    v_je_line_num   NUMBER;

    -- AP_PAYMENT
    v_pmt_status    VARCHAR2(50);

    v_gl_rows       NUMBER := 0;
    v_bat_rows      NUMBER := 0;
    v_ap_rows       NUMBER := 0;
    v_ext_rows      NUMBER := 0;

    v_obj           JSON_OBJECT_T;

    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_string(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION snum(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
BEGIN
    v_txn_id := TO_NUMBER(:txnId);

    v_obj          := JSON_OBJECT_T.parse(:body_text);
    v_source       := UPPER(NVL(sstr(v_obj, 'source'), ''));
    v_stmt_id      := snum(v_obj, 'statementId');
    v_stmt_line_id := snum(v_obj, 'stmtLineId');

    DECLARE v_d VARCHAR2(20) := sstr(v_obj, 'reconciledDate');
    BEGIN
        IF v_d IS NOT NULL THEN
            v_recon_date := TO_DATE(v_d, 'YYYY-MM-DD');
        END IF;
    END;

    -- ── BANK_TRANSFER ─────────────────────────────────────────
    IF v_source = 'BANK_TRANSFER' OR v_source = 'GL_BANK_TRANSFER' THEN

        v_transfer_id  := NVL(snum(v_obj, 'transferId'), v_txn_id);
        v_je_header_id := snum(v_obj, 'jeHeaderId');
        v_je_line_num  := snum(v_obj, 'jeLineNumber');

        -- Update GL journal line
        IF v_je_header_id IS NOT NULL AND v_je_line_num IS NOT NULL THEN
            UPDATE RR_GL_JE_LINES_ALL
               SET RECONCILED_FLAG = 'Y'
             WHERE JE_HEADER_ID  = v_je_header_id
               AND JE_LINE_NUMBER = v_je_line_num;
            v_gl_rows := SQL%ROWCOUNT;
        END IF;

        -- Update bank transfer record
        UPDATE RR_BANK_ACCOUNT_TRANSFERS
           SET RECONCILED_FLAG = 'Y',
               RECONCILED_DATE = v_recon_date,
               LAST_UPDATE_DATE = SYSTIMESTAMP
         WHERE BANK_ACCOUNT_TRANSFER_ID = v_transfer_id;
        v_bat_rows := SQL%ROWCOUNT;

        COMMIT;

        :status_code := 200;
        HTP.P('{"status":"success","source":"BANK_TRANSFER"'
           || ',"transferId":'      || v_transfer_id
           || ',"glRowsUpdated":'   || v_gl_rows
           || ',"batRowsUpdated":'  || v_bat_rows
           || '}');

    -- ── AP_PAYMENT ────────────────────────────────────────────
    ELSIF v_source = 'AP_PAYMENT' THEN

        v_pmt_status := NVL(sstr(v_obj, 'paymentStatus'), 'CLEARED');

        UPDATE RR_AP_PAYMENTS_ALL
           SET RECONCILED_FLAG    = 'Y',
               CLEARING_DATE      = v_recon_date,
               PAYMENT_STATUS     = v_pmt_status,
               LOCAL_UPDATED_DATE = SYSTIMESTAMP
         WHERE CHECK_ID = v_txn_id;
        v_ap_rows := SQL%ROWCOUNT;

        COMMIT;

        :status_code := 200;
        HTP.P('{"status":"success","source":"AP_PAYMENT"'
           || ',"checkId":'        || v_txn_id
           || ',"apRowsUpdated":'  || v_ap_rows
           || ',"paymentStatus":"' || v_pmt_status || '"'
           || '}');

    -- ── EXTERNAL TRANSACTION (EXTERNAL_TXN, ORA_MAN, ORA_BAT, ORA_STA) ──
    ELSIF v_source IN ('EXTERNAL_TXN', 'ORA_MAN', 'ORA_BAT', 'ORA_STA') THEN

        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
           SET RECONCILED_FLAG  = 'Y',
               RECONCILED_DATE  = v_recon_date,
               LAST_UPDATE_DATE = SYSTIMESTAMP
         WHERE EXTERNAL_TRANSACTION_ID = v_txn_id;
        v_ext_rows := SQL%ROWCOUNT;

        COMMIT;

        :status_code := 200;
        HTP.P('{"status":"success","source":"' || v_source || '"'
           || ',"externalTxnId":'  || v_txn_id
           || ',"extRowsUpdated":' || v_ext_rows
           || '}');

    -- ── Unknown source ────────────────────────────────────────
    ELSE
        :status_code := 400;
        HTP.P('{"status":"error","message":"Unknown source: ' || v_source || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
