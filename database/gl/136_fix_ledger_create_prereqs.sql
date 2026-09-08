-- =====================================================
-- PATCH 136: Fix ORDS-25001 on POST gl/ledgers/create (and LE / BU create)
--
-- Symptom: POST .../gl/ledgers/create returns HTTP 555, ORDS-25001
--          ("could not be processed for a user defined resource").
--
-- Cause: the create handler's PL/SQL references objects that don't exist yet,
--        so the anonymous block fails to COMPILE — which happens before the
--        handler's EXCEPTION block can run, so you get ORDS-25001 instead of
--        the handler's own JSON error. This happens when patch 135 (sequence
--        handlers) was run but patch 134 (which ADDS the COA columns) was not,
--        or a sequence is missing.
--
-- This patch is idempotent and self-contained: it ensures the columns and all
-- three manual-id sequences exist. After running it, the existing create
-- handlers compile and work. Safe to run repeatedly.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole script.
-- =====================================================

-- ── 1. RR_LEDGERS: Chart of Accounts columns (idempotent) ──
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE RR_LEDGERS ADD (CHART_OF_ACCOUNTS_ID VARCHAR2(100), CHART_OF_ACCOUNTS_NAME VARCHAR2(360))';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE = -1430 THEN NULL; ELSE RAISE; END IF;   -- -1430 = column already exists
END;
/

-- ── 2. Ensure the three manual-id sequences exist (seeded to follow data) ──
DECLARE
  v NUMBER; n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_sequences WHERE sequence_name = 'SEQ_RR_LEDGER_MANUAL_ID';
  IF n = 0 THEN
    SELECT GREATEST(NVL(MAX(ledger_id), 900000000) + 1, 900000001) INTO v
      FROM rr_ledgers WHERE ledger_id BETWEEN 900000001 AND 999999999;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_LEDGER_MANUAL_ID START WITH ' || v
                   || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
  END IF;
END;
/
DECLARE
  v NUMBER; n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_sequences WHERE sequence_name = 'SEQ_RR_GL_LE_MANUAL_ID';
  IF n = 0 THEN
    SELECT GREATEST(NVL(MAX(legal_entity_id), 900000000) + 1, 900000001) INTO v
      FROM rr_gl_legal_entities WHERE legal_entity_id BETWEEN 900000001 AND 999999999;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_GL_LE_MANUAL_ID START WITH ' || v
                   || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
  END IF;
END;
/
DECLARE
  v NUMBER; n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_sequences WHERE sequence_name = 'SEQ_RR_GL_BU_MANUAL_ID';
  IF n = 0 THEN
    SELECT GREATEST(NVL(MAX(business_unit_id), 900000000) + 1, 900000001) INTO v
      FROM rr_gl_business_units WHERE business_unit_id BETWEEN 900000001 AND 999999999;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_GL_BU_MANUAL_ID START WITH ' || v
                   || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
  END IF;
END;
/

-- ── 3. Diagnostics — confirm everything the handlers need is present ──
SET SERVEROUTPUT ON
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_tab_columns
   WHERE table_name = 'RR_LEDGERS' AND column_name IN ('CHART_OF_ACCOUNTS_ID', 'CHART_OF_ACCOUNTS_NAME');
  DBMS_OUTPUT.PUT_LINE('RR_LEDGERS COA columns present: ' || n || ' / 2');

  FOR s IN (SELECT sequence_name FROM user_sequences
             WHERE sequence_name IN ('SEQ_RR_LEDGER_MANUAL_ID','SEQ_RR_GL_LE_MANUAL_ID','SEQ_RR_GL_BU_MANUAL_ID')) LOOP
    DBMS_OUTPUT.PUT_LINE('sequence present: ' || s.sequence_name);
  END LOOP;
END;
/

-- After this, retry:
--   POST {base}/gl/ledgers/create
--   {"ledgerName":"leger1","description":"ledger1","currencyCode":"AED",
--    "chartOfAccountsId":"2002","chartOfAccountsName":"BUIMERC Global Chart of Accounts Instance",
--    "createdBy":"javeedindia@gmail.com"}
--   -> 201 {"success":true,"ledgerId":9000000xx,...}
