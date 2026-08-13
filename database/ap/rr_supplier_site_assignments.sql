-- =============================================
-- RR_SUPPLIER_SITE_ASSIGNMENTS Table, Procedure, and APEX Handlers
-- Supplier Site Assignments from Oracle Fusion
-- =============================================

-- Drop existing objects (optional, comment out in production)
-- DROP TABLE RR_SUPPLIER_SITE_ASSIGNMENTS CASCADE CONSTRAINTS;

-- =============================================
-- 1. Create Table
-- =============================================
CREATE TABLE RR_SUPPLIER_SITE_ASSIGNMENTS (
    ASSIGNMENT_ID                 NUMBER PRIMARY KEY,
    SUPPLIER_ID                   NUMBER NOT NULL,
    SUPPLIER_SITE_ID              NUMBER NOT NULL,
    CLIENT_BU_ID                  NUMBER,
    CLIENT_BU                     VARCHAR2(240),
    BILL_TO_BU_ID                 NUMBER,
    BILL_TO_BU                    VARCHAR2(240),
    SHIP_TO_LOCATION_ID           NUMBER,
    SHIP_TO_LOCATION              VARCHAR2(240),
    SHIP_TO_LOCATION_CODE         VARCHAR2(60),
    BILL_TO_LOCATION_ID           NUMBER,
    BILL_TO_LOCATION              VARCHAR2(240),
    BILL_TO_LOCATION_CODE         VARCHAR2(60),
    USE_WITHHOLDING_TAX_FLAG      VARCHAR2(1),
    WITHHOLDING_TAX_GROUP_ID      NUMBER,
    WITHHOLDING_TAX_GROUP         VARCHAR2(240),
    CHART_OF_ACCOUNTS_ID          NUMBER,
    LIABILITY_DISTRIBUTION_ID     NUMBER,
    LIABILITY_DISTRIBUTION        VARCHAR2(240),
    PREPAYMENT_DISTRIBUTION_ID    NUMBER,
    PREPAYMENT_DISTRIBUTION       VARCHAR2(240),
    BILL_PAYABLE_DISTRIBUTION_ID  NUMBER,
    BILL_PAYABLE_DISTRIBUTION     VARCHAR2(240),
    DISTRIBUTION_SET_ID           NUMBER,
    DISTRIBUTION_SET              VARCHAR2(240),
    INACTIVE_DATE                 DATE,
    STATUS                        VARCHAR2(30),
    CREATION_DATE                 TIMESTAMP WITH TIME ZONE,
    CREATED_BY                    VARCHAR2(240),
    LAST_UPDATE_DATE              TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY               VARCHAR2(240),
    SYNC_TIMESTAMP                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IDX_SITE_ASSIGN_SUPPLIER ON RR_SUPPLIER_SITE_ASSIGNMENTS(SUPPLIER_ID);
CREATE INDEX IDX_SITE_ASSIGN_SITE ON RR_SUPPLIER_SITE_ASSIGNMENTS(SUPPLIER_SITE_ID);
CREATE INDEX IDX_SITE_ASSIGN_CLIENT_BU ON RR_SUPPLIER_SITE_ASSIGNMENTS(CLIENT_BU_ID);

-- Add comments
COMMENT ON TABLE RR_SUPPLIER_SITE_ASSIGNMENTS IS 'Supplier Site Assignments synced from Oracle Fusion';
COMMENT ON COLUMN RR_SUPPLIER_SITE_ASSIGNMENTS.ASSIGNMENT_ID IS 'Unique identifier for the site assignment';
COMMENT ON COLUMN RR_SUPPLIER_SITE_ASSIGNMENTS.SUPPLIER_ID IS 'Foreign key to RR_SUPPLIER_MASTER';
COMMENT ON COLUMN RR_SUPPLIER_SITE_ASSIGNMENTS.SUPPLIER_SITE_ID IS 'Foreign key to RR_SUPPLIER_SITES';
COMMENT ON COLUMN RR_SUPPLIER_SITE_ASSIGNMENTS.CLIENT_BU IS 'Client Business Unit name';

-- =============================================
-- 2. Create Sync Procedure
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_SUPPLIER_SITE_ASSIGNMENTS (
    p_json_data IN CLOB,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- Merge (upsert) data from JSON
    MERGE INTO RR_SUPPLIER_SITE_ASSIGNMENTS tgt
    USING (
        SELECT
            jt.ASSIGNMENT_ID,
            jt.SUPPLIER_ID,
            jt.SUPPLIER_SITE_ID,
            jt.CLIENT_BU_ID,
            jt.CLIENT_BU,
            jt.BILL_TO_BU_ID,
            jt.BILL_TO_BU,
            jt.SHIP_TO_LOCATION_ID,
            jt.SHIP_TO_LOCATION,
            jt.SHIP_TO_LOCATION_CODE,
            jt.BILL_TO_LOCATION_ID,
            jt.BILL_TO_LOCATION,
            jt.BILL_TO_LOCATION_CODE,
            CASE WHEN jt.USE_WITHHOLDING_TAX_FLAG = 'true' THEN 'Y' ELSE 'N' END AS USE_WITHHOLDING_TAX_FLAG,
            jt.WITHHOLDING_TAX_GROUP_ID,
            jt.WITHHOLDING_TAX_GROUP,
            jt.CHART_OF_ACCOUNTS_ID,
            jt.LIABILITY_DISTRIBUTION_ID,
            jt.LIABILITY_DISTRIBUTION,
            jt.PREPAYMENT_DISTRIBUTION_ID,
            jt.PREPAYMENT_DISTRIBUTION,
            jt.BILL_PAYABLE_DISTRIBUTION_ID,
            jt.BILL_PAYABLE_DISTRIBUTION,
            jt.DISTRIBUTION_SET_ID,
            jt.DISTRIBUTION_SET,
            CASE
                WHEN jt.INACTIVE_DATE IS NOT NULL AND jt.INACTIVE_DATE != '4712-12-31'
                THEN TO_DATE(SUBSTR(jt.INACTIVE_DATE, 1, 10), 'YYYY-MM-DD')
                ELSE NULL
            END AS INACTIVE_DATE,
            jt.STATUS,
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
                ASSIGNMENT_ID                 NUMBER          PATH '$.AssignmentId',
                SUPPLIER_ID                   NUMBER          PATH '$.SupplierId',
                SUPPLIER_SITE_ID              NUMBER          PATH '$.SupplierSiteId',
                CLIENT_BU_ID                  NUMBER          PATH '$.ClientBUId',
                CLIENT_BU                     VARCHAR2(240)   PATH '$.ClientBU',
                BILL_TO_BU_ID                 NUMBER          PATH '$.BillToBUId',
                BILL_TO_BU                    VARCHAR2(240)   PATH '$.BillToBU',
                SHIP_TO_LOCATION_ID           NUMBER          PATH '$.ShipToLocationId',
                SHIP_TO_LOCATION              VARCHAR2(240)   PATH '$.ShipToLocation',
                SHIP_TO_LOCATION_CODE         VARCHAR2(60)    PATH '$.ShipToLocationCode',
                BILL_TO_LOCATION_ID           NUMBER          PATH '$.BillToLocationId',
                BILL_TO_LOCATION              VARCHAR2(240)   PATH '$.BillToLocation',
                BILL_TO_LOCATION_CODE         VARCHAR2(60)    PATH '$.BillToLocationCode',
                USE_WITHHOLDING_TAX_FLAG      VARCHAR2(10)    PATH '$.UseWithholdingTaxFlag',
                WITHHOLDING_TAX_GROUP_ID      NUMBER          PATH '$.WithholdingTaxGroupId',
                WITHHOLDING_TAX_GROUP         VARCHAR2(240)   PATH '$.WithholdingTaxGroup',
                CHART_OF_ACCOUNTS_ID          NUMBER          PATH '$.ChartOfAccountsId',
                LIABILITY_DISTRIBUTION_ID     NUMBER          PATH '$.LiabilityDistributionId',
                LIABILITY_DISTRIBUTION        VARCHAR2(240)   PATH '$.LiabilityDistribution',
                PREPAYMENT_DISTRIBUTION_ID    NUMBER          PATH '$.PrepaymentDistributionId',
                PREPAYMENT_DISTRIBUTION       VARCHAR2(240)   PATH '$.PrepaymentDistribution',
                BILL_PAYABLE_DISTRIBUTION_ID  NUMBER          PATH '$.BillPayableDistributionId',
                BILL_PAYABLE_DISTRIBUTION     VARCHAR2(240)   PATH '$.BillPayableDistribution',
                DISTRIBUTION_SET_ID           NUMBER          PATH '$.DistributionSetId',
                DISTRIBUTION_SET              VARCHAR2(240)   PATH '$.DistributionSet',
                INACTIVE_DATE                 VARCHAR2(30)    PATH '$.InactiveDate',
                STATUS                        VARCHAR2(30)    PATH '$.Status',
                CREATION_DATE                 VARCHAR2(50)    PATH '$.CreationDate',
                CREATED_BY                    VARCHAR2(240)   PATH '$.CreatedBy',
                LAST_UPDATE_DATE              VARCHAR2(50)    PATH '$.LastUpdateDate',
                LAST_UPDATED_BY               VARCHAR2(240)   PATH '$.LastUpdatedBy'
            )
        ) jt
        WHERE jt.ASSIGNMENT_ID IS NOT NULL
    ) src
    ON (tgt.ASSIGNMENT_ID = src.ASSIGNMENT_ID)
    WHEN MATCHED THEN
        UPDATE SET
            tgt.SUPPLIER_ID = src.SUPPLIER_ID,
            tgt.SUPPLIER_SITE_ID = src.SUPPLIER_SITE_ID,
            tgt.CLIENT_BU_ID = src.CLIENT_BU_ID,
            tgt.CLIENT_BU = src.CLIENT_BU,
            tgt.BILL_TO_BU_ID = src.BILL_TO_BU_ID,
            tgt.BILL_TO_BU = src.BILL_TO_BU,
            tgt.SHIP_TO_LOCATION_ID = src.SHIP_TO_LOCATION_ID,
            tgt.SHIP_TO_LOCATION = src.SHIP_TO_LOCATION,
            tgt.SHIP_TO_LOCATION_CODE = src.SHIP_TO_LOCATION_CODE,
            tgt.BILL_TO_LOCATION_ID = src.BILL_TO_LOCATION_ID,
            tgt.BILL_TO_LOCATION = src.BILL_TO_LOCATION,
            tgt.BILL_TO_LOCATION_CODE = src.BILL_TO_LOCATION_CODE,
            tgt.USE_WITHHOLDING_TAX_FLAG = src.USE_WITHHOLDING_TAX_FLAG,
            tgt.WITHHOLDING_TAX_GROUP_ID = src.WITHHOLDING_TAX_GROUP_ID,
            tgt.WITHHOLDING_TAX_GROUP = src.WITHHOLDING_TAX_GROUP,
            tgt.CHART_OF_ACCOUNTS_ID = src.CHART_OF_ACCOUNTS_ID,
            tgt.LIABILITY_DISTRIBUTION_ID = src.LIABILITY_DISTRIBUTION_ID,
            tgt.LIABILITY_DISTRIBUTION = src.LIABILITY_DISTRIBUTION,
            tgt.PREPAYMENT_DISTRIBUTION_ID = src.PREPAYMENT_DISTRIBUTION_ID,
            tgt.PREPAYMENT_DISTRIBUTION = src.PREPAYMENT_DISTRIBUTION,
            tgt.BILL_PAYABLE_DISTRIBUTION_ID = src.BILL_PAYABLE_DISTRIBUTION_ID,
            tgt.BILL_PAYABLE_DISTRIBUTION = src.BILL_PAYABLE_DISTRIBUTION,
            tgt.DISTRIBUTION_SET_ID = src.DISTRIBUTION_SET_ID,
            tgt.DISTRIBUTION_SET = src.DISTRIBUTION_SET,
            tgt.INACTIVE_DATE = src.INACTIVE_DATE,
            tgt.STATUS = src.STATUS,
            tgt.CREATION_DATE = src.CREATION_DATE,
            tgt.CREATED_BY = src.CREATED_BY,
            tgt.LAST_UPDATE_DATE = src.LAST_UPDATE_DATE,
            tgt.LAST_UPDATED_BY = src.LAST_UPDATED_BY,
            tgt.SYNC_TIMESTAMP = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            ASSIGNMENT_ID,
            SUPPLIER_ID,
            SUPPLIER_SITE_ID,
            CLIENT_BU_ID,
            CLIENT_BU,
            BILL_TO_BU_ID,
            BILL_TO_BU,
            SHIP_TO_LOCATION_ID,
            SHIP_TO_LOCATION,
            SHIP_TO_LOCATION_CODE,
            BILL_TO_LOCATION_ID,
            BILL_TO_LOCATION,
            BILL_TO_LOCATION_CODE,
            USE_WITHHOLDING_TAX_FLAG,
            WITHHOLDING_TAX_GROUP_ID,
            WITHHOLDING_TAX_GROUP,
            CHART_OF_ACCOUNTS_ID,
            LIABILITY_DISTRIBUTION_ID,
            LIABILITY_DISTRIBUTION,
            PREPAYMENT_DISTRIBUTION_ID,
            PREPAYMENT_DISTRIBUTION,
            BILL_PAYABLE_DISTRIBUTION_ID,
            BILL_PAYABLE_DISTRIBUTION,
            DISTRIBUTION_SET_ID,
            DISTRIBUTION_SET,
            INACTIVE_DATE,
            STATUS,
            CREATION_DATE,
            CREATED_BY,
            LAST_UPDATE_DATE,
            LAST_UPDATED_BY,
            SYNC_TIMESTAMP
        ) VALUES (
            src.ASSIGNMENT_ID,
            src.SUPPLIER_ID,
            src.SUPPLIER_SITE_ID,
            src.CLIENT_BU_ID,
            src.CLIENT_BU,
            src.BILL_TO_BU_ID,
            src.BILL_TO_BU,
            src.SHIP_TO_LOCATION_ID,
            src.SHIP_TO_LOCATION,
            src.SHIP_TO_LOCATION_CODE,
            src.BILL_TO_LOCATION_ID,
            src.BILL_TO_LOCATION,
            src.BILL_TO_LOCATION_CODE,
            src.USE_WITHHOLDING_TAX_FLAG,
            src.WITHHOLDING_TAX_GROUP_ID,
            src.WITHHOLDING_TAX_GROUP,
            src.CHART_OF_ACCOUNTS_ID,
            src.LIABILITY_DISTRIBUTION_ID,
            src.LIABILITY_DISTRIBUTION,
            src.PREPAYMENT_DISTRIBUTION_ID,
            src.PREPAYMENT_DISTRIBUTION,
            src.BILL_PAYABLE_DISTRIBUTION_ID,
            src.BILL_PAYABLE_DISTRIBUTION,
            src.DISTRIBUTION_SET_ID,
            src.DISTRIBUTION_SET,
            src.INACTIVE_DATE,
            src.STATUS,
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
END RR_SYNC_SUPPLIER_SITE_ASSIGNMENTS;
/

-- =============================================
-- 3. Create APEX REST Handlers
-- =============================================
-- Module: reerp (existing)

-- GET Handler - Fetch sites with supplier info for sync
-- Returns sites that we already have synced (to get SupplierId and SupplierSiteId)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers/sites',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Get Supplier Sites for Assignment Sync',
        p_source         => q'[
SELECT
    SUPPLIER_SITE_ID as "SupplierSiteId",
    SUPPLIER_ID as "SupplierId",
    SUPPLIER_SITE as "SupplierSite",
    PROCUREMENT_BU as "ProcurementBU"
FROM RR_SUPPLIER_SITES
ORDER BY SUPPLIER_ID, SUPPLIER_SITE_ID
]'
    );
    COMMIT;
END;
/

-- POST Handler - Sync Site Assignments
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers/sites/assignments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync Supplier Site Assignments from Oracle Fusion',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    RR_SYNC_SUPPLIER_SITE_ASSIGNMENTS(
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
-- DESC RR_SUPPLIER_SITE_ASSIGNMENTS;

-- Check row count:
-- SELECT COUNT(*) FROM RR_SUPPLIER_SITE_ASSIGNMENTS;

-- Check assignments by site:
-- SELECT SUPPLIER_SITE_ID, COUNT(*) as ASSIGNMENT_COUNT
-- FROM RR_SUPPLIER_SITE_ASSIGNMENTS
-- GROUP BY SUPPLIER_SITE_ID;

-- Sample query with site and supplier join:
-- SELECT s.SUPPLIER, st.SUPPLIER_SITE, a.CLIENT_BU, a.STATUS
-- FROM RR_SUPPLIER_MASTER s
-- JOIN RR_SUPPLIER_SITES st ON s.SUPPLIER_ID = st.SUPPLIER_ID
-- JOIN RR_SUPPLIER_SITE_ASSIGNMENTS a ON st.SUPPLIER_SITE_ID = a.SUPPLIER_SITE_ID;
