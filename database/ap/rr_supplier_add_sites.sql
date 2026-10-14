-- =============================================================================
-- RR_SUPPLIER_ADD_SITES.SQL
-- Add sites (and, when the supplier has none yet, an address) to an EXISTING
-- supplier — e.g. one registered without a site, which cannot be invoiced.
--
-- The existing suppliers/sites POST endpoints are Fusion SYNC/MERGE (they need a
-- caller-supplied Fusion PK). This generates the keys server-side, exactly like
-- suppliers/create (rr_supplier_create.sql), and assigns each site to its
-- Procurement BU (RR_SUPPLIER_SITE_ASSIGNMENTS) so invoices find it.
--
-- New webservice:  POST reerp/suppliers/sites/add
--   Body:
--   {
--     "supplierId": 900000000012,                -- required
--     "createdBy": "JSMITH",
--     "address": { "addressName":"MAIN", "country":"United Arab Emirates", ... },   -- optional
--     "sites": [ { "siteCode":"DUBAI", "siteName":"Dubai Main", "procurementBu":"...",
--                  "addressName":"MAIN", "payFlag":true, "purchasingFlag":true,
--                  "paymentTerms":"Immediate", "invoiceCurrency":"AED", "status":"Active" } ]
--   }
--   Returns { success, supplierId, sites, siteIds:[...] }.
--   400 no sites / site without code · 404 supplier not found ·
--   409 a site code the supplier already has (nothing is inserted).
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole file.
-- Requires rr_supplier_create.sql (same tables). Re-runnable.
-- =============================================================================

CREATE OR REPLACE PACKAGE RR_SUPPLIER_SITES_ADD_PKG AS
  PROCEDURE ADD_SITES(p_json IN CLOB, p_status OUT NUMBER, p_result OUT CLOB);
