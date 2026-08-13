-- ============================================================
-- PATCH 95: Fix JSON_QUERY truncation in POST /cash/bankstatements
--
-- Problem:
--   JSON_QUERY(v_body, '$.lines') returns VARCHAR2(4000) by default.
--   When the lines JSON array exceeds ~4000 characters (roughly 14+
--   lines with descriptions), Oracle silently returns NULL, so
--   save_lines is never called and linesProcessed = 0.
--
-- Symptom:
--   "Statement saved but 0 of N lines were stored — check
--    date/amount formats."
--
-- Fix:
--   Add RETURNING CLOB to both JSON_QUERY calls so large payloads
--   are handled correctly regardless of line count.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run this single BEGIN...END;
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/bankstatements',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/bankstatements',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_mimes_allowed  => 'application/json',
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body        CLOB;
    v_header_json CLOB;
    v_lines_json  CLOB;
    v_stmt_id     NUMBER;
    v_count       NUMBER := 0;
    v_error       VARCHAR2(4000);
    v_dest_off    INTEGER := 1;
    v_src_off     INTEGER := 1;
    v_lang        INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warn        INTEGER;
BEGIN
    -- Convert BLOB body to CLOB
    DBMS_LOB.CREATETEMPORARY(v_body, TRUE);
    DBMS_LOB.CONVERTTOCLOB(
        dest_lob     => v_body,
        src_blob     => :body,
        amount       => DBMS_LOB.LOBMAXSIZE,
        dest_offset  => v_dest_off,
        src_offset   => v_src_off,
        blob_csid    => NLS_CHARSET_ID('AL32UTF8'),
        lang_context => v_lang,
        warning      => v_warn
    );

    -- Extract header and lines — RETURNING CLOB prevents silent
    -- truncation at 4000 chars when many lines are submitted
    SELECT JSON_QUERY(v_body, '$.header' RETURNING CLOB),
           JSON_QUERY(v_body, '$.lines'  RETURNING CLOB)
    INTO   v_header_json, v_lines_json
    FROM   DUAL;

    -- Save header
    RR_BANK_STMT_PKG.save_header(
        p_json    => v_header_json,
        p_stmt_id => v_stmt_id,
        p_error   => v_error
    );
    IF v_error IS NOT NULL THEN
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(v_error) || '}');
        RETURN;
    END IF;

    -- Save lines if provided
    IF v_lines_json IS NOT NULL AND v_lines_json != 'null' THEN
        RR_BANK_STMT_PKG.save_lines(
            p_stmt_id => v_stmt_id,
            p_json    => v_lines_json,
            p_count   => v_count,
            p_error   => v_error
        );
        IF v_error IS NOT NULL THEN
            HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(v_error) || '}');
            RETURN;
        END IF;
    END IF;

    -- Recalculate totals
    RR_BANK_STMT_PKG.recalc_totals(p_stmt_id => v_stmt_id);

    HTP.P('{"status":"success","statementId":' || v_stmt_id ||
          ',"linesProcessed":'                 || v_count   || '}');
EXCEPTION
    WHEN OTHERS THEN
        DBMS_LOB.FREETEMPORARY(v_body);
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
