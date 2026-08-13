-- =====================================================
-- AR Receipts PL/SQL Package v2
-- Changes from v1:
--   - Added RECEIPT_METHOD_ID to JSON_TABLE column list
--   - Added RECEIPT_METHOD_ID to MERGE UPDATE SET
--   - Added RECEIPT_METHOD_ID to INSERT columns/values
-- =====================================================

CREATE OR REPLACE PACKAGE RR_AR_RECEIPTS_PKG AS

    PROCEDURE save_receipts_bulk (
        p_receipts_json  IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2,
        p_inserted       OUT NUMBER,
        p_updated        OUT NUMBER,
        p_errors         OUT NUMBER,
        p_last_id        OUT NUMBER
    );

    PROCEDURE update_receipt (
        p_receipt_json   IN  CLOB,
        p_receipt_id     IN  NUMBER,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2,
        p_updated        OUT NUMBER
    );

END RR_AR_RECEIPTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_RECEIPTS_PKG AS

    FUNCTION to_safe_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_date;

    FUNCTION to_safe_ts (p_str IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP(
            SUBSTR(REPLACE(TRIM(p_str), 'T', ' '), 1, 19),
            'YYYY-MM-DD HH24:MI:SS'
        );
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_ts;

    PROCEDURE save_receipts_bulk (
        p_receipts_json  IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2,
        p_inserted       OUT NUMBER,
        p_updated        OUT NUMBER,
        p_errors         OUT NUMBER,
        p_last_id        OUT NUMBER
    ) IS
        l_errors    NUMBER := 0;
        l_err_log   VARCHAR2(4000) := '';
    BEGIN
        p_inserted := 0;
        p_updated  := 0;
        p_errors   := 0;
        p_last_id  := NULL;

        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_receipts_json, '$.items[*]' COLUMNS (
                STANDARD_RECEIPT_ID                 NUMBER         PATH '$.StandardReceiptId',
                RECEIPT_NUMBER                      VARCHAR2(50)   PATH '$.ReceiptNumber',
                DOCUMENT_NUMBER                     NUMBER         PATH '$.DocumentNumber',
                RECEIPT_TYPE                        VARCHAR2(10)   PATH '$.ReceiptType',
                RECEIVABLES_TRX_ID                  NUMBER         PATH '$.ReceivablesTrxId',
                MISC_PAYMENT_SOURCE                 VARCHAR2(50)   PATH '$.MiscPaymentSource',
                BUSINESS_UNIT                       VARCHAR2(240)  PATH '$.BusinessUnit',
                RECEIPT_METHOD                      VARCHAR2(240)  PATH '$.ReceiptMethod',
                RECEIPT_METHOD_ID                   NUMBER         PATH '$.ReceiptMethodId',
                RECEIPT_DATE_STR                    VARCHAR2(50)   PATH '$.ReceiptDate',
                ACCOUNTING_DATE_STR                 VARCHAR2(50)   PATH '$.AccountingDate',
                MATURITY_DATE_STR                   VARCHAR2(50)   PATH '$.MaturityDate',
                POSTMARK_DATE_STR                   VARCHAR2(50)   PATH '$.PostmarkDate',
                REM_BANK_DEPOSIT_DATE_STR           VARCHAR2(50)   PATH '$.RemittanceBankDepositDate',
                AMOUNT                              NUMBER         PATH '$.Amount',
                UNAPPLIED_AMOUNT                    NUMBER         PATH '$.UnappliedAmount',
                ACCOUNTED_AMOUNT                    NUMBER         PATH '$.AccountedAmount',
                CURRENCY                            VARCHAR2(15)   PATH '$.Currency',
                CONVERSION_RATE_TYPE                VARCHAR2(30)   PATH '$.ConversionRateType',
                CONVERSION_DATE_STR                 VARCHAR2(50)   PATH '$.ConversionDate',
                CONVERSION_RATE                     NUMBER         PATH '$.ConversionRate',
                STATE                               VARCHAR2(30)   PATH '$.State',
                STATUS                              VARCHAR2(30)   PATH '$.Status',
                RECEIPT_AT_RISK                     VARCHAR2(1)    PATH '$.ReceiptAtRisk',
                REMITTANCE_BANK_NAME                VARCHAR2(240)  PATH '$.RemittanceBankName',
                REMITTANCE_BANK_BRANCH              VARCHAR2(240)  PATH '$.RemittanceBankBranch',
                REMITTANCE_BANK_ACCOUNT_NUMBER      VARCHAR2(100)  PATH '$.RemittanceBankAccountNumber',
                REMITTANCE_BANK_ALLOW_OVERRIDE      VARCHAR2(1)    PATH '$.RemittanceBankAllowOverride',
                CUSTOMER_NAME                       VARCHAR2(360)  PATH '$.CustomerName',
                CUSTOMER_ACCOUNT_NUMBER             VARCHAR2(30)   PATH '$.CustomerAccountNumber',
                CUSTOMER_SITE                       VARCHAR2(240)  PATH '$.CustomerSite',
                TAXPAYER_IDENTIFICATION_NUMBER      VARCHAR2(50)   PATH '$.TaxpayerIdentificationNumber',
                CUSTOMER_BANK                       VARCHAR2(240)  PATH '$.CustomerBank',
                CUSTOMER_BANK_BRANCH                VARCHAR2(240)  PATH '$.CustomerBankBranch',
                CUSTOMER_BANK_ACCOUNT_NUMBER        VARCHAR2(100)  PATH '$.CustomerBankAccountNumber',
                CREDIT_CARD_TOKEN_NUMBER            VARCHAR2(80)   PATH '$.CreditCardTokenNumber',
                CREDIT_CARD_AUTH_REQUEST_ID         VARCHAR2(50)   PATH '$.CreditCardAuthorizationRequestIdentifier',
                CARD_HOLDER_FIRST_NAME              VARCHAR2(60)   PATH '$.CardHolderFirstName',
                CARD_HOLDER_LAST_NAME               VARCHAR2(60)   PATH '$.CardHolderLastName',
                CREDIT_CARD_ISSUER_CODE             VARCHAR2(80)   PATH '$.CreditCardIssuerCode',
                CC_EXPIRATION_DATE_STR              VARCHAR2(50)   PATH '$.CreditCardExpirationDate',
                VOICE_AUTHORIZATION_CODE            VARCHAR2(10)   PATH '$.VoiceAuthorizationCode',
                REVERSAL_CATEGORY                   VARCHAR2(20)   PATH '$.ReversalCategory',
                REVERSAL_REASON                     VARCHAR2(240)  PATH '$.ReversalReason',
                REVERSAL_DATE_STR                   VARCHAR2(50)   PATH '$.ReversalDate',
                REVERSAL_COMMENTS                   VARCHAR2(4000) PATH '$.ReversalComments',
                RECEIPT_BATCH_NAME                  VARCHAR2(20)   PATH '$.ReceiptBatchName',
                RECEIPT_BATCH_DATE_STR              VARCHAR2(50)   PATH '$.ReceiptBatchDate',
                RECEIVABLES_SPECIALIST              VARCHAR2(30)   PATH '$.ReceivablesSpecialist',
                COMMENTS                            VARCHAR2(4000) PATH '$.Comments',
                STRUCTURED_PAYMENT_REFERENCE        VARCHAR2(100)  PATH '$.StructuredPaymentReference',
                FUSION_CREATED_BY                   VARCHAR2(240)  PATH '$.CreatedBy',
                CREATION_DATE_STR                   VARCHAR2(50)   PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY              VARCHAR2(240)  PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR                VARCHAR2(50)   PATH '$.LastUpdateDate',
                DR_ACCOUNT                          VARCHAR2(100)  PATH '$.DrAccount',
                CR_ACCOUNT                          VARCHAR2(100)  PATH '$.CrAccount'
            )) j
        ) LOOP
            DECLARE
                l_receipt_date   DATE;
                l_acct_date      DATE;
                l_maturity_date  DATE;
                l_postmark_date  DATE;
                l_rem_dep_date   DATE;
                l_conv_date      DATE;
                l_cc_exp_date    DATE;
                l_rev_date       DATE;
                l_batch_date     DATE;
                l_cr_ts          TIMESTAMP;
                l_upd_ts         TIMESTAMP;
                l_exists         NUMBER;
                l_receipt_id     NUMBER;
            BEGIN
                l_receipt_date  := to_safe_date(rec.RECEIPT_DATE_STR);
                l_acct_date     := to_safe_date(rec.ACCOUNTING_DATE_STR);
                l_maturity_date := to_safe_date(rec.MATURITY_DATE_STR);
                l_postmark_date := to_safe_date(rec.POSTMARK_DATE_STR);
                l_rem_dep_date  := to_safe_date(rec.REM_BANK_DEPOSIT_DATE_STR);
                l_conv_date     := to_safe_date(rec.CONVERSION_DATE_STR);
                l_cc_exp_date   := to_safe_date(rec.CC_EXPIRATION_DATE_STR);
                l_rev_date      := to_safe_date(rec.REVERSAL_DATE_STR);
                l_batch_date    := to_safe_date(rec.RECEIPT_BATCH_DATE_STR);
                l_cr_ts         := to_safe_ts(rec.CREATION_DATE_STR);
                l_upd_ts        := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                IF rec.STANDARD_RECEIPT_ID IS NULL OR rec.STANDARD_RECEIPT_ID = 0 THEN
                    l_receipt_id := RR_AR_RECEIPTS_LOCAL_SEQ.NEXTVAL;
                    p_last_id    := l_receipt_id;
                ELSE
                    l_receipt_id := rec.STANDARD_RECEIPT_ID;
                END IF;

                SELECT COUNT(*) INTO l_exists
                FROM RR_AR_RECEIPTS
                WHERE STANDARD_RECEIPT_ID = l_receipt_id;

                MERGE INTO RR_AR_RECEIPTS r
                USING DUAL
                ON (r.STANDARD_RECEIPT_ID = l_receipt_id)
                WHEN MATCHED THEN UPDATE SET
                    RECEIPT_NUMBER                      = rec.RECEIPT_NUMBER,
                    DOCUMENT_NUMBER                     = rec.DOCUMENT_NUMBER,
                    RECEIPT_TYPE                        = rec.RECEIPT_TYPE,
                    RECEIVABLES_TRX_ID                  = rec.RECEIVABLES_TRX_ID,
                    MISC_PAYMENT_SOURCE                 = rec.MISC_PAYMENT_SOURCE,
                    BUSINESS_UNIT                       = rec.BUSINESS_UNIT,
                    RECEIPT_METHOD                      = rec.RECEIPT_METHOD,
                    RECEIPT_METHOD_ID                   = rec.RECEIPT_METHOD_ID,
                    RECEIPT_DATE                        = l_receipt_date,
                    ACCOUNTING_DATE                     = l_acct_date,
                    MATURITY_DATE                       = l_maturity_date,
                    POSTMARK_DATE                       = l_postmark_date,
                    REMITTANCE_BANK_DEPOSIT_DATE        = l_rem_dep_date,
                    AMOUNT                              = rec.AMOUNT,
                    UNAPPLIED_AMOUNT                    = rec.UNAPPLIED_AMOUNT,
                    ACCOUNTED_AMOUNT                    = rec.ACCOUNTED_AMOUNT,
                    CURRENCY                            = rec.CURRENCY,
                    CONVERSION_RATE_TYPE                = rec.CONVERSION_RATE_TYPE,
                    CONVERSION_DATE                     = l_conv_date,
                    CONVERSION_RATE                     = rec.CONVERSION_RATE,
                    STATE                               = rec.STATE,
                    STATUS                              = rec.STATUS,
                    RECEIPT_AT_RISK                     = rec.RECEIPT_AT_RISK,
                    REMITTANCE_BANK_NAME                = rec.REMITTANCE_BANK_NAME,
                    REMITTANCE_BANK_BRANCH              = rec.REMITTANCE_BANK_BRANCH,
                    REMITTANCE_BANK_ACCOUNT_NUMBER      = rec.REMITTANCE_BANK_ACCOUNT_NUMBER,
                    REMITTANCE_BANK_ALLOW_OVERRIDE      = rec.REMITTANCE_BANK_ALLOW_OVERRIDE,
                    CUSTOMER_NAME                       = rec.CUSTOMER_NAME,
                    CUSTOMER_ACCOUNT_NUMBER             = rec.CUSTOMER_ACCOUNT_NUMBER,
                    CUSTOMER_SITE                       = rec.CUSTOMER_SITE,
                    TAXPAYER_IDENTIFICATION_NUMBER      = rec.TAXPAYER_IDENTIFICATION_NUMBER,
                    CUSTOMER_BANK                       = rec.CUSTOMER_BANK,
                    CUSTOMER_BANK_BRANCH                = rec.CUSTOMER_BANK_BRANCH,
                    CUSTOMER_BANK_ACCOUNT_NUMBER        = rec.CUSTOMER_BANK_ACCOUNT_NUMBER,
                    CREDIT_CARD_TOKEN_NUMBER            = rec.CREDIT_CARD_TOKEN_NUMBER,
                    CREDIT_CARD_AUTH_REQUEST_ID         = rec.CREDIT_CARD_AUTH_REQUEST_ID,
                    CARD_HOLDER_FIRST_NAME              = rec.CARD_HOLDER_FIRST_NAME,
                    CARD_HOLDER_LAST_NAME               = rec.CARD_HOLDER_LAST_NAME,
                    CREDIT_CARD_ISSUER_CODE             = rec.CREDIT_CARD_ISSUER_CODE,
                    CREDIT_CARD_EXPIRATION_DATE         = l_cc_exp_date,
                    VOICE_AUTHORIZATION_CODE            = rec.VOICE_AUTHORIZATION_CODE,
                    REVERSAL_CATEGORY                   = rec.REVERSAL_CATEGORY,
                    REVERSAL_REASON                     = rec.REVERSAL_REASON,
                    REVERSAL_DATE                       = l_rev_date,
                    REVERSAL_COMMENTS                   = rec.REVERSAL_COMMENTS,
                    RECEIPT_BATCH_NAME                  = rec.RECEIPT_BATCH_NAME,
                    RECEIPT_BATCH_DATE                  = l_batch_date,
                    RECEIVABLES_SPECIALIST              = rec.RECEIVABLES_SPECIALIST,
                    COMMENTS                            = rec.COMMENTS,
                    STRUCTURED_PAYMENT_REFERENCE        = rec.STRUCTURED_PAYMENT_REFERENCE,
                    FUSION_CREATED_BY                   = rec.FUSION_CREATED_BY,
                    FUSION_CREATION_DATE                = l_cr_ts,
                    FUSION_LAST_UPDATED_BY              = rec.FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE             = l_upd_ts,
                    DR_ACCOUNT                          = rec.DR_ACCOUNT,
                    CR_ACCOUNT                          = rec.CR_ACCOUNT,
                    LAST_UPDATED_BY                     = USER,
                    LAST_UPDATE_DATE                    = SYSTIMESTAMP,
                    SYNC_DATE                           = SYSTIMESTAMP,
                    SYNC_STATUS                         = 'UPDATED'
                WHEN NOT MATCHED THEN INSERT (
                    STANDARD_RECEIPT_ID,                RECEIPT_NUMBER,
                    DOCUMENT_NUMBER,                    RECEIPT_TYPE,
                    RECEIVABLES_TRX_ID,                 MISC_PAYMENT_SOURCE,
                    BUSINESS_UNIT,
                    RECEIPT_METHOD,                     RECEIPT_METHOD_ID,
                    RECEIPT_DATE,                       ACCOUNTING_DATE,
                    MATURITY_DATE,                      POSTMARK_DATE,
                    REMITTANCE_BANK_DEPOSIT_DATE,       AMOUNT,
                    UNAPPLIED_AMOUNT,                   ACCOUNTED_AMOUNT,
                    CURRENCY,                           CONVERSION_RATE_TYPE,
                    CONVERSION_DATE,                    CONVERSION_RATE,
                    STATE,                              STATUS,
                    RECEIPT_AT_RISK,                    REMITTANCE_BANK_NAME,
                    REMITTANCE_BANK_BRANCH,             REMITTANCE_BANK_ACCOUNT_NUMBER,
                    REMITTANCE_BANK_ALLOW_OVERRIDE,     CUSTOMER_NAME,
                    CUSTOMER_ACCOUNT_NUMBER,            CUSTOMER_SITE,
                    TAXPAYER_IDENTIFICATION_NUMBER,     CUSTOMER_BANK,
                    CUSTOMER_BANK_BRANCH,               CUSTOMER_BANK_ACCOUNT_NUMBER,
                    CREDIT_CARD_TOKEN_NUMBER,           CREDIT_CARD_AUTH_REQUEST_ID,
                    CARD_HOLDER_FIRST_NAME,             CARD_HOLDER_LAST_NAME,
                    CREDIT_CARD_ISSUER_CODE,            CREDIT_CARD_EXPIRATION_DATE,
                    VOICE_AUTHORIZATION_CODE,           REVERSAL_CATEGORY,
                    REVERSAL_REASON,                    REVERSAL_DATE,
                    REVERSAL_COMMENTS,                  RECEIPT_BATCH_NAME,
                    RECEIPT_BATCH_DATE,                 RECEIVABLES_SPECIALIST,
                    COMMENTS,                           STRUCTURED_PAYMENT_REFERENCE,
                    FUSION_CREATED_BY,                  FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY,             FUSION_LAST_UPDATE_DATE,
                    DR_ACCOUNT,                         CR_ACCOUNT,
                    SYNC_STATUS
                ) VALUES (
                    l_receipt_id,                       rec.RECEIPT_NUMBER,
                    rec.DOCUMENT_NUMBER,                rec.RECEIPT_TYPE,
                    rec.RECEIVABLES_TRX_ID,             rec.MISC_PAYMENT_SOURCE,
                    rec.BUSINESS_UNIT,
                    rec.RECEIPT_METHOD,                 rec.RECEIPT_METHOD_ID,
                    l_receipt_date,                     l_acct_date,
                    l_maturity_date,                    l_postmark_date,
                    l_rem_dep_date,                     rec.AMOUNT,
                    rec.UNAPPLIED_AMOUNT,               rec.ACCOUNTED_AMOUNT,
                    rec.CURRENCY,                       rec.CONVERSION_RATE_TYPE,
                    l_conv_date,                        rec.CONVERSION_RATE,
                    rec.STATE,                          rec.STATUS,
                    rec.RECEIPT_AT_RISK,                rec.REMITTANCE_BANK_NAME,
                    rec.REMITTANCE_BANK_BRANCH,         rec.REMITTANCE_BANK_ACCOUNT_NUMBER,
                    rec.REMITTANCE_BANK_ALLOW_OVERRIDE, rec.CUSTOMER_NAME,
                    rec.CUSTOMER_ACCOUNT_NUMBER,        rec.CUSTOMER_SITE,
                    rec.TAXPAYER_IDENTIFICATION_NUMBER, rec.CUSTOMER_BANK,
                    rec.CUSTOMER_BANK_BRANCH,           rec.CUSTOMER_BANK_ACCOUNT_NUMBER,
                    rec.CREDIT_CARD_TOKEN_NUMBER,       rec.CREDIT_CARD_AUTH_REQUEST_ID,
                    rec.CARD_HOLDER_FIRST_NAME,         rec.CARD_HOLDER_LAST_NAME,
                    rec.CREDIT_CARD_ISSUER_CODE,        l_cc_exp_date,
                    rec.VOICE_AUTHORIZATION_CODE,       rec.REVERSAL_CATEGORY,
                    rec.REVERSAL_REASON,                l_rev_date,
                    rec.REVERSAL_COMMENTS,              rec.RECEIPT_BATCH_NAME,
                    l_batch_date,                       rec.RECEIVABLES_SPECIALIST,
                    rec.COMMENTS,                       rec.STRUCTURED_PAYMENT_REFERENCE,
                    rec.FUSION_CREATED_BY,              l_cr_ts,
                    rec.FUSION_LAST_UPDATED_BY,         l_upd_ts,
                    rec.DR_ACCOUNT,                     rec.CR_ACCOUNT,
                    'NEW'
                );

                IF l_exists > 0 THEN
                    p_updated  := p_updated  + 1;
                ELSE
                    p_inserted := p_inserted + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    p_errors  := p_errors + 1;
                    IF p_errors <= 3 THEN
                        l_err_log := l_err_log || ' | [' || p_errors || '] ReceiptId=' ||
                            NVL(TO_CHAR(rec.STANDARD_RECEIPT_ID), '?') ||
                            ': ' || SUBSTR(SQLERRM, 1, 200);
                    END IF;
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Receipts complete. Inserted: ' || p_inserted ||
                     ', Updated: ' || p_updated ||
                     ', Errors: '  || p_errors  ||
                     CASE WHEN l_err_log IS NOT NULL THEN ' -- ERRORS:' || l_err_log ELSE '' END;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_receipts_bulk;

    PROCEDURE update_receipt (
        p_receipt_json   IN  CLOB,
        p_receipt_id     IN  NUMBER,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2,
        p_updated        OUT NUMBER
    ) IS
        l_inserted   NUMBER;
        l_errors     NUMBER;
        l_last_id    NUMBER;
        l_body       CLOB;
        l_wrapped    CLOB;
    BEGIN
        p_updated := 0;

        l_body := p_receipt_json;
        IF INSTR(l_body, 'StandardReceiptId') = 0 THEN
            l_body := REGEXP_REPLACE(l_body, '^\s*\{', '{"StandardReceiptId":' || p_receipt_id || ',');
        END IF;
        l_wrapped := '{"items":[' || l_body || ']}';

        save_receipts_bulk(
            p_receipts_json => l_wrapped,
            p_status        => p_status,
            p_message       => p_message,
            p_inserted      => l_inserted,
            p_updated       => p_updated,
            p_errors        => l_errors,
            p_last_id       => l_last_id
        );

        IF l_errors > 0 THEN
            p_status  := 'ERROR';
            p_message := 'Update failed: ' || p_message;
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END update_receipt;

END RR_AR_RECEIPTS_PKG;
/
