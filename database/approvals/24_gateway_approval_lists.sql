-- =============================================================================
-- PATCH 24: every approvals list through the read gateway (direct execute)
--
-- The app reads the approval lists — users, rules (with their approvers), requests, history, approval
-- links and e-mail replies — with one SELECT each through POST ai/executequery, not through the
-- approvals GET handlers. It no longer depends on which version of those handlers is deployed.
--
-- When RR_AI_OBJECT_ACL runs in whitelist mode (any 'Y' row), the gateway reads only the tables listed
-- there; this adds the approval tables. In open mode nothing is added (adding 'Y' rows would switch it
-- to whitelist mode). A table the gateway may not read falls back to its GET handler — so this script
-- is optional: run it once, and the GET handlers are no longer used for reading.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands (one block). Safe to re-run.
-- =============================================================================
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR t IN (SELECT table_name FROM user_tables
                  WHERE table_name IN ('RR_APPROVAL_REQUESTS', 'RR_APPROVAL_HISTORY', 'RR_APPROVAL_USERS', 'RR_APPROVAL_RULES',
                                       'RR_APPROVAL_RULE_APPROVERS', 'RR_APPROVAL_TOKENS', 'RR_APPROVAL_EMAIL_REPLIES')) LOOP
            MERGE INTO RR_AI_OBJECT_ACL a USING (SELECT t.table_name n FROM dual) s ON (a.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');   -- a table set to N stays N
        END LOOP;
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('Whitelist mode: approval tables allowed for the read gateway.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('Open mode: the read gateway already reads every table — nothing to do.');
    END IF;
EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('AI gateway not installed (' || SQLERRM || ') — the app keeps using the approvals GET handlers.');
END;
/
