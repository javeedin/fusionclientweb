-- =============================================================================
-- Purchasing-RR (module PO) — 310: AP liability account for invoices created from a PO
--
-- Create AP invoice from a PO said "No liability account on the supplier site or in Purchasing options"
-- although the supplier has one. 305 only read the site's assignment row for the PO's business unit, matched
-- on the exact business unit id or name; it never read the supplier site's own liability account.
--
-- RR_PO_V_PO_LIABILITY now offers, in this order (the app takes the first one found):
--   SITE_LIABILITY_ACCOUNT      the PO site's assignment to the business unit — matched on the business unit id,
--                               its name (ignoring case, spaces and punctuation), the bill-to business unit,
--                               or an account whose company segment is the business unit's company
--   SITE_ACCOUNT                the supplier site's own liability account (RR_SUPPLIER_SITES.LIABILITY_ACCOUNT_ID),
--                               when its company segment is the business unit's company
--   SUPPLIER_LIABILITY_ACCOUNT  another site of the same supplier, for this business unit
--   BU_LIABILITY_ACCOUNT        Purchasing → Setup → Purchasing options (AP liability account)
--   LAST_AP_LIABILITY_ACCOUNT   the supplier's latest AP invoice in the business unit
-- plus SITE_NAME, BU_NAME, BU_COMPANY, SITE_LIABILITY_ACCOUNT_ID and SITE_ASSIGNMENTS so the screen can say
-- what it found when nothing matches.
--
-- The site's account id is turned into an account string through reerp_gl_code_combinations; the script tries
-- the Fusion column names first, then the plain ones, and leaves SITE_ACCOUNT empty if neither exists.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Scripts (after 305). Safe to re-run.
-- =============================================================================

DECLARE
    v_view CLOB := q'~
