-- ============================================================
-- 120b_system_options_get_by_bu.sql
-- Updates GET ap/system-options to support optional
-- ?businessUnitId=N filter parameter
-- Run in SQL Developer against the BCLDIFC schema.
-- ============================================================

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
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_bu_id  NUMBER := TO_NUMBER(:businessUnitId);
  v_cur    SYS_REFCURSOR;
  v_json   CLOB := '';
  v_row    VARCHAR2(4000);

  CURSOR c_rows IS
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
      SHOW_AVAIL_PREPAYMENTS_FLAG,
      REQUIRE_CONV_RATE_FOR_PMTS_FLAG,
      USE_DIST_FROM_PO_FLAG,
      NVL(EXCHANGE_GAIN_LOSS_ACCOUNT,'') AS EXCHANGE_GAIN_LOSS_ACCOUNT,
      TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
      NVL(LAST_UPDATED_BY,'') AS LAST_UPDATED_BY,
      NVL(CREATED_BY,'') AS CREATED_BY,
      TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
      TO_CHAR(SYNC_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE
    FROM RR_AP_SYSTEM_OPTIONS
    WHERE (v_bu_id IS NULL OR BUSINESS_UNIT_ID = v_bu_id)
    ORDER BY BUSINESS_UNIT_NAME;

  TYPE t_row IS RECORD (
    OPTION_ID                          NUMBER,
    BUSINESS_UNIT_ID                   NUMBER,
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
    SHOW_AVAIL_PREPAYMENTS_FLAG        VARCHAR2(1),
    REQUIRE_CONV_RATE_FOR_PMTS_FLAG    VARCHAR2(1),
    USE_DIST_FROM_PO_FLAG              VARCHAR2(1),
    EXCHANGE_GAIN_LOSS_ACCOUNT         VARCHAR2(100),
    LAST_UPDATE_DATE                   VARCHAR2(30),
    LAST_UPDATED_BY                    VARCHAR2(240),
    CREATED_BY                         VARCHAR2(240),
    CREATION_DATE                      VARCHAR2(30),
    SYNC_DATE                          VARCHAR2(30)
  );

  r t_row;
  v_sep VARCHAR2(1) := '';
BEGIN
  v_json := '{"items":[';
  FOR r IN c_rows LOOP
    v_json := v_json || v_sep || '{'
      || '"optionId":'                         || NVL(TO_CHAR(r.OPTION_ID),'null')
      || ',"businessUnitId":'                  || NVL(TO_CHAR(r.BUSINESS_UNIT_ID),'null')
      || ',"businessUnitName":"'               || REPLACE(NVL(r.BUSINESS_UNIT_NAME,''),'"','\"') || '"'
      || ',"ledgerId":'                        || NVL(TO_CHAR(r.LEDGER_ID),'null')
      || ',"ledgerCurrency":"'                 || NVL(r.LEDGER_CURRENCY,'') || '"'
      || ',"invoiceCurrency":"'                || NVL(r.INVOICE_CURRENCY,'') || '"'
      || ',"paymentCurrency":"'                || NVL(r.PAYMENT_CURRENCY,'') || '"'
      || ',"payDateBasis":"'                   || NVL(r.PAY_DATE_BASIS,'') || '"'
      || ',"termsDateBasis":"'                 || NVL(r.TERMS_DATE_BASIS,'') || '"'
      || ',"budgetDateBasis":"'                || NVL(r.BUDGET_DATE_BASIS,'') || '"'
      || ',"accountingDateBasis":"'            || NVL(r.ACCOUNTING_DATE_BASIS,'') || '"'
      || ',"accountForPayment":"'              || NVL(r.ACCOUNT_FOR_PAYMENT,'') || '"'
      || ',"paymentPriority":'                 || NVL(TO_CHAR(r.PAYMENT_PRIORITY),'null')
      || ',"paymentTerms":"'                   || NVL(r.PAYMENT_TERMS,'') || '"'
      || ',"prepaymentPaymentTerms":"'         || NVL(r.PREPAYMENT_PAYMENT_TERMS,'') || '"'
      || ',"paymentRequestPaymentTerms":"'     || NVL(r.PAYMENT_REQUEST_PAYMENT_TERMS,'') || '"'
      || ',"payGroup":"'                       || NVL(r.PAY_GROUP,'') || '"'
      || ',"discountAllocationMethod":"'       || NVL(r.DISCOUNT_ALLOCATION_METHOD,'') || '"'
      || ',"enableInvoiceApprovalFlag":"'      || NVL(r.ENABLE_INVOICE_APPROVAL_FLAG,'N') || '"'
      || ',"requireValidationBeforeApproval":"'|| NVL(r.REQUIRE_VALIDATION_BEFORE_APPROVAL,'N') || '"'
      || ',"allowForceApprovalFlag":"'         || NVL(r.ALLOW_FORCE_APPROVAL_FLAG,'N') || '"'
      || ',"allowAdjustmentsToPaidInvFlag":"'  || NVL(r.ALLOW_ADJUSTMENTS_TO_PAID_INV_FLAG,'N') || '"'
      || ',"createInterestInvoicesFlag":"'     || NVL(r.CREATE_INTEREST_INVOICES_FLAG,'N') || '"'
      || ',"alwaysTakeDiscFlag":"'             || NVL(r.ALWAYS_TAKE_DISC_FLAG,'N') || '"'
      || ',"showAvailPrepaymentsFlag":"'       || NVL(r.SHOW_AVAIL_PREPAYMENTS_FLAG,'N') || '"'
      || ',"requireConvRateForPmtsFlag":"'     || NVL(r.REQUIRE_CONV_RATE_FOR_PMTS_FLAG,'N') || '"'
      || ',"useDistFromPoFlag":"'              || NVL(r.USE_DIST_FROM_PO_FLAG,'N') || '"'
      || ',"exchangeGainLossAccount":"'        || NVL(r.EXCHANGE_GAIN_LOSS_ACCOUNT,'') || '"'
      || ',"lastUpdateDate":'                  || CASE WHEN r.LAST_UPDATE_DATE IS NULL THEN 'null' ELSE '"'||r.LAST_UPDATE_DATE||'"' END
      || ',"lastUpdatedBy":"'                  || NVL(r.LAST_UPDATED_BY,'') || '"'
      || ',"createdBy":"'                      || NVL(r.CREATED_BY,'') || '"'
      || ',"creationDate":'                    || CASE WHEN r.CREATION_DATE IS NULL THEN 'null' ELSE '"'||r.CREATION_DATE||'"' END
      || ',"syncDate":'                        || CASE WHEN r.SYNC_DATE IS NULL THEN 'null' ELSE '"'||r.SYNC_DATE||'"' END
      || '}';
    v_sep := ',';
  END LOOP;
  v_json := v_json || ']}';
  HTP.P(v_json);
EXCEPTION
  WHEN OTHERS THEN
    :status := 500;
    HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/
