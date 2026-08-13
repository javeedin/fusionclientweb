-- =============================================================================
-- PATCH 13: Server-side Brevo email proxy via ORDS
--
-- WHY: Brevo whitelists specific IP addresses. Browser-side fetch() calls
--      from different user machines appear with varying IPs → Brevo 401.
--      By routing all Brevo calls through ORDS (Oracle Cloud = fixed IP),
--      only ONE IP needs to be whitelisted in Brevo.
--
-- STEPS:
--   1. Create RR_BRAVO_IP_ADDRESS config table
--   2. Seed config from RR_EMAIL_CONFIG (if already set up)
--   3. Setup network ACL for api.brevo.com
--   4. Register POST approvals/send-email ORDS handler
--
-- AFTER RUNNING:
--   - Find your Oracle Cloud outbound IP in the SERVER_IP column
--     (ask DBA or check via Oracle Cloud Console → Networking)
--   - Whitelist that IP once in Brevo → Settings → Authorised IPs
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── Step 1: Create RR_BRAVO_IP_ADDRESS table ─────────────────────────────────
BEGIN
    EXECUTE IMMEDIATE q'[
        CREATE TABLE RR_BRAVO_IP_ADDRESS (
            CONFIG_ID     NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            BREVO_API_KEY VARCHAR2(500)  NOT NULL,
            FROM_EMAIL    VARCHAR2(200)  NOT NULL,
            FROM_NAME     VARCHAR2(200)  DEFAULT 'ERP Approval System',
            SERVER_IP     VARCHAR2(100),
            ACTIVE        VARCHAR2(1)    DEFAULT 'Y'   NOT NULL,
            CREATED_DATE  DATE           DEFAULT SYSDATE
        )
    ]';
    DBMS_OUTPUT.PUT_LINE('RR_BRAVO_IP_ADDRESS created.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -955 THEN
            DBMS_OUTPUT.PUT_LINE('Table already exists — skipped.');
        ELSE
            RAISE;
        END IF;
END;
/

-- ── Step 2: Seed config from RR_EMAIL_CONFIG ─────────────────────────────────
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM RR_BRAVO_IP_ADDRESS;
    IF v_count = 0 THEN
        INSERT INTO RR_BRAVO_IP_ADDRESS (BREVO_API_KEY, FROM_EMAIL, FROM_NAME)
        SELECT SMTP_PASS,
               SMTP_USER,
               NVL(FROM_NAME, 'ERP Approval System')
        FROM   RR_EMAIL_CONFIG
        WHERE  ROWNUM = 1;
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('Seeded Brevo config from RR_EMAIL_CONFIG.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('Config row already exists — skipped seed.');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('Seed skipped: ' || SQLERRM);
END;
/

-- ── Step 3: Network ACL for api.brevo.com ─────────────────────────────────────
-- Grants the current DB schema permission to make outbound HTTPS calls to Brevo.
-- Required for APEX_WEB_SERVICE.MAKE_REST_REQUEST to work.
BEGIN
    DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
        host => 'api.brevo.com',
        ace  => xs$ace_type(
                    privilege_list => xs$name_list('connect', 'resolve'),
                    principal_name => SYS_CONTEXT('USERENV', 'CURRENT_USER'),
                    principal_type => xs_acl.ptype_db
                )
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('ACL set for api.brevo.com → ' ||
                         SYS_CONTEXT('USERENV', 'CURRENT_USER'));
EXCEPTION
    WHEN OTHERS THEN
        -- "already exists" or "insufficient privileges" — both non-fatal
        DBMS_OUTPUT.PUT_LINE('ACL note (non-fatal): ' || SQLERRM);
END;
/

-- ── Step 4: Register POST approvals/send-email ────────────────────────────────
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
    v_body       CLOB := :body_text;
    v_to_email   VARCHAR2(500);
    v_to_name    VARCHAR2(500);
    v_subject    VARCHAR2(1000);
    v_html       CLOB;
    v_api_key    VARCHAR2(500);
    v_from_email VARCHAR2(200);
    v_from_name  VARCHAR2(200);
    v_req_body   CLOB;
    v_resp       CLOB;
    v_http_code  NUMBER;
BEGIN
    -- Extract recipient fields from request body
    v_to_email := JSON_VALUE(v_body, '$.toEmail');
    v_to_name  := JSON_VALUE(v_body, '$.toName');
    v_subject  := JSON_VALUE(v_body, '$.subject');

    -- Extract htmlContent as CLOB (may exceed VARCHAR2 limit)
    BEGIN
        SELECT jt.html
        INTO   v_html
        FROM   JSON_TABLE(v_body, '$'
                   COLUMNS (html CLOB PATH '$.htmlContent')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_html := JSON_VALUE(v_body, '$.htmlContent');
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

    -- Build Brevo API request JSON
    DBMS_LOB.CREATETEMPORARY(v_req_body, TRUE);
    DBMS_LOB.APPEND(v_req_body,
        '{"sender":{"name":'  || APEX_JSON.STRINGIFY(v_from_name)  ||
        ',"email":'           || APEX_JSON.STRINGIFY(v_from_email) ||
        '},"to":[{"email":'   || APEX_JSON.STRINGIFY(v_to_email)   ||
        ',"name":'            || APEX_JSON.STRINGIFY(NVL(v_to_name, v_to_email)) ||
        '}],"subject":'       || APEX_JSON.STRINGIFY(v_subject)    ||
        ',"htmlContent":');
    DBMS_LOB.APPEND(v_req_body, APEX_JSON.STRINGIFY(v_html));
    DBMS_LOB.APPEND(v_req_body, '}');

    -- Set HTTP headers for Brevo
    APEX_WEB_SERVICE.G_REQUEST_HEADERS.DELETE;
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(1).NAME  := 'api-key';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(1).VALUE := v_api_key;
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(2).NAME  := 'Content-Type';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(2).VALUE := 'application/json';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(3).NAME  := 'Accept';
    APEX_WEB_SERVICE.G_REQUEST_HEADERS(3).VALUE := 'application/json';

    -- Call Brevo from the Oracle Cloud server (fixed IP)
    -- p_body accepts CLOB so full HTML content is sent without truncation
    v_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
        p_url         => 'https://api.brevo.com/v3/smtp/email',
        p_http_method => 'POST',
        p_body        => v_req_body
    );
    v_http_code := APEX_WEB_SERVICE.G_STATUS_CODE;

    DBMS_LOB.FREETEMPORARY(v_req_body);

    IF v_http_code BETWEEN 200 AND 299 THEN
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Email sent to ' || v_to_email || '"}');
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
    DBMS_OUTPUT.PUT_LINE('POST approvals/send-email registered successfully.');
END;
/

-- ── Step 5: GET approvals/brevo-config (masked API key) ──────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp', 'approvals/brevo-config', 'GET');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/brevo-config',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_id       NUMBER;
    v_api_key  VARCHAR2(500);
    v_email    VARCHAR2(200);
    v_name     VARCHAR2(200);
    v_ip       VARCHAR2(100);
    v_active   VARCHAR2(1);
    v_masked   VARCHAR2(20);
BEGIN
    SELECT CONFIG_ID, BREVO_API_KEY, FROM_EMAIL,
           NVL(FROM_NAME,'ERP Approval System'), SERVER_IP, ACTIVE
    INTO   v_id, v_api_key, v_email, v_name, v_ip, v_active
    FROM   RR_BRAVO_IP_ADDRESS
    WHERE  ROWNUM = 1;

    -- Mask API key: show only last 4 chars
    IF LENGTH(v_api_key) > 4 THEN
        v_masked := LPAD('*', LENGTH(v_api_key) - 4, '*') || SUBSTR(v_api_key, -4);
        IF LENGTH(v_masked) > 20 THEN v_masked := '****************' || SUBSTR(v_api_key, -4); END IF;
    ELSE
        v_masked := '****';
    END IF;

    :status_code := 200;
    HTP.P('{"status":"SUCCESS"' ||
          ',"configId":'    || v_id ||
          ',"apiKeyMasked":' || APEX_JSON.STRINGIFY(v_masked) ||
          ',"fromEmail":'   || APEX_JSON.STRINGIFY(NVL(v_email,'')) ||
          ',"fromName":'    || APEX_JSON.STRINGIFY(NVL(v_name,'')) ||
          ',"serverIp":'    || APEX_JSON.STRINGIFY(NVL(v_ip,'')) ||
          ',"active":'      || APEX_JSON.STRINGIFY(NVL(v_active,'Y')) ||
          '}');
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        :status_code := 200;
        HTP.P('{"status":"EMPTY","configId":null,"apiKeyMasked":"","fromEmail":"","fromName":"","serverIp":"","active":"Y"}');
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET approvals/brevo-config registered.');
END;
/

-- ── Step 6: PUT approvals/brevo-config (save/update config) ──────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp', 'approvals/brevo-config', 'PUT');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/brevo-config',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body     CLOB := :body_text;
    v_api_key  VARCHAR2(500);
    v_email    VARCHAR2(200);
    v_name     VARCHAR2(200);
    v_ip       VARCHAR2(100);
    v_active   VARCHAR2(1);
    v_count    NUMBER;
BEGIN
    v_api_key := JSON_VALUE(v_body, '$.apiKey');
    v_email   := JSON_VALUE(v_body, '$.fromEmail');
    v_name    := JSON_VALUE(v_body, '$.fromName');
    v_ip      := JSON_VALUE(v_body, '$.serverIp');
    v_active  := NVL(JSON_VALUE(v_body, '$.active'), 'Y');

    IF v_email IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"fromEmail is required"}');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_count FROM RR_BRAVO_IP_ADDRESS;

    IF v_count = 0 THEN
        -- First-time insert — apiKey is required
        IF v_api_key IS NULL THEN
            :status_code := 400;
            HTP.P('{"status":"ERROR","message":"apiKey is required for first-time setup"}');
            RETURN;
        END IF;
        INSERT INTO RR_BRAVO_IP_ADDRESS (BREVO_API_KEY, FROM_EMAIL, FROM_NAME, SERVER_IP, ACTIVE)
        VALUES (v_api_key, v_email, NVL(v_name,'ERP Approval System'), v_ip, v_active);
    ELSE
        -- Update: only replace apiKey if a non-empty value was submitted
        UPDATE RR_BRAVO_IP_ADDRESS SET
            BREVO_API_KEY = CASE WHEN v_api_key IS NOT NULL THEN v_api_key ELSE BREVO_API_KEY END,
            FROM_EMAIL    = v_email,
            FROM_NAME     = NVL(v_name, FROM_NAME),
            SERVER_IP     = v_ip,
            ACTIVE        = v_active
        WHERE ROWNUM = 1;
    END IF;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","message":"Brevo config saved"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT approvals/brevo-config registered.');
END;
/
