-- ============================================================
-- PATCH 107: New endpoint — Bank Reconciliation Status
--            for a GL Account Combination in a given Period
--
-- GET /cash/recon-status?account_combination=01-00-00-231110...
--                        &period_name=May-26
--                        &ledger_id=2001          (optional)
--
-- Returns:
--   totalLines   — total GL journal lines for that combination/period
--   reconLines   — lines where RECONCILED_FLAG = 'Y'
--   unreconLines — lines not reconciled
--   reconAmount  — sum of amounts on reconciled lines
--   unreconAmount— sum of amounts on unreconciled lines
--   lines[]      — detail: je_header_id, je_line_number, date,
--                   amount, description, reconciled_flag,
--                   recon_reference, recon_date
-- ============================================================
BEGIN
  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'reerp',
      p_pattern     => 'cash/recon-status',
      p_method      => 'GET'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'cash/recon-status',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_comments       => 'Bank recon status for a GL account combination in a period — patch 107',
    p_source         => q'[
DECLARE
  v_combo      VARCHAR2(200) := :account_combination;
  v_period     VARCHAR2(20)  := :period_name;
  v_ledger_id  NUMBER        := TO_NUMBER(:ledger_id);

  v_total   NUMBER := 0;
  v_recon   NUMBER := 0;
  v_unrecon NUMBER := 0;
  v_recon_amt   NUMBER := 0;
  v_unrecon_amt NUMBER := 0;
  v_lines   CLOB   := '[';
  v_first   BOOLEAN := TRUE;

  CURSOR c_lines IS
    SELECT
      L.JE_HEADER_ID,
      L.JE_LINE_NUMBER,
      H.DEFAULT_EFFECTIVE_DATE EFFECTIVE_DATE,
      L.ACCOUNTED_DR,
      L.ACCOUNTED_CR,
      L.DESCRIPTION,
      L.RECONCILED_FLAG,
      L.RECONCILIATION_REFERENCE,
      L.JGZZ_RECON_DATE,
      L.JGZZ_RECON_ID,
      L.LAST_UPDATED_BY,
      H.USER_JE_CATEGORY_NAME
    FROM RR_GL_JE_LINES_ALL L
    JOIN RR_GL_JE_HEADERS   H ON H.JE_HEADER_ID = L.JE_HEADER_ID
    WHERE L.ACCOUNT_COMBINATION = v_combo
      AND H.PERIOD_NAME          = v_period
      AND (v_ledger_id IS NULL OR H.LEDGER_ID = v_ledger_id)
    ORDER BY H.DEFAULT_EFFECTIVE_DATE, L.JE_HEADER_ID, L.JE_LINE_NUMBER;

  v_dr    NUMBER;
  v_cr    NUMBER;
  v_net   NUMBER;
  v_rflag VARCHAR2(1);
  v_ref   VARCHAR2(255);
  v_rdate VARCHAR2(20);
  v_rid   VARCHAR2(100);
  v_upd   VARCHAR2(150);
  v_hdr   NUMBER;
  v_lnum  NUMBER;
  v_edate VARCHAR2(20);
  v_desc  VARCHAR2(500);
  v_cat   VARCHAR2(100);
  -- cleaned versions for JSON embedding
  v_desc_j VARCHAR2(600);
  v_ref_j  VARCHAR2(300);
  v_upd_j  VARCHAR2(200);
  v_cat_j  VARCHAR2(120);
