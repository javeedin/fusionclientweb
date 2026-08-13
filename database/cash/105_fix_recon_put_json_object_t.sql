-- ============================================================
-- PATCH 105: Fix PUT /cash/reconciliation/systxns/:txnId
--
-- Problem: Handler uses JSON_OBJECT_T + nested FUNCTION declarations,
--          both forbidden in the ORDS PL/SQL sandbox (ORA-40573 / ORA-06550).
--          GL_JOURNAL reconciliation fails silently as a result.
--
-- Fix: Replace JSON_OBJECT_T with JSON_VALUE(:body_text, '$.key').
--      Remove nested FUNCTION declarations entirely.
--      All sources preserved: GL_JOURNAL, BANK_TRANSFER, AP_PAYMENT,
--      EXTERNAL_TXN (ORA_MAN/ORA_BAT/ORA_STA), AR_RECEIPT.
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
    p_comments       => 'Reconcile system transaction — patch 105: no JSON_OBJECT_T',
    p_source         => q'[
DECLARE
  v_txn_id        NUMBER  := TO_NUMBER(:txnId);
  v_source        VARCHAR2(50);
  v_recon_date    DATE    := SYSDATE;
  v_recon_by      VARCHAR2(150);
  v_stmt_id       NUMBER;
  v_stmt_line_id  NUMBER;

  -- GL_JOURNAL / BANK_TRANSFER
  v_je_header_id  NUMBER;
  v_je_line_num   NUMBER;
  v_transfer_id   NUMBER;

  -- AP_PAYMENT
  v_pmt_status    VARCHAR2(50);

  v_gl_rows  NUMBER := 0;
  v_bat_rows NUMBER := 0;
  v_ap_rows  NUMBER := 0;
  v_ext_rows NUMBER := 0;
  v_body     CLOB;
BEGIN
  -- Read body_text once into a local variable (ORA-17270 if referenced multiple times)
  v_body := :body_text;

  -- Parse fields from the local CLOB
  v_source       := UPPER(NVL(JSON_VALUE(v_body, '$.source'),        ''));
  v_recon_by     := NVL(JSON_VALUE(v_body, '$.reconciledBy'),        'SYSTEM');
  v_stmt_id      := TO_NUMBER(JSON_VALUE(v_body, '$.statementId'));
  v_stmt_line_id := TO_NUMBER(JSON_VALUE(v_body, '$.stmtLineId'));
  v_je_header_id := TO_NUMBER(JSON_VALUE(v_body, '$.jeHeaderId'));
  v_je_line_num  := TO_NUMBER(JSON_VALUE(v_body, '$.jeLineNumber'));
  v_transfer_id  := TO_NUMBER(JSON_VALUE(v_body, '$.transferId'));
  v_pmt_status   := NVL(JSON_VALUE(v_body, '$.paymentStatus'), 'CLEARED');

  IF JSON_VALUE(v_body, '$.reconciledDate') IS NOT NULL THEN
    v_recon_date := TO_DATE(JSON_VALUE(v_body, '$.reconciledDate'), 'YYYY-MM-DD');
  END IF;

  -- ── GL_JOURNAL — local ReactERP journals (RR_GL_LINES_ALL) ──
  IF v_source = 'GL_JOURNAL' THEN

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
     WHERE JE_HEADER_ID  = v_je_header_id
       AND JE_LINE_NUMBER = v_je_line_num;
    v_gl_rows := SQL%ROWCOUNT;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","source":"GL_JOURNAL"'
       || ',"jeHeaderId":'    || v_je_header_id
       || ',"jeLineNumber":'  || v_je_line_num
       || ',"glRowsUpdated":' || v_gl_rows
       || '}');

  -- ── BANK_TRANSFER (Fusion-synced — RR_GL_JE_LINES_ALL) ───────
  ELSIF v_source = 'BANK_TRANSFER' OR v_source = 'GL_BANK_TRANSFER' THEN

    v_transfer_id := NVL(v_transfer_id, v_txn_id);

    IF v_je_header_id IS NOT NULL AND v_je_line_num IS NOT NULL THEN
      UPDATE RR_GL_JE_LINES_ALL
         SET RECONCILED_FLAG = 'Y'
       WHERE JE_HEADER_ID  = v_je_header_id
         AND JE_LINE_NUMBER = v_je_line_num;
      v_gl_rows := SQL%ROWCOUNT;
    END IF;

    UPDATE RR_BANK_ACCOUNT_TRANSFERS
       SET RECONCILED_FLAG  = 'Y',
           RECONCILED_DATE  = v_recon_date,
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE BANK_ACCOUNT_TRANSFER_ID = v_transfer_id;
    v_bat_rows := SQL%ROWCOUNT;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","source":"BANK_TRANSFER"'
       || ',"transferId":'    || v_transfer_id
       || ',"glRowsUpdated":' || v_gl_rows
       || ',"batRowsUpdated":'|| v_bat_rows
       || '}');

  -- ── AP_PAYMENT ────────────────────────────────────────────────
  ELSIF v_source = 'AP_PAYMENT' THEN

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
       || ',"checkId":'       || v_txn_id
       || ',"apRowsUpdated":' || v_ap_rows
       || ',"paymentStatus":"'|| v_pmt_status || '"'
       || '}');

  -- ── EXTERNAL TRANSACTION ─────────────────────────────────────
  ELSIF v_source IN ('ORA_MAN', 'ORA_BAT', 'ORA_STA', 'EXTERNAL_TXN') THEN

    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
       SET RECONCILED_FLAG   = 'Y',
           RECONCILED_DATE   = v_recon_date,
           RECONCILED_BY     = v_recon_by,
           BANK_STATEMENT_ID = v_stmt_id,
           STMT_LINE_ID      = v_stmt_line_id,
           STATUS            = 'REC',
           LAST_UPDATE_DATE  = SYSTIMESTAMP
     WHERE EXTERNAL_TRANSACTION_ID = v_txn_id;
    v_ext_rows := SQL%ROWCOUNT;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","source":"' || v_source || '"'
       || ',"externalTxnId":'  || v_txn_id
       || ',"extRowsUpdated":' || v_ext_rows
       || ',"reconciledBy":"'  || v_recon_by || '"'
       || ',"bankStatementId":'|| NVL(TO_CHAR(v_stmt_id),   'null')
       || ',"stmtLineId":'     || NVL(TO_CHAR(v_stmt_line_id), 'null')
       || '}');

  -- ── Unknown source ────────────────────────────────────────────
  ELSE
    :status_code := 400;
    HTP.P('{"status":"error","message":"Unknown source: ' || NVL(v_source,'(null)') || '"}');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN
      :status_code := 500;
      HTP.P('{"status":"error","message":"' || REPLACE(v_e,'"','\"') || '"}');
    END;
END;
    ]'
  );
  COMMIT;
END;
/