CREATE OR REPLACE VIEW RR_PO_V_PO_LIABILITY AS
WITH bu AS (
    SELECT BUSINESS_UNIT_ID, BUSINESS_UNIT_NAME, COMPANY,
           UPPER(REGEXP_REPLACE(BUSINESS_UNIT_NAME, '[^[:alnum:]]', '')) AS BU_KEY
    FROM   RR_GL_BUSINESS_UNITS
), asg AS (                                   -- active site assignments that carry a liability account
    SELECT a.SUPPLIER_ID, a.SUPPLIER_SITE_ID, a.LIABILITY_DISTRIBUTION AS ACCT,
           a.CLIENT_BU_ID, UPPER(REGEXP_REPLACE(a.CLIENT_BU, '[^[:alnum:]]', '')) AS CLIENT_KEY,
           a.BILL_TO_BU_ID, UPPER(REGEXP_REPLACE(a.BILL_TO_BU, '[^[:alnum:]]', '')) AS BILL_KEY,
           REGEXP_SUBSTR(a.LIABILITY_DISTRIBUTION, '[^-]+', 1, 1) AS CO
    FROM   RR_SUPPLIER_SITE_ASSIGNMENTS a
    WHERE  a.LIABILITY_DISTRIBUTION IS NOT NULL
    AND    NVL(UPPER(a.STATUS), 'ACTIVE') <> 'INACTIVE'
    AND    (a.INACTIVE_DATE IS NULL OR a.INACTIVE_DATE > SYSDATE)
), sacct AS (                                 -- the supplier site's own liability account
    SELECT s.SUPPLIER_ID, s.SUPPLIER_SITE_ID, #CCID# AS ACCT
    FROM   RR_SUPPLIER_SITES s
    WHERE  s.LIABILITY_ACCOUNT_ID IS NOT NULL
)
SELECT h.PO_HEADER_ID, h.BUSINESS_UNIT_ID, h.SUPPLIER_ID, h.SUPPLIER_SITE_ID,
       b.BUSINESS_UNIT_NAME AS BU_NAME, b.COMPANY AS BU_COMPANY, st.SUPPLIER_SITE AS SITE_NAME,
       st.LIABILITY_ACCOUNT_ID AS SITE_LIABILITY_ACCOUNT_ID,
       (SELECT MAX(a.ACCT) KEEP (DENSE_RANK FIRST ORDER BY
                   CASE WHEN a.CLIENT_BU_ID = h.BUSINESS_UNIT_ID THEN 0
                        WHEN a.CLIENT_KEY = b.BU_KEY THEN 1
                        WHEN a.BILL_TO_BU_ID = h.BUSINESS_UNIT_ID OR a.BILL_KEY = b.BU_KEY THEN 2
                        ELSE 3 END)
        FROM   asg a
        WHERE  a.SUPPLIER_SITE_ID = h.SUPPLIER_SITE_ID
        AND   (a.CLIENT_BU_ID = h.BUSINESS_UNIT_ID OR a.CLIENT_KEY = b.BU_KEY
            OR a.BILL_TO_BU_ID = h.BUSINESS_UNIT_ID OR a.BILL_KEY = b.BU_KEY OR a.CO = b.COMPANY)) AS SITE_LIABILITY_ACCOUNT,
       (SELECT MAX(sa.ACCT) FROM sacct sa
        WHERE  sa.SUPPLIER_SITE_ID = h.SUPPLIER_SITE_ID AND sa.ACCT IS NOT NULL
        AND   (b.COMPANY IS NULL OR REGEXP_SUBSTR(sa.ACCT, '[^-]+', 1, 1) = b.COMPANY)) AS SITE_ACCOUNT,
       NVL((SELECT MAX(a.ACCT) KEEP (DENSE_RANK FIRST ORDER BY
                       CASE WHEN a.CLIENT_BU_ID = h.BUSINESS_UNIT_ID THEN 0 WHEN a.CLIENT_KEY = b.BU_KEY THEN 1 ELSE 2 END)
            FROM   asg a
            WHERE  a.SUPPLIER_ID = h.SUPPLIER_ID AND a.SUPPLIER_SITE_ID <> h.SUPPLIER_SITE_ID
            AND   (a.CLIENT_BU_ID = h.BUSINESS_UNIT_ID OR a.CLIENT_KEY = b.BU_KEY
                OR a.BILL_TO_BU_ID = h.BUSINESS_UNIT_ID OR a.BILL_KEY = b.BU_KEY)),
           (SELECT MAX(sa.ACCT) FROM sacct sa
            WHERE  sa.SUPPLIER_ID = h.SUPPLIER_ID AND sa.SUPPLIER_SITE_ID <> h.SUPPLIER_SITE_ID
            AND    REGEXP_SUBSTR(sa.ACCT, '[^-]+', 1, 1) = b.COMPANY)) AS SUPPLIER_LIABILITY_ACCOUNT,
       o.AP_LIABILITY_ACCOUNT AS BU_LIABILITY_ACCOUNT,
       (SELECT MAX(i.LIABILITY_DISTRIBUTION) KEEP (DENSE_RANK LAST ORDER BY i.CREATION_DATE)
        FROM   RR_AP_INVOICES_ALL i
        WHERE  i.SUPPLIER_NUMBER = sm.SUPPLIER_NUMBER AND i.BUSINESS_UNIT = b.BUSINESS_UNIT_NAME
        AND    i.LIABILITY_DISTRIBUTION IS NOT NULL AND NVL(i.CANCELED_FLAG, 'N') <> 'Y') AS LAST_AP_LIABILITY_ACCOUNT,
       (SELECT SUBSTR(LISTAGG(NVL(a.CLIENT_BU, NVL(TO_CHAR(a.CLIENT_BU_ID), '?')) || ': '
                              || NVL(a.LIABILITY_DISTRIBUTION, 'no liability account')
                              || CASE WHEN a.INACTIVE_DATE <= SYSDATE OR UPPER(a.STATUS) = 'INACTIVE' THEN ' (inactive)' END,
                              '; ' ON OVERFLOW TRUNCATE '...' WITHOUT COUNT)
                      WITHIN GROUP (ORDER BY a.CLIENT_BU), 1, 1000)
        FROM   RR_SUPPLIER_SITE_ASSIGNMENTS a
        WHERE  a.SUPPLIER_SITE_ID = h.SUPPLIER_SITE_ID AND ROWNUM <= 10) AS SITE_ASSIGNMENTS
