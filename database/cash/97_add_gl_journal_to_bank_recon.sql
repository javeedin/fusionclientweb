-- ============================================================
-- PATCH 97: Add GL Journal Lines as a source in Bank Recon
--
-- Changes:
--   1. Update RR_V_BANK_RECON_SYSTXNS view — add GL_JOURNAL
--      union branch (all GL lines whose ACCOUNT_COMBINATION
--      matches the bank's cash account, excluding bank-transfer
--      lines which are already covered by BANK_TRANSFER source).
--
--   2. Update GET /cash/reconciliation/systxns handler —
--      add `cash_account` parameter; GL_JOURNAL rows are
--      returned only when cash_account matches
--      ACCOUNT_COMBINATION. Non-GL rows continue to be
--      filtered by bank_account (BANK_ACCOUNT_NAME).
--
--   3. Update PUT /cash/reconciliation/systxns/:txnId handler
--      — add GL_JOURNAL branch: sets RECONCILED_FLAG,
--      JGZZ_RECON_REFERENCE, JGZZ_RECON_DATE, JGZZ_RECON_ID
--      on the matched RR_GL_JE_LINES_ALL row.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run STEP 1, then STEP 2, then STEP 3 separately.
-- ============================================================


-- ── STEP 1: Update view to include GL_JOURNAL source ────────
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

    -- Bank Transfers (GL Journal Lines — BANK_ASSET lines only)
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

UNION ALL

    -- Standalone GL Journal Lines (not bank transfers)
    -- Filtered at query time by ACCOUNT_COMBINATION = bank's cash account.
    -- TXN_ID is a unique numeric composite: JE_HEADER_ID * 10000 + JE_LINE_NUMBER.
    -- PAYMENT_METHOD and ACCOUNTING_CLASS both carry the journal category.
    -- BANK_ACCOUNT_NAME is NULL — these rows are filtered by ACCOUNT_COMBINATION
    -- via the cash_account parameter in the ORDS handler.
    SELECT
        'GL_JOURNAL'                                               AS SOURCE,
        TO_CHAR(l.JE_HEADER_ID * 10000 + l.JE_LINE_NUMBER)        AS TXN_ID,
        h.NAME                                                     AS TXN_NUMBER,
        l.DESCRIPTION                                              AS REFERENCE,
        TRUNC(NVL(h.DEFAULT_EFFECTIVE_DATE, l.CREATION_DATE))      AS TXN_DATE,
        NVL(l.ENTERED_DR, l.ENTERED_CR)                            AS AMOUNT,
        l.CURRENCY_CODE,
        CASE WHEN NVL(l.RECONCILED_FLAG, 'N') = 'Y'
             THEN 'RECONCILED' ELSE 'UNRECONCILED' END             AS STATUS,
        NULL                                                       AS BANK_ACCOUNT_NAME,
        NULL                                                       AS BUSINESS_UNIT,
        NULL                                                       AS COUNTERPARTY_NAME,
        NULL                                                       AS COUNTERPARTY_NUMBER,
        h.JE_CATEGORY                                              AS PAYMENT_METHOD,
        NULL                                                       AS CLEARING_DATE,
        NVL(l.RECONCILED_FLAG, 'N')                                AS RECONCILED_FLAG,
        l.DESCRIPTION                                              AS DESCRIPTION,
        h.JE_CATEGORY                                              AS ACCOUNTING_CLASS,
        l.JE_HEADER_ID,
        l.JE_LINE_NUMBER,
        l.ACCOUNT_COMBINATION,
        NULL                                                       AS TRANSFER_ID,
        l.CREATED_BY,
        l.CREATION_DATE
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE NVL(l.REFERENCE5, 'X') NOT IN ('BANKTFR-DISBURSE', 'BANKTFR-RECEIPT')
/


-- ── STEP 2: Update GET /cash/reconciliation/systxns handler ─
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
        p_comments       => 'Unified system transactions for bank recon — AP + External + Bank Transfers + GL Journals',
        p_source         => q'[
