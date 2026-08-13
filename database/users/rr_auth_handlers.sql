-- =============================================================================
-- RR_AUTH_HANDLERS.SQL
-- ORDS REST handlers for: auth/login, auth/send-otp, auth/set-password
-- Run this in APEX SQL Workshop to replace any existing auth handlers.
--
-- RR_USER_PASSWORDS columns assumed:
--   USERNAME       VARCHAR2(320) PK
--   PASSWORD_HASH  VARCHAR2(200)
--   IS_ADMIN       VARCHAR2(1)
--   OTP_CODE       VARCHAR2(10)
--   OTP_EXPIRES    DATE
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. POST auth/login
--    Body: { "username": "...", "password": "..." }
--    Returns: { "status": "SUCCESS"|"INVALID_CREDENTIALS"|"NO_PASSWORD"|"SUSPENDED",
--               "message": "...", "user": { ... } }
--
--    NO hardcoded bypass — every login must match RR_USER_PASSWORDS.
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'auth/login',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_body         VARCHAR2(32767);
    v_username     VARCHAR2(320);
    v_password     VARCHAR2(500);
    v_input_hash   VARCHAR2(200);
    v_stored_hash  VARCHAR2(200);
    v_suspended    VARCHAR2(5);
    v_is_admin     VARCHAR2(1);
    v_pwd_count    NUMBER;
BEGIN
    -- Read request body
    v_body     := :body_text;
    v_username := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'username', p_values => APEX_JSON.PARSE(v_body))));
    v_password := APEX_JSON.GET_VARCHAR2(p_path => 'password', p_values => APEX_JSON.PARSE(v_body));

    -- Check if user account exists and is not suspended
    BEGIN
        SELECT NVL(SUSPENDED_FLAG, 'false')
          INTO v_suspended
          FROM RR_USER_ACCOUNTS
         WHERE UPPER(USERNAME) = v_username;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P('{"status":"INVALID_CREDENTIALS","message":"Invalid username or password."}');
            RETURN;
    END;

    IF v_suspended = 'true' THEN
        HTP.P('{"status":"SUSPENDED","message":"Your account has been suspended. Please contact your administrator."}');
        RETURN;
    END IF;

    -- Check if a password record exists
    SELECT COUNT(*) INTO v_pwd_count
      FROM RR_USER_PASSWORDS
     WHERE USERNAME = v_username;

    IF v_pwd_count = 0 THEN
        HTP.P('{"status":"NO_PASSWORD","message":"No password set for this account. Use Reset / Set Password to set one."}');
        RETURN;
    END IF;

    -- Hash the supplied password using the same algorithm
    v_input_hash := TO_CHAR(DBMS_UTILITY.GET_HASH_VALUE(v_password, 1000000000, 1073741824));

    -- Verify against stored hash
    BEGIN
        SELECT PASSWORD_HASH, NVL(IS_ADMIN, 'N')
          INTO v_stored_hash, v_is_admin
          FROM RR_USER_PASSWORDS
         WHERE USERNAME = v_username;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P('{"status":"INVALID_CREDENTIALS","message":"Invalid username or password."}');
            RETURN;
    END;

    IF v_stored_hash IS NULL THEN
        HTP.P('{"status":"NO_PASSWORD","message":"No password set for this account. Use Reset / Set Password to set one."}');
        RETURN;
    END IF;

    IF v_input_hash != v_stored_hash THEN
        HTP.P('{"status":"INVALID_CREDENTIALS","message":"Invalid username or password."}');
        RETURN;
    END IF;

    -- ── SUCCESS — return user info ────────────────────────────────────────────
    HTP.P(
        '{"status":"SUCCESS"'
        || ',"message":"Login successful."'
        || ',"user":{"username":"' || v_username || '"'
        || ',"is_admin":"' || v_is_admin || '"'
        || '}}'
    );

EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 2. POST auth/send-otp
--    Body: { "username": "..." }
--    Generates a 6-digit OTP, stores it with a 15-min expiry, returns
--    { "status": "OK", "email": "...", "otp": "..." }
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'auth/send-otp',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_body     VARCHAR2(32767);
    v_username VARCHAR2(320);
    v_email    VARCHAR2(320);
    v_otp      VARCHAR2(6);
    v_count    NUMBER;