END RR_SUPPLIER_SITES_ADD_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_SUPPLIER_SITES_ADD_PKG AS

  FUNCTION yn(p VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN LOWER(NVL(p, 'false')) IN ('y', 'true', '1', 'yes') THEN 'Y' ELSE 'N' END;
  END yn;

  PROCEDURE ADD_SITES(p_json IN CLOB, p_status OUT NUMBER, p_result OUT CLOB) IS
    v_sid       NUMBER;
    v_found     NUMBER;
    v_by        VARCHAR2(240);
    v_addr_name VARCHAR2(240);
    v_addr_id   NUMBER;
    v_site_id   NUMBER;
    v_site_base NUMBER;
    v_asgn_base NUMBER;
    v_bu_id     NUMBER;
    v_sites     NUMBER := 0;
    v_ids       VARCHAR2(4000);
    v_dups      VARCHAR2(4000);
    v_n         NUMBER;
  BEGIN
    v_sid := JSON_VALUE(p_json, '$.supplierId' RETURNING NUMBER);
    v_by  := NVL(JSON_VALUE(p_json, '$.createdBy'), 'REACTERP');
    IF v_sid IS NULL THEN
      p_status := 400; p_result := '{"success":false,"error":"supplierId is required"}'; RETURN;
    END IF;
    SELECT COUNT(*) INTO v_found FROM RR_SUPPLIER_MASTER WHERE SUPPLIER_ID = v_sid;
    IF v_found = 0 THEN
      p_status := 404; p_result := '{"success":false,"error":"Supplier ' || v_sid || ' not found"}'; RETURN;
    END IF;

    -- validate every site before inserting anything
    SELECT COUNT(*) INTO v_n FROM JSON_TABLE(p_json, '$.sites[*]' COLUMNS (rn FOR ORDINALITY));
    IF v_n = 0 THEN
      p_status := 400; p_result := '{"success":false,"error":"At least one site is required"}'; RETURN;
    END IF;
    SELECT COUNT(*) INTO v_n
    FROM   JSON_TABLE(p_json, '$.sites[*]' COLUMNS (site_code VARCHAR2(60) PATH '$.siteCode'))
    WHERE  TRIM(site_code) IS NULL;
    IF v_n > 0 THEN
      p_status := 400; p_result := '{"success":false,"error":"Every site needs a site code"}'; RETURN;
    END IF;
    SELECT LISTAGG(UPPER(j.site_code), ', ') WITHIN GROUP (ORDER BY j.site_code)
    INTO   v_dups
    FROM   JSON_TABLE(p_json, '$.sites[*]' COLUMNS (site_code VARCHAR2(60) PATH '$.siteCode')) j
    WHERE  EXISTS (SELECT 1 FROM RR_SUPPLIER_SITES s
                   WHERE s.SUPPLIER_ID = v_sid AND UPPER(s.SUPPLIER_SITE_CODE) = UPPER(TRIM(j.site_code)));
    IF v_dups IS NOT NULL THEN
      p_status := 409;
      p_result := '{"success":false,"error":"The supplier already has site ' || REPLACE(v_dups, '"', '\"') || '"}';
      RETURN;
    END IF;

    -- address: the one sent (created unless it already exists), else the supplier's first address
    v_addr_name := JSON_VALUE(p_json, '$.address.addressName');
    IF v_addr_name IS NOT NULL THEN
      SELECT COUNT(*) INTO v_n FROM RR_SUPPLIER_ADDRESS
      WHERE  SUPPLIER_ID = v_sid AND UPPER(ADDRESS_NAME) = UPPER(v_addr_name);
      IF v_n = 0 THEN
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
          yn(JSON_VALUE(p_json, '$.address.purposeOrdering')), yn(JSON_VALUE(p_json, '$.address.purposeRemitTo')),
          'Active', SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
        );
      END IF;
    ELSE
      SELECT MIN(ADDRESS_NAME) INTO v_addr_name FROM RR_SUPPLIER_ADDRESS WHERE SUPPLIER_ID = v_sid;
    END IF;

    -- sites + one assignment per site to its Procurement/Client BU
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
        v_site_id, v_sid, s.proc_bu, NVL(s.site_name, TRIM(s.site_code)), TRIM(s.site_code),
        NVL(s.addr_name, v_addr_name),
        yn(s.purch_flag), yn(s.pay_flag), yn(s.pay_flag),
        s.pay_terms, s.inv_ccy, NVL(s.st, 'Active'), SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
      );

      IF s.proc_bu IS NOT NULL THEN
        BEGIN
          SELECT BUSINESS_UNIT_ID INTO v_bu_id
          FROM   RR_GL_BUSINESS_UNITS
          WHERE  UPPER(BUSINESS_UNIT_NAME) = UPPER(s.proc_bu)
          AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_bu_id := NULL;
        END;
        v_asgn_base := v_asgn_base + 1;
        INSERT INTO RR_SUPPLIER_SITE_ASSIGNMENTS (
          ASSIGNMENT_ID, SUPPLIER_ID, SUPPLIER_SITE_ID,
          CLIENT_BU_ID, CLIENT_BU, BILL_TO_BU_ID, BILL_TO_BU,
          STATUS, CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
          v_asgn_base, v_sid, v_site_id,
          v_bu_id, s.proc_bu, v_bu_id, s.proc_bu,
          NVL(s.st, 'Active'), SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
        );
      END IF;

      v_sites := v_sites + 1;
      v_ids   := v_ids || CASE WHEN v_ids IS NOT NULL THEN ',' END || v_site_id;
    END LOOP;

    COMMIT;
    p_status := 200;
    p_result := '{"success":true,"supplierId":' || v_sid || ',"sites":' || v_sites || ',"siteIds":[' || v_ids || ']}';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END ADD_SITES;

END RR_SUPPLIER_SITES_ADD_PKG;
/

-- ── ORDS handler: POST reerp/suppliers/sites/add ──────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'suppliers/sites/add', p_method => 'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'suppliers/sites/add'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'suppliers/sites/add',
    p_priority    => 1,
    p_etag_type   => 'HASH',
    p_comments    => 'Add sites (and an address) to an existing supplier'
  );
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'suppliers/sites/add',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Add sites to an existing supplier',
    p_source         => q'[
DECLARE
  l_status NUMBER;
  l_result CLOB;
BEGIN
  RR_SUPPLIER_SITES_ADD_PKG.ADD_SITES(
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
  DBMS_OUTPUT.PUT_LINE('POST suppliers/sites/add registered OK');
END;
/

-- ── Verify the package compiled — returns NO rows after a clean run ───────────
ALTER PACKAGE RR_SUPPLIER_SITES_ADD_PKG COMPILE BODY;

SELECT name, type, line, position, text
FROM   USER_ERRORS
WHERE  name = 'RR_SUPPLIER_SITES_ADD_PKG'
ORDER  BY sequence;
