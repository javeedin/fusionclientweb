-- =============================================================================
-- POST {base}/pl/account/move
--   body { "section_id": 123, "accounts": ["5229101", "5229102", ...] }
-- Moves (or adds) accounts to a P&L template section in ONE transaction:
--   · the account is put in the target section (if it is not there yet)
--   · its single-account rows in every other section of the same template are
--     removed (soft delete, IS_ACTIVE = 'N') — so an account never ends up in two
--     sections because a second call failed
--   · accounts that another section picks up through an account RANGE are not
--     touched (the range would go with them) and are reported back in "ranged"
-- Response: {"success":true,"moved":n,"added":n,"removed":n,"unchanged":n,"ranged":[{"account","section","from","to"}]}
--
-- Used by Financial Statements → Run → "As per TB" (Move / Add, single or many
-- accounts). Created in the same ORDS module as POST {base}/pl/account/assign.
-- Run in bcldifc (SQL Developer, F5). Safe to re-run.
-- =============================================================================
SET SERVEROUTPUT ON
DECLARE
    v_mod    VARCHAR2(255);
    v_prefix VARCHAR2(255);
    v_pat    VARCHAR2(255);
BEGIN
    -- the module that serves account/assign (that call already works from the app)
    BEGIN
        SELECT m.name, m.uri_prefix, REPLACE(t.uri_template, 'account/assign', 'account/move')
        INTO   v_mod, v_prefix, v_pat
        FROM   user_ords_modules m
        JOIN   user_ords_templates t ON t.module_id = m.id
        WHERE  t.uri_template IN ('account/assign', 'pl/account/assign')
        ORDER  BY CASE WHEN LOWER(m.uri_prefix) LIKE '%pl/' THEN 0 ELSE 1 END
        FETCH FIRST 1 ROW ONLY;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        v_mod := 'pl'; v_prefix := '/pl/'; v_pat := 'account/move';
    END;
    DBMS_OUTPUT.PUT_LINE('Module: ' || v_mod || '   base path: ' || v_prefix);

    BEGIN ORDS.DELETE_TEMPLATE(p_module_name => v_mod, p_pattern => v_pat);
    EXCEPTION WHEN OTHERS THEN NULL; END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => v_mod,
        p_pattern     => v_pat,
        p_comments    => 'Move / add accounts to a P&L template section (one transaction)'
    );
    ORDS.DEFINE_HANDLER(
        p_module_name    => v_mod,
        p_pattern        => v_pat,
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Put accounts in a section and take them out of the other sections of the template',
        p_source         => q'~
DECLARE
    l_body     CLOB := :body_text;
    l_section  NUMBER := JSON_VALUE(l_body, '$.section_id' RETURNING NUMBER);
    l_template NUMBER;
    l_in       NUMBER;
    l_rm       NUMBER;
    l_order    NUMBER;
    l_moved    NUMBER := 0;
    l_added    NUMBER := 0;
    l_removed  NUMBER := 0;
    l_same     NUMBER := 0;
    l_ranged   VARCHAR2(32767);
    FUNCTION js (p VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN '"' || REPLACE(REPLACE(REPLACE(p, '\', '\\'), '"', '\"'), CHR(10), ' ') || '"';
    END;
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    BEGIN
        SELECT g.template_id INTO l_template
        FROM   rr_pl_sections s JOIN rr_pl_groups g ON g.group_id = s.group_id
        WHERE  s.section_id = l_section AND NVL(s.is_active, 'Y') = 'Y';
    EXCEPTION WHEN NO_DATA_FOUND THEN
        :status_code := 400;
        HTP.PRN('{"success":false,"error":"Target section ' || NVL(TO_CHAR(l_section), '(none)') || ' not found"}');
        RETURN;
    END;

    FOR a IN (SELECT DISTINCT TRIM(acct) AS acct
              FROM JSON_TABLE(l_body, '$.accounts[*]' COLUMNS (acct VARCHAR2(50) PATH '$'))
              WHERE TRIM(acct) IS NOT NULL) LOOP
        -- ranges in other sections that pick the account up: leave them, report
        FOR r IN (SELECT s.section_name, sa.account_from, sa.account_to
                  FROM   rr_pl_section_accounts sa
                  JOIN   rr_pl_sections s ON s.section_id = sa.section_id
                  JOIN   rr_pl_groups g   ON g.group_id = s.group_id
                  WHERE  g.template_id = l_template AND sa.section_id <> l_section
                  AND    NVL(sa.is_active, 'Y') = 'Y' AND NVL(s.is_active, 'Y') = 'Y' AND NVL(g.is_active, 'Y') = 'Y'
                  AND    sa.account_from IS NOT NULL AND sa.account_to IS NOT NULL
                  AND    a.acct BETWEEN sa.account_from AND sa.account_to) LOOP
            l_ranged := l_ranged || CASE WHEN l_ranged IS NOT NULL THEN ',' END
                     || '{"account":' || js(a.acct) || ',"section":' || js(r.section_name)
                     || ',"from":' || js(r.account_from) || ',"to":' || js(r.account_to) || '}';
        END LOOP;

        -- single-account rows in the other sections of this template
        UPDATE rr_pl_section_accounts sa
        SET    sa.is_active = 'N', sa.updated_date = SYSTIMESTAMP
        WHERE  sa.account_code = a.acct
        AND    sa.account_from IS NULL AND sa.account_to IS NULL
        AND    NVL(sa.is_active, 'Y') = 'Y'
        AND    sa.section_id <> l_section
        AND    sa.section_id IN (SELECT s.section_id FROM rr_pl_sections s JOIN rr_pl_groups g ON g.group_id = s.group_id
                                 WHERE g.template_id = l_template);
        l_rm := SQL%ROWCOUNT;
        l_removed := l_removed + l_rm;

        -- in the target already (as itself or inside a range of the target)?
        SELECT COUNT(*) INTO l_in
        FROM   rr_pl_section_accounts sa
        WHERE  sa.section_id = l_section AND NVL(sa.is_active, 'Y') = 'Y'
        AND    ((sa.account_from IS NULL AND sa.account_code = a.acct)
             OR (sa.account_from IS NOT NULL AND a.acct BETWEEN sa.account_from AND sa.account_to));
        IF l_in = 0 THEN
            SELECT NVL(MAX(display_order), 0) + 10 INTO l_order FROM rr_pl_section_accounts WHERE section_id = l_section;
            INSERT INTO rr_pl_section_accounts (section_id, account_code, account_from, account_to, display_order)
            VALUES (l_section, a.acct, NULL, NULL, l_order);
            IF l_rm > 0 THEN l_moved := l_moved + 1; ELSE l_added := l_added + 1; END IF;
        ELSIF l_rm > 0 THEN
            l_moved := l_moved + 1;
        ELSE
            l_same := l_same + 1;
        END IF;
    END LOOP;
    COMMIT;
    HTP.PRN('{"success":true,"moved":' || l_moved || ',"added":' || l_added || ',"removed":' || l_removed
         || ',"unchanged":' || l_same || ',"ranged":[' || l_ranged || ']}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(REPLACE(SQLERRM, '"', '\"'), CHR(10), ' ') || '"}');
END;
~'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('Created: ' || v_prefix || v_pat || '  (POST)');
END;
/

-- Verify: the new endpoint next to account/assign
SELECT m.name AS module_name, m.uri_prefix, t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON t.module_id = m.id
JOIN   user_ords_handlers  h ON h.template_id = t.id
WHERE  t.uri_template LIKE '%account/%'
ORDER  BY m.name, t.uri_template, h.method;
