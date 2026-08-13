-- =============================================================================
-- GL Lines compare endpoint for SLA ↔ GL reconciliation
-- Endpoint: GET reerp/sla/gl-lines?glHeaderId=:glHeaderId
-- Returns GL_JE_LINES joined to GL_JE_HEADERS for a given je_header_id
-- Run in: SQL Workshop > SQL Commands  (one block at a time)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Drop template if it exists
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'sla/gl-lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- Create template
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'sla/gl-lines',
        p_comments    => 'GL Journal Lines for SLA comparison'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- GET sla/gl-lines?glHeaderId=:glHeaderId
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/gl-lines',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Fetch GL journal lines for a given je_header_id',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_offset INTEGER := 1;
  v_len    INTEGER;
  v_amt    CONSTANT INTEGER := 8000;
BEGIN
  SELECT JSON_ARRAYAGG(
    JSON_OBJECT(
      ''lineNum''           VALUE l.je_line_num,
      ''accountCombination'' VALUE (
        s1.segment1 || ''-'' || s2.segment2 || ''-'' ||
        s3.segment3 || ''-'' || s4.segment4 || ''-'' ||
        s5.segment5 || ''-'' || s6.segment6
      ),
      ''description''       VALUE l.description,
      ''currencyCode''      VALUE h.currency_code,
      ''enteredDr''         VALUE l.entered_dr,
      ''enteredCr''         VALUE l.entered_cr,
      ''accountedDr''       VALUE l.accounted_dr,
      ''accountedCr''       VALUE l.accounted_cr,
      ''status''            VALUE h.status,
      ''periodName''        VALUE h.period_name,
      ''effectiveDate''     VALUE TO_CHAR(l.effective_date, ''YYYY-MM-DD''),
      ''codeComboId''       VALUE l.code_combination_id
      NULL ON NULL
    )
    ORDER BY l.je_line_num
    RETURNING CLOB
  )
  INTO v_result
  FROM GL_JE_LINES       l
  JOIN GL_JE_HEADERS     h  ON h.je_header_id = l.je_header_id
  LEFT JOIN GL_CODE_COMBINATIONS cc ON cc.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment1 FROM GL_CODE_COMBINATIONS) s1 ON s1.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment2 FROM GL_CODE_COMBINATIONS) s2 ON s2.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment3 FROM GL_CODE_COMBINATIONS) s3 ON s3.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment4 FROM GL_CODE_COMBINATIONS) s4 ON s4.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment5 FROM GL_CODE_COMBINATIONS) s5 ON s5.code_combination_id = l.code_combination_id
  LEFT JOIN (SELECT code_combination_id, segment6 FROM GL_CODE_COMBINATIONS) s6 ON s6.code_combination_id = l.code_combination_id
  WHERE l.je_header_id = TO_NUMBER(:glHeaderId);

  v_result := ''{"items":'' || NVL(v_result, ''[]'') || ''}'';
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  v_len := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
  WHILE v_offset <= v_len LOOP
    HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_amt, v_offset));
    v_offset := v_offset + v_amt;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/
