-- =====================================================
-- PATCH 129: Manage Business Units (GL)
--
-- New page: GL → Manage Business Units — search all BUs and create new
-- Business Units, with inline creation of Legal Entities and Ledgers.
--
-- The existing POST gl/businessunits / gl/legalentities endpoints are the
-- FUSION SYNC upserts (batch payloads) — they are NOT touched. This patch
-- adds dedicated create/list endpoints (module 'reerp'):
--   GET  gl/businessunits/list      — all BUs incl. audit columns (filters: search, company, active)
--   POST gl/businessunits/create    — create one BU manually
--   GET  gl/setup/legalentities     — legal entities for the picker
--   POST gl/legalentities/create    — create one legal entity
--   GET  gl/setup/ledgers           — ledgers for the picker
--   POST gl/ledgers/create          — create one ledger
--
-- Manually created rows get ids in a reserved range 900000001..999999999
-- so they can never collide with Fusion-synced ids.
--
-- RUN ORDER: section 1 (ALTERs) once, then the ORDS blocks.
-- =====================================================

-- ── 1. Audit columns ─────────────────────────────────
ALTER TABLE RR_GL_BUSINESS_UNITS ADD (
    CREATED_BY     VARCHAR2(150),
    CREATION_DATE  TIMESTAMP(6)
);

ALTER TABLE RR_LEDGERS ADD (
    CREATED_BY     VARCHAR2(150),
    CREATION_DATE  TIMESTAMP(6)
);
-- (RR_GL_LEGAL_ENTITIES already has CREATED_BY / CREATION_DATE)


-- =====================================================
-- 2. GET gl/businessunits/list
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/list');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/list',
        p_comments => 'Business units with audit columns for the Manage Business Units page');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/businessunits/list',
        p_method      => 'GET',
        p_source_type => 'json/collection',
        p_comments    => 'List BUs (filters: search, company, active)',
        p_source      => '
SELECT bu.business_unit_id                          AS "businessUnitId",
       bu.business_unit_name                        AS "businessUnitName",
       bu.company                                   AS "company",
       bu.active_flag                               AS "activeFlag",
       bu.profit_center_flag                        AS "profitCenterFlag",
       bu.legal_entity_id                           AS "legalEntityId",
       bu.legal_entity_name                         AS "legalEntityName",
       bu.primary_ledger_id                         AS "primaryLedgerId",
       bu.ledger                                    AS "ledger",
       bu.created_by                                AS "createdBy",
       TO_CHAR(bu.creation_date, ''YYYY-MM-DD HH24:MI'') AS "creationDate",
       TO_CHAR(bu.sync_date,     ''YYYY-MM-DD HH24:MI'') AS "syncDate"
FROM   rr_gl_business_units bu
WHERE  (:search  IS NULL OR UPPER(bu.business_unit_name) LIKE ''%'' || UPPER(:search) || ''%'')
AND    (:company IS NULL OR UPPER(bu.company) = UPPER(:company))
AND    (:active  IS NULL OR NVL(bu.active_flag, ''Y'') = UPPER(:active))
ORDER  BY bu.business_unit_name'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. POST gl/businessunits/create
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/businessunits/create',
        p_comments => 'Create a business unit manually');
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
        p_comments      => 'Create one business unit (manual range 900000001+)',
        p_source        => '
