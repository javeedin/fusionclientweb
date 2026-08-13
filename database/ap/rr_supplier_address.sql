-- =============================================
-- RR_SUPPLIER_ADDRESS Table, Procedure, and APEX Handler
-- Supplier Addresses from Oracle Fusion
-- =============================================

-- Drop existing objects (optional, comment out in production)
-- DROP TABLE RR_SUPPLIER_ADDRESS CASCADE CONSTRAINTS;

-- =============================================
-- 1. Create Table
-- =============================================
CREATE TABLE RR_SUPPLIER_ADDRESS (
    SUPPLIER_ADDRESS_ID       NUMBER PRIMARY KEY,
    SUPPLIER_ID               NUMBER NOT NULL,
    ADDRESS_NAME              VARCHAR2(240),
    COUNTRY_CODE              VARCHAR2(10),
    COUNTRY                   VARCHAR2(240),
    ADDRESS_LINE1             VARCHAR2(240),
    ADDRESS_LINE2             VARCHAR2(240),
    ADDRESS_LINE3             VARCHAR2(240),
    ADDRESS_LINE4             VARCHAR2(240),
    CITY                      VARCHAR2(240),
    STATE                     VARCHAR2(240),
    POSTAL_CODE               VARCHAR2(60),
    POSTAL_CODE_EXTENSION     VARCHAR2(60),
    PROVINCE                  VARCHAR2(240),
    COUNTY                    VARCHAR2(240),
    BUILDING                  VARCHAR2(240),
    FLOOR_NUMBER              VARCHAR2(60),
    PHONETIC_ADDRESS          VARCHAR2(500),
    LANGUAGE_CODE             VARCHAR2(10),
    LANGUAGE                  VARCHAR2(100),
    ADDRESSEE                 VARCHAR2(240),
    GLOBAL_LOCATION_NUMBER    VARCHAR2(60),
    ADDITIONAL_ADDR_ATTR1     VARCHAR2(240),
    ADDITIONAL_ADDR_ATTR2     VARCHAR2(240),
    ADDITIONAL_ADDR_ATTR3     VARCHAR2(240),
    ADDITIONAL_ADDR_ATTR4     VARCHAR2(240),
    ADDITIONAL_ADDR_ATTR5     VARCHAR2(240),
    FORMATTED_ADDRESS         VARCHAR2(1000),
    ADDR_PURPOSE_ORDERING     VARCHAR2(1),
    ADDR_PURPOSE_REMIT_TO     VARCHAR2(1),
    ADDR_PURPOSE_RFQ_BIDDING  VARCHAR2(1),
    PHONE_COUNTRY_CODE        VARCHAR2(10),
    PHONE_AREA_CODE           VARCHAR2(20),
    PHONE_NUMBER              VARCHAR2(60),
    PHONE_EXTENSION           VARCHAR2(20),
    FAX_COUNTRY_CODE          VARCHAR2(10),
    FAX_AREA_CODE             VARCHAR2(20),
    FAX_NUMBER                VARCHAR2(60),
    EMAIL                     VARCHAR2(320),
    INACTIVE_DATE             DATE,
    STATUS                    VARCHAR2(30),
    ADDRESS_PARTY_NUMBER      VARCHAR2(60),
    CREATION_DATE             TIMESTAMP WITH TIME ZONE,
    CREATED_BY                VARCHAR2(240),
    LAST_UPDATE_DATE          TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY           VARCHAR2(240),
    SYNC_TIMESTAMP            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on SUPPLIER_ID for faster lookups
CREATE INDEX IDX_SUPPLIER_ADDRESS_SUPPLIER ON RR_SUPPLIER_ADDRESS(SUPPLIER_ID);

-- Add comments
COMMENT ON TABLE RR_SUPPLIER_ADDRESS IS 'Supplier Addresses synced from Oracle Fusion';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.SUPPLIER_ADDRESS_ID IS 'Unique identifier for the supplier address';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.SUPPLIER_ID IS 'Foreign key to RR_SUPPLIER_MASTER';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.ADDRESS_NAME IS 'Name of the address';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.FORMATTED_ADDRESS IS 'Full formatted address';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.ADDR_PURPOSE_ORDERING IS 'Address purpose for ordering (Y/N)';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.ADDR_PURPOSE_REMIT_TO IS 'Address purpose for remit to (Y/N)';
COMMENT ON COLUMN RR_SUPPLIER_ADDRESS.ADDR_PURPOSE_RFQ_BIDDING IS 'Address purpose for RFQ/Bidding (Y/N)';

-- =============================================
-- 2. Create Sync Procedure
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_SUPPLIER_ADDRESS (
    p_json_data IN CLOB,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- Merge (upsert) data from JSON
    MERGE INTO RR_SUPPLIER_ADDRESS tgt
    USING (
        SELECT
            jt.SUPPLIER_ADDRESS_ID,
            jt.SUPPLIER_ID,
            jt.ADDRESS_NAME,
            jt.COUNTRY_CODE,
            jt.COUNTRY,
            jt.ADDRESS_LINE1,
            jt.ADDRESS_LINE2,
            jt.ADDRESS_LINE3,
            jt.ADDRESS_LINE4,
            jt.CITY,
            jt.STATE,
            jt.POSTAL_CODE,
            jt.POSTAL_CODE_EXTENSION,
            jt.PROVINCE,
            jt.COUNTY,
            jt.BUILDING,
            jt.FLOOR_NUMBER,
            jt.PHONETIC_ADDRESS,
            jt.LANGUAGE_CODE,
            jt.LANGUAGE,
            jt.ADDRESSEE,
            jt.GLOBAL_LOCATION_NUMBER,
            jt.ADDITIONAL_ADDR_ATTR1,
            jt.ADDITIONAL_ADDR_ATTR2,
            jt.ADDITIONAL_ADDR_ATTR3,
            jt.ADDITIONAL_ADDR_ATTR4,
            jt.ADDITIONAL_ADDR_ATTR5,
            jt.FORMATTED_ADDRESS,
            CASE WHEN jt.ADDR_PURPOSE_ORDERING = 'true' THEN 'Y' ELSE 'N' END AS ADDR_PURPOSE_ORDERING,
            CASE WHEN jt.ADDR_PURPOSE_REMIT_TO = 'true' THEN 'Y' ELSE 'N' END AS ADDR_PURPOSE_REMIT_TO,
            CASE WHEN jt.ADDR_PURPOSE_RFQ_BIDDING = 'true' THEN 'Y' ELSE 'N' END AS ADDR_PURPOSE_RFQ_BIDDING,
            jt.PHONE_COUNTRY_CODE,
            jt.PHONE_AREA_CODE,
            jt.PHONE_NUMBER,
            jt.PHONE_EXTENSION,
            jt.FAX_COUNTRY_CODE,
            jt.FAX_AREA_CODE,
            jt.FAX_NUMBER,
            jt.EMAIL,
            CASE
                WHEN jt.INACTIVE_DATE IS NOT NULL AND jt.INACTIVE_DATE != '4712-12-31'
                THEN TO_DATE(SUBSTR(jt.INACTIVE_DATE, 1, 10), 'YYYY-MM-DD')
                ELSE NULL
            END AS INACTIVE_DATE,
            jt.STATUS,
            jt.ADDRESS_PARTY_NUMBER,
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
            jt.LAST_UPDATED_BY
        FROM JSON_TABLE(p_json_data, '$.items[*]'
            COLUMNS (
                SUPPLIER_ADDRESS_ID       NUMBER          PATH '$.SupplierAddressId',
                SUPPLIER_ID               NUMBER          PATH '$.SupplierId',
                ADDRESS_NAME              VARCHAR2(240)   PATH '$.AddressName',
                COUNTRY_CODE              VARCHAR2(10)    PATH '$.CountryCode',
                COUNTRY                   VARCHAR2(240)   PATH '$.Country',
                ADDRESS_LINE1             VARCHAR2(240)   PATH '$.AddressLine1',
                ADDRESS_LINE2             VARCHAR2(240)   PATH '$.AddressLine2',
                ADDRESS_LINE3             VARCHAR2(240)   PATH '$.AddressLine3',
                ADDRESS_LINE4             VARCHAR2(240)   PATH '$.AddressLine4',
                CITY                      VARCHAR2(240)   PATH '$.City',
                STATE                     VARCHAR2(240)   PATH '$.State',
                POSTAL_CODE               VARCHAR2(60)    PATH '$.PostalCode',
                POSTAL_CODE_EXTENSION     VARCHAR2(60)    PATH '$.PostalCodeExtension',
                PROVINCE                  VARCHAR2(240)   PATH '$.Province',
                COUNTY                    VARCHAR2(240)   PATH '$.County',
                BUILDING                  VARCHAR2(240)   PATH '$.Building',
                FLOOR_NUMBER              VARCHAR2(60)    PATH '$.FloorNumber',
                PHONETIC_ADDRESS          VARCHAR2(500)   PATH '$.PhoneticAddress',
                LANGUAGE_CODE             VARCHAR2(10)    PATH '$.LanguageCode',
                LANGUAGE                  VARCHAR2(100)   PATH '$.Language',
                ADDRESSEE                 VARCHAR2(240)   PATH '$.Addressee',
                GLOBAL_LOCATION_NUMBER    VARCHAR2(60)    PATH '$.GlobalLocationNumber',
                ADDITIONAL_ADDR_ATTR1     VARCHAR2(240)   PATH '$.AdditionalAddressAttribute1',
                ADDITIONAL_ADDR_ATTR2     VARCHAR2(240)   PATH '$.AdditionalAddressAttribute2',
                ADDITIONAL_ADDR_ATTR3     VARCHAR2(240)   PATH '$.AdditionalAddressAttribute3',
                ADDITIONAL_ADDR_ATTR4     VARCHAR2(240)   PATH '$.AdditionalAddressAttribute4',
                ADDITIONAL_ADDR_ATTR5     VARCHAR2(240)   PATH '$.AdditionalAddressAttribute5',
                FORMATTED_ADDRESS         VARCHAR2(1000)  PATH '$.FormattedAddress',
                ADDR_PURPOSE_ORDERING     VARCHAR2(10)    PATH '$.AddressPurposeOrderingFlag',
                ADDR_PURPOSE_REMIT_TO     VARCHAR2(10)    PATH '$.AddressPurposeRemitToFlag',
                ADDR_PURPOSE_RFQ_BIDDING  VARCHAR2(10)    PATH '$.AddressPurposeRFQOrBiddingFlag',
                PHONE_COUNTRY_CODE        VARCHAR2(10)    PATH '$.PhoneCountryCode',
                PHONE_AREA_CODE           VARCHAR2(20)    PATH '$.PhoneAreaCode',
                PHONE_NUMBER              VARCHAR2(60)    PATH '$.PhoneNumber',
                PHONE_EXTENSION           VARCHAR2(20)    PATH '$.PhoneExtension',
                FAX_COUNTRY_CODE          VARCHAR2(10)    PATH '$.FaxCountryCode',
                FAX_AREA_CODE             VARCHAR2(20)    PATH '$.FaxAreaCode',
                FAX_NUMBER                VARCHAR2(60)    PATH '$.FaxNumber',
                EMAIL                     VARCHAR2(320)   PATH '$.Email',
                INACTIVE_DATE             VARCHAR2(30)    PATH '$.InactiveDate',
                STATUS                    VARCHAR2(30)    PATH '$.Status',
                ADDRESS_PARTY_NUMBER      VARCHAR2(60)    PATH '$.AddressPartyNumber',
                CREATION_DATE             VARCHAR2(50)    PATH '$.CreationDate',
                CREATED_BY                VARCHAR2(240)   PATH '$.CreatedBy',
                LAST_UPDATE_DATE          VARCHAR2(50)    PATH '$.LastUpdateDate',
                LAST_UPDATED_BY           VARCHAR2(240)   PATH '$.LastUpdatedBy'
            )
        ) jt
        WHERE jt.SUPPLIER_ADDRESS_ID IS NOT NULL
    ) src
    ON (tgt.SUPPLIER_ADDRESS_ID = src.SUPPLIER_ADDRESS_ID)
    WHEN MATCHED THEN
        UPDATE SET
            tgt.SUPPLIER_ID = src.SUPPLIER_ID,
            tgt.ADDRESS_NAME = src.ADDRESS_NAME,
            tgt.COUNTRY_CODE = src.COUNTRY_CODE,
            tgt.COUNTRY = src.COUNTRY,
            tgt.ADDRESS_LINE1 = src.ADDRESS_LINE1,
            tgt.ADDRESS_LINE2 = src.ADDRESS_LINE2,
            tgt.ADDRESS_LINE3 = src.ADDRESS_LINE3,
            tgt.ADDRESS_LINE4 = src.ADDRESS_LINE4,
            tgt.CITY = src.CITY,
            tgt.STATE = src.STATE,
            tgt.POSTAL_CODE = src.POSTAL_CODE,
            tgt.POSTAL_CODE_EXTENSION = src.POSTAL_CODE_EXTENSION,
            tgt.PROVINCE = src.PROVINCE,
            tgt.COUNTY = src.COUNTY,
            tgt.BUILDING = src.BUILDING,
            tgt.FLOOR_NUMBER = src.FLOOR_NUMBER,
            tgt.PHONETIC_ADDRESS = src.PHONETIC_ADDRESS,
            tgt.LANGUAGE_CODE = src.LANGUAGE_CODE,
            tgt.LANGUAGE = src.LANGUAGE,
            tgt.ADDRESSEE = src.ADDRESSEE,
            tgt.GLOBAL_LOCATION_NUMBER = src.GLOBAL_LOCATION_NUMBER,
            tgt.ADDITIONAL_ADDR_ATTR1 = src.ADDITIONAL_ADDR_ATTR1,
            tgt.ADDITIONAL_ADDR_ATTR2 = src.ADDITIONAL_ADDR_ATTR2,
            tgt.ADDITIONAL_ADDR_ATTR3 = src.ADDITIONAL_ADDR_ATTR3,
            tgt.ADDITIONAL_ADDR_ATTR4 = src.ADDITIONAL_ADDR_ATTR4,
            tgt.ADDITIONAL_ADDR_ATTR5 = src.ADDITIONAL_ADDR_ATTR5,
            tgt.FORMATTED_ADDRESS = src.FORMATTED_ADDRESS,
            tgt.ADDR_PURPOSE_ORDERING = src.ADDR_PURPOSE_ORDERING,
            tgt.ADDR_PURPOSE_REMIT_TO = src.ADDR_PURPOSE_REMIT_TO,
            tgt.ADDR_PURPOSE_RFQ_BIDDING = src.ADDR_PURPOSE_RFQ_BIDDING,
            tgt.PHONE_COUNTRY_CODE = src.PHONE_COUNTRY_CODE,
            tgt.PHONE_AREA_CODE = src.PHONE_AREA_CODE,
            tgt.PHONE_NUMBER = src.PHONE_NUMBER,
            tgt.PHONE_EXTENSION = src.PHONE_EXTENSION,
            tgt.FAX_COUNTRY_CODE = src.FAX_COUNTRY_CODE,
            tgt.FAX_AREA_CODE = src.FAX_AREA_CODE,
            tgt.FAX_NUMBER = src.FAX_NUMBER,
            tgt.EMAIL = src.EMAIL,
            tgt.INACTIVE_DATE = src.INACTIVE_DATE,
            tgt.STATUS = src.STATUS,
            tgt.ADDRESS_PARTY_NUMBER = src.ADDRESS_PARTY_NUMBER,
            tgt.CREATION_DATE = src.CREATION_DATE,
            tgt.CREATED_BY = src.CREATED_BY,
            tgt.LAST_UPDATE_DATE = src.LAST_UPDATE_DATE,
            tgt.LAST_UPDATED_BY = src.LAST_UPDATED_BY,
            tgt.SYNC_TIMESTAMP = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            SUPPLIER_ADDRESS_ID,
            SUPPLIER_ID,
            ADDRESS_NAME,
            COUNTRY_CODE,
            COUNTRY,
            ADDRESS_LINE1,
            ADDRESS_LINE2,
            ADDRESS_LINE3,
            ADDRESS_LINE4,
            CITY,
            STATE,
            POSTAL_CODE,
            POSTAL_CODE_EXTENSION,
            PROVINCE,
            COUNTY,
            BUILDING,
            FLOOR_NUMBER,
            PHONETIC_ADDRESS,
            LANGUAGE_CODE,
            LANGUAGE,
            ADDRESSEE,
            GLOBAL_LOCATION_NUMBER,
            ADDITIONAL_ADDR_ATTR1,
            ADDITIONAL_ADDR_ATTR2,
            ADDITIONAL_ADDR_ATTR3,
            ADDITIONAL_ADDR_ATTR4,
            ADDITIONAL_ADDR_ATTR5,
            FORMATTED_ADDRESS,
            ADDR_PURPOSE_ORDERING,
            ADDR_PURPOSE_REMIT_TO,
            ADDR_PURPOSE_RFQ_BIDDING,
            PHONE_COUNTRY_CODE,
            PHONE_AREA_CODE,
            PHONE_NUMBER,
            PHONE_EXTENSION,
            FAX_COUNTRY_CODE,
            FAX_AREA_CODE,
            FAX_NUMBER,
            EMAIL,
            INACTIVE_DATE,
            STATUS,
            ADDRESS_PARTY_NUMBER,
            CREATION_DATE,
            CREATED_BY,
            LAST_UPDATE_DATE,
            LAST_UPDATED_BY,
            SYNC_TIMESTAMP
        ) VALUES (
            src.SUPPLIER_ADDRESS_ID,
            src.SUPPLIER_ID,
            src.ADDRESS_NAME,
            src.COUNTRY_CODE,
            src.COUNTRY,
            src.ADDRESS_LINE1,
            src.ADDRESS_LINE2,
            src.ADDRESS_LINE3,
            src.ADDRESS_LINE4,
            src.CITY,
            src.STATE,
            src.POSTAL_CODE,
            src.POSTAL_CODE_EXTENSION,
            src.PROVINCE,
            src.COUNTY,
            src.BUILDING,
            src.FLOOR_NUMBER,
            src.PHONETIC_ADDRESS,
            src.LANGUAGE_CODE,
            src.LANGUAGE,
            src.ADDRESSEE,
            src.GLOBAL_LOCATION_NUMBER,
            src.ADDITIONAL_ADDR_ATTR1,
            src.ADDITIONAL_ADDR_ATTR2,
            src.ADDITIONAL_ADDR_ATTR3,
            src.ADDITIONAL_ADDR_ATTR4,
            src.ADDITIONAL_ADDR_ATTR5,
            src.FORMATTED_ADDRESS,
            src.ADDR_PURPOSE_ORDERING,
            src.ADDR_PURPOSE_REMIT_TO,
            src.ADDR_PURPOSE_RFQ_BIDDING,
            src.PHONE_COUNTRY_CODE,
            src.PHONE_AREA_CODE,
            src.PHONE_NUMBER,
            src.PHONE_EXTENSION,
            src.FAX_COUNTRY_CODE,
            src.FAX_AREA_CODE,
            src.FAX_NUMBER,
            src.EMAIL,
            src.INACTIVE_DATE,
            src.STATUS,
            src.ADDRESS_PARTY_NUMBER,
            src.CREATION_DATE,
            src.CREATED_BY,
            src.LAST_UPDATE_DATE,
            src.LAST_UPDATED_BY,
            CURRENT_TIMESTAMP
        );

    v_count := SQL%ROWCOUNT;
    COMMIT;

    -- Return success with count
    p_result := '{"success": true, "inserted": ' || v_count || '}';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := '{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
END RR_SYNC_SUPPLIER_ADDRESS;
/

-- =============================================
-- 3. Create APEX REST Handler
-- =============================================
-- Module: reerp (existing)
-- Template: suppliers/address
-- Method: POST

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers/address',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync Supplier Addresses from Oracle Fusion',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    RR_SYNC_SUPPLIER_ADDRESS(
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
-- 4. Verification Queries
-- =============================================
-- Check table structure:
-- DESC RR_SUPPLIER_ADDRESS;

-- Check row count:
-- SELECT COUNT(*) FROM RR_SUPPLIER_ADDRESS;

-- Check addresses by supplier:
-- SELECT SUPPLIER_ID, COUNT(*) as ADDRESS_COUNT
-- FROM RR_SUPPLIER_ADDRESS
-- GROUP BY SUPPLIER_ID;

-- Sample query with supplier join:
-- SELECT s.SUPPLIER, s.SUPPLIER_NUMBER, a.ADDRESS_NAME, a.CITY, a.COUNTRY
-- FROM RR_SUPPLIER_MASTER s
-- JOIN RR_SUPPLIER_ADDRESS a ON s.SUPPLIER_ID = a.SUPPLIER_ID;
