-- =============================================================================
-- 29_FIX_RESET_PASSWORD.SQL
-- Patches ADMIN_RESET_PASSWORD to upsert RR_USER_PASSWORDS.
-- Fixes "User not found" for users who have an account but no password row.
-- Safe to run independently — does not touch other procedures.
-- =============================================================================

CREATE OR REPLACE PACKAGE BODY RR_ADMIN_PKG AS

  FUNCTION HASH_PASSWORD(p_password IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(DBMS_UTILITY.GET_HASH_VALUE(p_password, 1000000000, 1073741824));
  END HASH_PASSWORD;

  PROCEDURE GET_USERS(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
    v_row   VARCHAR2(4000);
    CURSOR c_users IS
      SELECT a.USERNAME,
             a.EMAIL,
             a.USER_ID,
             a.PERSON_NUMBER,
             NVL(a.SUSPENDED_FLAG, 'N')               AS SUSPENDED_FLAG,
             NVL(p.IS_ADMIN, 'N')                     AS IS_ADMIN,
             TO_CHAR(a.CREATION_DATE, 'YYYY-MM-DD HH24:MI:SS') AS CREATION_DATE
        FROM RR_USER_ACCOUNTS a
        LEFT JOIN RR_USER_PASSWORDS p ON p.USERNAME = a.USERNAME
       ORDER BY a.USERNAME;
    r c_users%ROWTYPE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));
    OPEN c_users;
    LOOP
      FETCH c_users INTO r;
      EXIT WHEN c_users%NOTFOUND;
      IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
      v_first := FALSE;
      v_row := '{"username":'       || APEX_JSON.STRINGIFY(NVL(r.USERNAME,''))        ||
               ',"email":'          || APEX_JSON.STRINGIFY(NVL(r.EMAIL,''))           ||
               ',"user_id":'        || NVL(TO_CHAR(r.USER_ID),'null')                ||
               ',"person_number":'  || APEX_JSON.STRINGIFY(NVL(r.PERSON_NUMBER,''))  ||
               ',"suspended_flag":' || APEX_JSON.STRINGIFY(NVL(r.SUSPENDED_FLAG,'N'))||
               ',"is_admin":'       || APEX_JSON.STRINGIFY(r.IS_ADMIN)               ||
               ',"created_date":'   || APEX_JSON.STRINGIFY(NVL(r.CREATION_DATE,''))  ||
               '}';
      DBMS_LOB.APPEND(v_clob, TO_CLOB(v_row));
    END LOOP;
    CLOSE c_users;
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status := 'SUCCESS'; p_message := 'OK'; p_data := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      IF c_users%ISOPEN THEN CLOSE c_users; END IF;
      p_status := 'ERROR'; p_message := SQLERRM; p_data := TO_CLOB('[]');
  END GET_USERS;

  PROCEDURE CREATE_USER(
    p_username IN VARCHAR2, p_name IN VARCHAR2,
    p_email    IN VARCHAR2, p_password IN VARCHAR2,
    p_is_admin IN VARCHAR2,
    p_status  OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_count   NUMBER;
    v_user_id NUMBER;
    v_hash    VARCHAR2(100);
  BEGIN
    SELECT COUNT(*) INTO v_count FROM RR_USER_ACCOUNTS WHERE USERNAME = UPPER(p_username);
    IF v_count > 0 THEN
      p_status := 'ERROR'; p_message := 'Username already exists.'; RETURN;
    END IF;
    SELECT NVL(MIN(USER_ID), 0) - 1 INTO v_user_id FROM RR_USER_ACCOUNTS;
    INSERT INTO RR_USER_ACCOUNTS (USER_ID, USERNAME, EMAIL)
    VALUES (v_user_id, UPPER(p_username), p_email);
    v_hash := HASH_PASSWORD(p_password);
    INSERT INTO RR_USER_PASSWORDS (USERNAME, PASSWORD_HASH, IS_ADMIN)
    VALUES (UPPER(p_username), v_hash, NVL(p_is_admin, 'N'));
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'User created successfully.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END CREATE_USER;

  PROCEDURE UPDATE_USER(
    p_username  IN VARCHAR2, p_name      IN VARCHAR2,
    p_email     IN VARCHAR2, p_is_admin  IN VARCHAR2,
    p_suspended IN VARCHAR2,
    p_status   OUT VARCHAR2, p_message  OUT VARCHAR2
  ) IS
  BEGIN
    UPDATE RR_USER_ACCOUNTS
       SET SUSPENDED_FLAG   = NVL(p_suspended, SUSPENDED_FLAG),
           EMAIL            = NVL(p_email, EMAIL),
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE USERNAME = UPPER(p_username);
    UPDATE RR_USER_PASSWORDS
       SET IS_ADMIN = NVL(p_is_admin, IS_ADMIN)
     WHERE USERNAME = UPPER(p_username);
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'User updated successfully.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END UPDATE_USER;

  -- ── ADMIN_RESET_PASSWORD — upsert fix ─────────────────────────────────────
  -- Checks RR_USER_ACCOUNTS first (true "not found" guard).
  -- Updates RR_USER_PASSWORDS if row exists; inserts if not (new users).
  PROCEDURE ADMIN_RESET_PASSWORD(
    p_username     IN VARCHAR2, p_new_password IN VARCHAR2,
    p_admin_user   IN VARCHAR2,
    p_status      OUT VARCHAR2, p_message     OUT VARCHAR2
  ) IS
    v_acct_count NUMBER;
    v_hash       VARCHAR2(100);
  BEGIN
    SELECT COUNT(*) INTO v_acct_count
      FROM RR_USER_ACCOUNTS WHERE UPPER(USERNAME) = UPPER(p_username);

    IF v_acct_count = 0 THEN
      p_status := 'ERROR'; p_message := 'User not found.'; RETURN;
    END IF;

    v_hash := HASH_PASSWORD(p_new_password);

    UPDATE RR_USER_PASSWORDS
       SET PASSWORD_HASH = v_hash
     WHERE UPPER(USERNAME) = UPPER(p_username);

    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO RR_USER_PASSWORDS (USERNAME, PASSWORD_HASH, IS_ADMIN, SALT)
      VALUES (UPPER(p_username), v_hash, 'N', DBMS_RANDOM.STRING('X', 32));
    END IF;

    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Password reset successfully.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END ADMIN_RESET_PASSWORD;

  PROCEDURE CHANGE_OWN_PASSWORD(
    p_username         IN VARCHAR2, p_current_password IN VARCHAR2,
    p_new_password     IN VARCHAR2,
    p_status          OUT VARCHAR2, p_message         OUT VARCHAR2
  ) IS
    v_count    NUMBER;
    v_cur_hash VARCHAR2(100);
    v_new_hash VARCHAR2(100);
  BEGIN
    v_cur_hash := HASH_PASSWORD(p_current_password);
    v_new_hash := HASH_PASSWORD(p_new_password);
    SELECT COUNT(*) INTO v_count
      FROM RR_USER_PASSWORDS
     WHERE UPPER(USERNAME) = UPPER(p_username) AND PASSWORD_HASH = v_cur_hash;
    IF v_count = 0 THEN
      p_status := 'ERROR'; p_message := 'Current password is incorrect.'; RETURN;
    END IF;
    UPDATE RR_USER_PASSWORDS SET PASSWORD_HASH = v_new_hash WHERE UPPER(USERNAME) = UPPER(p_username);
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Password changed successfully.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END CHANGE_OWN_PASSWORD;

  PROCEDURE ASSIGN_MODULE(
    p_username IN VARCHAR2, p_module_code IN VARCHAR2,
    p_granted_by IN VARCHAR2,
    p_status OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    INSERT INTO RR_USER_MODULE_ACCESS (USERNAME, MODULE_CODE, GRANTED_BY, GRANTED_DATE)
    VALUES (UPPER(p_username), UPPER(p_module_code), p_granted_by, SYSDATE);
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Module assigned.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN p_status := 'SUCCESS'; p_message := 'Already assigned.';
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END ASSIGN_MODULE;

  PROCEDURE REMOVE_MODULE(
    p_username IN VARCHAR2, p_module_code IN VARCHAR2,
    p_status OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    DELETE FROM RR_USER_MODULE_ACCESS
     WHERE USERNAME = UPPER(p_username) AND MODULE_CODE = UPPER(p_module_code);
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Module removed.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END REMOVE_MODULE;

  PROCEDURE ASSIGN_BU(
    p_username IN VARCHAR2, p_bu_id IN NUMBER,
    p_granted_by IN VARCHAR2,
    p_status OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_bu_name VARCHAR2(360);
  BEGIN
    BEGIN
      SELECT BUSINESS_UNIT_NAME INTO v_bu_name
        FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = p_bu_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status := 'ERROR'; p_message := 'Business unit not found.'; RETURN;
    END;
    INSERT INTO RR_USER_BU_ACCESS (USERNAME, BU_ID, BU_NAME, GRANTED_BY, GRANTED_DATE)
    VALUES (UPPER(p_username), p_bu_id, v_bu_name, p_granted_by, SYSDATE);
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Business unit assigned.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN p_status := 'SUCCESS'; p_message := 'Already assigned.';
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END ASSIGN_BU;

  PROCEDURE REMOVE_BU(
    p_username IN VARCHAR2, p_bu_id IN NUMBER,
    p_status OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    DELETE FROM RR_USER_BU_ACCESS WHERE USERNAME = UPPER(p_username) AND BU_ID = p_bu_id;
    COMMIT;
    p_status := 'SUCCESS'; p_message := 'Business unit removed.';
  EXCEPTION
    WHEN OTHERS THEN ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
  END REMOVE_BU;

  PROCEDURE GET_USER_ACCESS(
    p_username IN VARCHAR2,
    p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB
  ) IS
    v_is_admin VARCHAR2(1);
    v_modules  CLOB;
    v_bus      CLOB;
    v_row      VARCHAR2(4000);
    v_first    BOOLEAN;
    CURSOR c_mod IS
      SELECT MODULE_CODE FROM RR_USER_MODULE_ACCESS
       WHERE USERNAME = UPPER(p_username) ORDER BY MODULE_CODE;
    CURSOR c_bu IS
      SELECT BU_ID, BU_NAME FROM RR_USER_BU_ACCESS
       WHERE USERNAME = UPPER(p_username) ORDER BY BU_ID;
    r_mod c_mod%ROWTYPE;
    r_bu  c_bu%ROWTYPE;
  BEGIN
    BEGIN
      SELECT NVL(IS_ADMIN,'N') INTO v_is_admin FROM RR_USER_PASSWORDS WHERE USERNAME = UPPER(p_username);
    EXCEPTION WHEN NO_DATA_FOUND THEN v_is_admin := 'N'; END;

    DBMS_LOB.CREATETEMPORARY(v_modules, TRUE);
    DBMS_LOB.APPEND(v_modules, TO_CLOB('['));
    v_first := TRUE;
    OPEN c_mod;
    LOOP
      FETCH c_mod INTO r_mod; EXIT WHEN c_mod%NOTFOUND;
      IF NOT v_first THEN DBMS_LOB.APPEND(v_modules, TO_CLOB(',')); END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_modules, TO_CLOB('"' || r_mod.MODULE_CODE || '"'));
    END LOOP;
    CLOSE c_mod;
    DBMS_LOB.APPEND(v_modules, TO_CLOB(']'));

    DBMS_LOB.CREATETEMPORARY(v_bus, TRUE);
    DBMS_LOB.APPEND(v_bus, TO_CLOB('['));
    v_first := TRUE;
    OPEN c_bu;
    LOOP
      FETCH c_bu INTO r_bu; EXIT WHEN c_bu%NOTFOUND;
      IF NOT v_first THEN DBMS_LOB.APPEND(v_bus, TO_CLOB(',')); END IF;
      v_first := FALSE;
      v_row := '{"id":' || r_bu.BU_ID || ',"name":"' || REPLACE(r_bu.BU_NAME,'"','\"') || '"}';
      DBMS_LOB.APPEND(v_bus, TO_CLOB(v_row));
    END LOOP;
    CLOSE c_bu;
    DBMS_LOB.APPEND(v_bus, TO_CLOB(']'));

    DBMS_LOB.CREATETEMPORARY(p_data, TRUE);
    DBMS_LOB.APPEND(p_data, TO_CLOB('{"is_admin":"' || v_is_admin || '","modules":'));
    DBMS_LOB.APPEND(p_data, v_modules);
    DBMS_LOB.APPEND(p_data, TO_CLOB(',"bus":'));
    DBMS_LOB.APPEND(p_data, v_bus);
    DBMS_LOB.APPEND(p_data, TO_CLOB('}'));
    p_status := 'SUCCESS'; p_message := 'OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF c_mod%ISOPEN THEN CLOSE c_mod; END IF;
      IF c_bu%ISOPEN  THEN CLOSE c_bu;  END IF;
      p_status := 'ERROR'; p_message := SQLERRM; p_data := TO_CLOB('{}');
  END GET_USER_ACCESS;

  PROCEDURE GET_MODULES(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob  CLOB;
    v_row   VARCHAR2(4000);
    v_first BOOLEAN := TRUE;
    CURSOR c IS SELECT MODULE_CODE, MODULE_NAME FROM RR_MODULES
                 WHERE IS_ACTIVE = 'Y' ORDER BY SORT_ORDER;
    r c%ROWTYPE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));
    OPEN c;
    LOOP
      FETCH c INTO r; EXIT WHEN c%NOTFOUND;
      IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
      v_first := FALSE;
      v_row := '{"module_code":"' || r.MODULE_CODE || '","module_name":"' || REPLACE(r.MODULE_NAME,'"','\"') || '"}';
      DBMS_LOB.APPEND(v_clob, TO_CLOB(v_row));
    END LOOP;
    CLOSE c;
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status := 'SUCCESS'; p_message := 'OK'; p_data := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      IF c%ISOPEN THEN CLOSE c; END IF;
      p_status := 'ERROR'; p_message := SQLERRM; p_data := TO_CLOB('[]');
  END GET_MODULES;

  PROCEDURE GET_BUS(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob  CLOB;
    v_row   VARCHAR2(4000);
    v_first BOOLEAN := TRUE;
    CURSOR c IS
      SELECT BUSINESS_UNIT_ID AS BU_ID, BUSINESS_UNIT_NAME AS BU_NAME
        FROM RR_GL_BUSINESS_UNITS
       WHERE NVL(ACTIVE_FLAG,'Y') = 'Y'
       ORDER BY BUSINESS_UNIT_NAME;
    r c%ROWTYPE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));
    OPEN c;
    LOOP
      FETCH c INTO r; EXIT WHEN c%NOTFOUND;
      IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
      v_first := FALSE;
      v_row := '{"bu_id":' || r.BU_ID || ',"bu_name":"' || REPLACE(r.BU_NAME,'"','\"') || '"}';
      DBMS_LOB.APPEND(v_clob, TO_CLOB(v_row));
    END LOOP;
    CLOSE c;
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status := 'SUCCESS'; p_message := 'OK'; p_data := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      IF c%ISOPEN THEN CLOSE c; END IF;
      p_status := 'ERROR'; p_message := SQLERRM; p_data := TO_CLOB('[]');
  END GET_BUS;

END RR_ADMIN_PKG;
/
