-- ============================================================
-- DELETE reerp/gl/categories/:name
-- Deletes a single GL Category by JE_CATEGORY_NAME
-- ============================================================

BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/categories/:name'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/categories/:name',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Delete a GL Category by JE_CATEGORY_NAME',
        p_source         => q'[
DECLARE
    v_name   VARCHAR2(25) := :name;
    v_count  NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM   RR_GL_CATEGORIES
    WHERE  JE_CATEGORY_NAME = v_name;

    IF v_count = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',  'NOT_FOUND');
        APEX_JSON.WRITE('message', 'Category not found: ' || v_name);
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    DELETE FROM RR_GL_CATEGORIES
    WHERE  JE_CATEGORY_NAME = v_name;

    COMMIT;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',          'SUCCESS');
    APEX_JSON.WRITE('jeCategoryName',  v_name);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error',  SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('DELETE gl/categories/:name registered');
END;
/
