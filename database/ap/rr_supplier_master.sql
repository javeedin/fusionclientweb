-- =============================================
-- RR_SUPPLIER_MASTER Table and Sync Procedure
-- For syncing Suppliers from Oracle Fusion
-- =============================================

-- Drop existing objects (optional, for clean setup)
-- DROP TABLE RR_SUPPLIER_MASTER;
-- DROP PROCEDURE RR_SYNC_SUPPLIERS;

-- =============================================
-- 1. Create the RR_SUPPLIER_MASTER table
-- =============================================
CREATE TABLE RR_SUPPLIER_MASTER (
    SUPPLIER_ID                    NUMBER PRIMARY KEY,
    SUPPLIER_PARTY_ID              NUMBER,
    SUPPLIER                       VARCHAR2(360),
    SUPPLIER_NUMBER                VARCHAR2(30),
    ALTERNATE_NAME                 VARCHAR2(360),
    TAX_ORGANIZATION_TYPE_CODE     VARCHAR2(30),
    TAX_ORGANIZATION_TYPE          VARCHAR2(80),
    SUPPLIER_TYPE_CODE             VARCHAR2(30),
    SUPPLIER_TYPE                  VARCHAR2(80),
    INACTIVE_DATE                  TIMESTAMP WITH TIME ZONE,
    STATUS                         VARCHAR2(30),
    BUSINESS_RELATIONSHIP_CODE     VARCHAR2(30),
    BUSINESS_RELATIONSHIP          VARCHAR2(80),
    PARENT_SUPPLIER_ID             NUMBER,
    PARENT_SUPPLIER                VARCHAR2(360),
    PARENT_SUPPLIER_NUMBER         VARCHAR2(30),
    CREATION_DATE                  TIMESTAMP WITH TIME ZONE,
    CREATED_BY                     VARCHAR2(240),
    LAST_UPDATE_DATE               TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY                VARCHAR2(240),
    CREATION_SOURCE_CODE           VARCHAR2(30),
    CREATION_SOURCE                VARCHAR2(80),
    ALIAS                          VARCHAR2(360),
    DUNS_NUMBER                    VARCHAR2(30),
    ONE_TIME_SUPPLIER_FLAG         VARCHAR2(1),
    REGISTRY_ID                    VARCHAR2(30),
    CUSTOMER_NUMBER                VARCHAR2(30),
    CORPORATE_WEBSITE              VARCHAR2(2000),
    TAX_REGISTRATION_COUNTRY_CODE  VARCHAR2(30),
    TAX_REGISTRATION_COUNTRY       VARCHAR2(80),
    TAX_REGISTRATION_NUMBER        VARCHAR2(50),
    TAXPAYER_COUNTRY_CODE          VARCHAR2(30),
    TAXPAYER_COUNTRY               VARCHAR2(80),
    TAXPAYER_ID                    VARCHAR2(50),
    -- Audit columns
    SYNC_DATE                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SYNC_SOURCE                    VARCHAR2(50) DEFAULT 'ORACLE_FUSION'
);

-- Create indexes for performance
CREATE INDEX IDX_SUPPLIER_NUMBER ON RR_SUPPLIER_MASTER(SUPPLIER_NUMBER);
CREATE INDEX IDX_SUPPLIER_NAME ON RR_SUPPLIER_MASTER(SUPPLIER);
CREATE INDEX IDX_SUPPLIER_STATUS ON RR_SUPPLIER_MASTER(STATUS);
CREATE INDEX IDX_SUPPLIER_PARENT ON RR_SUPPLIER_MASTER(PARENT_SUPPLIER_ID);