FROM   RR_PO_HEADERS h
LEFT   JOIN bu b                 ON b.BUSINESS_UNIT_ID = h.BUSINESS_UNIT_ID
LEFT   JOIN RR_SUPPLIER_MASTER sm ON sm.SUPPLIER_ID = h.SUPPLIER_ID
LEFT   JOIN RR_SUPPLIER_SITES st  ON st.SUPPLIER_SITE_ID = h.SUPPLIER_SITE_ID
LEFT   JOIN RR_PO_BU_OPTIONS o    ON o.BUSINESS_UNIT_ID = h.BUSINESS_UNIT_ID~';
    TYPE t_list IS TABLE OF VARCHAR2(2000);
    -- the site's account id → account string, for each shape of reerp_gl_code_combinations
    v_ccid t_list := t_list(
        q'~(SELECT cc."buimercFinGlbCoaCo" || '-' || cc."buimercFinGlbCoaLob" || '-' || cc."buimercFinGlbCoaDepartment" || '-'
                || cc."buimercFinGlbCoaAccount" || '-' || cc."buimercFinGlbCoaSubAcc" || '-' || cc."buimercFinGlbCoaAlys" || '-'
                || cc."buimercFinGlbCoaIc" || '-' || cc."buimercFinGlbCoaFut1" || '-' || cc."buimercFinGlbCoaFut2"
            FROM reerp_gl_code_combinations cc WHERE cc."_CODE_COMBINATION_ID" = s.LIABILITY_ACCOUNT_ID AND ROWNUM = 1)~',
        q'~(SELECT cc.concatenated_segments FROM reerp_gl_code_combinations cc
            WHERE cc.code_combination_id = s.LIABILITY_ACCOUNT_ID AND ROWNUM = 1)~',
        'CAST(NULL AS VARCHAR2(240))');
    v_names t_list := t_list('Fusion code combinations', 'plain code combinations', 'no code combinations (SITE_ACCOUNT stays empty)');
BEGIN
    FOR i IN 1 .. v_ccid.COUNT LOOP
        BEGIN
            EXECUTE IMMEDIATE REPLACE(v_view, '#CCID#', v_ccid(i));
            DBMS_OUTPUT.PUT_LINE('RR_PO_V_PO_LIABILITY created — site account from ' || v_names(i));
            EXIT;
        EXCEPTION WHEN OTHERS THEN
            IF i = v_ccid.COUNT THEN RAISE; END IF;
            DBMS_OUTPUT.PUT_LINE('  ' || v_names(i) || ' not usable: ' || SQLERRM);
        END;
    END LOOP;
END;
/

-- AI gateway ACL (whitelist mode only)
DECLARE v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        MERGE INTO RR_AI_OBJECT_ACL t USING (SELECT 'RR_PO_V_PO_LIABILITY' n FROM dual) s ON (t.OBJECT_NAME = s.n)
        WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- checks ──────────────────────────────────────────────────────────────────────
-- a) the view is valid (expect VALID)
SELECT object_name, status FROM user_objects WHERE object_name = 'RR_PO_V_PO_LIABILITY';

-- b) what a PO gets (change the PO number): the first non-empty account of the five is used
SELECT PO_HEADER_ID, BU_NAME, SITE_NAME, SITE_LIABILITY_ACCOUNT, SITE_ACCOUNT, SUPPLIER_LIABILITY_ACCOUNT,
       BU_LIABILITY_ACCOUNT, LAST_AP_LIABILITY_ACCOUNT, SITE_LIABILITY_ACCOUNT_ID, SITE_ASSIGNMENTS
FROM   RR_PO_V_PO_LIABILITY
WHERE  PO_HEADER_ID = (SELECT PO_HEADER_ID FROM RR_PO_HEADERS WHERE PO_NUMBER = 'PO-2026-00003');
