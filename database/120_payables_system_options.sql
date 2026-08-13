-- ============================================================
-- 120_payables_system_options.sql
-- Creates RR_AP_SYSTEM_OPTIONS table and ORDS handlers:
--   GET  ap/system-options          -- list all rows
--   POST ap/system-options          -- upsert (merge) by businessUnitId
-- Run in SQL Developer against the BCLDIFC schema.
-- ============================================================

-- ---- Table --------------------------------------------------
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE RR_AP_SYSTEM_OPTIONS';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

CREATE TABLE RR_AP_SYSTEM_OPTIONS (
  OPTION_ID                          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  BUSINESS_UNIT_ID                   NUMBER         NOT NULL,
  BUSINESS_UNIT_NAME                 VARCHAR2(240),
  LEDGER_ID                          NUMBER,
  LEDGER_CURRENCY                    VARCHAR2(15),
  INVOICE_CURRENCY                   VARCHAR2(15),
  PAYMENT_CURRENCY                   VARCHAR2(15),
  PAY_DATE_BASIS                     VARCHAR2(30),
  TERMS_DATE_BASIS                   VARCHAR2(30),
  BUDGET_DATE_BASIS                  VARCHAR2(30),
  ACCOUNTING_DATE_BASIS              VARCHAR2(30),
  ACCOUNT_FOR_PAYMENT                VARCHAR2(60),
  PAYMENT_PRIORITY                   NUMBER,
  PAYMENT_TERMS                      VARCHAR2(60),
  PREPAYMENT_PAYMENT_TERMS           VARCHAR2(60),
  PAYMENT_REQUEST_PAYMENT_TERMS      VARCHAR2(60),
  PAY_GROUP                          VARCHAR2(60),
  DISCOUNT_ALLOCATION_METHOD         VARCHAR2(30),
  ENABLE_INVOICE_APPROVAL_FLAG       VARCHAR2(1),
  REQUIRE_VALIDATION_BEFORE_APPROVAL VARCHAR2(1),
  ALLOW_FORCE_APPROVAL_FLAG          VARCHAR2(1),
  ALLOW_ADJUSTMENTS_TO_PAID_INV_FLAG VARCHAR2(1),
  CREATE_INTEREST_INVOICES_FLAG      VARCHAR2(1),
  ALWAYS_TAKE_DISC_FLAG              VARCHAR2(1),
  ALLOW_INVOICE_BACKDATING_FLAG      VARCHAR2(1),
  SHOW_AVAIL_PREPAYMENTS_FLAG        VARCHAR2(1),
  REQUIRE_CONV_RATE_FOR_PMTS_FLAG    VARCHAR2(1),
  USE_DIST_FROM_PO_FLAG              VARCHAR2(1),
  EXCHANGE_GAIN_LOSS_ACCOUNT         VARCHAR2(100),  -- custom column
  LAST_UPDATE_DATE                   DATE,
  LAST_UPDATED_BY                    VARCHAR2(240),
  CREATED_BY                         VARCHAR2(240),
  CREATION_DATE                      DATE,
  SYNC_DATE                          DATE DEFAULT SYSDATE,
  CONSTRAINT RR_AP_SYS_OPT_BU_UK UNIQUE (BUSINESS_UNIT_ID)
);

COMMENT ON COLUMN RR_AP_SYSTEM_OPTIONS.EXCHANGE_GAIN_LOSS_ACCOUNT IS 'Custom: GL account combination for FX Gain/Loss';
/

-- ---- GET handler -------------------------------------------
BEGIN
  ORDS.DELETE_HANDLER(p_module_name=>'ap', p_pattern=>'system-options', p_method=>'GET');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'system-options',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_source         => q'[
SELECT
  OPTION_ID,
  BUSINESS_UNIT_ID,
  BUSINESS_UNIT_NAME,
  LEDGER_ID,
  LEDGER_CURRENCY,
  INVOICE_CURRENCY,
  PAYMENT_CURRENCY,
  PAY_DATE_BASIS,
  TERMS_DATE_BASIS,
  BUDGET_DATE_BASIS,
  ACCOUNTING_DATE_BASIS,
  ACCOUNT_FOR_PAYMENT,
  PAYMENT_PRIORITY,
  PAYMENT_TERMS,
  PREPAYMENT_PAYMENT_TERMS,
  PAYMENT_REQUEST_PAYMENT_TERMS,
  PAY_GROUP,
  DISCOUNT_ALLOCATION_METHOD,
  ENABLE_INVOICE_APPROVAL_FLAG,
  REQUIRE_VALIDATION_BEFORE_APPROVAL,
  ALLOW_FORCE_APPROVAL_FLAG,
  ALLOW_ADJUSTMENTS_TO_PAID_INV_FLAG,
  CREATE_INTEREST_INVOICES_FLAG,
  ALWAYS_TAKE_DISC_FLAG,
  ALLOW_INVOICE_BACKDATING_FLAG,
  SHOW_AVAIL_PREPAYMENTS_FLAG,
  REQUIRE_CONV_RATE_FOR_PMTS_FLAG,
  USE_DIST_FROM_PO_FLAG,
  EXCHANGE_GAIN_LOSS_ACCOUNT,
  TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
  LAST_UPDATED_BY,
  CREATED_BY,
  TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
  TO_CHAR(SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE
FROM RR_AP_SYSTEM_OPTIONS
ORDER BY BUSINESS_UNIT_NAME
]'
  );
  COMMIT;