-- =============================================
-- 2. Create the sync procedure (MERGE/Upsert)
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_SUPPLIERS (
    p_json_data IN CLOB,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- MERGE (upsert) suppliers from JSON
    MERGE INTO RR_SUPPLIER_MASTER target
    USING (
        SELECT
            jt.SUPPLIER_ID,
            jt.SUPPLIER_PARTY_ID,
            jt.SUPPLIER,
            jt.SUPPLIER_NUMBER,
            jt.ALTERNATE_NAME,
            jt.TAX_ORGANIZATION_TYPE_CODE,
            jt.TAX_ORGANIZATION_TYPE,
            jt.SUPPLIER_TYPE_CODE,
            jt.SUPPLIER_TYPE,
            CASE
                WHEN jt.INACTIVE_DATE IS NOT NULL AND INSTR(jt.INACTIVE_DATE, '.') > 0
                THEN TO_TIMESTAMP_TZ(jt.INACTIVE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')
                WHEN jt.INACTIVE_DATE IS NOT NULL
                THEN TO_TIMESTAMP_TZ(jt.INACTIVE_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
                ELSE NULL
            END AS INACTIVE_DATE,
            jt.STATUS,
            jt.BUSINESS_RELATIONSHIP_CODE,
            jt.BUSINESS_RELATIONSHIP,
            jt.PARENT_SUPPLIER_ID,
            jt.PARENT_SUPPLIER,
            jt.PARENT_SUPPLIER_NUMBER,
            CASE
                WHEN INSTR(jt.CREATION_DATE, '.') > 0
                THEN TO_TIMESTAMP_TZ(jt.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')
                ELSE TO_TIMESTAMP_TZ(jt.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
            END AS CREATION_DATE,
            jt.CREATED_BY,
            CASE
                WHEN INSTR(jt.LAST_UPDATE_DATE, '.') > 0
                THEN TO_TIMESTAMP_TZ(jt.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')
                ELSE TO_TIMESTAMP_TZ(jt.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
            END AS LAST_UPDATE_DATE,
            jt.LAST_UPDATED_BY,
            jt.CREATION_SOURCE_CODE,
            jt.CREATION_SOURCE,
            jt.ALIAS,
            jt.DUNS_NUMBER,
            jt.ONE_TIME_SUPPLIER_FLAG,
            jt.REGISTRY_ID,
            jt.CUSTOMER_NUMBER,
            jt.CORPORATE_WEBSITE,
            jt.TAX_REGISTRATION_COUNTRY_CODE,
            jt.TAX_REGISTRATION_COUNTRY,
            jt.TAX_REGISTRATION_NUMBER,
            jt.TAXPAYER_COUNTRY_CODE,
            jt.TAXPAYER_COUNTRY,
            jt.TAXPAYER_ID
        FROM JSON_TABLE(
            p_json_data,
            '$.items[*]'
            COLUMNS (
                SUPPLIER_ID                    NUMBER         PATH '$.SupplierId',
                SUPPLIER_PARTY_ID              NUMBER         PATH '$.SupplierPartyId',
                SUPPLIER                       VARCHAR2(360)  PATH '$.Supplier',
                SUPPLIER_NUMBER                VARCHAR2(30)   PATH '$.SupplierNumber',
                ALTERNATE_NAME                 VARCHAR2(360)  PATH '$.AlternateName',
                TAX_ORGANIZATION_TYPE_CODE     VARCHAR2(30)   PATH '$.TaxOrganizationTypeCode',
                TAX_ORGANIZATION_TYPE          VARCHAR2(80)   PATH '$.TaxOrganizationType',
                SUPPLIER_TYPE_CODE             VARCHAR2(30)   PATH '$.SupplierTypeCode',
                SUPPLIER_TYPE                  VARCHAR2(80)   PATH '$.SupplierType',
                INACTIVE_DATE                  VARCHAR2(50)   PATH '$.InactiveDate',
                STATUS                         VARCHAR2(30)   PATH '$.Status',
                BUSINESS_RELATIONSHIP_CODE     VARCHAR2(30)   PATH '$.BusinessRelationshipCode',
                BUSINESS_RELATIONSHIP          VARCHAR2(80)   PATH '$.BusinessRelationship',
                PARENT_SUPPLIER_ID             NUMBER         PATH '$.ParentSupplierId',
                PARENT_SUPPLIER                VARCHAR2(360)  PATH '$.ParentSupplier',
                PARENT_SUPPLIER_NUMBER         VARCHAR2(30)   PATH '$.ParentSupplierNumber',
                CREATION_DATE                  VARCHAR2(50)   PATH '$.CreationDate',
                CREATED_BY                     VARCHAR2(240)  PATH '$.CreatedBy',
                LAST_UPDATE_DATE               VARCHAR2(50)   PATH '$.LastUpdateDate',
                LAST_UPDATED_BY                VARCHAR2(240)  PATH '$.LastUpdatedBy',
                CREATION_SOURCE_CODE           VARCHAR2(30)   PATH '$.CreationSourceCode',
                CREATION_SOURCE                VARCHAR2(80)   PATH '$.CreationSource',
                ALIAS                          VARCHAR2(360)  PATH '$.Alias',
                DUNS_NUMBER                    VARCHAR2(30)   PATH '$.DUNSNumber',
                ONE_TIME_SUPPLIER_FLAG         VARCHAR2(1)    PATH '$.OneTimeSupplierFlag',
                REGISTRY_ID                    VARCHAR2(30)   PATH '$.RegistryId',
                CUSTOMER_NUMBER                VARCHAR2(30)   PATH '$.CustomerNumber',
                CORPORATE_WEBSITE              VARCHAR2(2000) PATH '$.CorporateWebsite',
                TAX_REGISTRATION_COUNTRY_CODE  VARCHAR2(30)   PATH '$.TaxRegistrationCountryCode',
                TAX_REGISTRATION_COUNTRY       VARCHAR2(80)   PATH '$.TaxRegistrationCountry',
                TAX_REGISTRATION_NUMBER        VARCHAR2(50)   PATH '$.TaxRegistrationNumber',
                TAXPAYER_COUNTRY_CODE          VARCHAR2(30)   PATH '$.TaxpayerCountryCode',
                TAXPAYER_COUNTRY               VARCHAR2(80)   PATH '$.TaxpayerCountry',
                TAXPAYER_ID                    VARCHAR2(50)   PATH '$.TaxpayerId'
            )
        ) jt
        WHERE jt.SUPPLIER_ID IS NOT NULL
    ) source
    ON (target.SUPPLIER_ID = source.SUPPLIER_ID)
    WHEN MATCHED THEN
        UPDATE SET
            target.SUPPLIER_PARTY_ID = source.SUPPLIER_PARTY_ID,
            target.SUPPLIER = source.SUPPLIER,
            target.SUPPLIER_NUMBER = source.SUPPLIER_NUMBER,
            target.ALTERNATE_NAME = source.ALTERNATE_NAME,
            target.TAX_ORGANIZATION_TYPE_CODE = source.TAX_ORGANIZATION_TYPE_CODE,
            target.TAX_ORGANIZATION_TYPE = source.TAX_ORGANIZATION_TYPE,
            target.SUPPLIER_TYPE_CODE = source.SUPPLIER_TYPE_CODE,
            target.SUPPLIER_TYPE = source.SUPPLIER_TYPE,
            target.INACTIVE_DATE = source.INACTIVE_DATE,
            target.STATUS = source.STATUS,
            target.BUSINESS_RELATIONSHIP_CODE = source.BUSINESS_RELATIONSHIP_CODE,
            target.BUSINESS_RELATIONSHIP = source.BUSINESS_RELATIONSHIP,
            target.PARENT_SUPPLIER_ID = source.PARENT_SUPPLIER_ID,
            target.PARENT_SUPPLIER = source.PARENT_SUPPLIER,
            target.PARENT_SUPPLIER_NUMBER = source.PARENT_SUPPLIER_NUMBER,
            target.CREATION_DATE = source.CREATION_DATE,
            target.CREATED_BY = source.CREATED_BY,
            target.LAST_UPDATE_DATE = source.LAST_UPDATE_DATE,
            target.LAST_UPDATED_BY = source.LAST_UPDATED_BY,
            target.CREATION_SOURCE_CODE = source.CREATION_SOURCE_CODE,
            target.CREATION_SOURCE = source.CREATION_SOURCE,
            target.ALIAS = source.ALIAS,
            target.DUNS_NUMBER = source.DUNS_NUMBER,
            target.ONE_TIME_SUPPLIER_FLAG = source.ONE_TIME_SUPPLIER_FLAG,
            target.REGISTRY_ID = source.REGISTRY_ID,
            target.CUSTOMER_NUMBER = source.CUSTOMER_NUMBER,
            target.CORPORATE_WEBSITE = source.CORPORATE_WEBSITE,
            target.TAX_REGISTRATION_COUNTRY_CODE = source.TAX_REGISTRATION_COUNTRY_CODE,
            target.TAX_REGISTRATION_COUNTRY = source.TAX_REGISTRATION_COUNTRY,
            target.TAX_REGISTRATION_NUMBER = source.TAX_REGISTRATION_NUMBER,
            target.TAXPAYER_COUNTRY_CODE = source.TAXPAYER_COUNTRY_CODE,
            target.TAXPAYER_COUNTRY = source.TAXPAYER_COUNTRY,
            target.TAXPAYER_ID = source.TAXPAYER_ID,
            target.SYNC_DATE = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            SUPPLIER_ID, SUPPLIER_PARTY_ID, SUPPLIER, SUPPLIER_NUMBER, ALTERNATE_NAME,
            TAX_ORGANIZATION_TYPE_CODE, TAX_ORGANIZATION_TYPE, SUPPLIER_TYPE_CODE, SUPPLIER_TYPE,
            INACTIVE_DATE, STATUS, BUSINESS_RELATIONSHIP_CODE, BUSINESS_RELATIONSHIP,
            PARENT_SUPPLIER_ID, PARENT_SUPPLIER, PARENT_SUPPLIER_NUMBER,
            CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
            CREATION_SOURCE_CODE, CREATION_SOURCE, ALIAS, DUNS_NUMBER,
            ONE_TIME_SUPPLIER_FLAG, REGISTRY_ID, CUSTOMER_NUMBER, CORPORATE_WEBSITE,
            TAX_REGISTRATION_COUNTRY_CODE, TAX_REGISTRATION_COUNTRY, TAX_REGISTRATION_NUMBER,
            TAXPAYER_COUNTRY_CODE, TAXPAYER_COUNTRY, TAXPAYER_ID,
            SYNC_DATE, SYNC_SOURCE
        )
        VALUES (
            source.SUPPLIER_ID, source.SUPPLIER_PARTY_ID, source.SUPPLIER, source.SUPPLIER_NUMBER, source.ALTERNATE_NAME,
            source.TAX_ORGANIZATION_TYPE_CODE, source.TAX_ORGANIZATION_TYPE, source.SUPPLIER_TYPE_CODE, source.SUPPLIER_TYPE,
            source.INACTIVE_DATE, source.STATUS, source.BUSINESS_RELATIONSHIP_CODE, source.BUSINESS_RELATIONSHIP,
            source.PARENT_SUPPLIER_ID, source.PARENT_SUPPLIER, source.PARENT_SUPPLIER_NUMBER,
            source.CREATION_DATE, source.CREATED_BY, source.LAST_UPDATE_DATE, source.LAST_UPDATED_BY,
            source.CREATION_SOURCE_CODE, source.CREATION_SOURCE, source.ALIAS, source.DUNS_NUMBER,
            source.ONE_TIME_SUPPLIER_FLAG, source.REGISTRY_ID, source.CUSTOMER_NUMBER, source.CORPORATE_WEBSITE,
            source.TAX_REGISTRATION_COUNTRY_CODE, source.TAX_REGISTRATION_COUNTRY, source.TAX_REGISTRATION_NUMBER,
            source.TAXPAYER_COUNTRY_CODE, source.TAXPAYER_COUNTRY, source.TAXPAYER_ID,
            CURRENT_TIMESTAMP, 'ORACLE_FUSION'
        );

    v_count := SQL%ROWCOUNT;
    COMMIT;

    p_result := '{"success": true, "message": "Synced ' || v_count || ' suppliers", "count": ' || v_count || '}';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := '{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
END RR_SYNC_SUPPLIERS;
/

-- =============================================
-- 3. Create APEX REST Handlers
-- =============================================

-- GET Handler - Fetch Suppliers list
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Get Suppliers from RR_SUPPLIER_MASTER',
        p_source         => q'[
SELECT DISTINCT
    s.supplier_id,
    s.supplier,
    s.supplier_number,
    s.alternate_name,
    s.status,
    s.supplier_type,
    s.taxpayer_id,
    TO_CHAR(s.creation_date, 'YYYY-MM-DD') AS creation_date
FROM RR_SUPPLIER_MASTER s
WHERE (:supplier_number IS NULL OR UPPER(s.supplier_number) LIKE '%' || UPPER(:supplier_number) || '%')
  AND (:supplier         IS NULL OR UPPER(s.supplier)        LIKE '%' || UPPER(:supplier)        || '%')
  AND (:q               IS NULL OR (
           UPPER(s.supplier_number) LIKE '%' || UPPER(:q) || '%'
        OR UPPER(s.supplier)        LIKE '%' || UPPER(:q) || '%'
      ))
  AND (:P_BUSINESS_UNIT IS NULL OR EXISTS (
        SELECT 1 FROM RR_SUPPLIER_SITE_ASSIGNMENTS a
        WHERE a.supplier_id = s.supplier_id
          AND a.client_bu   = :P_BUSINESS_UNIT
      ))
ORDER BY s.supplier
]'
    );
    COMMIT;
END;
/

-- Register P_BUSINESS_UNIT as a formal query-string parameter
BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'suppliers',
        p_method             => 'GET',
        p_name               => 'P_BUSINESS_UNIT',
        p_bind_variable_name => 'P_BUSINESS_UNIT',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter suppliers by Procurement Business Unit name'
    );
    COMMIT;
END;
/

-- GET Handler - Fetch distinct Procurement Business Units (used to populate UI dropdowns)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'business-units',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Get distinct Procurement Business Units from RR_SUPPLIER_SITES',
        p_source         => q'[
SELECT DISTINCT
    PROCUREMENT_BU   AS business_unit
FROM RR_SUPPLIER_SITES
WHERE PROCUREMENT_BU IS NOT NULL
ORDER BY PROCUREMENT_BU
]'
    );
    COMMIT;
END;
/

-- POST Handler - Sync Suppliers from Oracle Fusion
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync Suppliers from Oracle Fusion',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    RR_SYNC_SUPPLIERS(
        p_json_data => l_json_clob,
        p_result    => l_result
    );

    :status_code := 200;
    HTP.P(l_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- =============================================
-- Verification Queries
-- =============================================
-- SELECT COUNT(*) FROM RR_SUPPLIER_MASTER;
-- SELECT SUPPLIER_ID, SUPPLIER_NUMBER, SUPPLIER, STATUS FROM RR_SUPPLIER_MASTER WHERE ROWNUM <= 10;
-- SELECT STATUS, COUNT(*) FROM RR_SUPPLIER_MASTER GROUP BY STATUS;
