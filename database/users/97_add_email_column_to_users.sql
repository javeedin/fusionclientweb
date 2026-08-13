-- =============================================================================
-- PATCH 97: Add EMAIL column to RR_USER_ACCOUNTS + expose in GET /admin/users
--
-- Problem: CREATE_USER/UPDATE_USER accept p_email but never persisted it.
-- Fix:
--   1. Add EMAIL column to RR_USER_ACCOUNTS
--   2. Rebuild GET /admin/users to return email
--   3. Rebuild POST/PUT /admin/users handlers to store email
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── Step 1: Add EMAIL column (safe — ignores if already exists) ───────────────
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_USER_ACCOUNTS ADD (EMAIL VARCHAR2(500))';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -1430 THEN RAISE; END IF; -- ORA-01430: column already exists
END;
/

-- ── Step 2: Rebuild GET /admin/users — include email ─────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'admin/users',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'admin/users',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_out   CLOB;
    v_first BOOLEAN := TRUE;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_out, TRUE);
    DBMS_LOB.APPEND(v_out, '{"status":"SUCCESS","message":"OK","data":[');

    FOR r IN (
        SELECT a.USERNAME,
               a.EMAIL,
               a.USER_ID,
               a.PERSON_NUMBER,
               NVL(a.SUSPENDED_FLAG, 'N')                          AS SUSPENDED_FLAG,
               NVL(p.IS_ADMIN, 'N')                                AS IS_ADMIN,
               TO_CHAR(a.CREATION_DATE, 'YYYY-MM-DD HH24:MI:SS')  AS CREATED_DATE
        FROM   RR_USER_ACCOUNTS a
        LEFT   JOIN RR_USER_PASSWORDS p ON p.USERNAME = a.USERNAME
        ORDER  BY a.USERNAME
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_out, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_out,
            '{"username":'       || APEX_JSON.STRINGIFY(NVL(r.USERNAME,''))       ||
            ',"email":'          || APEX_JSON.STRINGIFY(NVL(r.EMAIL,''))          ||
            ',"user_id":'        || NVL(TO_CHAR(r.USER_ID),'null')               ||
            ',"person_number":'  || APEX_JSON.STRINGIFY(NVL(r.PERSON_NUMBER,'')) ||
            ',"suspended_flag":' || APEX_JSON.STRINGIFY(r.SUSPENDED_FLAG)        ||
            ',"is_admin":'       || APEX_JSON.STRINGIFY(r.IS_ADMIN)              ||
            ',"created_date":'   || APEX_JSON.STRINGIFY(NVL(r.CREATED_DATE,''))  ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_out, ']}');
    :status_code := 200;
    HTP.P(v_out);
    DBMS_LOB.FREETEMPORARY(v_out);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || ',"data":[]}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 3: Rebuild POST /admin/users — store email ───────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'admin/users',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'admin/users',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_username VARCHAR2(100);
    v_email    VARCHAR2(500);
    v_password VARCHAR2(500);
    v_is_admin VARCHAR2(1);
    v_count    NUMBER;
BEGIN
    SELECT jt.username, jt.email, jt.password, jt.is_admin
    INTO   v_username, v_email, v_password, v_is_admin
    FROM   JSON_TABLE(:body_text, '$'
             COLUMNS (
               username VARCHAR2(100) PATH '$.username',
               email    VARCHAR2(500) PATH '$.email',
               password VARCHAR2(500) PATH '$.password',
               is_admin VARCHAR2(1)   PATH '$.is_admin'
             )
           ) jt;

    SELECT COUNT(*) INTO v_count FROM RR_USER_ACCOUNTS WHERE USERNAME = UPPER(v_username);
    IF v_count > 0 THEN
        HTP.P('{"status":"ERROR","message":"Username already exists."}');
        RETURN;
    END IF;

    INSERT INTO RR_USER_ACCOUNTS (USERNAME, EMAIL)
    VALUES (UPPER(v_username), v_email);

    INSERT INTO RR_USER_PASSWORDS (USERNAME, PASSWORD_HASH, IS_ADMIN)
    VALUES (UPPER(v_username),
            STANDARD_HASH(v_password, 'SHA256'),
            NVL(v_is_admin, 'N'));

    COMMIT;
    HTP.P('{"status":"SUCCESS","message":"User created successfully."}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 4: Rebuild PUT /admin/users — store email ────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'admin/users',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'admin/users',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_username VARCHAR2(100);
    v_email    VARCHAR2(500);
    v_is_admin VARCHAR2(1);
    v_suspend  VARCHAR2(1);
BEGIN
    SELECT jt.username, jt.email, jt.is_admin, jt.suspended_flag
    INTO   v_username, v_email, v_is_admin, v_suspend
    FROM   JSON_TABLE(:body_text, '$'
             COLUMNS (
               username       VARCHAR2(100) PATH '$.username',
               email          VARCHAR2(500) PATH '$.email',
               is_admin       VARCHAR2(1)   PATH '$.is_admin',
               suspended_flag VARCHAR2(1)   PATH '$.suspended_flag'
             )
           ) jt;

    UPDATE RR_USER_ACCOUNTS
    SET    EMAIL          = NVL(v_email,   EMAIL),
           SUSPENDED_FLAG = NVL(v_suspend, SUSPENDED_FLAG),
           LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE  USERNAME = UPPER(v_username);

    UPDATE RR_USER_PASSWORDS
    SET    IS_ADMIN = NVL(v_is_admin, IS_ADMIN)
    WHERE  USERNAME = UPPER(v_username);

    COMMIT;
    HTP.P('{"status":"SUCCESS","message":"User updated."}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
