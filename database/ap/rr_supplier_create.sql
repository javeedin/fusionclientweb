-- =============================================================================
-- RR_SUPPLIER_CREATE.SQL
-- Net-new supplier creation (supplier header + one address + one or more sites).
--
-- The existing suppliers/address/sites POST endpoints are Fusion SYNC/MERGE
-- (they require a caller-supplied Fusion PK). This adds a proper CREATE that
-- generates the keys server-side.
--
-- New webservice:  POST reerp/suppliers/create
--   Body:
--   {
--     "supplier": "ACME TRADING LLC",          -- required (name)
--     "supplierNumber": "SUP-1001",            -- optional (auto if blank)
--     "alternateName": "...", "supplierType": "Supplier",
--     "taxOrganizationType": "Corporation", "businessRelationship": "Spend Authorized",
--     "taxRegistrationNumber": "...", "taxpayerId": "...", "dunsNumber": "...",
--     "status": "Active", "createdBy": "JSMITH",
--     "address": { "addressName":"MAIN", "country":"United Arab Emirates",
--                  "addressLine1":"...", "addressLine2":"...", "city":"Dubai",
--                  "state":"...", "postalCode":"...", "phoneNumber":"...",
--                  "email":"...", "purposeOrdering":true, "purposeRemitTo":true },
--     "sites": [ { "siteCode":"DUBAI", "siteName":"Dubai Main", "procurementBu":"...",
--                  "addressName":"MAIN", "payFlag":true, "purchasingFlag":true,
--                  "paymentTerms":"Immediate", "invoiceCurrency":"AED", "status":"Active" } ]
--   }
--   Returns { success, supplierId, supplierNumber, sites }.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- =============================================================================

-- ── Package ───────────────────────────────────────────────────────────────────
-- NOTE: IDs are generated with MAX(id)+1 from a high floor (900000000000) so
-- there is no dependency on sequences / CREATE SEQUENCE privilege, and no
-- collision with synced Fusion IDs.
CREATE OR REPLACE PACKAGE RR_SUPPLIER_CREATE_PKG AS
  PROCEDURE CREATE_SUPPLIER(p_json IN CLOB, p_status OUT NUMBER, p_result OUT CLOB);
