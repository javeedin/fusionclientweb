-- =============================================================================
-- PATCH 21: Fix ORA-06502 in POST approvals/send-email
--
-- PROBLEM:
--   APEX_JSON.STRINGIFY(clob_variable) implicitly converts CLOB → VARCHAR2
--   before APEX 20.2.  A base64-encoded XLSX attachment is typically 30-100 KB,
--   which exceeds the 32,767-byte VARCHAR2 limit and throws:
--     ORA-06502: PL/SQL: numeric or value error
--
-- FIX:
--   1. htmlContent  → manual CLOB-safe escaping via REPLACE chains
--      (escapes \ " CR LF — the only chars HTML email bodies contain)
--   2. attachmentContent → direct CLOB append wrapped in JSON quotes
--      (base64 alphabet A-Za-z0-9+/= has no JSON special characters,
--       so no escaping is needed — just surround with double-quotes)
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the BEGIN...END; block
-- =============================================================================

BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp', 'approvals/send-email', 'POST');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/send-email',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body           CLOB := :body_text;
    v_to_email       VARCHAR2(500);
    v_to_name        VARCHAR2(500);
    v_subject        VARCHAR2(1000);
    v_html           CLOB;
    v_attach_content CLOB;
    v_attach_name    VARCHAR2(300);
    v_api_key        VARCHAR2(500);
    v_from_email     VARCHAR2(200);
    v_from_name      VARCHAR2(200);
    v_req_body       CLOB;
    v_resp           CLOB;
    v_http_code      NUMBER;
BEGIN
    -- Extract scalar fields
    v_to_email    := JSON_VALUE(v_body, '$.toEmail');
    v_to_name     := JSON_VALUE(v_body, '$.toName');
    v_subject     := JSON_VALUE(v_body, '$.subject');
    v_attach_name := NVL(JSON_VALUE(v_body, '$.attachmentName'), 'attachment.xlsx');

    -- Extract htmlContent as CLOB (may exceed VARCHAR2 4000 limit)
    BEGIN
        SELECT jt.html
        INTO   v_html
        FROM   JSON_TABLE(v_body, '$'
                   COLUMNS (html CLOB PATH '$.htmlContent')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_html := NULL;
    END;

    -- Extract attachmentContent as CLOB (base64-encoded file, can be large)
    BEGIN
        SELECT jt.attach
        INTO   v_attach_content
        FROM   JSON_TABLE(v_body, '$'
                   COLUMNS (attach CLOB PATH '$.attachmentContent')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_attach_content := NULL;
    END;

    IF v_to_email IS NULL OR v_subject IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"toEmail and subject are required"}');
        RETURN;
    END IF;

    -- Read Brevo credentials from config table
    BEGIN
        SELECT BREVO_API_KEY,
               FROM_EMAIL,
               NVL(FROM_NAME, 'ERP Approval System')
        INTO   v_api_key, v_from_email, v_from_name
        FROM   RR_BRAVO_IP_ADDRESS
        WHERE  ACTIVE = 'Y'
        AND    ROWNUM  = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 500;
            HTP.P('{"status":"ERROR","message":"Brevo config not found"}');
            RETURN;
    END;

    -- Build Brevo API JSON body (all VARCHAR2 fields fit in concat safely)
    DBMS_LOB.CREATETEMPORARY(v_req_body, TRUE);
    DBMS_LOB.APPEND(v_req_body,
        '{"sender":{"name":'  || APEX_JSON.STRINGIFY(v_from_name)  ||
        ',"email":'           || APEX_JSON.STRINGIFY(v_from_email) ||
        '},"to":[{"email":'   || APEX_JSON.STRINGIFY(v_to_email)   ||
        ',"name":'            || APEX_JSON.STRINGIFY(NVL(v_to_name, v_to_email)) ||
        '}],"subject":'       || APEX_JSON.STRINGIFY(v_subject)    ||
        ',"htmlContent":');

    -- ── htmlContent: CLOB-safe JSON string encoding ────────────────────────
    -- APEX_JSON.STRINGIFY on a CLOB converts to VARCHAR2 internally in older
    -- APEX versions (< 20.2), which overflows for large HTML bodies.
    -- We manually escape the four characters that appear in HTML email bodies:
    --   \  →  \\    (must be first to avoid double-escaping)
    --   "  →  \"
    --   CR →  \r
    --   LF →  \n
    DECLARE
        v_esc CLOB;
    BEGIN
        v_esc := REPLACE(v_html,  '\',     '\\');
        v_esc := REPLACE(v_esc,   '"',     '\"');
        v_esc := REPLACE(v_esc,   CHR(13), '\r');
        v_esc := REPLACE(v_esc,   CHR(10), '\n');
        DBMS_LOB.APPEND(v_req_body, '"');
        DBMS_LOB.APPEND(v_req_body, v_esc);
        DBMS_LOB.APPEND(v_req_body, '"');
    END;

    -- ── attachmentContent: base64 needs no JSON escaping ───────────────────
    -- The base64 alphabet (A-Za-z0-9+/=) contains no JSON special characters.
    -- We can embed it directly between double-quotes without APEX_JSON.STRINGIFY.
    IF v_attach_content IS NOT NULL AND DBMS_LOB.GETLENGTH(v_attach_content) > 0 THEN
        DBMS_LOB.APPEND(v_req_body, ',"attachment":[{"content":"');
        DBMS_LOB.APPEND(v_req_body, v_attach_content);
        DBMS_LOB.APPEND(v_req_body,
            '","name":' || APEX_JSON.STRINGIFY(v_attach_name) || '}]');
    END IF;

    DBMS_LOB.APPEND(v_req_body, '}');

    -- Set HTTP headers for Brevo
    APEX_WEB_SERVICE.G_REQUEST_HEADERS.DELETE;
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(1).NAME  := 'api-key';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(1).VALUE := v_api_key;
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(2).NAME  := 'Content-Type';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(2).VALUE := 'application/json';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(3).NAME  := 'Accept';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(3).VALUE := 'application/json';

    -- Call Brevo from Oracle Cloud (fixed outbound IP)
    v_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
        p_url         => 'https://api.brevo.com/v3/smtp/email',
        p_http_method => 'POST',
        p_body        => v_req_body
    );
    v_http_code := APEX_WEB_SERVICE.G_STATUS_CODE;

    DBMS_LOB.FREETEMPORARY(v_req_body);

    IF v_http_code BETWEEN 200 AND 299 THEN
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Email sent to ' || v_to_email ||
              (CASE WHEN v_attach_content IS NOT NULL THEN ' with attachment' ELSE '' END) || '"}');
    ELSE
        :status_code := NVL(v_http_code, 502);
        HTP.P('{"status":"ERROR","brevoStatus":' || NVL(v_http_code, 502) ||
              ',"message":' || APEX_JSON.STRINGIFY(SUBSTR(NVL(v_resp,'no response'),1,500)) || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST approvals/send-email redeployed with CLOB-safe JSON escaping (patch 21).');
END;
/
