-- =============================================================================
-- PMS Group Portfolio Dashboard (/pms) — read access through the AI query gateway
--   POST {base}/ai/executequery runs SELECTs for the page:
--     PMS_V_PORTFOLIO_POSTION   open NRE / NRO positions (cost, revalued, market; native / AED / USD)
--     PMS_COMPANY               company names
--     PMS_FAIRVALUE_CHANGE      last RE-CAL revaluation date per company
--   and the Venture Capital page (/pms/venture-capital):
--     VCAP_INVESTMENT_OPPORTUNITY, VCAP_PAYMENT, VCAP_DRAWDOWN_NOTICE, VCAP_STANDING_INSTRUCTION,
--     VCAP_TRUST_FUND_MASTER, BMSEXERATE
-- Only needed when the gateway's object ACL is in whitelist mode (any ALLOWED_FLAG = 'Y' row);
-- otherwise nothing changes. Safe to re-run.
-- =============================================================================
SET SERVEROUTPUT ON
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist = 0 THEN
        -- open mode: everything not denied is visible; only report explicit denies
        FOR d IN (SELECT OBJECT_NAME FROM RR_AI_OBJECT_ACL
                  WHERE ALLOWED_FLAG = 'N' AND OBJECT_NAME IN ('PMS_V_PORTFOLIO_POSTION', 'PMS_COMPANY', 'PMS_FAIRVALUE_CHANGE',
                                     'VCAP_INVESTMENT_OPPORTUNITY', 'VCAP_PAYMENT', 'VCAP_DRAWDOWN_NOTICE', 'VCAP_STANDING_INSTRUCTION',
                                     'VCAP_TRUST_FUND_MASTER', 'BMSEXERATE')) LOOP
            DBMS_OUTPUT.PUT_LINE(d.OBJECT_NAME || ' is denied (ALLOWED_FLAG = N) - the dashboard needs it');
        END LOOP;
        DBMS_OUTPUT.PUT_LINE('Gateway ACL is not in whitelist mode - nothing else to do');
        RETURN;
    END IF;
    FOR o IN (SELECT 'PMS_V_PORTFOLIO_POSTION' n FROM dual UNION ALL
              SELECT 'PMS_COMPANY' FROM dual UNION ALL
              SELECT 'PMS_FAIRVALUE_CHANGE' FROM dual UNION ALL
              SELECT 'VCAP_INVESTMENT_OPPORTUNITY' FROM dual UNION ALL
              SELECT 'VCAP_PAYMENT' FROM dual UNION ALL
              SELECT 'VCAP_DRAWDOWN_NOTICE' FROM dual UNION ALL
              SELECT 'VCAP_STANDING_INSTRUCTION' FROM dual UNION ALL
              SELECT 'VCAP_TRUST_FUND_MASTER' FROM dual UNION ALL
              SELECT 'BMSEXERATE' FROM dual) LOOP
        MERGE INTO RR_AI_OBJECT_ACL t USING (SELECT o.n n FROM dual) s ON (t.OBJECT_NAME = s.n)
        WHEN MATCHED THEN UPDATE SET t.ALLOWED_FLAG = 'Y'
        WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
    END LOOP;
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PMS objects allowed for the gateway');
END;
/

-- quick check: should return rows
SELECT COUNT(*) AS positions, COUNT(DISTINCT COMPANY_CODE) AS companies FROM PMS_V_PORTFOLIO_POSTION;
SELECT COUNT(*) AS trust_funds FROM VCAP_TRUST_FUND_MASTER;
