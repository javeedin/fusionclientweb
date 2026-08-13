-- =============================================================================
-- Add missing lines to an existing GL journal header
-- Endpoint: POST reerp/gl/journals/:headerId/linesaddmissing
--
-- Unique pattern avoids any conflict with the existing GET
-- gl/journals/:id/lines template.
--
-- Body: JSON array of line objects
-- [
--   {
--     "enteredDr":          1000,
--     "enteredCr":          null,
--     "accountedDr":        3675,
--     "accountedCr":        null,
--     "description":        "Missing line",
--     "currencyCode":       "USD",
--     "accountingDate":     "2026-04-30",
--     "accountCombination": "01-200-7010-0000-000-0000",
--     "reference1":         "INV-001",
--     "reference2":         "12345",
--     "reference3":         "EXPENSE",
--     "reference4":         "HQ Business Unit",
--     "reference5":         "AP-INVOICE-CREATION",
--     "createdBy":          "SYSTEM"
--   }
-- ]
--
-- Run in: SQL Workshop > SQL Commands (one block at a time, as schema owner)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Step 1: Remove the old conflicting :headerId/lines template if it exists
-- (This was the one that caused the 404 outage)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:headerId/lines',
        p_method      => 'POST'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:headerId/lines'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- Step 2: Republish to restore routing after conflict cleanup
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.PUBLISH_MODULE(p_module_name => 'reerp');
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Step 3: Create unique template (no conflict with any existing pattern)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:headerId/linesaddmissing'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:headerId/linesaddmissing',
        p_comments    => 'Add missing lines to an existing GL journal header'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Step 4: POST handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:headerId/linesaddmissing',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_comments    => 'Append missing lines to an existing GL journal header',
        p_source      =>
'DECLARE
    v_je_header_id  NUMBER  := TO_NUMBER(:headerId);
    v_body          CLOB    := :body_text;
    v_lines         JSON_ARRAY_T;
    v_line          JSON_OBJECT_T;
    v_batch_id      NUMBER;
    v_next_line_num NUMBER;
    v_entered_dr    NUMBER;
    v_entered_cr    NUMBER;
    v_accounted_dr  NUMBER;
    v_accounted_cr  NUMBER;
    i               INTEGER;
BEGIN
    -- Validate header exists and get batch_id
    BEGIN
        SELECT h.batch_id
        INTO   v_batch_id
        FROM   RR_GL_HEADERS h
        WHERE  h.je_header_id = v_je_header_id
        AND    ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
            HTP.PRN(''{"success":false,"error":"GL header '' || v_je_header_id || '' not found"}'');
            RETURN;
    END;

    -- Next available line number
    SELECT NVL(MAX(je_line_number), 0)
    INTO   v_next_line_num
    FROM   RR_GL_LINES_ALL
    WHERE  je_header_id = v_je_header_id;

    -- Parse JSON body
    v_lines := JSON_ARRAY_T.parse(v_body);

    FOR i IN 0 .. v_lines.get_size - 1 LOOP
        v_line          := JSON_OBJECT_T(v_lines.get(i));
        v_next_line_num := v_next_line_num + 1;

        v_entered_dr   := v_line.get_number(''enteredDr'');
        v_entered_cr   := v_line.get_number(''enteredCr'');
        v_accounted_dr := v_line.get_number(''accountedDr'');
        v_accounted_cr := v_line.get_number(''accountedCr'');

        INSERT INTO RR_GL_LINES_ALL (
            batch_id, je_header_id, je_line_number,
            entered_dr, entered_cr, accounted_dr, accounted_cr,
            description, currency_code,
            currency_conversion_date, currency_conversion_rate,
            user_currency_conversion_type,
            account_combination, chart_of_accounts_name,
            reference1, reference2, reference3, reference4, reference5,
            reference6, reference7, reference8, reference9, reference10,
            reconciled_flag, created_by, creation_date,
            last_updated_by, last_update_date
        ) VALUES (
            v_batch_id, v_je_header_id, v_next_line_num,
            v_entered_dr, v_entered_cr, v_accounted_dr, v_accounted_cr,
            v_line.get_string(''description''),
            v_line.get_string(''currencyCode''),
            TO_DATE(v_line.get_string(''accountingDate''), ''YYYY-MM-DD''),
            NVL(v_line.get_number(''conversionRate''), 1),
            ''User'',
            v_line.get_string(''accountCombination''),
            ''Chart of Accounts'',
            v_line.get_string(''reference1''), v_line.get_string(''reference2''),
            v_line.get_string(''reference3''), v_line.get_string(''reference4''),
            v_line.get_string(''reference5''), v_line.get_string(''reference6''),
            v_line.get_string(''reference7''), v_line.get_string(''reference8''),
            v_line.get_string(''reference9''), v_line.get_string(''reference10''),
            NVL(v_line.get_string(''reconciledFlag''), ''N''),
            NVL(v_line.get_string(''createdBy''), USER), SYSTIMESTAMP,
            NVL(v_line.get_string(''createdBy''), USER), SYSTIMESTAMP
        );
    END LOOP;

    -- Refresh running totals on the header
    UPDATE RR_GL_HEADERS
    SET    running_total_dr           = (SELECT NVL(SUM(accounted_dr),0) FROM RR_GL_LINES_ALL WHERE je_header_id = v_je_header_id),
           running_total_cr           = (SELECT NVL(SUM(accounted_cr),0) FROM RR_GL_LINES_ALL WHERE je_header_id = v_je_header_id),
           running_total_accounted_dr = (SELECT NVL(SUM(accounted_dr),0) FROM RR_GL_LINES_ALL WHERE je_header_id = v_je_header_id),
           running_total_accounted_cr = (SELECT NVL(SUM(accounted_cr),0) FROM RR_GL_LINES_ALL WHERE je_header_id = v_je_header_id),
           last_update_date           = SYSTIMESTAMP
    WHERE  je_header_id = v_je_header_id;

    COMMIT;

    :status_code := 200;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(
        ''{"success":true'' ||
        '',"jeHeaderId":'' || v_je_header_id ||
        '',"jeBatchId":''  || v_batch_id ||
        '',"linesAdded":'' || v_lines.get_size ||
        ''}''
    );
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
        HTP.PRN(''{"success":false,"error":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Step 5: Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template = 'gl/journals/:headerId/linesaddmissing';
