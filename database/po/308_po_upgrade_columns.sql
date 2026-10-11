-- =============================================================================
-- Purchasing-RR (module PO) — 308: bring an existing install up to date
--
-- Later changes added columns through upgrade steps at the end of 300 / the top of 302. A database
-- where those steps did not run fails with, for example,
--   ORA-00904: "AP_LIABILITY_ACCOUNT": invalid identifier
-- on Purchasing → Setup → Purchasing Options (load and save).
--
-- This script:
--   1. adds every later column that is missing (nothing happens for columns that exist);
--   2. re-creates RR_PO_V_BUSINESS_UNITS (it shows the AP liability account);
--   3. recompiles purchasing objects that became invalid;
--   4. shows what is still wrong (should return no rows), and whether RR_PO_SETUP_PKG is
--      recent enough to save the AP liability account (if not: re-run 302_po_packages.sql).
--
-- HOW TO RUN: APEX SQL Workshop → SQL Scripts (or SQL Commands, block by block). Safe to re-run.
-- =============================================================================

-- 1. missing columns ──────────────────────────────────────────────────────────
DECLARE
    v_n NUMBER;
BEGIN
    FOR c IN (SELECT 'RR_PO_BU_OPTIONS' tab, 'AP_LIABILITY_ACCOUNT' col, 'VARCHAR2(200)' def FROM dual  -- 300 upgrade: default liability for PO → AP invoices
              UNION ALL SELECT 'RR_PO_CATEGORIES', 'DEFAULT_CHARGE_ACCOUNT', 'VARCHAR2(200)' FROM dual  -- 300 upgrade: category default charge account
              UNION ALL SELECT 'RR_APPROVAL_RULES', 'BUSINESS_UNIT_ID', 'NUMBER' FROM dual              -- 302: approval rule per business unit
              UNION ALL SELECT 'RR_APPROVAL_RULES', 'CATEGORY_CODE', 'VARCHAR2(40)' FROM dual) LOOP     -- 302: approval rule per category
        SELECT COUNT(*) INTO v_n FROM user_tables WHERE table_name = c.tab;
        IF v_n > 0 THEN
            SELECT COUNT(*) INTO v_n FROM user_tab_columns WHERE table_name = c.tab AND column_name = c.col;
            IF v_n = 0 THEN
                EXECUTE IMMEDIATE 'ALTER TABLE ' || c.tab || ' ADD (' || c.col || ' ' || c.def || ')';
                DBMS_OUTPUT.PUT_LINE('Added ' || c.tab || '.' || c.col);
            END IF;
        END IF;
    END LOOP;
END;
/

-- 2. view with the new column (same as 301) ──────────────────────────────────
CREATE OR REPLACE VIEW RR_PO_V_BUSINESS_UNITS AS
SELECT bu.BUSINESS_UNIT_ID, bu.BUSINESS_UNIT_NAME, bu.COMPANY, bu.PRIMARY_LEDGER_ID,
       o.BU_OPTION_ID, o.FUNCTIONAL_CURRENCY, o.ACCRUE_AT_RECEIPT_FLAG, o.RECEIPT_ACCRUAL_ACCOUNT, o.AP_LIABILITY_ACCOUNT,
       o.REQUIRE_REQUISITION, o.PO_APPROVAL_REQUIRED, o.REQ_APPROVAL_REQUIRED,
       CASE WHEN o.BU_OPTION_ID IS NULL THEN 'N' ELSE 'Y' END AS OPTIONS_SET
FROM   RR_GL_BUSINESS_UNITS bu
LEFT   JOIN RR_PO_BU_OPTIONS o ON o.BUSINESS_UNIT_ID = bu.BUSINESS_UNIT_ID
WHERE  NVL(bu.ACTIVE_FLAG, 'Y') = 'Y';

-- 3. recompile what became invalid ────────────────────────────────────────────
BEGIN
    FOR o IN (SELECT object_name, object_type FROM user_objects
              WHERE  status = 'INVALID'
              AND   (object_name LIKE 'RR\_PO\_%' ESCAPE '\' OR object_name LIKE 'RR\_REPORT\_%' ESCAPE '\')
              AND    object_type IN ('VIEW', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'PROCEDURE', 'FUNCTION')
              ORDER  BY DECODE(object_type, 'VIEW', 1, 'PACKAGE', 2, 'PROCEDURE', 3, 'FUNCTION', 3, 'PACKAGE BODY', 4, 5)) LOOP
        BEGIN
            EXECUTE IMMEDIATE CASE o.object_type
                WHEN 'PACKAGE BODY' THEN 'ALTER PACKAGE ' || o.object_name || ' COMPILE BODY'
                ELSE 'ALTER ' || o.object_type || ' ' || o.object_name || ' COMPILE' END;
        EXCEPTION WHEN OTHERS THEN NULL;   -- reported by the check below
        END;
    END LOOP;
END;
/

-- 4. checks ───────────────────────────────────────────────────────────────────
-- a) still invalid (expect no rows)
SELECT object_name, object_type, status FROM user_objects
 WHERE status = 'INVALID' AND (object_name LIKE 'RR\_PO\_%' ESCAPE '\' OR object_name LIKE 'RR\_REPORT\_%' ESCAPE '\')
 ORDER BY object_type, object_name;

-- b) the columns (expect 4 rows)
SELECT table_name, column_name, data_type FROM user_tab_columns
 WHERE (table_name, column_name) IN (('RR_PO_BU_OPTIONS', 'AP_LIABILITY_ACCOUNT'), ('RR_PO_CATEGORIES', 'DEFAULT_CHARGE_ACCOUNT'),
                                     ('RR_APPROVAL_RULES', 'BUSINESS_UNIT_ID'), ('RR_APPROVAL_RULES', 'CATEGORY_CODE'))
 ORDER BY table_name, column_name;

-- c) is the setup package recent enough to save the AP liability account? ('NO' → re-run 302_po_packages.sql)
SELECT CASE WHEN COUNT(*) > 0 THEN 'YES' ELSE 'NO — re-run database/po/302_po_packages.sql' END AS SETUP_PKG_SAVES_AP_LIABILITY
  FROM user_source
 WHERE name = 'RR_PO_SETUP_PKG' AND type = 'PACKAGE BODY' AND INSTR(text, 'AP_LIABILITY_ACCOUNT') > 0;
