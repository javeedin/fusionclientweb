-- =====================================================
-- PATCH 137: Business Unit create — store the ledger name (LEDGER column)
--
-- The Create Business Unit wizard now passes "ledger" (the ledger NAME) in the
-- POST body. This patch:
--   1. Ensures RR_GL_BUSINESS_UNITS has a LEDGER column (idempotent).
--   2. Re-defines POST gl/businessunits/create to also store LEDGER.
--
-- (Adding the column before referencing it in the handler avoids the
--  ORDS-25001 compile error you hit on gl/ledgers/create.)
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole script.
-- =====================================================

-- ── 1. LEDGER column (idempotent) ──
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE RR_GL_BUSINESS_UNITS ADD (LEDGER VARCHAR2(360))';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE = -1430 THEN NULL; ELSE RAISE; END IF;   -- already exists
END;
/

-- ── 2. Re-define POST gl/businessunits/create (adds LEDGER) ──
BEGIN
  ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create', p_method => 'POST');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create',
      p_comments => 'Create a business unit manually (sequence id)');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

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
    l_ldgnm  VARCHAR2(360);
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
    l_ldgnm  := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'ledger'));
    l_le     := APEX_JSON.GET_NUMBER(p_path => 'legalEntityId');
    l_lename := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'legalEntityName'));
    l_by     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');

    -- guard against the literal string "undefined" arriving from the client
    IF l_lename = 'undefined' THEN l_lename := NULL; END IF;
    IF l_ldgnm  = 'undefined' THEN l_ldgnm  := NULL; END IF;
    -- fall back to the ledger master name if not supplied
    IF l_ldgnm IS NULL AND l_ledger IS NOT NULL THEN
        BEGIN SELECT ledger_name INTO l_ldgnm FROM rr_ledgers WHERE ledger_id = l_ledger; EXCEPTION WHEN NO_DATA_FOUND THEN NULL; END;
    END IF;
    IF l_lename IS NULL AND l_le IS NOT NULL THEN
        BEGIN SELECT name INTO l_lename FROM rr_gl_legal_entities WHERE legal_entity_id = l_le; EXCEPTION WHEN NO_DATA_FOUND THEN NULL; END;
    END IF;

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
        (business_unit_id, business_unit_name, active_flag, primary_ledger_id, ledger,
         legal_entity_id, legal_entity_name, profit_center_flag, company,
         created_by, creation_date)
    VALUES
        (l_id, l_name, l_active, l_ledger, l_ldgnm,
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

-- VERIFY:
--   POST {base}/gl/businessunits/create
--   {"businessUnitName":"Business unit1","company":"908","activeFlag":"Y",
--    "profitCenterFlag":"N","primaryLedgerId":900000007,"legalEntityId":900000003,
--    "legalEntityName":"Seq LE","ledger":"leger1","createdBy":"javeedindia@gmail.com"}
--   -> 201 {"success":true,"businessUnitId":9000000xx}