BEGIN
  IF v_combo IS NULL OR v_period IS NULL THEN
    :status_code := 400;
    HTP.P('{"status":"error","message":"account_combination and period_name are required"}');
    RETURN;
  END IF;

  OPEN c_lines;
  LOOP
    FETCH c_lines INTO v_hdr, v_lnum, v_edate, v_dr, v_cr, v_desc,
                       v_rflag, v_ref, v_rdate, v_rid, v_upd, v_cat;
    EXIT WHEN c_lines%NOTFOUND;

    v_total := v_total + 1;
    v_net   := NVL(v_dr, 0) - NVL(v_cr, 0);

    IF NVL(v_rflag, 'N') = 'Y' THEN
      v_recon      := v_recon + 1;
      v_recon_amt  := v_recon_amt + v_net;
    ELSE
      v_unrecon     := v_unrecon + 1;
      v_unrecon_amt := v_unrecon_amt + v_net;
    END IF;

    -- Escape for JSON: backslash first, then quote, then control chars
    v_desc_j := REGEXP_REPLACE(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    NVL(SUBSTR(v_desc, 1, 200), ''),
                    '\', '\\'), '"', '\"'),
                    CHR(10), '\n'), CHR(13), '\r'), CHR(9), '\t'),
                  '[[:cntrl:]]', '');

    v_ref_j  := REGEXP_REPLACE(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    NVL(v_ref, ''),
                    '\', '\\'), '"', '\"'),
                    CHR(10), '\n'), CHR(13), '\r'), CHR(9), '\t'),
                  '[[:cntrl:]]', '');

    v_upd_j  := REGEXP_REPLACE(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    NVL(v_upd, ''),
                    '\', '\\'), '"', '\"'),
                    CHR(10), '\n'), CHR(13), '\r'), CHR(9), '\t'),
                  '[[:cntrl:]]', '');

    v_cat_j  := REGEXP_REPLACE(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    NVL(v_cat, ''),
                    '\', '\\'), '"', '\"'),
                    CHR(10), '\n'), CHR(13), '\r'), CHR(9), '\t'),
                  '[[:cntrl:]]', '');

    IF NOT v_first THEN v_lines := v_lines || ','; END IF;
    v_first := FALSE;

    v_lines := v_lines
      || '{"jeHeaderId":'      || v_hdr
      || ',"jeLineNumber":'    || v_lnum
      || ',"effectiveDate":"'  || NVL(TO_CHAR(v_edate), '') || '"'
      || ',"debit":'           || NVL(v_dr, 0)
      || ',"credit":'          || NVL(v_cr, 0)
      || ',"net":'             || v_net
      || ',"description":"'    || v_desc_j || '"'
      || ',"reconciledFlag":"' || NVL(v_rflag, 'N') || '"'
      || ',"reconReference":'  || CASE WHEN v_ref  IS NULL THEN 'null' ELSE '"' || v_ref_j  || '"' END
      || ',"reconDate":'       || CASE WHEN v_rdate IS NULL THEN 'null' ELSE '"' || TO_CHAR(v_rdate) || '"' END
      || ',"reconId":'         || CASE WHEN v_rid   IS NULL THEN 'null' ELSE '"' || v_rid   || '"' END
      || ',"lastUpdatedBy":'   || CASE WHEN v_upd   IS NULL THEN 'null' ELSE '"' || v_upd_j  || '"' END
      || ',"jeCategory":'     || CASE WHEN v_cat   IS NULL THEN 'null' ELSE '"' || v_cat_j  || '"' END
      || '}';
  END LOOP;
  CLOSE c_lines;

  v_lines := v_lines || ']';

  :status_code := 200;
  HTP.P('{'
     || '"status":"success"'
     || ',"accountCombination":"' || REGEXP_REPLACE(REPLACE(REPLACE(v_combo,'\','\\'),'"','\"'),'[[:cntrl:]]','') || '"'
     || ',"periodName":"'         || v_period || '"'
     || ',"totalLines":'          || v_total
     || ',"reconLines":'          || v_recon
     || ',"unreconLines":'        || v_unrecon
     || ',"reconAmount":'         || v_recon_amt
     || ',"unreconAmount":'       || v_unrecon_amt
     || ',"lines":'               || v_lines
     || '}');

EXCEPTION
  WHEN OTHERS THEN
    IF c_lines%ISOPEN THEN CLOSE c_lines; END IF;
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