DECLARE
    l_bank_acct    VARCHAR2(360) := :bank_account;
    l_cash_acct    VARCHAR2(360) := :cash_account;  -- GL journal filter: ACCOUNT_COMBINATION
    l_bus_unit     VARCHAR2(360) := :business_unit;
    l_source       VARCHAR2(30)  := :source;        -- AP_PAYMENT | EXTERNAL_TXN | BANK_TRANSFER | GL_JOURNAL
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
            -- Non-GL sources: filter by bank account name (existing behaviour)
            (SOURCE != 'GL_JOURNAL'
             AND l_bank_acct IS NOT NULL
             AND UPPER(BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_bank_acct) || '%')
            OR
            -- GL Journal: filter by cash account combination
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


-- ── STEP 3: Update PUT /cash/reconciliation/systxns/:txnId ──
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
        p_comments       => 'Reconcile any system transaction — BANK_TRANSFER, AP_PAYMENT, ORA_MAN/BAT/STA, GL_JOURNAL',
        p_source         => q'[
DECLARE
    v_txn_id        NUMBER;
    v_source        VARCHAR2(50);
    v_recon_date    DATE    := SYSDATE;
    v_stmt_id       NUMBER;
    v_stmt_line_id  NUMBER;
    v_recon_by      VARCHAR2(100);

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
    v_recon_by     := NVL(sstr(v_obj, 'reconciledBy'), 'SYSTEM');

    DECLARE v_d VARCHAR2(20) := sstr(v_obj, 'reconciledDate');
    BEGIN
        IF v_d IS NOT NULL THEN
            v_recon_date := TO_DATE(v_d, 'YYYY-MM-DD');
        END IF;
    END;

    -- ── GL_JOURNAL ────────────────────────────────────────────
    IF v_source = 'GL_JOURNAL' THEN

        v_je_header_id := snum(v_obj, 'jeHeaderId');
        v_je_line_num  := snum(v_obj, 'jeLineNumber');

        IF v_je_header_id IS NULL OR v_je_line_num IS NULL THEN
            :status_code := 400;
            HTP.P('{"status":"error","message":"jeHeaderId and jeLineNumber are required for GL_JOURNAL"}');
            RETURN;
        END IF;

        UPDATE RR_GL_JE_LINES_ALL
           SET RECONCILED_FLAG      = 'Y',
               JGZZ_RECON_REFERENCE = TO_CHAR(v_stmt_id),
               JGZZ_RECON_DATE      = v_recon_date,
               JGZZ_RECON_ID        = v_stmt_line_id
         WHERE JE_HEADER_ID   = v_je_header_id
           AND JE_LINE_NUMBER  = v_je_line_num;
        v_gl_rows := SQL%ROWCOUNT;

        COMMIT;

        :status_code := 200;
        HTP.P('{"status":"success","source":"GL_JOURNAL"'
           || ',"jeHeaderId":'      || v_je_header_id
           || ',"jeLineNumber":'    || v_je_line_num
           || ',"glRowsUpdated":'   || v_gl_rows
           || '}');

    -- ── BANK_TRANSFER ─────────────────────────────────────────
    ELSIF v_source = 'BANK_TRANSFER' OR v_source = 'GL_BANK_TRANSFER' THEN

        v_transfer_id  := NVL(snum(v_obj, 'transferId'), v_txn_id);
        v_je_header_id := snum(v_obj, 'jeHeaderId');
        v_je_line_num  := snum(v_obj, 'jeLineNumber');

        IF v_je_header_id IS NOT NULL AND v_je_line_num IS NOT NULL THEN
            UPDATE RR_GL_JE_LINES_ALL
               SET RECONCILED_FLAG = 'Y'
             WHERE JE_HEADER_ID  = v_je_header_id
               AND JE_LINE_NUMBER = v_je_line_num;
            v_gl_rows := SQL%ROWCOUNT;
        END IF;

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

    -- ── EXTERNAL TRANSACTION ─────────────────────────────────
    ELSIF v_source IN ('ORA_MAN', 'ORA_BAT', 'ORA_STA', 'EXTERNAL_TXN') THEN

        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
           SET RECONCILED_FLAG  = 'Y',
               RECONCILED_DATE  = v_recon_date,
               STATUS           = 'REC',
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
