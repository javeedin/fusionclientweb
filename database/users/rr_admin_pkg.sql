-- ============================================================
-- RR_ADMIN_PKG  –  Admin Package (SPEC + BODY)
-- Uses RR_GL_BUSINESS_UNITS for the master BU list
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- STEP 1: DDL for supporting tables (run once)
-- ───────────────────────────────────────────────────────────

-- Module master
CREATE TABLE RR_MODULES (
  MODULE_CODE        VARCHAR2(30)  NOT NULL,
  MODULE_NAME        VARCHAR2(100) NOT NULL,
  MODULE_DESCRIPTION VARCHAR2(500),
  IS_ACTIVE          VARCHAR2(1)   DEFAULT 'Y',
  SORT_ORDER         NUMBER        DEFAULT 0,
  CONSTRAINT PK_RR_MODULES PRIMARY KEY (MODULE_CODE)
);

-- Seed modules
INSERT INTO RR_MODULES VALUES ('GL',          'General Ledger',          'Journal entries, COA, periods', 'Y', 1);
INSERT INTO RR_MODULES VALUES ('AP',          'Accounts Payable',         'Invoices, payments, suppliers', 'Y', 2);
INSERT INTO RR_MODULES VALUES ('AR',          'Accounts Receivable',      'Customer invoices, receipts',   'Y', 3);
INSERT INTO RR_MODULES VALUES ('INVENTORY',   'Inventory',                'Stock management',              'Y', 4);
INSERT INTO RR_MODULES VALUES ('PROCUREMENT', 'Procurement',              'POs, suppliers',                'Y', 5);
INSERT INTO RR_MODULES VALUES ('HR',          'Human Resources',          'Employees, payroll',            'Y', 6);
INSERT INTO RR_MODULES VALUES ('PMS',         'Portfolio Management',     'Funds, orders, risk',           'Y', 7);
INSERT INTO RR_MODULES VALUES ('RM',          'Rental Management',        'Properties, agreements',        'Y', 8);
INSERT INTO RR_MODULES VALUES ('PROJECTS',    'Projects',                 'Project tracking',              'Y', 9);
INSERT INTO RR_MODULES VALUES ('MANUFACTURING','Manufacturing',           'Production',                    'Y', 10);
INSERT INTO RR_MODULES VALUES ('REPORTS',     'Reports & Analytics',      'BI reports',                    'Y', 11);
INSERT INTO RR_MODULES VALUES ('SYNC',        'Data Sync',                'ERP data synchronisation',      'Y', 12);
INSERT INTO RR_MODULES VALUES ('ADMIN',       'Administration',           'Users, access, settings',       'Y', 13);
COMMIT;

-- User-module assignments
CREATE TABLE RR_USER_MODULE_ACCESS (
  USERNAME     VARCHAR2(100) NOT NULL,
  MODULE_CODE  VARCHAR2(30)  NOT NULL,
  GRANTED_BY   VARCHAR2(100),
  GRANTED_DATE DATE          DEFAULT SYSDATE,
  CONSTRAINT PK_UMA PRIMARY KEY (USERNAME, MODULE_CODE)
);

-- User-BU assignments  (references RR_GL_BUSINESS_UNITS)
CREATE TABLE RR_USER_BU_ACCESS (
  USERNAME     VARCHAR2(100) NOT NULL,
  BU_ID        NUMBER        NOT NULL,
  BU_NAME      VARCHAR2(360),
  GRANTED_BY   VARCHAR2(100),
  GRANTED_DATE DATE          DEFAULT SYSDATE,
  CONSTRAINT PK_UBA PRIMARY KEY (USERNAME, BU_ID)
);

-- Admin flag on passwords table
ALTER TABLE RR_USER_PASSWORDS ADD IS_ADMIN VARCHAR2(1) DEFAULT 'N';


