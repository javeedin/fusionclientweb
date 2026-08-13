-- ============================================================
-- Distribution Combinations — PL/SQL Package
-- File: database/ap/rr_dist_combinations_pkg.sql
-- Run order: 2nd
-- ============================================================

CREATE OR REPLACE PACKAGE RR_DIST_PKG AS
    PROCEDURE create_combination (p_body IN CLOB);
    PROCEDURE update_combination (p_id   IN NUMBER, p_body IN CLOB);
    PROCEDURE delete_combination (p_id   IN NUMBER);
END RR_DIST_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_DIST_PKG AS

    -- ────────────────────────────────────────────────────────
    -- create_combination
    -- ────────────────────────────────────────────────────────
    PROCEDURE create_combination (p_body IN CLOB) IS
        l_name    VARCHAR2(300);
        l_bu      VARCHAR2(240);
        l_ccid    NUMBER;
        l_desc    VARCHAR2(400);
        l_module  VARCHAR2(50);
        l_descr   VARCHAR2(1000);
        l_status  VARCHAR2(20);
        l_user    VARCHAR2(150);
        l_new_id  NUMBER;
    BEGIN
        APEX_JSON.PARSE(p_body);

        l_name   := APEX_JSON.GET_VARCHAR2(p_path => 'combinationName');
        l_bu     := APEX_JSON.GET_VARCHAR2(p_path => 'businessUnit');
        l_ccid   := APEX_JSON.GET_NUMBER(p_path  => 'glAccountCcid');
        l_desc   := APEX_JSON.GET_VARCHAR2(p_path => 'glAccountDesc');
        l_module := APEX_JSON.GET_VARCHAR2(p_path => 'module');
        l_descr  := APEX_JSON.GET_VARCHAR2(p_path => 'description');
        l_status := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'status'), 'ACTIVE');
        l_user   := APEX_JSON.GET_VARCHAR2(p_path => 'createdBy');

        IF l_name IS NULL THEN
            RAISE_APPLICATION_ERROR(-20101, 'combinationName is required');
        END IF;
        IF l_module IS NULL THEN
            RAISE_APPLICATION_ERROR(-20102, 'module is required');
        END IF;
        IF l_module NOT IN ('AP','PC','GL','FA','AR','CASH','ALL','GL Revaluation') THEN
            RAISE_APPLICATION_ERROR(-20103, 'module must be one of AP, PC, GL, FA, AR, CASH, ALL, GL Revaluation');
        END IF;

        INSERT INTO RR_DIST_COMBINATIONS (
            COMBINATION_NAME, BUSINESS_UNIT, GL_ACCOUNT_CCID, GL_ACCOUNT_DESC,
            MODULE, DESCRIPTION, STATUS,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
        ) VALUES (
            l_name, l_bu, l_ccid, l_desc,
            l_module, l_descr, l_status,
            l_user, SYSTIMESTAMP, l_user, SYSTIMESTAMP
        ) RETURNING COMBINATION_ID INTO l_new_id;

        COMMIT;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',       TRUE);
        APEX_JSON.WRITE('combinationId', l_new_id);
        APEX_JSON.CLOSE_OBJECT;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('success', FALSE);
            APEX_JSON.WRITE('message', SQLERRM);
            APEX_JSON.CLOSE_OBJECT;
    END create_combination;

    -- ────────────────────────────────────────────────────────
    -- update_combination
    -- ────────────────────────────────────────────────────────
    PROCEDURE update_combination (p_id IN NUMBER, p_body IN CLOB) IS
        l_name    VARCHAR2(300);
        l_bu      VARCHAR2(240);
        l_ccid    NUMBER;
        l_desc    VARCHAR2(400);
        l_module  VARCHAR2(50);
        l_descr   VARCHAR2(1000);
        l_status  VARCHAR2(20);
        l_user    VARCHAR2(150);
    BEGIN
        APEX_JSON.PARSE(p_body);

        l_name   := APEX_JSON.GET_VARCHAR2(p_path => 'combinationName');
        l_bu     := APEX_JSON.GET_VARCHAR2(p_path => 'businessUnit');
        l_ccid   := APEX_JSON.GET_NUMBER(p_path  => 'glAccountCcid');
        l_desc   := APEX_JSON.GET_VARCHAR2(p_path => 'glAccountDesc');
        l_module := APEX_JSON.GET_VARCHAR2(p_path => 'module');
        l_descr  := APEX_JSON.GET_VARCHAR2(p_path => 'description');
        l_status := APEX_JSON.GET_VARCHAR2(p_path => 'status');
        l_user   := APEX_JSON.GET_VARCHAR2(p_path => 'updatedBy');

        UPDATE RR_DIST_COMBINATIONS
        SET
            COMBINATION_NAME  = NVL(l_name,   COMBINATION_NAME),
            BUSINESS_UNIT     = NVL(l_bu,     BUSINESS_UNIT),
            GL_ACCOUNT_CCID   = NVL(l_ccid,   GL_ACCOUNT_CCID),
            GL_ACCOUNT_DESC   = NVL(l_desc,   GL_ACCOUNT_DESC),
            MODULE            = NVL(l_module, MODULE),
            DESCRIPTION       = NVL(l_descr,  DESCRIPTION),
            STATUS            = NVL(l_status, STATUS),
            LAST_UPDATED_BY   = l_user,
            LAST_UPDATE_DATE  = SYSTIMESTAMP
        WHERE COMBINATION_ID = p_id;

        IF SQL%ROWCOUNT = 0 THEN
            RAISE_APPLICATION_ERROR(-20104, 'Combination not found: ' || p_id);
        END IF;

        COMMIT;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.CLOSE_OBJECT;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('success', FALSE);
            APEX_JSON.WRITE('message', SQLERRM);
            APEX_JSON.CLOSE_OBJECT;
    END update_combination;

    -- ────────────────────────────────────────────────────────
    -- delete_combination
    -- ────────────────────────────────────────────────────────
    PROCEDURE delete_combination (p_id IN NUMBER) IS
    BEGIN
        DELETE FROM RR_DIST_COMBINATIONS WHERE COMBINATION_ID = p_id;

        IF SQL%ROWCOUNT = 0 THEN
            RAISE_APPLICATION_ERROR(-20105, 'Combination not found: ' || p_id);
        END IF;

        COMMIT;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.CLOSE_OBJECT;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('success', FALSE);
            APEX_JSON.WRITE('message', SQLERRM);
            APEX_JSON.CLOSE_OBJECT;
    END delete_combination;

END RR_DIST_PKG;
/
