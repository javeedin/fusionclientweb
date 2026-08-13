-- ============================================================
-- Patch 120: Disable ETag caching on GL journal lines GET handler
-- Fixes stale data issue — updated rows not reflected in UI
-- ============================================================
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/:id/lines',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/:id/lines',
            p_priority    => 0,
            p_etag_type   => 'NONE'   -- was 'HASH' — caused browser 304 stale responses
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/:id/lines',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Get journal lines for a header — ETag disabled to prevent stale cache',
        p_source         => q'[
DECLARE
    v_je_header_id NUMBER := TO_NUMBER(:id);
BEGIN
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('items');

    FOR rec IN (
        SELECT
            jls.JE_LINE_NUMBER,
            jls.ACCOUNT_COMBINATION,
            jls.ACCOUNT_DESCRIPTION,
            NVL(jls.ENTERED_DR,   0) AS ENTERED_DR,
            NVL(jls.ENTERED_CR,   0) AS ENTERED_CR,
            NVL(jls.ACCOUNTED_DR, 0) AS ACCOUNTED_DR,
            NVL(jls.ACCOUNTED_CR, 0) AS ACCOUNTED_CR,
            jls.CURRENCY_CODE,
            COALESCE(l.DESCRIPTION, h.JOURNAL_DESCRIPTION, h.JOURNAL_NAME) AS LINE_DESCRIPTION,
            l.REFERENCE1,
            l.REFERENCE2,
            l.REFERENCE3,
            l.REFERENCE4,
            l.REFERENCE5,
            l.REFERENCE6,
            l.REFERENCE7,
            l.REFERENCE8,
            l.REFERENCE9,
            l.REFERENCE10
        FROM V_GL_JOURNAL_LINES_SEGMENTS jls
        LEFT JOIN RR_GL_JE_LINES_ALL l
               ON l.JE_HEADER_ID  = jls.JE_HEADER_ID
              AND l.JE_LINE_NUMBER = jls.JE_LINE_NUMBER
        LEFT JOIN RR_GL_JE_HEADERS h
               ON h.JE_HEADER_ID  = jls.JE_HEADER_ID
        WHERE jls.JE_HEADER_ID = v_je_header_id
        ORDER BY jls.JE_LINE_NUMBER
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('lineNum',            rec.JE_LINE_NUMBER);
        APEX_JSON.WRITE('account',            rec.ACCOUNT_COMBINATION);
        APEX_JSON.WRITE('accountDescription', rec.ACCOUNT_DESCRIPTION);
        APEX_JSON.WRITE('description',        rec.LINE_DESCRIPTION);
        APEX_JSON.WRITE('enteredDr',          rec.ENTERED_DR);
        APEX_JSON.WRITE('enteredCr',          rec.ENTERED_CR);
        APEX_JSON.WRITE('accountedDr',        rec.ACCOUNTED_DR);
        APEX_JSON.WRITE('accountedCr',        rec.ACCOUNTED_CR);
        APEX_JSON.WRITE('currency',           rec.CURRENCY_CODE);
        APEX_JSON.WRITE('reference1',         rec.REFERENCE1);
        APEX_JSON.WRITE('reference2',         rec.REFERENCE2);
        APEX_JSON.WRITE('reference3',         rec.REFERENCE3);
        APEX_JSON.WRITE('reference4',         rec.REFERENCE4);
        APEX_JSON.WRITE('reference5',         rec.REFERENCE5);
        APEX_JSON.WRITE('reference6',         rec.REFERENCE6);
        APEX_JSON.WRITE('reference7',         rec.REFERENCE7);
        APEX_JSON.WRITE('reference8',         rec.REFERENCE8);
        APEX_JSON.WRITE('reference9',         rec.REFERENCE9);
        APEX_JSON.WRITE('reference10',        rec.REFERENCE10);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('ETag disabled on gl/journals/:id/lines GET handler.');
END;
/
