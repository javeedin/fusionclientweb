-- =====================================================
-- PATCH 134: Business Unit Setup Wizard backend
--
-- Fixes + additions behind the new "New Business Unit Setup" wizard:
--   1. Legal entities: NEW  POST gl/legalentities/create  — server-side id
--      (MAX+1 in the 900000001+ manual range), duplicate-name guard, and it
--      INSERTs a new row. The old POST gl/legalentities did a MERGE keyed by
--      id, so a manual create with a reused id OVERWROTE an existing LE.
--   2. Unique (case-insensitive) name indexes on legal entities and ledgers.
--   3. Ledgers: CHART_OF_ACCOUNTS_ID / _NAME columns + the ledger create and
--      list handlers extended to accept/return them (map a Chart of Accounts
--      structure to the ledger in step 1 of the wizard).
--
-- RUN ORDER: section 1 (ALTERs/indexes) once, then the ORDS blocks.
-- =====================================================

-- ── 1. Ledger: Chart of Accounts mapping columns ─────
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE RR_LEDGERS ADD (CHART_OF_ACCOUNTS_ID VARCHAR2(100), CHART_OF_ACCOUNTS_NAME VARCHAR2(360))';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE = -1430 THEN NULL; ELSE RAISE; END IF;  -- column already exists
END;
/

-- ── 2. Unique name indexes (case-insensitive) ────────
-- Guarded: if existing data has duplicate names the index won't create;
-- the create/POST handlers still enforce uniqueness at the app layer.
BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX UK_RR_GL_LE_UNAME ON RR_GL_LEGAL_ENTITIES (UPPER(NAME))';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX UK_RR_LEDGERS_UNAME ON RR_LEDGERS (UPPER(LEDGER_NAME))';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- =====================================================
-- 3. POST gl/legalentities/create  (INSERT-only, server id)
-- =====================================================
BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/legalentities/create');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/legalentities/create',
    p_comments => 'Create a legal entity manually (INSERT, server-assigned id)');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/legalentities/create',
    p_method        => 'POST',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Insert one legal entity (manual range 900000001+)',
    p_source        => q'[
DECLARE
    l_body  CLOB := :body_text;
    l_name  VARCHAR2(360);
    l_ident VARCHAR2(60);
    l_by    VARCHAR2(150);
    l_id    NUMBER;
    l_dup   NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name  := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'name'));
    l_ident := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'identifier'));
    l_by    := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');

    IF l_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success":false,"message":"name is required"}');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM RR_GL_LEGAL_ENTITIES WHERE UPPER(NAME) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P('{"success":false,"message":"Legal entity already exists"}');
        RETURN;
    END IF;

    SELECT GREATEST(NVL(MAX(LEGAL_ENTITY_ID), 900000000) + 1, 900000001)
      INTO l_id
      FROM RR_GL_LEGAL_ENTITIES
     WHERE LEGAL_ENTITY_ID BETWEEN 900000001 AND 999999999;

    INSERT INTO RR_GL_LEGAL_ENTITIES
        (LEGAL_ENTITY_ID, NAME, LEGAL_ENTITY_IDENTIFIER, CREATED_BY, CREATION_DATE)
    VALUES
        (l_id, l_name, l_ident, l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"legalEntityId":' || l_id || ',"message":"Legal entity created"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- 4. Re-define GET gl/setup/ledgers  (adds COA columns)
-- =====================================================
BEGIN
  ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'gl/setup/ledgers', p_method => 'GET');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name => 'reerp',
    p_pattern     => 'gl/setup/ledgers',
    p_method      => 'GET',
    p_source_type => 'json/collection',
    p_comments    => 'List ledgers (with Chart of Accounts mapping)',
    p_source      => q'[
SELECT l.ledger_id                                     AS "ledgerId",
       l.ledger_name                                   AS "ledgerName",
       l.description                                   AS "description",
       l.ledger_category_code                          AS "ledgerCategoryCode",
       l.currency_code                                 AS "currencyCode",
       l.chart_of_accounts_id                          AS "chartOfAccountsId",
       l.chart_of_accounts_name                        AS "chartOfAccountsName",
       l.created_by                                    AS "createdBy",
       TO_CHAR(l.creation_date, 'YYYY-MM-DD HH24:MI')  AS "creationDate"
FROM   rr_ledgers l
WHERE  (:search IS NULL OR UPPER(l.ledger_name) LIKE '%' || UPPER(:search) || '%')
ORDER  BY l.ledger_name
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- 5. Re-define POST gl/ledgers/create  (stores COA mapping)
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
    p_comments      => 'Create one ledger (manual range 900000001+) with COA mapping',
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
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'ledgerName'));
    l_desc   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'description'));
    l_ccy    := NVL(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'currencyCode'))), 'AED');
    l_by     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REERP');
    l_coa_id := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'chartOfAccountsId'));
    l_coa_nm := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'chartOfAccountsName'));

    IF l_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success":false,"message":"ledgerName is required"}');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_ledgers WHERE UPPER(ledger_name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P('{"success":false,"message":"Ledger already exists"}');
        RETURN;
    END IF;

    SELECT GREATEST(NVL(MAX(ledger_id), 900000000) + 1, 900000001)
      INTO l_id
      FROM rr_ledgers
     WHERE ledger_id BETWEEN 900000001 AND 999999999;

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
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- =====================================================
-- VERIFY
--   POST {base}/gl/legalentities/create {"name":"Test LE","createdBy":"KHALID"} -> 201 {legalEntityId}
--   POST {base}/gl/ledgers/create {"ledgerName":"Test Ledger","currencyCode":"AED",
--        "chartOfAccountsId":"101","chartOfAccountsName":"BUIMERC COA","createdBy":"KHALID"} -> 201
--   GET  {base}/gl/setup/ledgers  -> includes chartOfAccountsId / chartOfAccountsName
-- =====================================================