DECLARE
    l_body     CLOB := :body_text;
    l_name     VARCHAR2(360);
    l_company  VARCHAR2(5);
    l_le_id    NUMBER;
    l_le_name  VARCHAR2(360);
    l_ldg_id   NUMBER;
    l_ldg_name VARCHAR2(100);
    l_pc_flag  VARCHAR2(1);
    l_by       VARCHAR2(150);
    l_id       NUMBER;
    l_dup      NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name     := TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''businessUnitName''));
    l_company  := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''company'')));
    l_le_id    := APEX_JSON.GET_NUMBER(p_path => ''legalEntityId'');
    l_le_name  := APEX_JSON.GET_VARCHAR2(p_path => ''legalEntityName'');
    l_ldg_id   := APEX_JSON.GET_NUMBER(p_path => ''primaryLedgerId'');
    l_ldg_name := APEX_JSON.GET_VARCHAR2(p_path => ''ledger'');
    l_pc_flag  := NVL(UPPER(APEX_JSON.GET_VARCHAR2(p_path => ''profitCenterFlag'')), ''N'');
    l_by       := NVL(APEX_JSON.GET_VARCHAR2(p_path => ''createdBy''), ''REERP'');

    IF l_name IS NULL OR l_le_id IS NULL OR l_ldg_id IS NULL THEN
        :status_code := 400;
        HTP.P(''{"success":false,"message":"businessUnitName, legalEntityId and primaryLedgerId are required"}'');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_gl_business_units
    WHERE  UPPER(business_unit_name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P(''{"success":false,"message":"Business unit '''''' || l_name || '''''' already exists"}'');
        RETURN;
    END IF;

    SELECT GREATEST(NVL(MAX(business_unit_id), 900000000) + 1, 900000001)
    INTO   l_id
    FROM   rr_gl_business_units
    WHERE  business_unit_id BETWEEN 900000001 AND 999999999;

    INSERT INTO rr_gl_business_units
        (business_unit_id, business_unit_name, active_flag, primary_ledger_id,
         legal_entity_id, legal_entity_name, ledger, company, profit_center_flag,
         created_by, creation_date)
    VALUES
        (l_id, l_name, ''Y'', l_ldg_id,
         l_le_id, l_le_name, l_ldg_name, l_company, l_pc_flag,
         l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P(''{"success":true,"businessUnitId":'' || l_id || '',"message":"Business unit created"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P(''{"success":false,"message":"'' || REPLACE(SQLERRM, ''"'', '''''''') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. GET gl/setup/legalentities
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/setup/legalentities');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/setup/legalentities',
        p_comments => 'Legal entities for pickers');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/setup/legalentities',
        p_method      => 'GET',
        p_source_type => 'json/collection',
        p_comments    => 'List legal entities',
        p_source      => '
SELECT le.legal_entity_id                            AS "legalEntityId",
       le.name                                       AS "name",
       le.legal_entity_identifier                    AS "legalEntityIdentifier",
       le.created_by                                 AS "createdBy",
       TO_CHAR(le.creation_date, ''YYYY-MM-DD HH24:MI'') AS "creationDate",
       TO_CHAR(le.sync_date,     ''YYYY-MM-DD HH24:MI'') AS "syncDate"
FROM   rr_gl_legal_entities le
WHERE  (:search IS NULL OR UPPER(le.name) LIKE ''%'' || UPPER(:search) || ''%'')
ORDER  BY le.name'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. POST gl/legalentities/create
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/legalentities/create');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/legalentities/create',
        p_comments => 'Create a legal entity manually');
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
        p_comments      => 'Create one legal entity (manual range 900000001+)',
        p_source        => '
DECLARE
    l_body  CLOB := :body_text;
    l_name  VARCHAR2(360);
    l_ident VARCHAR2(60);
    l_by    VARCHAR2(150);
    l_id    NUMBER;
    l_dup   NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name  := TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''name''));
    l_ident := TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''legalEntityIdentifier''));
    l_by    := NVL(APEX_JSON.GET_VARCHAR2(p_path => ''createdBy''), ''REERP'');

    IF l_name IS NULL THEN
        :status_code := 400;
        HTP.P(''{"success":false,"message":"name is required"}'');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_gl_legal_entities WHERE UPPER(name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P(''{"success":false,"message":"Legal entity '''''' || l_name || '''''' already exists"}'');
        RETURN;
    END IF;

    SELECT GREATEST(NVL(MAX(legal_entity_id), 900000000) + 1, 900000001)
    INTO   l_id
    FROM   rr_gl_legal_entities
    WHERE  legal_entity_id BETWEEN 900000001 AND 999999999;

    INSERT INTO rr_gl_legal_entities
        (legal_entity_id, name, legal_entity_identifier, effective_from,
         created_by, creation_date)
    VALUES
        (l_id, l_name, l_ident, TRUNC(SYSDATE),
         l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P(''{"success":true,"legalEntityId":'' || l_id || '',"message":"Legal entity created"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P(''{"success":false,"message":"'' || REPLACE(SQLERRM, ''"'', '''''''') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. GET gl/setup/ledgers
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/setup/ledgers');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/setup/ledgers',
        p_comments => 'Ledgers for pickers');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/setup/ledgers',
        p_method      => 'GET',
        p_source_type => 'json/collection',
        p_comments    => 'List ledgers',
        p_source      => '
SELECT l.ledger_id                                   AS "ledgerId",
       l.ledger_name                                 AS "ledgerName",
       l.description                                 AS "description",
       l.ledger_category_code                        AS "ledgerCategoryCode",
       l.currency_code                               AS "currencyCode",
       l.created_by                                  AS "createdBy",
       TO_CHAR(l.creation_date, ''YYYY-MM-DD HH24:MI'') AS "creationDate"
FROM   rr_ledgers l
WHERE  (:search IS NULL OR UPPER(l.ledger_name) LIKE ''%'' || UPPER(:search) || ''%'')
ORDER  BY l.ledger_name'
    );
    COMMIT;
END;
/

-- =====================================================
-- 7. POST gl/ledgers/create
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/ledgers/create');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/ledgers/create',
        p_comments => 'Create a ledger manually');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'reerp',
        p_pattern       => 'gl/ledgers/create',
        p_method        => 'POST',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Create one ledger (manual range 900000001+)',
        p_source        => '
DECLARE
    l_body  CLOB := :body_text;
    l_name  VARCHAR2(100);
    l_desc  VARCHAR2(100);
    l_ccy   VARCHAR2(100);
    l_by    VARCHAR2(150);
    l_id    NUMBER;
    l_dup   NUMBER;
BEGIN
    APEX_JSON.PARSE(l_body);
    l_name := TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''ledgerName''));
    l_desc := TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''description''));
    l_ccy  := NVL(UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => ''currencyCode''))), ''AED'');
    l_by   := NVL(APEX_JSON.GET_VARCHAR2(p_path => ''createdBy''), ''REERP'');

    IF l_name IS NULL THEN
        :status_code := 400;
        HTP.P(''{"success":false,"message":"ledgerName is required"}'');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM rr_ledgers WHERE UPPER(ledger_name) = UPPER(l_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P(''{"success":false,"message":"Ledger '''''' || l_name || '''''' already exists"}'');
        RETURN;
    END IF;

    SELECT GREATEST(NVL(MAX(ledger_id), 900000000) + 1, 900000001)
    INTO   l_id
    FROM   rr_ledgers
    WHERE  ledger_id BETWEEN 900000001 AND 999999999;

    INSERT INTO rr_ledgers
        (ledger_id, ledger_name, description, ledger_category_code, currency_code,
         created_by, creation_date)
    VALUES
        (l_id, l_name, NVL(l_desc, l_name), ''PRIMARY'', l_ccy,
         l_by, SYSTIMESTAMP);
    COMMIT;

    :status_code := 201;
    HTP.P(''{"success":true,"ledgerId":'' || l_id || '',"message":"Ledger created"}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P(''{"success":false,"message":"'' || REPLACE(SQLERRM, ''"'', '''''''') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- VERIFY
--   GET  {base}/gl/businessunits/list           → all BUs with createdBy/creationDate
--   GET  {base}/gl/setup/legalentities          → LE picker list
--   GET  {base}/gl/setup/ledgers                → ledger picker list
--   POST {base}/gl/legalentities/create  {"name":"Test LE","createdBy":"KHALID"}       → 201
--   POST {base}/gl/ledgers/create        {"ledgerName":"Test Ledger","currencyCode":"AED","createdBy":"KHALID"} → 201
--   POST {base}/gl/businessunits/create  {"businessUnitName":"Test BU","company":"01","legalEntityId":900000001,
--                                         "legalEntityName":"Test LE","primaryLedgerId":900000001,"ledger":"Test Ledger",
--                                         "createdBy":"KHALID"} → 201
-- =====================================================