-- ───────────────────────────────────────────────────────────
-- STEP 2: PACKAGE SPEC  (compile first)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_ADMIN_PKG AS

  -- Users
  PROCEDURE GET_USERS          (p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB);
  PROCEDURE CREATE_USER        (p_username IN VARCHAR2, p_name IN VARCHAR2,
                                p_email IN VARCHAR2, p_password IN VARCHAR2,
                                p_is_admin IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);
  PROCEDURE UPDATE_USER        (p_username IN VARCHAR2, p_name IN VARCHAR2,
                                p_email IN VARCHAR2, p_is_admin IN VARCHAR2,
                                p_suspended IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);
  PROCEDURE ADMIN_RESET_PASSWORD(p_username IN VARCHAR2, p_new_password IN VARCHAR2,
                                 p_admin_user IN VARCHAR2,
                                 p_status OUT VARCHAR2, p_message OUT VARCHAR2);

  -- Own password change (no OTP)
  PROCEDURE CHANGE_OWN_PASSWORD(p_username IN VARCHAR2, p_current_password IN VARCHAR2,
                                p_new_password IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);

  -- Module access
  PROCEDURE ASSIGN_MODULE      (p_username IN VARCHAR2, p_module_code IN VARCHAR2,
                                p_granted_by IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);
  PROCEDURE REMOVE_MODULE      (p_username IN VARCHAR2, p_module_code IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);

  -- BU access
  PROCEDURE ASSIGN_BU          (p_username IN VARCHAR2, p_bu_id IN NUMBER,
                                p_granted_by IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);
  PROCEDURE REMOVE_BU          (p_username IN VARCHAR2, p_bu_id IN NUMBER,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2);

  -- Lookup lists
  PROCEDURE GET_USER_ACCESS    (p_username IN VARCHAR2,
                                p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB);
  PROCEDURE GET_MODULES        (p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB);
  PROCEDURE GET_BUS            (p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB);

END RR_ADMIN_PKG;
/


