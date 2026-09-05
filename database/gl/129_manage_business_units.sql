-- =====================================================
-- PATCH 129: Manage Business Units (GL)
--
-- New page: GL → Manage Business Units — search all BUs and create new
-- Business Units, with inline creation of Legal Entities and Ledgers.
--
-- Business units and legal entities REUSE the existing endpoints:
--   GET/POST gl/businessunits   (POST is the sync-style {items:[...]} upsert)
--   GET/POST gl/legalentities   (same style)
-- The UI generates manual ids client-side in the reserved range
-- 900000001..999999999 so they never collide with Fusion-synced ids.
--
-- This patch only adds:
--   1. CREATED_BY / CREATION_DATE audit columns on BU + ledgers tables
--   2. GET  gl/setup/ledgers   — ledger list for the picker
--   3. POST gl/ledgers/create  — create one ledger manually
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

-- NOTE: for the new audit columns to reach the UI, the existing
-- GET gl/businessunits handler's SELECT should also expose
--   created_by AS "created_by", TO_CHAR(creation_date,'YYYY-MM-DD HH24:MI') AS "creation_date"
-- and the existing POST gl/businessunits handler may optionally map the
-- extra fields the UI now sends per item: LegalEntityName, Ledger,
-- CreatedBy, CreationDate (they are safe to ignore otherwise).

-- =====================================================
-- 2. GET gl/setup/ledgers
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
-- 3. POST gl/ledgers/create
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
--   GET  {base}/gl/setup/ledgers   → ledger picker list
--   POST {base}/gl/ledgers/create  {"ledgerName":"Test Ledger","currencyCode":"AED","createdBy":"KHALID"} → 201
--   Then in the app: GL → Manage Business Units → Create Business Unit
--   (BU + LE creation go through the existing gl/businessunits and
--    gl/legalentities POST endpoints)
-- =====================================================
