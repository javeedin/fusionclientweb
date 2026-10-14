-- =============================================================================
-- 165: GL dashboard through the read gateway (direct execute)
--
-- The General Ledger page's dashboard (src/pages/gl/GlDashboard.tsx, glDashboard.service.ts) reads with
-- plain SELECTs through POST ai/executequery: journals not posted (PMS first), journals per period and
-- category, and the open GL periods. When RR_AI_OBJECT_ACL runs in whitelist mode (any 'Y' row), the
-- gateway reads only the tables listed there; this adds the GL tables the dashboard reads. In open mode
-- nothing is added. A table set to 'N' stays 'N' — the dashboard then shows which figure could not be read.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands (one block). Safe to re-run. Optional.
-- =============================================================================
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR t IN (SELECT table_name FROM user_tables
                  WHERE table_name IN ('RR_GL_JE_HEADERS', 'RR_GL_JOURNAL_BATCHES', 'RR_GL_JE_LINES_ALL', 'RR_ACCOUNTING_PERIODS_STATUS')) LOOP
            MERGE INTO RR_AI_OBJECT_ACL a USING (SELECT t.table_name n FROM dual) s ON (a.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('Whitelist mode: GL tables allowed for the read gateway.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('Open mode: the read gateway already reads every table — nothing to do.');
    END IF;
EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('AI gateway not installed (' || SQLERRM || ') — run database/ai/140_ai_sql_gateway.sql first.');
END;
/
