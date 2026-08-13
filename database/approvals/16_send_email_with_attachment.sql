-- =============================================================================
-- PATCH 16: Update POST approvals/send-email to support PDF attachment
--
-- CHANGE: Redeploy the ORDS send-email handler so it optionally reads
--   attachmentContent (base64 PDF) and attachmentName from the request body
--   and passes them to Brevo as "attachment":[{"content":"...","name":"..."}].
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
    v_attach_name := NVL(JSON_VALUE(v_body, '$.attachmentName'), 'invoice.pdf');

    -- Extract htmlContent as CLOB (may exceed VARCHAR2 4000 limit)
    BEGIN
        SELECT jt.html
        INTO   v_html
        FROM   JSON_TABLE(v_body, '$'
                   COLUMNS (html CLOB PATH '$.htmlContent')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_html := JSON_VALUE(v_body, '$.htmlContent');
    END;

    -- Extract attachmentContent as CLOB (base64-encoded PDF, can be large)
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
            HTP.P('{"status":"ERROR","message":"Brevo config not found — insert a row into RR_BRAVO_IP_ADDRESS"}');
            RETURN;
    END;

    -- Build Brevo API JSON body
    DBMS_LOB.CREATETEMPORARY(v_req_body, TRUE);
    DBMS_LOB.APPEND(v_req_body,
        '{"sender":{"name":'  || APEX_JSON.STRINGIFY(v_from_name)  ||
        ',"email":'           || APEX_JSON.STRINGIFY(v_from_email) ||
        '},"to":[{"email":'   || APEX_JSON.STRINGIFY(v_to_email)   ||
        ',"name":'            || APEX_JSON.STRINGIFY(NVL(v_to_name, v_to_email)) ||
        '}],"subject":'       || APEX_JSON.STRINGIFY(v_subject)    ||
        ',"htmlContent":');
    DBMS_LOB.APPEND(v_req_body, APEX_JSON.STRINGIFY(v_html));

    -- Conditionally add attachment (base64-encoded PDF)
    IF v_attach_content IS NOT NULL AND DBMS_LOB.GETLENGTH(v_attach_content) > 0 THEN
        DBMS_LOB.APPEND(v_req_body, ',"attachment":[{"content":');
        DBMS_LOB.APPEND(v_req_body, APEX_JSON.STRINGIFY(v_attach_content));
        DBMS_LOB.APPEND(v_req_body, ',"name":' || APEX_JSON.STRINGIFY(v_attach_name) || '}]');
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
    DBMS_OUTPUT.PUT_LINE('POST approvals/send-email redeployed with attachment support.');
END;
/
