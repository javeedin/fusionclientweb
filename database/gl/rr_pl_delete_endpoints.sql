-- =============================================================================
-- P&L template deletes over POST (Income Statement Templates bin icons)
--   POST {base}/pl/group/:group_id/delete        group + its sections + their accounts
--   POST {base}/pl/section/:section_id/delete    section + its accounts
--   POST {base}/pl/total/:total_id/delete        calculated total
--   POST {base}/pl/template/:template_id/delete  template
-- Soft deletes (IS_ACTIVE = 'N'), like the original DELETE handlers.
--
-- Why: on this database DELETE {base}/pl/group/:id returns ORDS' HTML error page
-- (endpoint/method not available there), so the app got
-- "Unexpected token '<' ... is not valid JSON". The app now tries DELETE first
-- and then these POST endpoints.
--
-- Created in the ORDS module serving {base}/pl/… ; the block prints module + paths.
-- Run in bcldifc (SQL Developer, F5).
-- =============================================================================
SET SERVEROUTPUT ON
DECLARE
    v_mod    VARCHAR2(255);
    v_prefix VARCHAR2(255);
    v_pre    VARCHAR2(10);   -- '' when the module prefix already ends in /pl/, else 'pl/'

    PROCEDURE def(p_pattern VARCHAR2, p_comment VARCHAR2, p_source CLOB) IS
    BEGIN
        BEGIN ORDS.DELETE_TEMPLATE(p_module_name => v_mod, p_pattern => v_pre || p_pattern);
        EXCEPTION WHEN OTHERS THEN NULL; END;
        ORDS.DEFINE_TEMPLATE(p_module_name => v_mod, p_pattern => v_pre || p_pattern, p_comments => p_comment);
        ORDS.DEFINE_HANDLER(
            p_module_name   => v_mod,
            p_pattern       => v_pre || p_pattern,
            p_method        => 'POST',
            p_source_type   => 'plsql/block',
            p_mimes_allowed => NULL,
            p_comments      => p_comment,
            p_source        => p_source);
        DBMS_OUTPUT.PUT_LINE('Created: POST ' || v_prefix || v_pre || p_pattern);
    END;
BEGIN
    BEGIN
        SELECT m.name, m.uri_prefix INTO v_mod, v_prefix
        FROM   user_ords_modules m
        WHERE  RTRIM(LOWER(m.uri_prefix), '/') LIKE '%/pl' OR LOWER(m.uri_prefix) = 'pl/'
        ORDER  BY CASE WHEN LOWER(m.uri_prefix) LIKE '%reerp/pl/' THEN 0 ELSE 1 END,
                  CASE WHEN m.name = 'pl' THEN 0 ELSE 1 END
        FETCH FIRST 1 ROW ONLY;
        v_pre := '';
    EXCEPTION WHEN NO_DATA_FOUND THEN
        SELECT m.name, m.uri_prefix INTO v_mod, v_prefix
        FROM   user_ords_modules m
        JOIN   user_ords_templates t ON t.module_id = m.id
        WHERE  t.uri_template LIKE 'pl/%'
        FETCH FIRST 1 ROW ONLY;
        v_pre := 'pl/';
    END;
    DBMS_OUTPUT.PUT_LINE('Module: ' || v_mod || '   base path: ' || v_prefix);

    def('group/:group_id/delete', 'Soft-delete a P&L group with its sections and accounts', q'~
DECLARE
    l_rows NUMBER;
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    UPDATE rr_pl_groups SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE  group_id = :group_id AND NVL(is_active, 'Y') = 'Y';
    l_rows := SQL%ROWCOUNT;
    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Group not found (already deleted?)"}');
        RETURN;
    END IF;
    UPDATE rr_pl_section_accounts SET is_active = 'N'
    WHERE  section_id IN (SELECT section_id FROM rr_pl_sections WHERE group_id = :group_id)
    AND    NVL(is_active, 'Y') = 'Y';
    UPDATE rr_pl_sections SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE  group_id = :group_id AND NVL(is_active, 'Y') = 'Y';
    COMMIT;
    HTP.PRN('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(REPLACE(SQLERRM, '\', '\\'), '"', '\"') || '"}');
END;
~');

    def('section/:section_id/delete', 'Soft-delete a P&L section with its accounts', q'~
DECLARE
    l_rows NUMBER;
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    UPDATE rr_pl_sections SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE  section_id = :section_id AND NVL(is_active, 'Y') = 'Y';
    l_rows := SQL%ROWCOUNT;
    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Section not found (already deleted?)"}');
        RETURN;
    END IF;
    UPDATE rr_pl_section_accounts SET is_active = 'N'
    WHERE  section_id = :section_id AND NVL(is_active, 'Y') = 'Y';
    COMMIT;
    HTP.PRN('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(REPLACE(SQLERRM, '\', '\\'), '"', '\"') || '"}');
END;
~');

    def('total/:total_id/delete', 'Soft-delete a P&L calculated total', q'~
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    UPDATE rr_pl_totals SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE  total_id = :total_id AND NVL(is_active, 'Y') = 'Y';
    IF SQL%ROWCOUNT = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Total not found (already deleted?)"}');
    ELSE
        COMMIT;
        HTP.PRN('{"success":true}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(REPLACE(SQLERRM, '\', '\\'), '"', '\"') || '"}');
END;
~');

    def('template/:template_id/delete', 'Soft-delete a P&L template', q'~
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    UPDATE rr_pl_templates SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE  template_id = :template_id AND NVL(is_active, 'Y') = 'Y';
    IF SQL%ROWCOUNT = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Template not found (already deleted?)"}');
    ELSE
        COMMIT;
        HTP.PRN('{"success":true}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(REPLACE(SQLERRM, '\', '\\'), '"', '\"') || '"}');
END;
~');
    COMMIT;
END;
/

-- Where the P&L group/section/total/template endpoints live, with their methods
SELECT m.name AS module_name, m.uri_prefix, t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON t.module_id = m.id
JOIN   user_ords_handlers  h ON h.template_id = t.id
WHERE  REGEXP_LIKE(t.uri_template, '(^|/)(group|section|total|template)/:')
ORDER  BY m.uri_prefix, t.uri_template, h.method;
