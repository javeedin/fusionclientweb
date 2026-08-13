-- ============================================================
-- PATCH 106: Add UNRECON action to PUT handlers
--
-- PUT /cash/reconciliation/systxns/:txnId  — action:'UNRECON'
--   sets all recon columns to NULL for each source
-- PUT /cash/reconciliation/stmtlines/:lineId — action:'UNRECON'
--   sets RECON_STATUS='UNRECONCILED', all RECON_* columns to NULL
-- ============================================================

-- ── 1. Redefine systxns PUT handler ──────────────────────────
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
    p_comments       => 'Reconcile/unreconcile system transaction — patch 106',
    p_source         => q'[
DECLARE
  v_txn_id        NUMBER  := TO_NUMBER(:txnId);
  v_action        VARCHAR2(20);
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
  v_body := :body_text;

  v_action       := UPPER(NVL(JSON_VALUE(v_body, '$.action'),        'RECON'));
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

  -- ══════════════════════════════════════════════════════════
  -- UNRECON branch — clear all recon columns
  -- ══════════════════════════════════════════════════════════
  IF v_action = 'UNRECON' THEN

    IF v_source = 'GL_JOURNAL' THEN
      IF v_je_header_id IS NULL OR v_je_line_num IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"jeHeaderId and jeLineNumber required for GL_JOURNAL UNRECON"}');
        RETURN;
      END IF;
      UPDATE RR_GL_LINES_ALL
         SET RECONCILED_FLAG          = 'N',
             RECONCILIATION_REFERENCE = NULL,
             JGZZ_RECON_REFERENCE     = NULL,
             JGZZ_RECON_DATE          = NULL,
             JGZZ_RECON_ID            = NULL,
             LAST_UPDATED_BY          = v_recon_by,
             LAST_UPDATE_DATE         = SYSTIMESTAMP
       WHERE JE_HEADER_ID  = v_je_header_id
         AND JE_LINE_NUMBER = v_je_line_num;
      v_gl_rows := SQL%ROWCOUNT;
      COMMIT;
      :status_code := 200;
      HTP.P('{"status":"success","action":"UNRECON","source":"GL_JOURNAL","glRowsUpdated":' || v_gl_rows || '}');

    ELSIF v_source = 'BANK_TRANSFER' OR v_source = 'GL_BANK_TRANSFER' THEN
      v_transfer_id := NVL(v_transfer_id, v_txn_id);
      IF v_je_header_id IS NOT NULL AND v_je_line_num IS NOT NULL THEN
        UPDATE RR_GL_JE_LINES_ALL
           SET RECONCILED_FLAG = 'N'
         WHERE JE_HEADER_ID  = v_je_header_id
           AND JE_LINE_NUMBER = v_je_line_num;
        v_gl_rows := SQL%ROWCOUNT;
      END IF;
      UPDATE RR_BANK_ACCOUNT_TRANSFERS
         SET RECONCILED_FLAG  = 'N',
             RECONCILED_DATE  = NULL,
             LAST_UPDATE_DATE = SYSTIMESTAMP
       WHERE BANK_ACCOUNT_TRANSFER_ID = v_transfer_id;
      v_bat_rows := SQL%ROWCOUNT;
      COMMIT;
      :status_code := 200;
      HTP.P('{"status":"success","action":"UNRECON","source":"BANK_TRANSFER"'
         || ',"transferId":'    || v_transfer_id
         || ',"glRowsUpdated":' || v_gl_rows
         || ',"batRowsUpdated":'|| v_bat_rows
         || '}');

    ELSIF v_source = 'AP_PAYMENT' THEN
      UPDATE RR_AP_PAYMENTS_ALL
         SET RECONCILED_FLAG    = 'N',
             CLEARING_DATE      = NULL,
             PAYMENT_STATUS     = 'NEGOTIABLE',
             LOCAL_UPDATED_DATE = SYSTIMESTAMP
       WHERE CHECK_ID = v_txn_id;
      v_ap_rows := SQL%ROWCOUNT;
      COMMIT;
      :status_code := 200;
      HTP.P('{"status":"success","action":"UNRECON","source":"AP_PAYMENT","apRowsUpdated":' || v_ap_rows || '}');

    ELSIF v_source IN ('ORA_MAN', 'ORA_BAT', 'ORA_STA', 'EXTERNAL_TXN') THEN
      UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
         SET RECONCILED_FLAG   = 'N',
             RECONCILED_DATE   = NULL,
             RECONCILED_BY     = NULL,
             BANK_STATEMENT_ID = NULL,
             STMT_LINE_ID      = NULL,
             STATUS            = 'UNREC',
             LAST_UPDATE_DATE  = SYSTIMESTAMP
       WHERE EXTERNAL_TRANSACTION_ID = v_txn_id;
      v_ext_rows := SQL%ROWCOUNT;
      COMMIT;
      :status_code := 200;
      HTP.P('{"status":"success","action":"UNRECON","source":"' || v_source || '","extRowsUpdated":' || v_ext_rows || '}');

    ELSE
      :status_code := 400;
      HTP.P('{"status":"error","message":"Unknown source for UNRECON: ' || NVL(v_source,'(null)') || '"}');
    END IF;

  -- ══════════════════════════════════════════════════════════
  -- RECON branch (default) — same as patch 105
  -- ══════════════════════════════════════════════════════════
  ELSIF v_source = 'GL_JOURNAL' THEN

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

