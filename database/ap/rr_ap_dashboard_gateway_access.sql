-- =============================================================================
-- Payables dashboard through the read gateway (direct execute)
--
-- The Payables dashboard reads its figures with plain SELECTs through POST ai/executequery
-- (src/services/payablesDashboard.service.ts) instead of ap/invoices/stats and
-- suppliers/balance/outstanding. When RR_AI_OBJECT_ACL runs in whitelist mode (any 'Y' row),
-- the gateway reads only the tables listed there; this adds the AP tables the dashboard reads.
-- In open mode nothing is added (adding 'Y' rows would switch it to whitelist mode).
-- A table set to 'N' stays 'N' — the dashboard then shows which figure could not be read.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands (one block). Safe to re-run. Optional.
-- =============================================================================
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR t IN (SELECT table_name FROM user_tables
                  WHERE table_name IN ('RR_AP_INVOICES_ALL', 'RR_AP_PAYMENTS_ALL', 'RR_AP_PAYMENTS_RELATED_INVOICES',
                                       'RR_AP_APPLIED_PREPAYMENTS', 'RR_AP_INVOICE_INSTALLMENTS')) LOOP
            MERGE INTO RR_AI_OBJECT_ACL a USING (SELECT t.table_name n FROM dual) s ON (a.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('Whitelist mode: AP tables allowed for the read gateway.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('Open mode: the read gateway already reads every table — nothing to do.');
    END IF;
EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('AI gateway not installed (' || SQLERRM || ') — run database/ai/140_ai_sql_gateway.sql first.');
END;
/