-- ───────────────────────────────────────────────────────────
-- STEP 3: PACKAGE BODY  (compile after spec)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE BODY RR_ADMIN_PKG AS

  -- ── internal hash (same algorithm as RR_AUTH_PKG) ─────────
  FUNCTION HASH_PASSWORD(p_password IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(DBMS_UTILITY.GET_HASH_VALUE(p_password, 1000000000, 1073741824));
  END HASH_PASSWORD;

  -- ── GET_USERS ──────────────────────────────────────────────
  PROCEDURE GET_USERS(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob CLOB;
    v_first BOOLEAN := TRUE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));

    FOR r IN (
      SELECT a.USERNAME,
             a.USER_ID,
             a.PERSON_NUMBER,
             NVL(a.SUSPENDED_FLAG, 'N')               AS SUSPENDED_FLAG,
             NVL(p.IS_ADMIN, 'N')                     AS IS_ADMIN,
             TO_CHAR(a.CREATION_DATE, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_DATE
        FROM RR_USER_ACCOUNTS a
        LEFT JOIN RR_USER_PASSWORDS p ON p.USERNAME = a.USERNAME
       ORDER BY a.USERNAME
    ) LOOP
      IF NOT v_first THEN
        DBMS_LOB.APPEND(v_clob, TO_CLOB(','));
      END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_clob,
        TO_CLOB('{"username":"'     || REPLACE(r.USERNAME, '"','\"') || '",'
             || '"user_id":'        || NVL(TO_CHAR(r.USER_ID), 'null') || ','
             || '"person_number":"' || NVL(REPLACE(r.PERSON_NUMBER,'"','\"'),'') || '",'
             || '"suspended_flag":"'|| r.SUSPENDED_FLAG || '",'
             || '"is_admin":"'      || r.IS_ADMIN || '",'
             || '"created_date":"'  || r.CREATED_DATE || '"}')
      );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status  := 'SUCCESS';
    p_message := 'OK';
    p_data    := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      p_status  := 'ERROR';
      p_message := SQLERRM;
      p_data    := TO_CLOB('[]');
  END GET_USERS;

  -- ── CREATE_USER ────────────────────────────────────────────
  PROCEDURE CREATE_USER(
    p_username  IN VARCHAR2, p_name IN VARCHAR2,
    p_email     IN VARCHAR2, p_password IN VARCHAR2,
    p_is_admin  IN VARCHAR2,
    p_status   OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_count     NUMBER;
    v_hash      VARCHAR2(200);
  BEGIN
    SELECT COUNT(*) INTO v_count FROM RR_USER_ACCOUNTS WHERE USERNAME = UPPER(p_username);
    IF v_count > 0 THEN
      p_status  := 'ERROR';
      p_message := 'Username already exists.';
      RETURN;
    END IF;

    v_hash := HASH_PASSWORD(p_password);

    INSERT INTO RR_USER_ACCOUNTS (USERNAME)
    VALUES (UPPER(p_username));

    INSERT INTO RR_USER_PASSWORDS (USERNAME, PASSWORD_HASH, IS_ADMIN)
    VALUES (UPPER(p_username), v_hash, NVL(p_is_admin,'N'));

    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'User created successfully.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END CREATE_USER;

  -- ── UPDATE_USER ────────────────────────────────────────────
  PROCEDURE UPDATE_USER(
    p_username  IN VARCHAR2, p_name IN VARCHAR2,
    p_email     IN VARCHAR2, p_is_admin IN VARCHAR2,
    p_suspended IN VARCHAR2,
    p_status   OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    UPDATE RR_USER_ACCOUNTS
       SET SUSPENDED_FLAG = NVL(p_suspended, 'N')
     WHERE USERNAME       = UPPER(p_username);

    UPDATE RR_USER_PASSWORDS
       SET IS_ADMIN = NVL(p_is_admin, 'N')
     WHERE USERNAME = UPPER(p_username);

    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'User updated successfully.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END UPDATE_USER;

  -- ── ADMIN_RESET_PASSWORD ───────────────────────────────────
  PROCEDURE ADMIN_RESET_PASSWORD(
    p_username     IN VARCHAR2, p_new_password IN VARCHAR2,
    p_admin_user   IN VARCHAR2,
    p_status      OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_acct_count NUMBER;
    v_hash       VARCHAR2(200);
  BEGIN
    -- Verify the user account exists
    SELECT COUNT(*) INTO v_acct_count
      FROM RR_USER_ACCOUNTS WHERE USERNAME = UPPER(p_username);

    IF v_acct_count = 0 THEN
      p_status  := 'ERROR';
      p_message := 'User not found.';
      RETURN;
    END IF;

    v_hash := HASH_PASSWORD(p_new_password);

    -- Upsert: update if password row exists, insert if not
    UPDATE RR_USER_PASSWORDS
       SET PASSWORD_HASH = v_hash
     WHERE USERNAME = UPPER(p_username);

    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO RR_USER_PASSWORDS (USERNAME, PASSWORD_HASH, IS_ADMIN)
      VALUES (UPPER(p_username), v_hash, 'N');
    END IF;

    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Password reset successfully.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END ADMIN_RESET_PASSWORD;

  -- ── CHANGE_OWN_PASSWORD ────────────────────────────────────
  PROCEDURE CHANGE_OWN_PASSWORD(
    p_username         IN VARCHAR2, p_current_password IN VARCHAR2,
    p_new_password     IN VARCHAR2,
    p_status          OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_count      NUMBER;
    v_curr_hash  VARCHAR2(200);
    v_new_hash   VARCHAR2(200);
  BEGIN
    v_curr_hash := HASH_PASSWORD(p_current_password);
    v_new_hash  := HASH_PASSWORD(p_new_password);

    SELECT COUNT(*) INTO v_count
      FROM RR_USER_PASSWORDS
     WHERE USERNAME      = UPPER(p_username)
       AND PASSWORD_HASH = v_curr_hash;

    IF v_count = 0 THEN
      p_status  := 'ERROR';
      p_message := 'Current password is incorrect.';
      RETURN;
    END IF;

    UPDATE RR_USER_PASSWORDS
       SET PASSWORD_HASH = v_new_hash
     WHERE USERNAME = UPPER(p_username);

    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Password changed successfully.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END CHANGE_OWN_PASSWORD;

  -- ── ASSIGN_MODULE ──────────────────────────────────────────
  PROCEDURE ASSIGN_MODULE(
    p_username    IN VARCHAR2, p_module_code IN VARCHAR2,
    p_granted_by  IN VARCHAR2,
    p_status     OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    INSERT INTO RR_USER_MODULE_ACCESS (USERNAME, MODULE_CODE, GRANTED_BY, GRANTED_DATE)
    VALUES (UPPER(p_username), UPPER(p_module_code), p_granted_by, SYSDATE);
    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Module assigned.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      p_status  := 'SUCCESS';
      p_message := 'Already assigned.';
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END ASSIGN_MODULE;

  -- ── REMOVE_MODULE ──────────────────────────────────────────
  PROCEDURE REMOVE_MODULE(
    p_username    IN VARCHAR2, p_module_code IN VARCHAR2,
    p_status     OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    DELETE FROM RR_USER_MODULE_ACCESS
     WHERE USERNAME    = UPPER(p_username)
       AND MODULE_CODE = UPPER(p_module_code);
    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Module removed.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END REMOVE_MODULE;

  -- ── ASSIGN_BU ──────────────────────────────────────────────
  -- Looks up BU_NAME from RR_GL_BUSINESS_UNITS
  PROCEDURE ASSIGN_BU(
    p_username    IN VARCHAR2, p_bu_id IN NUMBER,
    p_granted_by  IN VARCHAR2,
    p_status     OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
    v_bu_name RR_GL_BUSINESS_UNITS.BUSINESS_UNIT_NAME%TYPE;
  BEGIN
    BEGIN
      SELECT BUSINESS_UNIT_NAME
        INTO v_bu_name
        FROM RR_GL_BUSINESS_UNITS
       WHERE BUSINESS_UNIT_ID = p_bu_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status  := 'ERROR';
        p_message := 'Business unit not found.';
        RETURN;
    END;

    INSERT INTO RR_USER_BU_ACCESS (USERNAME, BU_ID, BU_NAME, GRANTED_BY, GRANTED_DATE)
    VALUES (UPPER(p_username), p_bu_id, v_bu_name, p_granted_by, SYSDATE);
    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Business unit assigned.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      p_status  := 'SUCCESS';
      p_message := 'Already assigned.';
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END ASSIGN_BU;

  -- ── REMOVE_BU ──────────────────────────────────────────────
  PROCEDURE REMOVE_BU(
    p_username    IN VARCHAR2, p_bu_id IN NUMBER,
    p_status     OUT VARCHAR2, p_message OUT VARCHAR2
  ) IS
  BEGIN
    DELETE FROM RR_USER_BU_ACCESS
     WHERE USERNAME = UPPER(p_username)
       AND BU_ID    = p_bu_id;
    COMMIT;
    p_status  := 'SUCCESS';
    p_message := 'Business unit removed.';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status  := 'ERROR';
      p_message := SQLERRM;
  END REMOVE_BU;

  -- ── GET_USER_ACCESS ────────────────────────────────────────
  PROCEDURE GET_USER_ACCESS(
    p_username  IN VARCHAR2,
    p_status   OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB
  ) IS
    v_is_admin   VARCHAR2(1);
    v_modules    CLOB;
    v_bus        CLOB;
    v_first      BOOLEAN;
  BEGIN
    -- Admin flag
    BEGIN
      SELECT NVL(IS_ADMIN,'N') INTO v_is_admin
        FROM RR_USER_PASSWORDS WHERE USERNAME = UPPER(p_username);
    EXCEPTION WHEN NO_DATA_FOUND THEN v_is_admin := 'N'; END;

    -- Modules array
    DBMS_LOB.CREATETEMPORARY(v_modules, TRUE);
    DBMS_LOB.APPEND(v_modules, TO_CLOB('['));
    v_first := TRUE;
    FOR r IN (SELECT MODULE_CODE FROM RR_USER_MODULE_ACCESS
               WHERE USERNAME = UPPER(p_username) ORDER BY MODULE_CODE) LOOP
      IF NOT v_first THEN DBMS_LOB.APPEND(v_modules, TO_CLOB(',')); END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_modules, TO_CLOB('"' || r.MODULE_CODE || '"'));
    END LOOP;
    DBMS_LOB.APPEND(v_modules, TO_CLOB(']'));

    -- BUs array
    DBMS_LOB.CREATETEMPORARY(v_bus, TRUE);
    DBMS_LOB.APPEND(v_bus, TO_CLOB('['));
    v_first := TRUE;
    FOR r IN (SELECT BU_ID, BU_NAME FROM RR_USER_BU_ACCESS
               WHERE USERNAME = UPPER(p_username) ORDER BY BU_ID) LOOP
      IF NOT v_first THEN DBMS_LOB.APPEND(v_bus, TO_CLOB(',')); END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_bus,
        TO_CLOB('{"id":' || r.BU_ID || ',"name":"' || REPLACE(r.BU_NAME,'"','\"') || '"}'));
    END LOOP;
    DBMS_LOB.APPEND(v_bus, TO_CLOB(']'));

    -- Assemble
    DBMS_LOB.CREATETEMPORARY(p_data, TRUE);
    DBMS_LOB.APPEND(p_data, TO_CLOB('{"is_admin":"' || v_is_admin || '","modules":'));
    DBMS_LOB.APPEND(p_data, v_modules);
    DBMS_LOB.APPEND(p_data, TO_CLOB(',"bus":'));
    DBMS_LOB.APPEND(p_data, v_bus);
    DBMS_LOB.APPEND(p_data, TO_CLOB('}'));

    p_status  := 'SUCCESS';
    p_message := 'OK';
  EXCEPTION
    WHEN OTHERS THEN
      p_status  := 'ERROR';
      p_message := SQLERRM;
      p_data    := TO_CLOB('{}');
  END GET_USER_ACCESS;

  -- ── GET_MODULES ────────────────────────────────────────────
  PROCEDURE GET_MODULES(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob CLOB;
    v_first BOOLEAN := TRUE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));
    FOR r IN (SELECT MODULE_CODE, MODULE_NAME FROM RR_MODULES
               WHERE IS_ACTIVE = 'Y' ORDER BY SORT_ORDER) LOOP
      IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_clob,
        TO_CLOB('{"module_code":"' || r.MODULE_CODE || '",'
             || '"module_name":"'  || REPLACE(r.MODULE_NAME,'"','\"') || '"}'));
    END LOOP;
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status  := 'SUCCESS';
    p_message := 'OK';
    p_data    := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      p_status  := 'ERROR';
      p_message := SQLERRM;
      p_data    := TO_CLOB('[]');
  END GET_MODULES;

  -- ── GET_BUS ────────────────────────────────────────────────
  -- Reads from RR_GL_BUSINESS_UNITS (BUSINESS_UNIT_ID / BUSINESS_UNIT_NAME)
  PROCEDURE GET_BUS(p_status OUT VARCHAR2, p_message OUT VARCHAR2, p_data OUT CLOB) IS
    v_clob CLOB;
    v_first BOOLEAN := TRUE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('['));
    FOR r IN (
      SELECT BUSINESS_UNIT_ID AS BU_ID,
             BUSINESS_UNIT_NAME AS BU_NAME
        FROM RR_GL_BUSINESS_UNITS
       WHERE NVL(ACTIVE_FLAG,'Y') = 'Y'
       ORDER BY BUSINESS_UNIT_NAME
    ) LOOP
      IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
      v_first := FALSE;
      DBMS_LOB.APPEND(v_clob,
        TO_CLOB('{"bu_id":'    || r.BU_ID  || ','
             || '"bu_name":"'  || REPLACE(r.BU_NAME,'"','\"') || '"}'));
    END LOOP;
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']'));
    p_status  := 'SUCCESS';
    p_message := 'OK';
    p_data    := v_clob;
  EXCEPTION
    WHEN OTHERS THEN
      p_status  := 'ERROR';
      p_message := SQLERRM;
      p_data    := TO_CLOB('[]');
  END GET_BUS;