-- ── 2. New dedicated UNRECON handler for stmtlines ───────────
BEGIN
  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'reerp',
      p_pattern     => 'cash/reconciliation/unreconstmtlines/:lineId',
      p_method      => 'PUT'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'cash/reconciliation/unreconstmtlines/:lineId',
    p_method         => 'PUT',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Unreconcile bank statement line — patch 106',
    p_source         => q'[
DECLARE
  v_line_id    NUMBER  := TO_NUMBER(:lineId);
  v_action     VARCHAR2(20);
  v_recon_by   VARCHAR2(150);
  v_recon_date DATE    := SYSDATE;
  v_stmt_id    NUMBER;
  v_recon_txn_type   VARCHAR2(50);
  v_recon_txn_id     NUMBER;
  v_recon_txn_number VARCHAR2(100);
  v_recon_ref        VARCHAR2(255);
  v_recon_notes      VARCHAR2(500);
  v_rows       NUMBER := 0;
  v_body       CLOB;
BEGIN
  v_body := :body_text;

  v_action           := UPPER(NVL(JSON_VALUE(v_body, '$.action'),         'RECON'));
  v_recon_by         := NVL(JSON_VALUE(v_body, '$.reconciledBy'),         'SYSTEM');
  v_stmt_id          := TO_NUMBER(JSON_VALUE(v_body, '$.statementId'));
  v_recon_txn_type   := JSON_VALUE(v_body, '$.reconTxnType');
  v_recon_txn_id     := TO_NUMBER(JSON_VALUE(v_body, '$.reconTxnId'));
  v_recon_txn_number := JSON_VALUE(v_body, '$.reconTxnNumber');
  v_recon_ref        := JSON_VALUE(v_body, '$.reconReference');
  v_recon_notes      := JSON_VALUE(v_body, '$.reconNotes');

  IF JSON_VALUE(v_body, '$.reconciledDate') IS NOT NULL THEN
    v_recon_date := TO_DATE(JSON_VALUE(v_body, '$.reconciledDate'), 'YYYY-MM-DD');
  END IF;

  IF v_action = 'UNRECON' THEN
    UPDATE RR_BANK_STATEMENT_LINES
       SET RECON_STATUS      = 'UNRECONCILED',
           RECON_AMOUNT      = NULL,
           RECON_DATE        = NULL,
           RECON_BY          = v_recon_by,
           RECON_TXN_TYPE    = NULL,
           RECON_TXN_ID      = NULL,
           RECON_TXN_NUMBER  = NULL,
           RECON_REFERENCE   = NULL,
           RECON_NOTES       = NULL,
           LAST_UPDATED_BY   = v_recon_by,
           LAST_UPDATE_DATE  = SYSTIMESTAMP
     WHERE LINE_ID = v_line_id;
    v_rows := SQL%ROWCOUNT;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","action":"UNRECON","lineId":' || v_line_id || ',"rowsUpdated":' || v_rows || '}');

  ELSE
    UPDATE RR_BANK_STATEMENT_LINES
       SET RECON_STATUS      = 'RECONCILED',
           RECON_AMOUNT      = (SELECT AMOUNT FROM RR_BANK_STATEMENT_LINES WHERE LINE_ID = v_line_id),
           RECON_DATE        = v_recon_date,
           RECON_BY          = v_recon_by,
           RECON_TXN_TYPE    = v_recon_txn_type,
           RECON_TXN_ID      = v_recon_txn_id,
           RECON_TXN_NUMBER  = v_recon_txn_number,
           RECON_REFERENCE   = v_recon_ref,
           RECON_NOTES       = v_recon_notes,
           LAST_UPDATED_BY   = v_recon_by,
           LAST_UPDATE_DATE  = SYSTIMESTAMP
     WHERE LINE_ID = v_line_id;
    v_rows := SQL%ROWCOUNT;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","action":"RECON","lineId":' || v_line_id || ',"rowsUpdated":' || v_rows || '}');
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
