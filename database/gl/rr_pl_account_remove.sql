-- =============================================================================
-- POST {base}/pl/section/:section_id/account/remove
--   body { account_code, account_from?, account_to? }
-- Removes an account (or account range) from a P&L template section — the delete
-- icon on account lines of Income Statement Templates. Soft delete
-- (IS_ACTIVE = 'N'), like the other P&L template deletes.
--
-- The template structure API returns accounts without their id, so the row is
-- matched by section + account_code + account_from + account_to.
--
-- Created in the ORDS module that serves {base}/pl/… (the P&L template
-- endpoints); the block prints the module and full path.
-- Run in bcldifc (SQL Developer, F5).
-- =============================================================================
SET SERVEROUTPUT ON
DECLARE
    v_mod    VARCHAR2(255);
    v_prefix VARCHAR2(255);
    v_pat    VARCHAR2(255);
BEGIN
    -- The app calls {base}/pl/section/:id/account/remove. Use the module whose
    -- prefix ends in /pl/ (pattern relative to it); otherwise a module holding
    -- 'pl/…' patterns directly (pattern gets the 'pl/' in front).
    BEGIN
        SELECT m.name, m.uri_prefix INTO v_mod, v_prefix
        FROM   user_ords_modules m
        WHERE  RTRIM(LOWER(m.uri_prefix), '/') LIKE '%/pl' OR LOWER(m.uri_prefix) = 'pl/'
        ORDER  BY CASE WHEN LOWER(m.uri_prefix) LIKE '%reerp/pl/' THEN 0 ELSE 1 END,
                  CASE WHEN m.name = 'pl' THEN 0 ELSE 1 END
        FETCH FIRST 1 ROW ONLY;
        v_pat := 'section/:section_id/account/remove';
    EXCEPTION WHEN NO_DATA_FOUND THEN
        SELECT m.name, m.uri_prefix INTO v_mod, v_prefix
        FROM   user_ords_modules m
        JOIN   user_ords_templates t ON t.module_id = m.id
        WHERE  t.uri_template LIKE 'pl/%'
        FETCH FIRST 1 ROW ONLY;
        v_pat := 'pl/section/:section_id/account/remove';
    END;
    DBMS_OUTPUT.PUT_LINE('Module: ' || v_mod || '   base path: ' || v_prefix);

    BEGIN ORDS.DELETE_TEMPLATE(p_module_name => v_mod, p_pattern => v_pat);
    EXCEPTION WHEN OTHERS THEN NULL; END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => v_mod,
        p_pattern     => v_pat,
        p_comments    => 'Remove an account / range from a P&L template section'
    );
    ORDS.DEFINE_HANDLER(
        p_module_name    => v_mod,
        p_pattern        => v_pat,
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Soft-delete (IS_ACTIVE=N) the matching rr_pl_section_accounts row(s)',
        p_source         => q'~
DECLARE
    l_body  CLOB := :body_text;
    l_code  VARCHAR2(100) := TRIM(JSON_VALUE(l_body, '$.account_code'));
    l_from  VARCHAR2(100) := TRIM(JSON_VALUE(l_body, '$.account_from'));
    l_to    VARCHAR2(100) := TRIM(JSON_VALUE(l_body, '$.account_to'));
    l_rows  NUMBER;
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    IF l_code IS NULL AND l_from IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"success":false,"error":"account_code or account_from is required"}');
        RETURN;
    END IF;
    UPDATE rr_pl_section_accounts
    SET    is_active = 'N'
    WHERE  section_id = :section_id
    AND    NVL(is_active, 'Y') = 'Y'
    AND    NVL(account_code, '~') = NVL(l_code, NVL(account_code, '~'))
    AND    NVL(account_from, '~') = NVL(l_from, '~')
    AND    NVL(account_to,   '~') = NVL(l_to,   '~');
    l_rows := SQL%ROWCOUNT;
    COMMIT;
    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Account not found in this section (already removed?)"}');
    ELSE
        HTP.PRN('{"success":true,"removed":' || l_rows || '}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
~'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('Created: ' || v_prefix || v_pat || '  (POST)');
END;
/

-- Verify: lists the new endpoint next to the existing section endpoint
SELECT m.name AS module_name, m.uri_prefix, t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON t.module_id = m.id
JOIN   user_ords_handlers  h ON h.template_id = t.id
WHERE  t.uri_template LIKE '%section/:section_id%'
ORDER  BY t.uri_template, h.method;
