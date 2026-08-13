-- ============================================================
-- PATCH 123: (Re)deploy DELETE gl/revaluation/:id handler
--
-- Problem:
--   The Manage FX Revaluation page's Delete button calls
--     DELETE {baseUrl}/gl/revaluation/:id
--   and receives an HTML error page ("<!DOCTYPE ...") instead of JSON,
--   which the UI reports as: Unexpected token '<' ... is not valid JSON.
--   That happens when ORDS has no DELETE handler registered for the route
--   (404/405 -> HTML error page). The handler exists in patch 42 but is not
--   present on this database (section never ran, or was dropped).
--
-- Fix:
--   Register the DELETE handler for gl/revaluation/:id. Idempotent — drops any
--   existing DELETE handler first, then redefines it.
--
-- HOW TO RUN:
--   APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/revaluation/:id',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Delete FX Revaluation header (cascades to CCY rows and lines)',
        p_source         => q'[
DECLARE
    v_id     NUMBER := TO_NUMBER(:id);
    v_rows   NUMBER;
    v_status VARCHAR2(30);
BEGIN
    -- Block deletion of an already-accounted revaluation.
    BEGIN
        SELECT STATUS INTO v_status FROM RR_REVALUE_HEADER WHERE REVALUE_ID = v_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN v_status := NULL;
    END;

    IF v_status = 'ACCOUNTED' THEN
        :status_code := 409;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error', 'Cannot delete an accounted revaluation. Reverse/unaccount it first.');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    -- RR_REVALUE_CCY and RR_REVALUE_LINES have ON DELETE CASCADE FKs to the
    -- header, so deleting the header removes their rows automatically.
    DELETE FROM RR_REVALUE_HEADER WHERE REVALUE_ID = v_id;
    v_rows := SQL%ROWCOUNT;
    COMMIT;

    IF v_rows = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error', 'Revaluation not found');
        APEX_JSON.CLOSE_OBJECT;
    ELSE
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',    'SUCCESS');
        APEX_JSON.WRITE('revalueId', v_id);
        APEX_JSON.CLOSE_OBJECT;
    END IF;
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
    DBMS_OUTPUT.PUT_LINE('DELETE /gl/revaluation/:id (re)deployed (patch 123).');
END;
/
