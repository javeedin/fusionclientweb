-- ============================================================
-- GL Categories ORDS Handlers + Package
--
-- Module: reerp
-- Endpoints:
--   GET  reerp/gl/categories          → list all categories
--   POST reerp/gl/categories/sync     → bulk upsert from Oracle Fusion
-- ============================================================


-- ── 1. Package Spec ──────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_GL_CATEGORIES_PKG AS

    PROCEDURE upsert_categories(
        p_body      IN  CLOB,
        p_inserted  OUT NUMBER,
        p_errors    OUT NUMBER,
        p_message   OUT VARCHAR2
    );

END RR_GL_CATEGORIES_PKG;
/


-- ── 2. Package Body ──────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE BODY RR_GL_CATEGORIES_PKG AS

    PROCEDURE upsert_categories(
        p_body      IN  CLOB,
        p_inserted  OUT NUMBER,
        p_errors    OUT NUMBER,
        p_message   OUT VARCHAR2
    ) IS
    BEGIN
        p_inserted := 0;
        p_errors   := 0;
        p_message  := NULL;

        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_body, '$.items[*]' COLUMNS (
                JE_CATEGORY_NAME      VARCHAR2(25)  PATH '$.JeCategoryName',
                USER_JE_CATEGORY_NAME VARCHAR2(80)  PATH '$.UserJeCategoryName',
                DESCRIPTION           VARCHAR2(240) PATH '$.Description',
                DISALLOW_MJE_FLAG     VARCHAR2(1)   PATH '$.DisallowMjeFlag'
            )) jt
            WHERE jt.JE_CATEGORY_NAME IS NOT NULL
        ) LOOP
            BEGIN
                MERGE INTO RR_GL_CATEGORIES t
                USING DUAL
                ON (t.JE_CATEGORY_NAME = rec.JE_CATEGORY_NAME)
                WHEN MATCHED THEN UPDATE SET
                    t.USER_JE_CATEGORY_NAME = rec.USER_JE_CATEGORY_NAME,
                    t.DESCRIPTION           = rec.DESCRIPTION,
                    t.DISALLOW_MJE_FLAG     = rec.DISALLOW_MJE_FLAG,
                    t.LAST_SYNC_DATE        = SYSTIMESTAMP,
                    t.SYNC_COUNT            = NVL(t.SYNC_COUNT, 0) + 1
                WHEN NOT MATCHED THEN INSERT (
                    JE_CATEGORY_NAME, USER_JE_CATEGORY_NAME,
                    DESCRIPTION, DISALLOW_MJE_FLAG
                ) VALUES (
                    rec.JE_CATEGORY_NAME, rec.USER_JE_CATEGORY_NAME,
                    rec.DESCRIPTION, rec.DISALLOW_MJE_FLAG
                );
                p_inserted := p_inserted + 1;
            EXCEPTION
                WHEN OTHERS THEN
                    p_errors := p_errors + 1;
                    p_message := SQLERRM;
            END;
        END LOOP;

        COMMIT;
    END upsert_categories;

END RR_GL_CATEGORIES_PKG;
/


-- ── 3. ORDS Template: gl/categories ─────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/categories'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/


-- ── 4. GET reerp/gl/categories ───────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/categories',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Return all GL Categories from RR_GL_CATEGORIES',
        p_source         => q'[
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM RR_GL_CATEGORIES;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('totalCount', v_count);
    APEX_JSON.OPEN_ARRAY('items');

    FOR rec IN (
        SELECT JE_CATEGORY_NAME,
               USER_JE_CATEGORY_NAME,
               DESCRIPTION,
               DISALLOW_MJE_FLAG,
               LAST_SYNC_DATE
        FROM   RR_GL_CATEGORIES
        ORDER  BY USER_JE_CATEGORY_NAME
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('jeCategoryName',     rec.JE_CATEGORY_NAME);
        APEX_JSON.WRITE('userJeCategoryName', rec.USER_JE_CATEGORY_NAME);
        APEX_JSON.WRITE('description',        rec.DESCRIPTION);
        APEX_JSON.WRITE('disallowMjeFlag',    rec.DISALLOW_MJE_FLAG);
        APEX_JSON.WRITE('lastSyncDate',       TO_CHAR(rec.LAST_SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS'));
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ── 5. ORDS Template: gl/categories/sync ─────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/categories/sync'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/


-- ── 6. POST reerp/gl/categories/sync ─────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/categories/sync',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Bulk upsert GL Categories into RR_GL_CATEGORIES',
        p_source         => q'[
DECLARE
    v_body     CLOB;
    v_inserted NUMBER := 0;
    v_errors   NUMBER := 0;
    v_message  VARCHAR2(4000);
BEGIN
    v_body := :body_text;

    RR_GL_CATEGORIES_PKG.upsert_categories(
        p_body     => v_body,
        p_inserted => v_inserted,
        p_errors   => v_errors,
        p_message  => v_message
    );

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',   'SUCCESS');
    APEX_JSON.WRITE('inserted', v_inserted);
    APEX_JSON.WRITE('errors',   v_errors);
    IF v_message IS NOT NULL THEN
        APEX_JSON.WRITE('lastError', v_message);
    END IF;
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error',  SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GL Categories handlers registered successfully');
END;
/
