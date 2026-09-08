-- =====================================================
-- PATCH 135: Real sequences for manual Ledger / Legal Entity / Business Unit ids
--
-- Replaces the MAX(id)+1 lookups (which can race under concurrent creates)
-- with three Oracle SEQUENCES in the reserved manual range 900000001..999999999.
-- Each sequence is SEEDED to continue after the highest existing manual id, so
-- it "follows the existing ones" (e.g. ledgers at 900000004 -> next 900000005).
--
--   SEQ_RR_LEDGER_MANUAL_ID   -> rr_ledgers.ledger_id
--   SEQ_RR_GL_LE_MANUAL_ID    -> rr_gl_legal_entities.legal_entity_id
--   SEQ_RR_GL_BU_MANUAL_ID    -> rr_gl_business_units.business_unit_id
--
-- The create handlers below draw ids from these sequences (with a collision
-- guard that skips any value that somehow already exists), and a NEW
-- POST gl/businessunits/create inserts a business unit with a sequence id
-- (previously the id was generated in the browser).
--
-- Fusion-synced ids are ~3.0e14 and never fall in the manual range, so the
-- sequences can never collide with synced data.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole script.
-- =====================================================

-- ── 1. Create/seed the three sequences ───────────────
DECLARE
  v_start NUMBER;
BEGIN
  BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE SEQ_RR_LEDGER_MANUAL_ID'; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT GREATEST(NVL(MAX(ledger_id), 900000000) + 1, 900000001) INTO v_start
    FROM rr_ledgers WHERE ledger_id BETWEEN 900000001 AND 999999999;
  EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_LEDGER_MANUAL_ID START WITH ' || v_start
                 || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
END;
/
DECLARE
  v_start NUMBER;
BEGIN
  BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE SEQ_RR_GL_LE_MANUAL_ID'; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT GREATEST(NVL(MAX(legal_entity_id), 900000000) + 1, 900000001) INTO v_start
    FROM rr_gl_legal_entities WHERE legal_entity_id BETWEEN 900000001 AND 999999999;
  EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_GL_LE_MANUAL_ID START WITH ' || v_start
                 || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
END;
/
DECLARE
  v_start NUMBER;
BEGIN
  BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE SEQ_RR_GL_BU_MANUAL_ID'; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT GREATEST(NVL(MAX(business_unit_id), 900000000) + 1, 900000001) INTO v_start
    FROM rr_gl_business_units WHERE business_unit_id BETWEEN 900000001 AND 999999999;
  EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_RR_GL_BU_MANUAL_ID START WITH ' || v_start
                 || ' INCREMENT BY 1 NOCACHE NOCYCLE MAXVALUE 999999999';
END;
/

-- =====================================================
-- 2. POST gl/ledgers/create  — id from SEQ_RR_LEDGER_MANUAL_ID
-- =====================================================
BEGIN
  ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'gl/ledgers/create', p_method => 'POST');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/ledgers/create',
    p_method        => 'POST',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Create one ledger (sequence id) with COA mapping',
    p_source        => q'[
