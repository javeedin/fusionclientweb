-- ============================================================================
-- Fusion SQL — "Query Runner" data-model PL/SQL
--
-- Paste this as the data set of the QueryRunnerDM BI Publisher data model
-- (see README.md). It base64-decodes the P_QRY_STMT parameter (the user's
-- SELECT, encoded by the app for safe SOAP transport) and opens a ref cursor
-- for it, which BI Publisher renders as the report output.
--
-- Read-only: a data-model ref cursor cannot perform DML. The app also caps
-- rows with ROWNUM and rejects anything that is not SELECT/WITH before it ever
-- reaches here.
-- ============================================================================
DECLARE
    TYPE refcursor IS REF CURSOR;
    xdo_cursor         refcursor;
    v_blob             BLOB;
    v_result           BLOB;
    l_offset           INTEGER;
    l_buffer_size      BINARY_INTEGER := 48;
    l_buffer_varchar   VARCHAR2(48);
    l_buffer_raw       RAW(48);
    l_clob             CLOB;
    l_varchar          VARCHAR2(32767);
    l_start            PLS_INTEGER := 1;
    l_buffer           PLS_INTEGER := 32767;
BEGIN
    -- 1) base64-decode P_QRY_STMT (arrives as text) into a BLOB
    dbms_lob.createtemporary(v_blob, TRUE);
    l_offset := 1;
    FOR i IN 1 .. CEIL(dbms_lob.getlength(:P_QRY_STMT) / l_buffer_size) LOOP
        dbms_lob.read(:P_QRY_STMT, l_buffer_size, l_offset, l_buffer_varchar);
        l_buffer_raw := utl_raw.cast_to_raw(l_buffer_varchar);
        l_buffer_raw := utl_encode.base64_decode(l_buffer_raw);
        dbms_lob.writeappend(v_blob, utl_raw.length(l_buffer_raw), l_buffer_raw);
        l_offset := l_offset + l_buffer_size;
    END LOOP;

    v_result := v_blob;
    dbms_lob.freetemporary(v_blob);

    -- 2) turn the decoded bytes back into the SQL text (CLOB)
    dbms_lob.createtemporary(l_clob, TRUE);
    FOR i IN 1 .. CEIL(dbms_lob.getlength(v_result) / l_buffer) LOOP
        l_varchar := utl_raw.cast_to_varchar2(dbms_lob.substr(v_result, l_buffer, l_start));
        dbms_lob.writeappend(l_clob, LENGTH(l_varchar), l_varchar);
        l_start := l_start + l_buffer;
    END LOOP;

    -- 3) execute it and hand the ref cursor to BI Publisher
    OPEN :xdo_cursor FOR l_clob;
END;


-- ============================================================================
-- VARIANT B — CLOB-safe (use this if Variant A raises PLS-00306 on GETLENGTH)
--
-- A BI Publisher "Text" parameter binds as VARCHAR2, not a LOB, so the
-- dbms_lob.read/getlength calls in Variant A can fail. This variant copies the
-- VARCHAR2 bind into a CLOB first, then base64-decodes it in 4-char-aligned
-- chunks (base64 encodes 3 bytes -> 4 chars, so a multiple of 4 never splits a
-- group). Same behaviour, same P_QRY_STMT parameter — paste this instead.
-- ============================================================================
-- DECLARE
--     TYPE refcursor IS REF CURSOR;
--     xdo_cursor  refcursor;
--     l_b64       CLOB;
--     l_sql       CLOB;
--     l_chunk     VARCHAR2(32767);
--     l_dec       VARCHAR2(32767);
--     l_raw       RAW(32767);
--     l_len       PLS_INTEGER;
--     l_pos       PLS_INTEGER := 1;
--     l_step      PLS_INTEGER := 7500;   -- multiple of 4 (base64 group size)
-- BEGIN
--     l_b64 := :P_QRY_STMT;              -- VARCHAR2 bind -> CLOB (implicit)
--     dbms_lob.createtemporary(l_sql, TRUE);
--     l_len := dbms_lob.getlength(l_b64);
--     WHILE l_pos <= l_len LOOP
--         l_chunk := dbms_lob.substr(l_b64, l_step, l_pos);
--         l_raw   := utl_encode.base64_decode(utl_raw.cast_to_raw(l_chunk));
--         l_dec   := utl_raw.cast_to_varchar2(l_raw);
--         IF l_dec IS NOT NULL THEN
--             dbms_lob.writeappend(l_sql, LENGTH(l_dec), l_dec);
--         END IF;
--         l_pos := l_pos + l_step;
--     END LOOP;
--     OPEN :xdo_cursor FOR l_sql;
-- END;
