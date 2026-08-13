-- ============================================================
-- PATCH 104: Fix GL_JOURNAL source to use RR_GL_LINES_ALL
--
-- Problem:
--   The GL_JOURNAL branch in RR_V_BANK_RECON_SYSTXNS was reading
--   from RR_GL_JE_LINES_ALL / RR_GL_JE_HEADERS — these are
--   Oracle Fusion-synced tables.  Locally-created GL journals
--   (posted via the ReactERP SLA posting flow) are stored in
--   RR_GL_LINES_ALL / RR_GL_HEADERS instead.
--
--   Side-effect: rows from Fusion-synced journals (e.g. external
--   transaction journals) appeared when filtering source=GL_JOURNAL
--   in bank reconciliation, because those rows exist in the JE
--   tables but not in the local RR tables.
--
-- Fix:
--   1. Recreate RR_V_BANK_RECON_SYSTXNS — GL_JOURNAL branch now
--      reads from RR_GL_LINES_ALL l JOIN RR_GL_HEADERS h.
--      Column mapping: h.JOURNAL_NAME (was h.NAME),
--                      h.USER_JE_CATEGORY_NAME (was h.JE_CATEGORY).
--   2. Update PUT /cash/reconciliation/systxns/:txnId — GL_JOURNAL
--      branch now updates RR_GL_LINES_ALL instead of RR_GL_JE_LINES_ALL.
--      RR_GL_LINES_ALL has RECONCILIATION_REFERENCE / JGZZ_RECON_REFERENCE
--      columns — use RECONCILIATION_REFERENCE for the recon stamp.
--
-- BANK_TRANSFER branch is unchanged (still uses RR_GL_JE_LINES_ALL
-- because bank-transfer journals are synced from Fusion, not local).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run STEP 1 first, then STEP 2.
-- ============================================================


-- ── STEP 1: Recreate view ────────────────────────────────────
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

    -- Bank Transfers (Fusion-synced GL lines — BANK_ASSET lines only)
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

    -- Standalone GL Journal Lines — locally created via ReactERP SLA posting.
    -- Reads from RR_GL_LINES_ALL / RR_GL_HEADERS (NOT the Fusion-synced JE tables).
    -- Filtered at query time by ACCOUNT_COMBINATION = bank's cash account.
    SELECT
        'GL_JOURNAL'                                               AS SOURCE,
        TO_CHAR(l.JE_HEADER_ID * 10000 + l.JE_LINE_NUMBER)        AS TXN_ID,
        h.JOURNAL_NAME                                             AS TXN_NUMBER,
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
        h.USER_JE_CATEGORY_NAME                                    AS PAYMENT_METHOD,
        NULL                                                       AS CLEARING_DATE,
        NVL(l.RECONCILED_FLAG, 'N')                                AS RECONCILED_FLAG,
        l.DESCRIPTION                                              AS DESCRIPTION,
        h.USER_JE_CATEGORY_NAME                                    AS ACCOUNTING_CLASS,
        l.JE_HEADER_ID,
        l.JE_LINE_NUMBER,
        l.ACCOUNT_COMBINATION,
        NULL                                                       AS TRANSFER_ID,
        l.CREATED_BY,
        l.CREATION_DATE
    FROM RR_GL_LINES_ALL l
    JOIN RR_GL_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE NVL(l.REFERENCE5, 'X') NOT IN ('BANKTFR-DISBURSE', 'BANKTFR-RECEIPT')
/


-- ── STEP 2: Update PUT reconcile handler — GL_JOURNAL branch ─
-- Updates RR_GL_LINES_ALL (local) instead of RR_GL_JE_LINES_ALL (Fusion).
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
        p_comments       => 'Reconcile system transaction — patch 104: GL_JOURNAL updates RR_GL_LINES_ALL',
        p_source         => q'[
DECLARE
    v_txn_id        NUMBER;
    v_source        VARCHAR2(50);
    v_recon_date    DATE    := SYSDATE;
    v_stmt_id       NUMBER;
    v_stmt_line_id  NUMBER;
    v_recon_by      VARCHAR2(100);

    -- BANK_TRANSFER / GL_JOURNAL
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

    -- ── GL_JOURNAL — local ReactERP journals (RR_GL_LINES_ALL) ──
    IF v_source = 'GL_JOURNAL' THEN

        v_je_header_id := snum(v_obj, 'jeHeaderId');
        v_je_line_num  := snum(v_obj, 'jeLineNumber');

        IF v_je_header_id IS NULL OR v_je_line_num IS NULL THEN
            :status_code := 400;
            HTP.P('{"status":"error","message":"jeHeaderId and jeLineNumber are required for GL_JOURNAL"}');
            RETURN;
        END IF;

        UPDATE RR_GL_LINES_ALL
           SET RECONCILED_FLAG          = 'Y',
               RECONCILIATION_REFERENCE = TO_CHAR(v_stmt_id),
               JGZZ_RECON_REFERENCE     = TO_CHAR(v_stmt_id),
               JGZZ_RECON_DATE          = v_recon_date,
               JGZZ_RECON_ID            = v_stmt_line_id,
               LAST_UPDATED_BY          = v_recon_by,
               LAST_UPDATE_DATE         = SYSTIMESTAMP
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

    -- ── BANK_TRANSFER (Fusion-synced — RR_GL_JE_LINES_ALL) ──────
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
