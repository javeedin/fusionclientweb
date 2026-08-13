-- =============================================================================
-- PATCH pc/13: Register DELETE /pc/attachments/:attachmentId
--
-- PROBLEM:
--   ORDS returns "method not found" for DELETE /pc/attachments/:attachmentId.
--   The handler was defined in 07_pc_attachments.sql but was not applied to
--   the live database.
--
-- FIX:
--   Re-register only the DELETE handler (idempotent — drops first if exists).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the single block below.
-- =============================================================================

BEGIN
    -- Drop existing DELETE handler if present (idempotent)
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'pc',
            p_pattern     => 'attachments/:attachmentId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Ensure the template exists
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'pc',
            p_pattern     => 'attachments/:attachmentId'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Register DELETE handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pc',
        p_pattern        => 'attachments/:attachmentId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    l_rows NUMBER;
    l_err  VARCHAR2(4000);
BEGIN
    RR_PC_ATTACH_PKG.delete_attachment(
        p_attachment_id => :attachmentId,
        p_rows          => l_rows,
        p_error         => l_err
    );
    IF l_err IS NOT NULL THEN
        :status_code := 500;
        HTP.PRN('{"success":false,"message":' || APEX_JSON.STRINGIFY(l_err) || '}');
    ELSIF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"message":"Attachment not found"}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"success":true,"message":"Attachment deleted"}');
    END IF;
END;
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('DELETE /pc/attachments/:attachmentId registered.');
END;
/
