-- ============================================================
-- PATCH 72: Add PAYMENT_DOCUMENT_NUMBER to bank transfers
--
-- 1. ALTER TABLE to add the column
-- 2. Re-register RR_SYNC_BANK_ACCOUNT_TRANSFERS procedure
--    to parse PaymentDocumentNumber from JSON and store it
-- 3. Update GET cash/banktransfers handler to return it
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run each block separately (Step 1, Step 2, Step 3)
-- ============================================================

-- ── Step 1: Add column ──────────────────────────────────────
ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
  ADD PAYMENT_DOCUMENT_NUMBER VARCHAR2(100);
/

-- ── Step 2: Re-create sync procedure (adds new column) ──────
CREATE OR REPLACE PROCEDURE RR_SYNC_BANK_ACCOUNT_TRANSFERS (
    p_json    IN  CLOB,
    p_count   OUT NUMBER,
    p_error   OUT VARCHAR2,
    p_last_id OUT NUMBER
) AS
    l_transfer_id NUMBER;
BEGIN
    p_count := 0;
    p_error := NULL;
    p_last_id := NULL;

    FOR rec IN (
        SELECT *
        FROM JSON_TABLE(
            p_json, '$.items[*]'
            COLUMNS (
                bank_account_transfer_id     NUMBER          PATH '$.BankAccountTransferId',
                bank_account_transfer_number NUMBER          PATH '$.BankAccountTransferNumber',
                transaction_date             VARCHAR2(30)    PATH '$.TransactionDate',
                memo                         VARCHAR2(1000)  PATH '$.Memo',
                payment_request_id           NUMBER          PATH '$.PaymentRequestId',
                payment_amount               NUMBER          PATH '$.PaymentAmount',
                from_amount                  NUMBER          PATH '$.FromAmount',
                from_external_trx_id         NUMBER          PATH '$.FromExternalTrxId',
                to_external_trx_id           NUMBER          PATH '$.ToExternalTrxId',
                conversion_rate              NUMBER          PATH '$.ConversionRate',
                conversion_rate_date         VARCHAR2(30)    PATH '$.ConversionRateDate',
                func_conversion_rate         NUMBER          PATH '$.FuncConversionRate',
                from_bank_account_name       VARCHAR2(360)   PATH '$.FromBankAccountName',
                to_bank_account_name         VARCHAR2(360)   PATH '$.ToBankAccountName',
                from_currency_code           VARCHAR2(15)    PATH '$.FromCurrencyCode',
                to_currency_code             VARCHAR2(15)    PATH '$.ToCurrencyCode',
                payment_currency_code        VARCHAR2(15)    PATH '$.PaymentCurrencyCode',
                conversion_rate_type         VARCHAR2(60)    PATH '$.ConversionRateType',
                status                       VARCHAR2(60)    PATH '$.Status',
                payment_status               VARCHAR2(60)    PATH '$.PaymentStatus',
                payment_method               VARCHAR2(60)    PATH '$.PaymentMethod',
                payment_profile_name         VARCHAR2(100)   PATH '$.PaymentProfileName',
                payment_document_number      VARCHAR2(100)   PATH '$.PaymentDocumentNumber',
                business_unit                VARCHAR2(360)   PATH '$.Businessunit',
                payment_file                 NUMBER          PATH '$.PaymentFile',
                is_settled_with_iby_flag     VARCHAR2(10)    PATH '$.IsSettledWithIbyFlag',
                reconciled_flag              VARCHAR2(1)     PATH '$.ReconciledFlag',
                reconciled_date              VARCHAR2(30)    PATH '$.ReconciledDate',
                cash_clearing_account        VARCHAR2(240)   PATH '$.CashClearingAccount',
                created_by                   VARCHAR2(150)   PATH '$.CreatedBy',
                creation_date                TIMESTAMP       PATH '$.CreationDate',
                last_updated_by              VARCHAR2(150)   PATH '$.LastUpdatedBy',
                last_update_date             TIMESTAMP       PATH '$.LastUpdateDate',
                last_update_login            VARCHAR2(100)   PATH '$.LastUpdateLogin'
            )
        )
    ) LOOP
        IF rec.bank_account_transfer_id IS NULL THEN
            SELECT RR_BAT_MANUAL_SEQ.NEXTVAL INTO l_transfer_id FROM DUAL;
        ELSE
            l_transfer_id := rec.bank_account_transfer_id;
        END IF;

        MERGE INTO RR_BANK_ACCOUNT_TRANSFERS tgt
        USING (
            SELECT
                l_transfer_id                    AS bank_account_transfer_id,
                NVL(rec.bank_account_transfer_number, l_transfer_id) AS bank_account_transfer_number,
                TO_DATE(rec.transaction_date, 'YYYY-MM-DD') AS transaction_date,
                rec.memo                         AS memo,
                rec.payment_request_id           AS payment_request_id,
                rec.payment_amount               AS payment_amount,
                rec.from_amount                  AS from_amount,
                rec.from_external_trx_id         AS from_external_trx_id,
                rec.to_external_trx_id           AS to_external_trx_id,
                rec.conversion_rate              AS conversion_rate,
                TO_DATE(rec.conversion_rate_date, 'YYYY-MM-DD') AS conversion_rate_date,
                rec.func_conversion_rate         AS func_conversion_rate,
                rec.from_bank_account_name       AS from_bank_account_name,
                rec.to_bank_account_name         AS to_bank_account_name,
                rec.from_currency_code           AS from_currency_code,
                rec.to_currency_code             AS to_currency_code,
                rec.payment_currency_code        AS payment_currency_code,
                rec.conversion_rate_type         AS conversion_rate_type,
                rec.status                       AS status,
                rec.payment_status               AS payment_status,
                rec.payment_method               AS payment_method,
                rec.payment_profile_name         AS payment_profile_name,
                rec.payment_document_number      AS payment_document_number,
                rec.business_unit                AS business_unit,
                rec.payment_file                 AS payment_file,
                CASE WHEN LOWER(rec.is_settled_with_iby_flag) = 'true' THEN 'Y' ELSE 'N' END AS is_settled_with_iby_flag,
                rec.reconciled_flag              AS reconciled_flag,
                TO_DATE(rec.reconciled_date, 'YYYY-MM-DD') AS reconciled_date,
                rec.cash_clearing_account        AS cash_clearing_account,
                rec.created_by                   AS created_by,
                rec.creation_date                AS creation_date,
                rec.last_updated_by              AS last_updated_by,
                rec.last_update_date             AS last_update_date,
                rec.last_update_login            AS last_update_login
            FROM DUAL
        ) src
        ON (tgt.BANK_ACCOUNT_TRANSFER_ID = src.bank_account_transfer_id)
        WHEN MATCHED THEN
            UPDATE SET
                tgt.BANK_ACCOUNT_TRANSFER_NUMBER = src.bank_account_transfer_number,
                tgt.TRANSACTION_DATE             = src.transaction_date,
                tgt.MEMO                         = src.memo,
                tgt.PAYMENT_REQUEST_ID           = src.payment_request_id,
                tgt.PAYMENT_AMOUNT               = src.payment_amount,
                tgt.FROM_AMOUNT                  = src.from_amount,
                tgt.FROM_EXTERNAL_TRX_ID         = src.from_external_trx_id,
                tgt.TO_EXTERNAL_TRX_ID           = src.to_external_trx_id,
                tgt.CONVERSION_RATE              = src.conversion_rate,
                tgt.CONVERSION_RATE_DATE         = src.conversion_rate_date,
                tgt.FUNC_CONVERSION_RATE         = src.func_conversion_rate,
                tgt.FROM_BANK_ACCOUNT_NAME       = src.from_bank_account_name,
                tgt.TO_BANK_ACCOUNT_NAME         = src.to_bank_account_name,
                tgt.FROM_CURRENCY_CODE           = src.from_currency_code,
                tgt.TO_CURRENCY_CODE             = src.to_currency_code,
                tgt.PAYMENT_CURRENCY_CODE        = src.payment_currency_code,
                tgt.CONVERSION_RATE_TYPE         = src.conversion_rate_type,
                tgt.STATUS                       = src.status,
                tgt.PAYMENT_STATUS               = src.payment_status,
                tgt.PAYMENT_METHOD               = src.payment_method,
                tgt.PAYMENT_PROFILE_NAME         = src.payment_profile_name,
                tgt.PAYMENT_DOCUMENT_NUMBER      = NVL(src.payment_document_number, tgt.PAYMENT_DOCUMENT_NUMBER),
                tgt.BUSINESS_UNIT                = src.business_unit,
                tgt.PAYMENT_FILE                 = src.payment_file,
                tgt.IS_SETTLED_WITH_IBY_FLAG     = src.is_settled_with_iby_flag,
                tgt.RECONCILED_FLAG              = NVL(src.reconciled_flag,       tgt.RECONCILED_FLAG),
                tgt.RECONCILED_DATE              = NVL(src.reconciled_date,       tgt.RECONCILED_DATE),
                tgt.CASH_CLEARING_ACCOUNT        = NVL(src.cash_clearing_account, tgt.CASH_CLEARING_ACCOUNT),
                tgt.CREATED_BY                   = src.created_by,
                tgt.CREATION_DATE                = src.creation_date,
                tgt.LAST_UPDATED_BY              = src.last_updated_by,
                tgt.LAST_UPDATE_DATE             = src.last_update_date,
                tgt.LAST_UPDATE_LOGIN            = src.last_update_login,
                tgt.SYNC_DATE                    = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                BANK_ACCOUNT_TRANSFER_ID, BANK_ACCOUNT_TRANSFER_NUMBER,
                TRANSACTION_DATE, MEMO,
                PAYMENT_REQUEST_ID, PAYMENT_AMOUNT, FROM_AMOUNT,
                FROM_EXTERNAL_TRX_ID, TO_EXTERNAL_TRX_ID,
                CONVERSION_RATE, CONVERSION_RATE_DATE, FUNC_CONVERSION_RATE,
                FROM_BANK_ACCOUNT_NAME, TO_BANK_ACCOUNT_NAME,
                FROM_CURRENCY_CODE, TO_CURRENCY_CODE, PAYMENT_CURRENCY_CODE,
                CONVERSION_RATE_TYPE, STATUS, PAYMENT_STATUS, PAYMENT_METHOD,
                PAYMENT_PROFILE_NAME, PAYMENT_DOCUMENT_NUMBER, BUSINESS_UNIT, PAYMENT_FILE,
                IS_SETTLED_WITH_IBY_FLAG,
                RECONCILED_FLAG, RECONCILED_DATE, CASH_CLEARING_ACCOUNT,
                CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE,
                LAST_UPDATE_LOGIN, SYNC_DATE
            ) VALUES (
                src.bank_account_transfer_id, src.bank_account_transfer_number,
                src.transaction_date, src.memo,
                src.payment_request_id, src.payment_amount, src.from_amount,
                src.from_external_trx_id, src.to_external_trx_id,
                src.conversion_rate, src.conversion_rate_date, src.func_conversion_rate,
                src.from_bank_account_name, src.to_bank_account_name,
                src.from_currency_code, src.to_currency_code, src.payment_currency_code,
                src.conversion_rate_type, src.status, src.payment_status, src.payment_method,
                src.payment_profile_name, src.payment_document_number, src.business_unit, src.payment_file,
                src.is_settled_with_iby_flag,
                src.reconciled_flag, src.reconciled_date, src.cash_clearing_account,
                src.created_by, src.creation_date, src.last_updated_by, src.last_update_date,
                src.last_update_login, SYSTIMESTAMP
            );

        p_count   := p_count + 1;
        p_last_id := l_transfer_id;
    END LOOP;

    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_error := SQLERRM;