DECLARE
    l_body    CLOB := :body_text;
    l_name    VARCHAR2(100);
    l_desc    VARCHAR2(100);
    l_ccy     VARCHAR2(100);
    l_by      VARCHAR2(150);
    l_coa_id  VARCHAR2(100);
    l_coa_nm  VARCHAR2(360);
    l_id      NUMBER;
    l_dup     NUMBER;
    l_ex      NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'ledgerName'));
    l_desc   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'description'));
    l_ccy    := NVL(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'currencyCode'))), 'AED');
    l_by     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');
    l_coa_id := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'chartOfAccountsId'));
    l_coa_nm := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'chartOfAccountsName'));

    IF l_name IS NULL THEN
        :status_code := 400; HTP.P('{"success":false,"message":"ledgerName is required"}'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_ledgers WHERE UPPER(ledger_name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409; HTP.P('{"success":false,"message":"Ledger already exists"}'); RETURN;
    END IF;

    LOOP
        l_id := SEQ_RR_LEDGER_MANUAL_ID.NEXTVAL;
        SELECT COUNT(*) INTO l_ex FROM rr_ledgers WHERE ledger_id = l_id;
        EXIT WHEN l_ex = 0;
    END LOOP;

    INSERT INTO rr_ledgers
        (ledger_id, ledger_name, description, ledger_category_code, currency_code,
         chart_of_accounts_id, chart_of_accounts_name, created_by, creation_date)
    VALUES
        (l_id, l_name, NVL(l_desc, l_name), 'PRIMARY', l_ccy,
         l_coa_id, l_coa_nm, l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"ledgerId":' || l_id || ',"message":"Ledger created"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK; :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- 3. POST gl/legalentities/create  — id from SEQ_RR_GL_LE_MANUAL_ID
-- =====================================================
BEGIN
  ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'gl/legalentities/create', p_method => 'POST');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/legalentities/create',
    p_method        => 'POST',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Insert one legal entity (sequence id)',
    p_source        => q'[
DECLARE
    l_body  CLOB := :body_text;
    l_name  VARCHAR2(360);
    l_ident VARCHAR2(60);
    l_by    VARCHAR2(150);
    l_id    NUMBER;
    l_dup   NUMBER;
    l_ex    NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name  := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'name'));
    l_ident := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'identifier'));
    l_by    := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');

    IF l_name IS NULL THEN
        :status_code := 400; HTP.P('{"success":false,"message":"name is required"}'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM RR_GL_LEGAL_ENTITIES WHERE UPPER(NAME) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409; HTP.P('{"success":false,"message":"Legal entity already exists"}'); RETURN;
    END IF;

    LOOP
        l_id := SEQ_RR_GL_LE_MANUAL_ID.NEXTVAL;
        SELECT COUNT(*) INTO l_ex FROM RR_GL_LEGAL_ENTITIES WHERE legal_entity_id = l_id;
        EXIT WHEN l_ex = 0;
    END LOOP;

    INSERT INTO RR_GL_LEGAL_ENTITIES
        (LEGAL_ENTITY_ID, NAME, LEGAL_ENTITY_IDENTIFIER, CREATED_BY, CREATION_DATE)
    VALUES
        (l_id, l_name, l_ident, l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"legalEntityId":' || l_id || ',"message":"Legal entity created"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK; :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- 4. NEW  POST gl/businessunits/create  — id from SEQ_RR_GL_BU_MANUAL_ID
-- =====================================================
BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create',
    p_comments => 'Create a business unit manually (sequence id)');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/businessunits/create',
    p_method        => 'POST',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Insert one business unit (sequence id), links ledger + legal entity',
    p_source        => q'[
DECLARE
    l_body   CLOB := :body_text;
    l_name   VARCHAR2(360);
    l_active VARCHAR2(1);
    l_pcf    VARCHAR2(1);
    l_comp   VARCHAR2(30);
    l_ledger NUMBER;
    l_le     NUMBER;
    l_lename VARCHAR2(360);
    l_by     VARCHAR2(150);
    l_id     NUMBER;
    l_dup    NUMBER;
    l_ex     NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'businessUnitName'));
    l_active := NVL(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'activeFlag'))), 'Y');
    l_pcf    := NVL(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'profitCenterFlag'))), 'N');
    l_comp   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'company'));
    l_ledger := APEX_JSON.GET_NUMBER(p_path => 'primaryLedgerId');
    l_le     := APEX_JSON.GET_NUMBER(p_path => 'legalEntityId');
    l_lename := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'legalEntityName'));
    l_by     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');

    IF l_name IS NULL THEN
        :status_code := 400; HTP.P('{"success":false,"message":"businessUnitName is required"}'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_gl_business_units WHERE UPPER(business_unit_name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409; HTP.P('{"success":false,"message":"Business unit already exists"}'); RETURN;
    END IF;

    LOOP
        l_id := SEQ_RR_GL_BU_MANUAL_ID.NEXTVAL;
        SELECT COUNT(*) INTO l_ex FROM rr_gl_business_units WHERE business_unit_id = l_id;
        EXIT WHEN l_ex = 0;
    END LOOP;

    INSERT INTO rr_gl_business_units
        (business_unit_id, business_unit_name, active_flag, primary_ledger_id,
         legal_entity_id, legal_entity_name, profit_center_flag, company,
         created_by, creation_date)
    VALUES
        (l_id, l_name, l_active, l_ledger,
         l_le, l_lename, l_pcf, l_comp,
         l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"businessUnitId":' || l_id || ',"message":"Business unit created"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK; :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- VERIFY
--   SELECT SEQ_RR_LEDGER_MANUAL_ID.NEXTVAL FROM dual;   (then rollback isn't possible; it just advances)
--   POST {base}/gl/ledgers/create       {"ledgerName":"Seq Ledger","currencyCode":"AED"}          -> 201 ledgerId 9000000xx
--   POST {base}/gl/legalentities/create {"name":"Seq LE"}                                          -> 201 legalEntityId
--   POST {base}/gl/businessunits/create {"businessUnitName":"Seq BU","company":"01",
--        "primaryLedgerId":900000005,"legalEntityId":900000003,"legalEntityName":"Seq LE"}         -> 201 businessUnitId
-- =====================================================
