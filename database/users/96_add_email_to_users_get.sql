-- =============================================================================
-- PATCH 96: Add email field to GET /admin/users response
--
-- USERNAME in RR_USER_ACCOUNTS stores the login email (e.g. user@company.com).
-- This patch rebuilds the GET handler to expose it explicitly as "email"
-- so the Approval Engine approver picker can pre-fill the email field.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the BEGIN...END; block below
-- =============================================================================

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
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
    v_data    CLOB;
    v_out     CLOB;
    v_first   BOOLEAN := TRUE;
BEGIN
    -- Build enriched response: username + email (username IS the email in this system)
    DBMS_LOB.CREATETEMPORARY(v_out, TRUE);
    DBMS_LOB.APPEND(v_out, '{"status":"SUCCESS","message":"OK","data":[');

    FOR r IN (
        SELECT a.USERNAME,
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
            ',"email":'          || APEX_JSON.STRINGIFY(NVL(r.USERNAME,''))       ||
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