END RR_ADMIN_PKG;
/


-- ───────────────────────────────────────────────────────────
-- STEP 4: APEX REST handlers  (run in ORDS / REST workshop)
-- Module: reerp   Base path: /reerp/
-- ───────────────────────────────────────────────────────────

/*
  Create REST module "reerp" if it doesn't exist, then add these templates:

  ── GET  /admin/users  ─────────────────────────────────────
  DECLARE
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
    v_data    CLOB;
  BEGIN
    RR_ADMIN_PKG.GET_USERS(v_status, v_message, v_data);
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.WRITE_RAW('data', v_data);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── POST /admin/users  ─────────────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.CREATE_USER(
      p_username  => APEX_JSON.GET_VARCHAR2('username'),
      p_name      => APEX_JSON.GET_VARCHAR2('name'),
      p_email     => APEX_JSON.GET_VARCHAR2('email'),
      p_password  => APEX_JSON.GET_VARCHAR2('password'),
      p_is_admin  => NVL(APEX_JSON.GET_VARCHAR2('is_admin'),'N'),
      p_status    => v_status,
      p_message   => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── PUT /admin/users  ──────────────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.UPDATE_USER(
      p_username  => APEX_JSON.GET_VARCHAR2('username'),
      p_name      => APEX_JSON.GET_VARCHAR2('name'),
      p_email     => APEX_JSON.GET_VARCHAR2('email'),
      p_is_admin  => NVL(APEX_JSON.GET_VARCHAR2('is_admin'),'N'),
      p_suspended => NVL(APEX_JSON.GET_VARCHAR2('suspended'),'N'),
      p_status    => v_status,
      p_message   => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── POST /admin/reset-password  ────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.ADMIN_RESET_PASSWORD(
      p_username     => APEX_JSON.GET_VARCHAR2('username'),
      p_new_password => APEX_JSON.GET_VARCHAR2('new_password'),
      p_admin_user   => NVL(APEX_JSON.GET_VARCHAR2('admin_user'),'ADMIN'),
      p_status       => v_status,
      p_message      => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── POST /auth/change-password  ────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.CHANGE_OWN_PASSWORD(
      p_username         => APEX_JSON.GET_VARCHAR2('username'),
      p_current_password => APEX_JSON.GET_VARCHAR2('current_password'),
      p_new_password     => APEX_JSON.GET_VARCHAR2('new_password'),
      p_status           => v_status,
      p_message          => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── POST /admin/assign-module  ─────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.ASSIGN_MODULE(
      p_username    => APEX_JSON.GET_VARCHAR2('username'),
      p_module_code => APEX_JSON.GET_VARCHAR2('module_code'),
      p_granted_by  => NVL(APEX_JSON.GET_VARCHAR2('granted_by'),'ADMIN'),
      p_status      => v_status,
      p_message     => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── DELETE /admin/remove-module  ───────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.REMOVE_MODULE(
      p_username    => APEX_JSON.GET_VARCHAR2('username'),
      p_module_code => APEX_JSON.GET_VARCHAR2('module_code'),
      p_status      => v_status,
      p_message     => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── POST /admin/assign-bu  ─────────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.ASSIGN_BU(
      p_username   => APEX_JSON.GET_VARCHAR2('username'),
      p_bu_id      => TO_NUMBER(APEX_JSON.GET_VARCHAR2('bu_id')),
      p_granted_by => NVL(APEX_JSON.GET_VARCHAR2('granted_by'),'ADMIN'),
      p_status     => v_status,
      p_message    => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── DELETE /admin/remove-bu  ───────────────────────────────
  DECLARE
    v_body    VARCHAR2(32767) := :body_text;
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
  BEGIN
    APEX_JSON.PARSE(v_body);
    RR_ADMIN_PKG.REMOVE_BU(
      p_username => APEX_JSON.GET_VARCHAR2('username'),
      p_bu_id    => TO_NUMBER(APEX_JSON.GET_VARCHAR2('bu_id')),
      p_status   => v_status,
      p_message  => v_message
    );
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── GET /admin/user-access/:username  ──────────────────────
  DECLARE
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
    v_data    CLOB;
  BEGIN
    RR_ADMIN_PKG.GET_USER_ACCESS(:username, v_status, v_message, v_data);
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.WRITE_RAW('data', v_data);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── GET /admin/modules  ────────────────────────────────────
  DECLARE
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
    v_data    CLOB;
  BEGIN
    RR_ADMIN_PKG.GET_MODULES(v_status, v_message, v_data);
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.WRITE_RAW('data', v_data);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;

  ── GET /admin/bus  ────────────────────────────────────────
  DECLARE
    v_status  VARCHAR2(20);
    v_message VARCHAR2(500);
    v_data    CLOB;
  BEGIN
    RR_ADMIN_PKG.GET_BUS(v_status, v_message, v_data);
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  v_status);
    APEX_JSON.WRITE('message', v_message);
    APEX_JSON.WRITE_RAW('data', v_data);
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;
  END;
*/