END RR_SYNC_BANK_ACCOUNT_TRANSFERS;
/

-- ── Step 3: Update GET cash/banktransfers to return paymentDocumentNumber ──
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/banktransfers',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Query bank account transfers with optional filters',
        p_source         => q'[
DECLARE
    l_date_from   VARCHAR2(30)  := :date_from;
    l_date_to     VARCHAR2(30)  := :date_to;
    l_from_acct   VARCHAR2(360) := :from_account;
    l_to_acct     VARCHAR2(360) := :to_account;
    l_status      VARCHAR2(60)  := :status;
    l_bu          VARCHAR2(360) := :business_unit;
    l_limit       NUMBER        := NVL(TO_NUMBER(:row_limit), 500);
    l_offset      NUMBER        := NVL(TO_NUMBER(:row_offset), 0);

    v_total NUMBER := 0;

    CURSOR c_transfers IS
        SELECT BANK_ACCOUNT_TRANSFER_ID,
               BANK_ACCOUNT_TRANSFER_NUMBER,
               TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD')             AS TRANSACTION_DATE,
               MEMO,
               PAYMENT_REQUEST_ID,
               PAYMENT_AMOUNT,
               FROM_AMOUNT,
               FROM_EXTERNAL_TRX_ID,
               TO_EXTERNAL_TRX_ID,
               CONVERSION_RATE,
               TO_CHAR(CONVERSION_RATE_DATE, 'YYYY-MM-DD')         AS CONVERSION_RATE_DATE,
               FUNC_CONVERSION_RATE,
               FROM_BANK_ACCOUNT_NAME,
               TO_BANK_ACCOUNT_NAME,
               FROM_CURRENCY_CODE,
               TO_CURRENCY_CODE,
               PAYMENT_CURRENCY_CODE,
               CONVERSION_RATE_TYPE,
               STATUS,
               PAYMENT_STATUS,
               PAYMENT_METHOD,
               PAYMENT_PROFILE_NAME,
               PAYMENT_DOCUMENT_NUMBER,
               BUSINESS_UNIT,
               PAYMENT_FILE,
               IS_SETTLED_WITH_IBY_FLAG,
               NVL(ACCOUNTING_FLAG,  'N')                           AS ACCOUNTING_FLAG,
               NVL(RECONCILED_FLAG,  'N')                           AS RECONCILED_FLAG,
               TO_CHAR(RECONCILED_DATE, 'YYYY-MM-DD')               AS RECONCILED_DATE,
               CASH_CLEARING_ACCOUNT,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
               LAST_UPDATED_BY,
               TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               LAST_UPDATE_LOGIN,
               TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE
          FROM RR_BANK_ACCOUNT_TRANSFERS
         WHERE (l_date_from IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
           AND (l_date_to   IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
           AND (l_from_acct IS NULL OR UPPER(FROM_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_from_acct) || '%')
           AND (l_to_acct   IS NULL OR UPPER(TO_BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(l_to_acct)   || '%')
           AND (l_status    IS NULL OR STATUS        = l_status)
           AND (l_bu        IS NULL OR BUSINESS_UNIT = l_bu)
         ORDER BY TRANSACTION_DATE DESC, BANK_ACCOUNT_TRANSFER_ID DESC
         OFFSET l_offset ROWS FETCH NEXT l_limit ROWS ONLY;

    r c_transfers%ROWTYPE;
BEGIN
    SELECT COUNT(*)
      INTO v_total
      FROM RR_BANK_ACCOUNT_TRANSFERS
     WHERE (l_date_from IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
       AND (l_date_to   IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
       AND (l_from_acct IS NULL OR UPPER(FROM_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_from_acct) || '%')
       AND (l_to_acct   IS NULL OR UPPER(TO_BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(l_to_acct)   || '%')
       AND (l_status    IS NULL OR STATUS        = l_status)
       AND (l_bu        IS NULL OR BUSINESS_UNIT = l_bu);

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status', 'success');
    APEX_JSON.WRITE('total',  v_total);
    APEX_JSON.OPEN_ARRAY('items');

    OPEN c_transfers;
    LOOP
        FETCH c_transfers INTO r;
        EXIT WHEN c_transfers%NOTFOUND;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bankAccountTransferId',     r.BANK_ACCOUNT_TRANSFER_ID);
        APEX_JSON.WRITE('bankAccountTransferNumber', r.BANK_ACCOUNT_TRANSFER_NUMBER);
        APEX_JSON.WRITE('transactionDate',           r.TRANSACTION_DATE);
        APEX_JSON.WRITE('memo',                      r.MEMO);
        APEX_JSON.WRITE('paymentRequestId',          r.PAYMENT_REQUEST_ID);
        APEX_JSON.WRITE('paymentAmount',             r.PAYMENT_AMOUNT);
        APEX_JSON.WRITE('fromAmount',                r.FROM_AMOUNT);
        APEX_JSON.WRITE('fromExternalTrxId',         r.FROM_EXTERNAL_TRX_ID);
        APEX_JSON.WRITE('toExternalTrxId',           r.TO_EXTERNAL_TRX_ID);
        APEX_JSON.WRITE('conversionRate',            r.CONVERSION_RATE);
        APEX_JSON.WRITE('conversionRateDate',        r.CONVERSION_RATE_DATE);
        APEX_JSON.WRITE('funcConversionRate',        r.FUNC_CONVERSION_RATE);
        APEX_JSON.WRITE('fromBankAccountName',       r.FROM_BANK_ACCOUNT_NAME);
        APEX_JSON.WRITE('toBankAccountName',         r.TO_BANK_ACCOUNT_NAME);
        APEX_JSON.WRITE('fromCurrencyCode',          r.FROM_CURRENCY_CODE);
        APEX_JSON.WRITE('toCurrencyCode',            r.TO_CURRENCY_CODE);
        APEX_JSON.WRITE('paymentCurrencyCode',       r.PAYMENT_CURRENCY_CODE);
        APEX_JSON.WRITE('conversionRateType',        r.CONVERSION_RATE_TYPE);
        APEX_JSON.WRITE('status',                    r.STATUS);
        APEX_JSON.WRITE('paymentStatus',             r.PAYMENT_STATUS);
        APEX_JSON.WRITE('paymentMethod',             r.PAYMENT_METHOD);
        APEX_JSON.WRITE('paymentProfileName',        r.PAYMENT_PROFILE_NAME);
        APEX_JSON.WRITE('paymentDocumentNumber',     r.PAYMENT_DOCUMENT_NUMBER);
        APEX_JSON.WRITE('businessUnit',              r.BUSINESS_UNIT);
        APEX_JSON.WRITE('paymentFile',               r.PAYMENT_FILE);
        APEX_JSON.WRITE('isSettledWithIbyFlag',      r.IS_SETTLED_WITH_IBY_FLAG);
        APEX_JSON.WRITE('accountingFlag',            r.ACCOUNTING_FLAG);
        APEX_JSON.WRITE('reconciledFlag',            r.RECONCILED_FLAG);
        APEX_JSON.WRITE('reconciledDate',            r.RECONCILED_DATE);
        APEX_JSON.WRITE('cashClearingAccount',       r.CASH_CLEARING_ACCOUNT);
        APEX_JSON.WRITE('createdBy',                 r.CREATED_BY);
        APEX_JSON.WRITE('creationDate',              r.CREATION_DATE);
        APEX_JSON.WRITE('lastUpdatedBy',             r.LAST_UPDATED_BY);
        APEX_JSON.WRITE('lastUpdateDate',            r.LAST_UPDATE_DATE);
        APEX_JSON.WRITE('lastUpdateLogin',           r.LAST_UPDATE_LOGIN);
        APEX_JSON.WRITE('syncDate',                  r.SYNC_DATE);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    CLOSE c_transfers;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