END RR_SUPPLIER_CREATE_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_SUPPLIER_CREATE_PKG AS

  PROCEDURE CREATE_SUPPLIER(p_json IN CLOB, p_status OUT NUMBER, p_result OUT CLOB) IS
    v_sid       NUMBER;
    v_num       VARCHAR2(30);
    v_by        VARCHAR2(240);
    v_name      VARCHAR2(360);
    v_addr_name VARCHAR2(240);
    v_addr_id   NUMBER;
    v_site_id   NUMBER;
    v_site_base NUMBER;
    v_asgn_id   NUMBER;
    v_asgn_base NUMBER;
    v_bu_id     NUMBER;
    v_sites     NUMBER := 0;
  BEGIN
    v_name := JSON_VALUE(p_json, '$.supplier');
    IF v_name IS NULL THEN
      p_status := 400; p_result := '{"success":false,"error":"supplier (name) is required"}'; RETURN;
    END IF;
    v_by  := NVL(JSON_VALUE(p_json, '$.createdBy'), 'REACTERP');
    SELECT NVL(MAX(SUPPLIER_ID), 900000000000) + 1 INTO v_sid FROM RR_SUPPLIER_MASTER;
    v_num := NVL(JSON_VALUE(p_json, '$.supplierNumber'), 'SUP-' || v_sid);

    -- 1) Supplier header
    INSERT INTO RR_SUPPLIER_MASTER (
      SUPPLIER_ID, SUPPLIER, SUPPLIER_NUMBER, ALTERNATE_NAME, SUPPLIER_TYPE,
      TAX_ORGANIZATION_TYPE, BUSINESS_RELATIONSHIP, TAX_REGISTRATION_NUMBER, TAXPAYER_ID,
      DUNS_NUMBER, STATUS, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
      CREATION_SOURCE, SYNC_SOURCE
    ) VALUES (
      v_sid, v_name, v_num, JSON_VALUE(p_json, '$.alternateName'), JSON_VALUE(p_json, '$.supplierType'),
      JSON_VALUE(p_json, '$.taxOrganizationType'), JSON_VALUE(p_json, '$.businessRelationship'),
      JSON_VALUE(p_json, '$.taxRegistrationNumber'), JSON_VALUE(p_json, '$.taxpayerId'),
      JSON_VALUE(p_json, '$.dunsNumber'), NVL(JSON_VALUE(p_json, '$.status'), 'Active'),
      SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by, 'MANUAL', 'MANUAL'
    );

    -- 2) Address (optional)
    v_addr_name := JSON_VALUE(p_json, '$.address.addressName');
    IF v_addr_name IS NOT NULL THEN
      SELECT NVL(MAX(SUPPLIER_ADDRESS_ID), 900000000000) + 1 INTO v_addr_id FROM RR_SUPPLIER_ADDRESS;
      INSERT INTO RR_SUPPLIER_ADDRESS (
        SUPPLIER_ADDRESS_ID, SUPPLIER_ID, ADDRESS_NAME, COUNTRY, ADDRESS_LINE1, ADDRESS_LINE2,
        CITY, STATE, POSTAL_CODE, PHONE_NUMBER, EMAIL, ADDR_PURPOSE_ORDERING, ADDR_PURPOSE_REMIT_TO,
        STATUS, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
      ) VALUES (
        v_addr_id, v_sid, v_addr_name, JSON_VALUE(p_json, '$.address.country'),
        JSON_VALUE(p_json, '$.address.addressLine1'), JSON_VALUE(p_json, '$.address.addressLine2'),
        JSON_VALUE(p_json, '$.address.city'), JSON_VALUE(p_json, '$.address.state'),
        JSON_VALUE(p_json, '$.address.postalCode'), JSON_VALUE(p_json, '$.address.phoneNumber'),
        JSON_VALUE(p_json, '$.address.email'),
        CASE WHEN LOWER(NVL(JSON_VALUE(p_json, '$.address.purposeOrdering'),'false')) IN ('y','true','1','yes') THEN 'Y' ELSE 'N' END,
        CASE WHEN LOWER(NVL(JSON_VALUE(p_json, '$.address.purposeRemitTo'),'false')) IN ('y','true','1','yes') THEN 'Y' ELSE 'N' END,
        'Active', SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
      );
    END IF;

    -- 3) Sites (0..n) — increment a local counter (uncommitted rows aren't seen by MAX)
    SELECT NVL(MAX(SUPPLIER_SITE_ID), 900000000000) INTO v_site_base FROM RR_SUPPLIER_SITES;
    SELECT NVL(MAX(ASSIGNMENT_ID), 900000000000) INTO v_asgn_base FROM RR_SUPPLIER_SITE_ASSIGNMENTS;
    FOR s IN (
      SELECT * FROM JSON_TABLE(p_json, '$.sites[*]' COLUMNS (
        site_code  VARCHAR2(60)  PATH '$.siteCode',
        site_name  VARCHAR2(240) PATH '$.siteName',
        proc_bu    VARCHAR2(240) PATH '$.procurementBu',
        addr_name  VARCHAR2(240) PATH '$.addressName',
        pay_flag   VARCHAR2(10)  PATH '$.payFlag',
        purch_flag VARCHAR2(10)  PATH '$.purchasingFlag',
        pay_terms  VARCHAR2(240) PATH '$.paymentTerms',
        inv_ccy    VARCHAR2(15)  PATH '$.invoiceCurrency',
        st         VARCHAR2(30)  PATH '$.status'
      ))
    ) LOOP
      v_site_base := v_site_base + 1;
      v_site_id   := v_site_base;
      INSERT INTO RR_SUPPLIER_SITES (
        SUPPLIER_SITE_ID, SUPPLIER_ID, PROCUREMENT_BU, SUPPLIER_SITE, SUPPLIER_SITE_CODE,
        ADDRESS_NAME, PURCHASING_FLAG, PAY_FLAG, PAY_SITE_FLAG, PAYMENT_TERMS, INVOICE_CURRENCY_CODE,
        STATUS, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
      ) VALUES (
        v_site_id, v_sid, s.proc_bu, NVL(s.site_name, s.site_code), s.site_code,
        NVL(s.addr_name, v_addr_name),
        CASE WHEN LOWER(NVL(s.purch_flag,'false')) IN ('y','true','1','yes') THEN 'Y' ELSE 'N' END,
        CASE WHEN LOWER(NVL(s.pay_flag,'false')) IN ('y','true','1','yes') THEN 'Y' ELSE 'N' END,
        CASE WHEN LOWER(NVL(s.pay_flag,'false')) IN ('y','true','1','yes') THEN 'Y' ELSE 'N' END,
        s.pay_terms, s.inv_ccy, NVL(s.st, 'Active'), SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
      );

      -- 3a) Site assignment — one row per site tying it to its Procurement/Client BU
      IF s.proc_bu IS NOT NULL THEN
        BEGIN
          SELECT BUSINESS_UNIT_ID INTO v_bu_id
          FROM   RR_GL_BUSINESS_UNITS
          WHERE  UPPER(BUSINESS_UNIT_NAME) = UPPER(s.proc_bu)
          AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_bu_id := NULL;
        END;
        v_asgn_base := v_asgn_base + 1;
        v_asgn_id   := v_asgn_base;
        INSERT INTO RR_SUPPLIER_SITE_ASSIGNMENTS (
          ASSIGNMENT_ID, SUPPLIER_ID, SUPPLIER_SITE_ID,
          CLIENT_BU_ID, CLIENT_BU, BILL_TO_BU_ID, BILL_TO_BU,
          STATUS, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
          v_asgn_id, v_sid, v_site_id,
          v_bu_id, s.proc_bu, v_bu_id, s.proc_bu,
          NVL(s.st, 'Active'), SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
        );
      END IF;

      v_sites := v_sites + 1;
    END LOOP;

    COMMIT;
    p_status := 200;
    p_result := '{"success":true,"supplierId":' || v_sid
             || ',"supplierNumber":"' || REPLACE(v_num, '"', '\"') || '"'
             || ',"sites":' || v_sites || '}';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END CREATE_SUPPLIER;

END RR_SUPPLIER_CREATE_PKG;
/

-- ── ORDS handler: POST reerp/suppliers/create ─────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'suppliers/create', p_method => 'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'suppliers/create'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'suppliers/create',
    p_priority    => 1,
    p_etag_type   => 'HASH',
    p_comments    => 'Create a net-new supplier + address + sites'
  );
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'suppliers/create',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Create a net-new supplier',
    p_source         => q'[
DECLARE
  l_status NUMBER;
  l_result CLOB;
BEGIN
  RR_SUPPLIER_CREATE_PKG.CREATE_SUPPLIER(
    p_json   => :body_text,
    p_status => l_status,
    p_result => l_result
  );
  :status_code := l_status;
  HTP.P(l_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
  );
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('POST suppliers/create registered OK');
END;
/

-- ── Verify the package compiled (this is what ORA-06508 is about) ─────────────
-- Recompile and list any errors. After a clean run this returns NO rows.
ALTER PACKAGE RR_SUPPLIER_CREATE_PKG COMPILE BODY;

SELECT name, type, line, position, text
FROM   USER_ERRORS
WHERE  name = 'RR_SUPPLIER_CREATE_PKG'
ORDER  BY sequence;
