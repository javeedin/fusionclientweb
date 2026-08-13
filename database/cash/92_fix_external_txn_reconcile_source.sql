-- ============================================================
-- PATCH 92: Fix PUT /cash/reconciliation/systxns/:txnId
--           to handle source = 'EXTERNAL_TXN'
--           + also update STATUS = 'REC' on reconciliation
--
-- Problem 1:
--   The view RR_V_BANK_RECON_SYSTXNS returns external cash
--   transactions with SOURCE = 'EXTERNAL_TXN'. The unified PUT
--   handler only recognised ORA_MAN / ORA_BAT / ORA_STA, so
--   reconciling an external transaction sent source='EXTERNAL_TXN'
--   which fell into the Unknown-source branch (HTTP 400) and
--   never updated RECONCILED_FLAG, leaving the row as UREC.
--
-- Problem 2:
--   Reconciliation only updated RECONCILED_FLAG = 'Y' but NOT
--   STATUS. Manage External Transactions search/display uses STATUS,
--   so reconciled transactions still showed as Unreconciled in the UI.
--
-- Fix:
--   1. Add 'EXTERNAL_TXN' to the handler condition.
--   2. Set STATUS = 'REC' alongside RECONCILED_FLAG = 'Y'.
--   3. Backfill existing rows that have RECONCILED_FLAG='Y' but STATUS='UNR'.
--
-- Run Step 1 (backfill) first, then Step 2 (handler).
-- ============================================================

-- ── Step 1: Backfill existing reconciled rows ─────────────────
UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
   SET STATUS = 'REC'
 WHERE RECONCILED_FLAG = 'Y'
   AND STATUS != 'REC';
COMMIT;
/
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run this single BEGIN...END; block.
-- ============================================================

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
        p_comments       => 'Reconcile any system transaction — BANK_TRANSFER, AP_PAYMENT, ORA_MAN/BAT/STA, EXTERNAL_TXN',
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

    -- ── EXTERNAL TRANSACTION (ORA_MAN / ORA_BAT / ORA_STA / EXTERNAL_TXN) ──
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
