-- =============================================================================
-- PATCH 14: Fix GET approvals/brevo-config
--
-- Problem: RR_BRAVO_IP_ADDRESS is empty so GET returns status=EMPTY and
--          the admin page shows nothing.
--
-- Fix: When RR_BRAVO_IP_ADDRESS is empty, auto-seed from RR_EMAIL_CONFIG
--      and return the seeded row so the page populates immediately.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the single BEGIN...END; block below
-- =============================================================================

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
    v_masked   VARCHAR2(50);
    v_count    NUMBER;
BEGIN
    -- Auto-seed from RR_EMAIL_CONFIG if table is empty
    SELECT COUNT(*) INTO v_count FROM RR_BRAVO_IP_ADDRESS;
    IF v_count = 0 THEN
        BEGIN
            INSERT INTO RR_BRAVO_IP_ADDRESS (BREVO_API_KEY, FROM_EMAIL, FROM_NAME, ACTIVE)
            SELECT SMTP_PASS,
                   SMTP_USER,
                   NVL(FROM_NAME, 'ERP Approval System'),
                   'Y'
            FROM   RR_EMAIL_CONFIG
            WHERE  ROWNUM = 1;
            COMMIT;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- Fetch config (may still be empty if RR_EMAIL_CONFIG also empty)
    BEGIN
        SELECT CONFIG_ID, BREVO_API_KEY, FROM_EMAIL,
               NVL(FROM_NAME, 'ERP Approval System'), SERVER_IP, NVL(ACTIVE,'Y')
        INTO   v_id, v_api_key, v_email, v_name, v_ip, v_active
        FROM   RR_BRAVO_IP_ADDRESS
        WHERE  ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 200;
            HTP.P('{"status":"EMPTY","configId":null,"apiKeyMasked":"","fromEmail":"","fromName":"","serverIp":"","active":"Y"}');
            RETURN;
    END;

    -- Build masked key: always show ****...**** + last 4 chars
    IF v_api_key IS NOT NULL AND LENGTH(v_api_key) > 4 THEN
        v_masked := '****************' || SUBSTR(v_api_key, -4);
    ELSIF v_api_key IS NOT NULL THEN
        v_masked := '****';
    ELSE
        v_masked := '';
    END IF;

    :status_code := 200;
    HTP.P('{"status":"SUCCESS"' ||
          ',"configId":'     || v_id ||
          ',"apiKeyMasked":' || APEX_JSON.STRINGIFY(v_masked) ||
          ',"fromEmail":'    || APEX_JSON.STRINGIFY(NVL(v_email,'')) ||
          ',"fromName":'     || APEX_JSON.STRINGIFY(NVL(v_name,'')) ||
          ',"serverIp":'     || APEX_JSON.STRINGIFY(NVL(v_ip,'')) ||
          ',"active":'       || APEX_JSON.STRINGIFY(NVL(v_active,'Y')) ||
          '}');
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET approvals/brevo-config fixed and registered.');
END;
/