BEGIN
    v_body     := :body_text;
    v_username := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'username', p_values => APEX_JSON.PARSE(v_body))));

    -- Check user exists
    BEGIN
        SELECT USERNAME INTO v_email
          FROM RR_USER_ACCOUNTS
         WHERE UPPER(USERNAME) = v_username;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P('{"status":"NOT_FOUND","message":"No account found for that email address."}');
            RETURN;
    END;

    -- Generate 6-digit OTP
    v_otp := LPAD(TO_CHAR(TRUNC(DBMS_RANDOM.VALUE(0, 999999))), 6, '0');

    -- Upsert into RR_USER_PASSWORDS (create record if first time)
    SELECT COUNT(*) INTO v_count FROM RR_USER_PASSWORDS WHERE USERNAME = v_username;
    IF v_count = 0 THEN
        INSERT INTO RR_USER_PASSWORDS (USERNAME, OTP_CODE, OTP_EXPIRES)
        VALUES (v_username, v_otp, SYSDATE + (15/1440));
    ELSE
        UPDATE RR_USER_PASSWORDS
           SET OTP_CODE    = v_otp,
               OTP_EXPIRES = SYSDATE + (15/1440)
         WHERE USERNAME    = v_username;
    END IF;
    COMMIT;

    -- Return OTP + email to frontend (frontend sends the email via Brevo/nodemailer)
    HTP.P(
        '{"status":"OK"'
        || ',"email":"'  || v_email || '"'
        || ',"otp":"'    || v_otp   || '"'
        || '}'
    );

EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 3. POST auth/set-password
--    Body: { "username": "...", "otp": "...", "new_password": "..." }
--    Verifies OTP, sets new hashed password, clears OTP.
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'auth/set-password',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         => q'[
DECLARE
    v_body         VARCHAR2(32767);
    v_username     VARCHAR2(320);
    v_otp          VARCHAR2(6);
    v_new_password VARCHAR2(500);
    v_stored_otp   VARCHAR2(6);
    v_otp_expires  DATE;
    v_new_hash     VARCHAR2(200);
    v_count        NUMBER;
BEGIN
    v_body         := :body_text;
    v_username     := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'username',     p_values => APEX_JSON.PARSE(v_body))));
    v_otp          := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'otp',          p_values => APEX_JSON.PARSE(v_body)));
    v_new_password := APEX_JSON.GET_VARCHAR2(p_path => 'new_password', p_values => APEX_JSON.PARSE(v_body));

    -- Retrieve stored OTP
    BEGIN
        SELECT OTP_CODE, OTP_EXPIRES
          INTO v_stored_otp, v_otp_expires
          FROM RR_USER_PASSWORDS
         WHERE USERNAME = v_username;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            HTP.P('{"status":"ERROR","message":"No OTP found. Please request a new one."}');
            RETURN;
    END;

    -- Check expiry
    IF SYSDATE > v_otp_expires THEN
        HTP.P('{"status":"EXPIRED","message":"OTP has expired. Please request a new one."}');
        RETURN;
    END IF;

    -- Check OTP matches
    IF v_stored_otp != v_otp THEN
        HTP.P('{"status":"INVALID_OTP","message":"Incorrect OTP. Please try again."}');
        RETURN;
    END IF;

    -- Hash new password
    v_new_hash := TO_CHAR(DBMS_UTILITY.GET_HASH_VALUE(v_new_password, 1000000000, 1073741824));

    -- Set password and clear OTP
    UPDATE RR_USER_PASSWORDS
       SET PASSWORD_HASH = v_new_hash,
           OTP_CODE      = NULL,
           OTP_EXPIRES   = NULL
     WHERE USERNAME      = v_username;
    COMMIT;

    HTP.P('{"status":"SUCCESS","message":"Password set successfully. You can now log in."}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]',
        p_items_per_page => 0
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Prerequisites: ensure RR_USER_PASSWORDS has OTP columns
-- Run once if the columns don't exist yet:
--
-- ALTER TABLE RR_USER_PASSWORDS ADD OTP_CODE    VARCHAR2(10);
-- ALTER TABLE RR_USER_PASSWORDS ADD OTP_EXPIRES DATE;
-- ---------------------------------------------------------------------------
