-- =============================================
-- RR_SUPPLIER_SITES Table, Procedure, and APEX Handler
-- Supplier Sites from Oracle Fusion
-- =============================================

-- Drop existing objects (optional, comment out in production)
-- DROP TABLE RR_SUPPLIER_SITES CASCADE CONSTRAINTS;

-- =============================================
-- 1. Create Table
-- =============================================
CREATE TABLE RR_SUPPLIER_SITES (
    SUPPLIER_SITE_ID              NUMBER PRIMARY KEY,
    SUPPLIER_ID                   NUMBER NOT NULL,
    PROCUREMENT_BU                VARCHAR2(240),
    PROCUREMENT_BU_ID             NUMBER,
    SUPPLIER_SITE                 VARCHAR2(240),
    SUPPLIER_SITE_CODE            VARCHAR2(60),
    ADDRESS_NAME                  VARCHAR2(240),
    SOURCING_ONLY_FLAG            VARCHAR2(1),
    PURCHASING_FLAG               VARCHAR2(1),
    PAY_FLAG                      VARCHAR2(1),
    PAY_SITE_FLAG                 VARCHAR2(1),
    PRIMARY_PAY_SITE_FLAG         VARCHAR2(1),
    RFQ_ONLY_SITE_FLAG            VARCHAR2(1),

    -- Payment Terms
    PAYMENT_TERMS                 VARCHAR2(240),
    PAYMENT_TERMS_ID              NUMBER,
    PAYMENT_TERMS_DATE_BASIS_CODE VARCHAR2(30),
    PAYMENT_TERMS_DATE_BASIS      VARCHAR2(240),
    PAY_DATE_BASIS_CODE           VARCHAR2(30),
    PAY_DATE_BASIS                VARCHAR2(240),
    PAY_GROUP_CODE                VARCHAR2(60),
    PAY_GROUP                     VARCHAR2(240),

    -- Bank Charges & Discounts
    BANK_CHARGE_DEDUCTION_TYPE_CODE VARCHAR2(30),
    BANK_CHARGE_DEDUCTION_TYPE    VARCHAR2(240),
    ALWAYS_TAKE_DISCOUNT_CODE     VARCHAR2(30),
    ALWAYS_TAKE_DISCOUNT          VARCHAR2(240),
    EXCLUDE_FREIGHT_FROM_DISC_CODE VARCHAR2(30),
    EXCLUDE_FREIGHT_FROM_DISCOUNT VARCHAR2(240),
    EXCLUDE_TAX_FROM_DISC_CODE    VARCHAR2(30),
    EXCLUDE_TAX_FROM_DISCOUNT     VARCHAR2(240),
    CREATE_INTEREST_INVOICES_CODE VARCHAR2(30),
    CREATE_INTEREST_INVOICES      VARCHAR2(240),

    -- Invoice Settings
    INVOICE_CURRENCY_CODE         VARCHAR2(15),
    INVOICE_AMOUNT_LIMIT          NUMBER,
    INVOICE_MATCH_OPTION_CODE     VARCHAR2(30),
    INVOICE_MATCH_OPTION          VARCHAR2(240),
    MATCH_APPROVAL_LEVEL_CODE     VARCHAR2(30),
    MATCH_APPROVAL_LEVEL          VARCHAR2(240),

    -- Hold Settings
    HOLD_ALL_INVOICES_FLAG        VARCHAR2(1),
    HOLD_FUTURE_PAYMENTS_FLAG     VARCHAR2(1),
    HOLD_REASON                   VARCHAR2(240),
    HOLD_UNMATCHED_INVOICES_CODE  VARCHAR2(30),
    HOLD_UNMATCHED_INVOICES       VARCHAR2(240),

    -- Tax
    TAX_REPORTING_SITE_FLAG       VARCHAR2(1),
    SELF_ASSESS_TAX_FLAG          VARCHAR2(1),
    VAT_CODE                      VARCHAR2(60),
    VAT_REGISTRATION_NUMBER       VARCHAR2(60),

    -- Communication
    EMAIL                         VARCHAR2(320),
    FAX                           VARCHAR2(60),
    PHONE                         VARCHAR2(60),

    -- EDI Settings
    EDI_ENABLED_FLAG              VARCHAR2(1),

    -- Tolerance
    TOLERANCE_ID                  NUMBER,
    TOLERANCE_NAME                VARCHAR2(240),

    -- Distribution Sets
    DISTRIBUTION_SET_ID           NUMBER,
    DISTRIBUTION_SET              VARCHAR2(240),

    -- Accounting
    LIABILITY_ACCOUNT_ID          NUMBER,
    PREPAYMENT_ACCOUNT_ID         NUMBER,
    BILLS_PAYABLE_ACCOUNT_ID      NUMBER,

    -- Pay Alone
    PAY_ALONE_FLAG                VARCHAR2(1),

    -- Override Flags
    OVERRIDE_B2B_COMM_FLAG        VARCHAR2(1),

    -- Status
    INACTIVE_DATE                 DATE,
    STATUS                        VARCHAR2(30),

    -- Audit Fields
    CREATION_DATE                 TIMESTAMP WITH TIME ZONE,
    CREATED_BY                    VARCHAR2(240),
    LAST_UPDATE_DATE              TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY               VARCHAR2(240),
    SYNC_TIMESTAMP                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IDX_SUPPLIER_SITES_SUPPLIER ON RR_SUPPLIER_SITES(SUPPLIER_ID);
CREATE INDEX IDX_SUPPLIER_SITES_CODE ON RR_SUPPLIER_SITES(SUPPLIER_SITE_CODE);
CREATE INDEX IDX_SUPPLIER_SITES_BU ON RR_SUPPLIER_SITES(PROCUREMENT_BU_ID);

-- Add comments
COMMENT ON TABLE RR_SUPPLIER_SITES IS 'Supplier Sites synced from Oracle Fusion';
COMMENT ON COLUMN RR_SUPPLIER_SITES.SUPPLIER_SITE_ID IS 'Unique identifier for the supplier site';
COMMENT ON COLUMN RR_SUPPLIER_SITES.SUPPLIER_ID IS 'Foreign key to RR_SUPPLIER_MASTER';
COMMENT ON COLUMN RR_SUPPLIER_SITES.SUPPLIER_SITE IS 'Name of the supplier site';
COMMENT ON COLUMN RR_SUPPLIER_SITES.PROCUREMENT_BU IS 'Procurement Business Unit name';

-- =============================================
-- 2. Create Sync Procedure
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_SUPPLIER_SITES (
    p_json_data IN CLOB,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- Merge (upsert) data from JSON
    MERGE INTO RR_SUPPLIER_SITES tgt
    USING (
        SELECT
            jt.SUPPLIER_SITE_ID,
            jt.SUPPLIER_ID,
            jt.PROCUREMENT_BU,
            jt.PROCUREMENT_BU_ID,
            jt.SUPPLIER_SITE,
            jt.SUPPLIER_SITE_CODE,
            jt.ADDRESS_NAME,
            CASE WHEN jt.SOURCING_ONLY_FLAG = 'true' THEN 'Y' ELSE 'N' END AS SOURCING_ONLY_FLAG,
            CASE WHEN jt.PURCHASING_FLAG = 'true' THEN 'Y' ELSE 'N' END AS PURCHASING_FLAG,
            CASE WHEN jt.PAY_FLAG = 'true' THEN 'Y' ELSE 'N' END AS PAY_FLAG,
            CASE WHEN jt.PAY_SITE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS PAY_SITE_FLAG,
            CASE WHEN jt.PRIMARY_PAY_SITE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS PRIMARY_PAY_SITE_FLAG,
            CASE WHEN jt.RFQ_ONLY_SITE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS RFQ_ONLY_SITE_FLAG,
            jt.PAYMENT_TERMS,
            jt.PAYMENT_TERMS_ID,
            jt.PAYMENT_TERMS_DATE_BASIS_CODE,
            jt.PAYMENT_TERMS_DATE_BASIS,
            jt.PAY_DATE_BASIS_CODE,
            jt.PAY_DATE_BASIS,
            jt.PAY_GROUP_CODE,
            jt.PAY_GROUP,
            jt.BANK_CHARGE_DEDUCTION_TYPE_CODE,
            jt.BANK_CHARGE_DEDUCTION_TYPE,
            jt.ALWAYS_TAKE_DISCOUNT_CODE,
            jt.ALWAYS_TAKE_DISCOUNT,
            jt.EXCLUDE_FREIGHT_FROM_DISC_CODE,
            jt.EXCLUDE_FREIGHT_FROM_DISCOUNT,
            jt.EXCLUDE_TAX_FROM_DISC_CODE,
            jt.EXCLUDE_TAX_FROM_DISCOUNT,
            jt.CREATE_INTEREST_INVOICES_CODE,
            jt.CREATE_INTEREST_INVOICES,
            jt.INVOICE_CURRENCY_CODE,
            jt.INVOICE_AMOUNT_LIMIT,
            jt.INVOICE_MATCH_OPTION_CODE,
            jt.INVOICE_MATCH_OPTION,
            jt.MATCH_APPROVAL_LEVEL_CODE,
            jt.MATCH_APPROVAL_LEVEL,
            CASE WHEN jt.HOLD_ALL_INVOICES_FLAG = 'true' THEN 'Y' ELSE 'N' END AS HOLD_ALL_INVOICES_FLAG,
            CASE WHEN jt.HOLD_FUTURE_PAYMENTS_FLAG = 'true' THEN 'Y' ELSE 'N' END AS HOLD_FUTURE_PAYMENTS_FLAG,
            jt.HOLD_REASON,
            jt.HOLD_UNMATCHED_INVOICES_CODE,
            jt.HOLD_UNMATCHED_INVOICES,
            CASE WHEN jt.TAX_REPORTING_SITE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS TAX_REPORTING_SITE_FLAG,
            CASE WHEN jt.SELF_ASSESS_TAX_FLAG = 'true' THEN 'Y' ELSE 'N' END AS SELF_ASSESS_TAX_FLAG,
            jt.VAT_CODE,
            jt.VAT_REGISTRATION_NUMBER,
            jt.EMAIL,
            jt.FAX,
            jt.PHONE,
            CASE WHEN jt.EDI_ENABLED_FLAG = 'true' THEN 'Y' ELSE 'N' END AS EDI_ENABLED_FLAG,
            jt.TOLERANCE_ID,
            jt.TOLERANCE_NAME,
            jt.DISTRIBUTION_SET_ID,
            jt.DISTRIBUTION_SET,
            jt.LIABILITY_ACCOUNT_ID,
            jt.PREPAYMENT_ACCOUNT_ID,
            jt.BILLS_PAYABLE_ACCOUNT_ID,
            CASE WHEN jt.PAY_ALONE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS PAY_ALONE_FLAG,
            CASE WHEN jt.OVERRIDE_B2B_COMM_FLAG = 'true' THEN 'Y' ELSE 'N' END AS OVERRIDE_B2B_COMM_FLAG,
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
                SUPPLIER_SITE_ID              NUMBER          PATH '$.SupplierSiteId',
                SUPPLIER_ID                   NUMBER          PATH '$.SupplierId',
                PROCUREMENT_BU                VARCHAR2(240)   PATH '$.ProcurementBU',
                PROCUREMENT_BU_ID             NUMBER          PATH '$.ProcurementBUId',
                SUPPLIER_SITE                 VARCHAR2(240)   PATH '$.SupplierSite',
                SUPPLIER_SITE_CODE            VARCHAR2(60)    PATH '$.SupplierSiteCode',
                ADDRESS_NAME                  VARCHAR2(240)   PATH '$.AddressName',
                SOURCING_ONLY_FLAG            VARCHAR2(10)    PATH '$.SourcingOnlySiteFlag',
                PURCHASING_FLAG               VARCHAR2(10)    PATH '$.PurchasingSiteFlag',
                PAY_FLAG                      VARCHAR2(10)    PATH '$.PayFlag',
                PAY_SITE_FLAG                 VARCHAR2(10)    PATH '$.PaySiteFlag',
                PRIMARY_PAY_SITE_FLAG         VARCHAR2(10)    PATH '$.PrimaryPaySiteFlag',
                RFQ_ONLY_SITE_FLAG            VARCHAR2(10)    PATH '$.RFQOnlySiteFlag',
                PAYMENT_TERMS                 VARCHAR2(240)   PATH '$.PaymentTerms',
                PAYMENT_TERMS_ID              NUMBER          PATH '$.PaymentTermsId',
                PAYMENT_TERMS_DATE_BASIS_CODE VARCHAR2(30)    PATH '$.PaymentTermsDateBasisCode',
                PAYMENT_TERMS_DATE_BASIS      VARCHAR2(240)   PATH '$.PaymentTermsDateBasis',
                PAY_DATE_BASIS_CODE           VARCHAR2(30)    PATH '$.PayDateBasisCode',
                PAY_DATE_BASIS                VARCHAR2(240)   PATH '$.PayDateBasis',
                PAY_GROUP_CODE                VARCHAR2(60)    PATH '$.PayGroupCode',
                PAY_GROUP                     VARCHAR2(240)   PATH '$.PayGroup',
                BANK_CHARGE_DEDUCTION_TYPE_CODE VARCHAR2(30)  PATH '$.BankChargeDeductionTypeCode',
                BANK_CHARGE_DEDUCTION_TYPE    VARCHAR2(240)   PATH '$.BankChargeDeductionType',
                ALWAYS_TAKE_DISCOUNT_CODE     VARCHAR2(30)    PATH '$.AlwaysTakeDiscountCode',
                ALWAYS_TAKE_DISCOUNT          VARCHAR2(240)   PATH '$.AlwaysTakeDiscount',
                EXCLUDE_FREIGHT_FROM_DISC_CODE VARCHAR2(30)   PATH '$.ExcludeFreightFromDiscountCode',
                EXCLUDE_FREIGHT_FROM_DISCOUNT VARCHAR2(240)   PATH '$.ExcludeFreightFromDiscount',
                EXCLUDE_TAX_FROM_DISC_CODE    VARCHAR2(30)    PATH '$.ExcludeTaxFromDiscountCode',
                EXCLUDE_TAX_FROM_DISCOUNT     VARCHAR2(240)   PATH '$.ExcludeTaxFromDiscount',
                CREATE_INTEREST_INVOICES_CODE VARCHAR2(30)    PATH '$.CreateInterestInvoicesCode',
                CREATE_INTEREST_INVOICES      VARCHAR2(240)   PATH '$.CreateInterestInvoices',
                INVOICE_CURRENCY_CODE         VARCHAR2(15)    PATH '$.InvoiceCurrencyCode',
                INVOICE_AMOUNT_LIMIT          NUMBER          PATH '$.InvoiceAmountLimit',
                INVOICE_MATCH_OPTION_CODE     VARCHAR2(30)    PATH '$.InvoiceMatchOptionCode',
                INVOICE_MATCH_OPTION          VARCHAR2(240)   PATH '$.InvoiceMatchOption',
                MATCH_APPROVAL_LEVEL_CODE     VARCHAR2(30)    PATH '$.MatchApprovalLevelCode',
                MATCH_APPROVAL_LEVEL          VARCHAR2(240)   PATH '$.MatchApprovalLevel',
                HOLD_ALL_INVOICES_FLAG        VARCHAR2(10)    PATH '$.HoldAllInvoicesFlag',
                HOLD_FUTURE_PAYMENTS_FLAG     VARCHAR2(10)    PATH '$.HoldFuturePaymentsFlag',
                HOLD_REASON                   VARCHAR2(240)   PATH '$.HoldReason',
                HOLD_UNMATCHED_INVOICES_CODE  VARCHAR2(30)    PATH '$.HoldUnmatchedInvoicesCode',
                HOLD_UNMATCHED_INVOICES       VARCHAR2(240)   PATH '$.HoldUnmatchedInvoices',
                TAX_REPORTING_SITE_FLAG       VARCHAR2(10)    PATH '$.TaxReportingSiteFlag',
                SELF_ASSESS_TAX_FLAG          VARCHAR2(10)    PATH '$.SelfAssessTaxFlag',
                VAT_CODE                      VARCHAR2(60)    PATH '$.VATCode',
                VAT_REGISTRATION_NUMBER       VARCHAR2(60)    PATH '$.VATRegistrationNumber',
                EMAIL                         VARCHAR2(320)   PATH '$.Email',
                FAX                           VARCHAR2(60)    PATH '$.Fax',
                PHONE                         VARCHAR2(60)    PATH '$.Phone',
                EDI_ENABLED_FLAG              VARCHAR2(10)    PATH '$.EDIEnabledFlag',
                TOLERANCE_ID                  NUMBER          PATH '$.ToleranceId',
                TOLERANCE_NAME                VARCHAR2(240)   PATH '$.ToleranceName',
                DISTRIBUTION_SET_ID           NUMBER          PATH '$.DistributionSetId',
                DISTRIBUTION_SET              VARCHAR2(240)   PATH '$.DistributionSet',
                LIABILITY_ACCOUNT_ID          NUMBER          PATH '$.LiabilityAccountId',
                PREPAYMENT_ACCOUNT_ID         NUMBER          PATH '$.PrepaymentAccountId',
                BILLS_PAYABLE_ACCOUNT_ID      NUMBER          PATH '$.BillsPayableAccountId',
                PAY_ALONE_FLAG                VARCHAR2(10)    PATH '$.PayAloneFlag',
                OVERRIDE_B2B_COMM_FLAG        VARCHAR2(10)    PATH '$.OverrideB2BCommunicationforSpecialHandlingOrdersFlag',
                INACTIVE_DATE                 VARCHAR2(30)    PATH '$.InactiveDate',
                STATUS                        VARCHAR2(30)    PATH '$.Status',
                CREATION_DATE                 VARCHAR2(50)    PATH '$.CreationDate',
                CREATED_BY                    VARCHAR2(240)   PATH '$.CreatedBy',
                LAST_UPDATE_DATE              VARCHAR2(50)    PATH '$.LastUpdateDate',
                LAST_UPDATED_BY               VARCHAR2(240)   PATH '$.LastUpdatedBy'
            )
        ) jt
        WHERE jt.SUPPLIER_SITE_ID IS NOT NULL
    ) src
    ON (tgt.SUPPLIER_SITE_ID = src.SUPPLIER_SITE_ID)
    WHEN MATCHED THEN
        UPDATE SET
            tgt.SUPPLIER_ID = src.SUPPLIER_ID,
            tgt.PROCUREMENT_BU = src.PROCUREMENT_BU,
            tgt.PROCUREMENT_BU_ID = src.PROCUREMENT_BU_ID,
            tgt.SUPPLIER_SITE = src.SUPPLIER_SITE,
            tgt.SUPPLIER_SITE_CODE = src.SUPPLIER_SITE_CODE,
            tgt.ADDRESS_NAME = src.ADDRESS_NAME,
            tgt.SOURCING_ONLY_FLAG = src.SOURCING_ONLY_FLAG,
            tgt.PURCHASING_FLAG = src.PURCHASING_FLAG,
            tgt.PAY_FLAG = src.PAY_FLAG,
            tgt.PAY_SITE_FLAG = src.PAY_SITE_FLAG,
            tgt.PRIMARY_PAY_SITE_FLAG = src.PRIMARY_PAY_SITE_FLAG,
            tgt.RFQ_ONLY_SITE_FLAG = src.RFQ_ONLY_SITE_FLAG,
            tgt.PAYMENT_TERMS = src.PAYMENT_TERMS,
            tgt.PAYMENT_TERMS_ID = src.PAYMENT_TERMS_ID,
            tgt.PAYMENT_TERMS_DATE_BASIS_CODE = src.PAYMENT_TERMS_DATE_BASIS_CODE,
            tgt.PAYMENT_TERMS_DATE_BASIS = src.PAYMENT_TERMS_DATE_BASIS,
            tgt.PAY_DATE_BASIS_CODE = src.PAY_DATE_BASIS_CODE,
            tgt.PAY_DATE_BASIS = src.PAY_DATE_BASIS,
            tgt.PAY_GROUP_CODE = src.PAY_GROUP_CODE,
            tgt.PAY_GROUP = src.PAY_GROUP,
            tgt.BANK_CHARGE_DEDUCTION_TYPE_CODE = src.BANK_CHARGE_DEDUCTION_TYPE_CODE,
            tgt.BANK_CHARGE_DEDUCTION_TYPE = src.BANK_CHARGE_DEDUCTION_TYPE,
            tgt.ALWAYS_TAKE_DISCOUNT_CODE = src.ALWAYS_TAKE_DISCOUNT_CODE,
            tgt.ALWAYS_TAKE_DISCOUNT = src.ALWAYS_TAKE_DISCOUNT,
            tgt.EXCLUDE_FREIGHT_FROM_DISC_CODE = src.EXCLUDE_FREIGHT_FROM_DISC_CODE,
            tgt.EXCLUDE_FREIGHT_FROM_DISCOUNT = src.EXCLUDE_FREIGHT_FROM_DISCOUNT,
            tgt.EXCLUDE_TAX_FROM_DISC_CODE = src.EXCLUDE_TAX_FROM_DISC_CODE,
            tgt.EXCLUDE_TAX_FROM_DISCOUNT = src.EXCLUDE_TAX_FROM_DISCOUNT,
            tgt.CREATE_INTEREST_INVOICES_CODE = src.CREATE_INTEREST_INVOICES_CODE,
            tgt.CREATE_INTEREST_INVOICES = src.CREATE_INTEREST_INVOICES,
            tgt.INVOICE_CURRENCY_CODE = src.INVOICE_CURRENCY_CODE,
            tgt.INVOICE_AMOUNT_LIMIT = src.INVOICE_AMOUNT_LIMIT,
            tgt.INVOICE_MATCH_OPTION_CODE = src.INVOICE_MATCH_OPTION_CODE,
            tgt.INVOICE_MATCH_OPTION = src.INVOICE_MATCH_OPTION,
            tgt.MATCH_APPROVAL_LEVEL_CODE = src.MATCH_APPROVAL_LEVEL_CODE,
            tgt.MATCH_APPROVAL_LEVEL = src.MATCH_APPROVAL_LEVEL,
            tgt.HOLD_ALL_INVOICES_FLAG = src.HOLD_ALL_INVOICES_FLAG,
            tgt.HOLD_FUTURE_PAYMENTS_FLAG = src.HOLD_FUTURE_PAYMENTS_FLAG,
            tgt.HOLD_REASON = src.HOLD_REASON,
            tgt.HOLD_UNMATCHED_INVOICES_CODE = src.HOLD_UNMATCHED_INVOICES_CODE,
            tgt.HOLD_UNMATCHED_INVOICES = src.HOLD_UNMATCHED_INVOICES,
            tgt.TAX_REPORTING_SITE_FLAG = src.TAX_REPORTING_SITE_FLAG,
            tgt.SELF_ASSESS_TAX_FLAG = src.SELF_ASSESS_TAX_FLAG,
            tgt.VAT_CODE = src.VAT_CODE,
            tgt.VAT_REGISTRATION_NUMBER = src.VAT_REGISTRATION_NUMBER,
            tgt.EMAIL = src.EMAIL,
            tgt.FAX = src.FAX,
            tgt.PHONE = src.PHONE,
            tgt.EDI_ENABLED_FLAG = src.EDI_ENABLED_FLAG,
            tgt.TOLERANCE_ID = src.TOLERANCE_ID,
            tgt.TOLERANCE_NAME = src.TOLERANCE_NAME,
            tgt.DISTRIBUTION_SET_ID = src.DISTRIBUTION_SET_ID,
            tgt.DISTRIBUTION_SET = src.DISTRIBUTION_SET,
            tgt.LIABILITY_ACCOUNT_ID = src.LIABILITY_ACCOUNT_ID,
            tgt.PREPAYMENT_ACCOUNT_ID = src.PREPAYMENT_ACCOUNT_ID,
            tgt.BILLS_PAYABLE_ACCOUNT_ID = src.BILLS_PAYABLE_ACCOUNT_ID,
            tgt.PAY_ALONE_FLAG = src.PAY_ALONE_FLAG,
            tgt.OVERRIDE_B2B_COMM_FLAG = src.OVERRIDE_B2B_COMM_FLAG,
            tgt.INACTIVE_DATE = src.INACTIVE_DATE,
            tgt.STATUS = src.STATUS,
            tgt.CREATION_DATE = src.CREATION_DATE,
            tgt.CREATED_BY = src.CREATED_BY,
            tgt.LAST_UPDATE_DATE = src.LAST_UPDATE_DATE,
            tgt.LAST_UPDATED_BY = src.LAST_UPDATED_BY,
            tgt.SYNC_TIMESTAMP = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            SUPPLIER_SITE_ID,
            SUPPLIER_ID,
            PROCUREMENT_BU,
            PROCUREMENT_BU_ID,
            SUPPLIER_SITE,
            SUPPLIER_SITE_CODE,
            ADDRESS_NAME,
            SOURCING_ONLY_FLAG,
            PURCHASING_FLAG,
            PAY_FLAG,
            PAY_SITE_FLAG,
            PRIMARY_PAY_SITE_FLAG,
            RFQ_ONLY_SITE_FLAG,
            PAYMENT_TERMS,
            PAYMENT_TERMS_ID,
            PAYMENT_TERMS_DATE_BASIS_CODE,
            PAYMENT_TERMS_DATE_BASIS,
            PAY_DATE_BASIS_CODE,
            PAY_DATE_BASIS,
            PAY_GROUP_CODE,
            PAY_GROUP,
            BANK_CHARGE_DEDUCTION_TYPE_CODE,
            BANK_CHARGE_DEDUCTION_TYPE,
            ALWAYS_TAKE_DISCOUNT_CODE,
            ALWAYS_TAKE_DISCOUNT,
            EXCLUDE_FREIGHT_FROM_DISC_CODE,
            EXCLUDE_FREIGHT_FROM_DISCOUNT,
            EXCLUDE_TAX_FROM_DISC_CODE,
            EXCLUDE_TAX_FROM_DISCOUNT,
            CREATE_INTEREST_INVOICES_CODE,
            CREATE_INTEREST_INVOICES,
            INVOICE_CURRENCY_CODE,
            INVOICE_AMOUNT_LIMIT,
            INVOICE_MATCH_OPTION_CODE,
            INVOICE_MATCH_OPTION,
            MATCH_APPROVAL_LEVEL_CODE,
            MATCH_APPROVAL_LEVEL,
            HOLD_ALL_INVOICES_FLAG,
            HOLD_FUTURE_PAYMENTS_FLAG,
            HOLD_REASON,
            HOLD_UNMATCHED_INVOICES_CODE,
            HOLD_UNMATCHED_INVOICES,
            TAX_REPORTING_SITE_FLAG,
            SELF_ASSESS_TAX_FLAG,
            VAT_CODE,
            VAT_REGISTRATION_NUMBER,
            EMAIL,
            FAX,
            PHONE,
            EDI_ENABLED_FLAG,
            TOLERANCE_ID,
            TOLERANCE_NAME,
            DISTRIBUTION_SET_ID,
            DISTRIBUTION_SET,
            LIABILITY_ACCOUNT_ID,
            PREPAYMENT_ACCOUNT_ID,
            BILLS_PAYABLE_ACCOUNT_ID,
            PAY_ALONE_FLAG,
            OVERRIDE_B2B_COMM_FLAG,
            INACTIVE_DATE,
            STATUS,
            CREATION_DATE,
            CREATED_BY,
            LAST_UPDATE_DATE,
            LAST_UPDATED_BY,
            SYNC_TIMESTAMP
        ) VALUES (
            src.SUPPLIER_SITE_ID,
            src.SUPPLIER_ID,
            src.PROCUREMENT_BU,
            src.PROCUREMENT_BU_ID,
            src.SUPPLIER_SITE,
            src.SUPPLIER_SITE_CODE,
            src.ADDRESS_NAME,
            src.SOURCING_ONLY_FLAG,
            src.PURCHASING_FLAG,
            src.PAY_FLAG,
            src.PAY_SITE_FLAG,
            src.PRIMARY_PAY_SITE_FLAG,
            src.RFQ_ONLY_SITE_FLAG,
            src.PAYMENT_TERMS,
            src.PAYMENT_TERMS_ID,
            src.PAYMENT_TERMS_DATE_BASIS_CODE,
            src.PAYMENT_TERMS_DATE_BASIS,
            src.PAY_DATE_BASIS_CODE,
            src.PAY_DATE_BASIS,
            src.PAY_GROUP_CODE,
            src.PAY_GROUP,
            src.BANK_CHARGE_DEDUCTION_TYPE_CODE,
            src.BANK_CHARGE_DEDUCTION_TYPE,
            src.ALWAYS_TAKE_DISCOUNT_CODE,
            src.ALWAYS_TAKE_DISCOUNT,
            src.EXCLUDE_FREIGHT_FROM_DISC_CODE,
            src.EXCLUDE_FREIGHT_FROM_DISCOUNT,
            src.EXCLUDE_TAX_FROM_DISC_CODE,
            src.EXCLUDE_TAX_FROM_DISCOUNT,
            src.CREATE_INTEREST_INVOICES_CODE,
            src.CREATE_INTEREST_INVOICES,
            src.INVOICE_CURRENCY_CODE,
            src.INVOICE_AMOUNT_LIMIT,
            src.INVOICE_MATCH_OPTION_CODE,
            src.INVOICE_MATCH_OPTION,
            src.MATCH_APPROVAL_LEVEL_CODE,
            src.MATCH_APPROVAL_LEVEL,
            src.HOLD_ALL_INVOICES_FLAG,
            src.HOLD_FUTURE_PAYMENTS_FLAG,
            src.HOLD_REASON,
            src.HOLD_UNMATCHED_INVOICES_CODE,
            src.HOLD_UNMATCHED_INVOICES,
            src.TAX_REPORTING_SITE_FLAG,
            src.SELF_ASSESS_TAX_FLAG,
            src.VAT_CODE,
            src.VAT_REGISTRATION_NUMBER,
            src.EMAIL,
            src.FAX,
            src.PHONE,
            src.EDI_ENABLED_FLAG,
            src.TOLERANCE_ID,
            src.TOLERANCE_NAME,
            src.DISTRIBUTION_SET_ID,
            src.DISTRIBUTION_SET,
            src.LIABILITY_ACCOUNT_ID,
            src.PREPAYMENT_ACCOUNT_ID,
            src.BILLS_PAYABLE_ACCOUNT_ID,
            src.PAY_ALONE_FLAG,
            src.OVERRIDE_B2B_COMM_FLAG,
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
END RR_SYNC_SUPPLIER_SITES;
/

-- =============================================
-- 3. Create APEX REST Handler
-- =============================================
-- Module: reerp (existing)
-- Template: suppliers/sites
-- Method: POST

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'suppliers/sites',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync Supplier Sites from Oracle Fusion',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    RR_SYNC_SUPPLIER_SITES(
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
-- DESC RR_SUPPLIER_SITES;

-- Check row count:
-- SELECT COUNT(*) FROM RR_SUPPLIER_SITES;

-- Check sites by supplier:
-- SELECT SUPPLIER_ID, COUNT(*) as SITE_COUNT
-- FROM RR_SUPPLIER_SITES
-- GROUP BY SUPPLIER_ID;

-- Sample query with supplier join:
-- SELECT s.SUPPLIER, s.SUPPLIER_NUMBER, st.SUPPLIER_SITE, st.PROCUREMENT_BU, st.STATUS
-- FROM RR_SUPPLIER_MASTER s
-- JOIN RR_SUPPLIER_SITES st ON s.SUPPLIER_ID = st.SUPPLIER_ID;
