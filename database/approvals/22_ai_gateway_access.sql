-- =============================================================================
-- PATCH 22: Approval history through the read gateway
--
-- The approval status dialog (AP invoices, cash external transactions) reads every request and
-- action of a transaction in one SELECT through POST ai/executequery:
--   RR_APPROVAL_REQUESTS, RR_APPROVAL_HISTORY, RR_APPROVAL_USERS
-- When RR_AI_OBJECT_ACL runs in whitelist mode (any 'Y' row) these tables must be listed;
-- in open mode nothing is added (adding 'Y' rows would switch it to whitelist mode).
-- Without this the dialog falls back to the approvals REST endpoints (slower, one call per request).
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands. Safe to re-run.
-- =============================================================================
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR t IN (SELECT table_name FROM user_tables
                  WHERE table_name IN ('RR_APPROVAL_REQUESTS', 'RR_APPROVAL_HISTORY', 'RR_APPROVAL_USERS')) LOOP
            MERGE INTO RR_AI_OBJECT_ACL a USING (SELECT t.table_name n FROM dual) s ON (a.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;   -- AI gateway not installed: the dialog uses the REST fallback
END;
/