END;
/

-- ---- POST handler (upsert by businessUnitId) ---------------
BEGIN
  ORDS.DELETE_HANDLER(p_module_name=>'ap', p_pattern=>'system-options', p_method=>'POST');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'system-options',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body CLOB := :body;
  v_bu_id  NUMBER;
BEGIN
  v_bu_id := TO_NUMBER(JSON_VALUE(v_body, '$.businessUnitId'));

  IF v_bu_id IS NULL THEN
    :status := 400;
    HTP.P('{"status":"error","message":"businessUnitId is required"}');
    RETURN;
  END IF;

  MERGE INTO RR_AP_SYSTEM_OPTIONS t
  USING (SELECT v_bu_id AS BU FROM DUAL) s
  ON (t.BUSINESS_UNIT_ID = s.BU)
  WHEN MATCHED THEN UPDATE SET
    BUSINESS_UNIT_NAME                 = JSON_VALUE(v_body, '$.businessUnitName'),
    LEDGER_ID                          = TO_NUMBER(JSON_VALUE(v_body, '$.ledgerId')),
    LEDGER_CURRENCY                    = JSON_VALUE(v_body, '$.ledgerCurrency'),
    INVOICE_CURRENCY                   = JSON_VALUE(v_body, '$.invoiceCurrency'),
    PAYMENT_CURRENCY                   = JSON_VALUE(v_body, '$.paymentCurrency'),
    PAY_DATE_BASIS                     = JSON_VALUE(v_body, '$.payDateBasis'),
    TERMS_DATE_BASIS                   = JSON_VALUE(v_body, '$.termsDateBasis'),
    BUDGET_DATE_BASIS                  = JSON_VALUE(v_body, '$.budgetDateBasis'),
    ACCOUNTING_DATE_BASIS              = JSON_VALUE(v_body, '$.accountingDateBasis'),
    ACCOUNT_FOR_PAYMENT                = JSON_VALUE(v_body, '$.accountForPayment'),
    PAYMENT_PRIORITY                   = TO_NUMBER(JSON_VALUE(v_body, '$.paymentPriority')),
    PAYMENT_TERMS                      = JSON_VALUE(v_body, '$.paymentTerms'),
    PREPAYMENT_PAYMENT_TERMS           = JSON_VALUE(v_body, '$.prepaymentPaymentTerms'),
    PAYMENT_REQUEST_PAYMENT_TERMS      = JSON_VALUE(v_body, '$.paymentRequestPaymentTerms'),
    PAY_GROUP                          = JSON_VALUE(v_body, '$.payGroup'),
    DISCOUNT_ALLOCATION_METHOD         = JSON_VALUE(v_body, '$.discountAllocationMethod'),
    ENABLE_INVOICE_APPROVAL_FLAG       = CASE WHEN JSON_VALUE(v_body, '$.enableInvoiceApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    REQUIRE_VALIDATION_BEFORE_APPROVAL = CASE WHEN JSON_VALUE(v_body, '$.requireValidationBeforeApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    ALLOW_FORCE_APPROVAL_FLAG          = CASE WHEN JSON_VALUE(v_body, '$.allowForceApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    ALLOW_ADJUSTMENTS_TO_PAID_INV_FLAG = CASE WHEN JSON_VALUE(v_body, '$.allowAdjustmentsToPaidInvoicesFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CREATE_INTEREST_INVOICES_FLAG      = CASE WHEN JSON_VALUE(v_body, '$.createInterestInvoicesFlag') = 'true' THEN 'Y' ELSE 'N' END,
    ALWAYS_TAKE_DISC_FLAG              = CASE WHEN JSON_VALUE(v_body, '$.alwaysTakeDiscFlag') = 'true' THEN 'Y' ELSE 'N' END,
    SHOW_AVAIL_PREPAYMENTS_FLAG        = CASE WHEN JSON_VALUE(v_body, '$.showAvailablePrepaymentsDuringInvoiceEntryFlag') = 'true' THEN 'Y' ELSE 'N' END,
    REQUIRE_CONV_RATE_FOR_PMTS_FLAG    = CASE WHEN JSON_VALUE(v_body, '$.requireConversionRateEntryForPaymentsFlag') = 'true' THEN 'Y' ELSE 'N' END,
    USE_DIST_FROM_PO_FLAG              = CASE WHEN JSON_VALUE(v_body, '$.useDistributionFromPurchaseOrderFlag') = 'true' THEN 'Y' ELSE 'N' END,
    EXCHANGE_GAIN_LOSS_ACCOUNT         = JSON_VALUE(v_body, '$.exchangeGainLossAccount'),
    LAST_UPDATE_DATE                   = TO_DATE(SUBSTR(JSON_VALUE(v_body, '$.lastUpdateDate'),1,19),'YYYY-MM-DD"T"HH24:MI:SS'),
    LAST_UPDATED_BY                    = JSON_VALUE(v_body, '$.lastUpdatedBy'),
    SYNC_DATE                          = SYSDATE
  WHEN NOT MATCHED THEN INSERT (
    BUSINESS_UNIT_ID, BUSINESS_UNIT_NAME, LEDGER_ID, LEDGER_CURRENCY,
    INVOICE_CURRENCY, PAYMENT_CURRENCY, PAY_DATE_BASIS, TERMS_DATE_BASIS,
    BUDGET_DATE_BASIS, ACCOUNTING_DATE_BASIS, ACCOUNT_FOR_PAYMENT,
    PAYMENT_PRIORITY, PAYMENT_TERMS, PREPAYMENT_PAYMENT_TERMS,
    PAYMENT_REQUEST_PAYMENT_TERMS, PAY_GROUP, DISCOUNT_ALLOCATION_METHOD,
    ENABLE_INVOICE_APPROVAL_FLAG, REQUIRE_VALIDATION_BEFORE_APPROVAL,
    ALLOW_FORCE_APPROVAL_FLAG, ALLOW_ADJUSTMENTS_TO_PAID_INV_FLAG,
    CREATE_INTEREST_INVOICES_FLAG, ALWAYS_TAKE_DISC_FLAG,
    SHOW_AVAIL_PREPAYMENTS_FLAG, REQUIRE_CONV_RATE_FOR_PMTS_FLAG,
    USE_DIST_FROM_PO_FLAG, EXCHANGE_GAIN_LOSS_ACCOUNT,
    LAST_UPDATE_DATE, LAST_UPDATED_BY, CREATED_BY, CREATION_DATE, SYNC_DATE
  ) VALUES (
    v_bu_id,
    JSON_VALUE(v_body, '$.businessUnitName'),
    TO_NUMBER(JSON_VALUE(v_body, '$.ledgerId')),
    JSON_VALUE(v_body, '$.ledgerCurrency'),
    JSON_VALUE(v_body, '$.invoiceCurrency'),
    JSON_VALUE(v_body, '$.paymentCurrency'),
    JSON_VALUE(v_body, '$.payDateBasis'),
    JSON_VALUE(v_body, '$.termsDateBasis'),
    JSON_VALUE(v_body, '$.budgetDateBasis'),
    JSON_VALUE(v_body, '$.accountingDateBasis'),
    JSON_VALUE(v_body, '$.accountForPayment'),
    TO_NUMBER(JSON_VALUE(v_body, '$.paymentPriority')),
    JSON_VALUE(v_body, '$.paymentTerms'),
    JSON_VALUE(v_body, '$.prepaymentPaymentTerms'),
    JSON_VALUE(v_body, '$.paymentRequestPaymentTerms'),
    JSON_VALUE(v_body, '$.payGroup'),
    JSON_VALUE(v_body, '$.discountAllocationMethod'),
    CASE WHEN JSON_VALUE(v_body, '$.enableInvoiceApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.requireValidationBeforeApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.allowForceApprovalFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.allowAdjustmentsToPaidInvoicesFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.createInterestInvoicesFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.alwaysTakeDiscFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.showAvailablePrepaymentsDuringInvoiceEntryFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.requireConversionRateEntryForPaymentsFlag') = 'true' THEN 'Y' ELSE 'N' END,
    CASE WHEN JSON_VALUE(v_body, '$.useDistributionFromPurchaseOrderFlag') = 'true' THEN 'Y' ELSE 'N' END,
    JSON_VALUE(v_body, '$.exchangeGainLossAccount'),
    TO_DATE(SUBSTR(JSON_VALUE(v_body, '$.lastUpdateDate'),1,19),'YYYY-MM-DD"T"HH24:MI:SS'),
    JSON_VALUE(v_body, '$.lastUpdatedBy'),
    JSON_VALUE(v_body, '$.createdBy'),
    TO_DATE(SUBSTR(JSON_VALUE(v_body, '$.creationDate'),1,19),'YYYY-MM-DD"T"HH24:MI:SS'),
    SYSDATE
  );

  COMMIT;
  HTP.P('{"status":"success","businessUnitId":' || v_bu_id || '}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status := 500;
    HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/
