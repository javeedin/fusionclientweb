-- ============================================================
-- Patch: Add ACCOUNTING_FLAG to RR_BANK_ACCOUNT_TRANSFERS
-- Steps:
--   1. Add column to table
--   2. Update procedure to handle AccountingFlag in JSON + MERGE
--   3. Update GET handler to return accountingFlag
--   4. Add PUT /cash/banktransfers/:transferId/acctflag endpoint
-- Run once in Oracle APEX SQL Workshop (reerp module must exist)
-- ============================================================

-- ── 1. Add column ──────────────────────────────────────────────────────────
ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
  ADD ACCOUNTING_FLAG VARCHAR2(1) DEFAULT 'N';

CREATE INDEX IDX_RR_BAT_ACCT_FLAG ON RR_BANK_ACCOUNT_TRANSFERS(ACCOUNTING_FLAG);

-- ── 2. Update sync procedure ───────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_SYNC_BANK_ACCOUNT_TRANSFERS (
    p_json       IN  CLOB,
    p_count      OUT NUMBER,
    p_error      OUT VARCHAR2,
    p_last_id    OUT NUMBER
) AS
    l_transfer_id NUMBER;
BEGIN
    p_count   := 0;
    p_error   := NULL;
    p_last_id := NULL;

    FOR rec IN (
        SELECT *
        FROM JSON_TABLE(p_json, '$.items[*]'
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
                business_unit                VARCHAR2(360)   PATH '$.Businessunit',
                payment_file                 NUMBER          PATH '$.PaymentFile',
                is_settled_with_iby_flag     VARCHAR2(10)    PATH '$.IsSettledWithIbyFlag',
                accounting_flag              VARCHAR2(1)     PATH '$.AccountingFlag',
                created_by                   VARCHAR2(150)   PATH '$.CreatedBy',
                creation_date                TIMESTAMP       PATH '$.CreationDate',
                last_updated_by              VARCHAR2(150)   PATH '$.LastUpdatedBy',
                last_update_date             TIMESTAMP       PATH '$.LastUpdateDate',
                last_update_login            VARCHAR2(100)   PATH '$.LastUpdateLogin'
            )
        )
    ) LOOP
        -- Assign sequence ID for manually-created transfers (no Fusion ID)
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
                rec.business_unit                AS business_unit,
                rec.payment_file                 AS payment_file,
                CASE WHEN LOWER(rec.is_settled_with_iby_flag) = 'true' THEN 'Y' ELSE 'N' END AS is_settled_with_iby_flag,
                rec.accounting_flag              AS accounting_flag,
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
                tgt.FROM_BANK_ACCOUNT_NAME       = src.from_bank_account_name,
                tgt.TO_BANK_ACCOUNT_NAME         = src.to_bank_account_name,
                tgt.FROM_CURRENCY_CODE           = src.from_currency_code,
                tgt.TO_CURRENCY_CODE             = src.to_currency_code,
                tgt.PAYMENT_CURRENCY_CODE        = src.payment_currency_code,
                tgt.CONVERSION_RATE_TYPE         = src.conversion_rate_type,
                tgt.STATUS                       = NVL(src.status,        tgt.STATUS),
                tgt.PAYMENT_STATUS               = NVL(src.payment_status, tgt.PAYMENT_STATUS),
                tgt.PAYMENT_METHOD               = src.payment_method,
                tgt.PAYMENT_PROFILE_NAME         = src.payment_profile_name,
                tgt.BUSINESS_UNIT                = src.business_unit,
                tgt.PAYMENT_FILE                 = src.payment_file,
                tgt.IS_SETTLED_WITH_IBY_FLAG     = src.is_settled_with_iby_flag,
                -- Only update ACCOUNTING_FLAG if explicitly provided in payload
                tgt.ACCOUNTING_FLAG              = NVL(src.accounting_flag, tgt.ACCOUNTING_FLAG),
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
                CONVERSION_RATE, FROM_BANK_ACCOUNT_NAME, TO_BANK_ACCOUNT_NAME,
                FROM_CURRENCY_CODE, TO_CURRENCY_CODE, PAYMENT_CURRENCY_CODE,
                CONVERSION_RATE_TYPE, STATUS, PAYMENT_STATUS, PAYMENT_METHOD,
                PAYMENT_PROFILE_NAME, BUSINESS_UNIT, PAYMENT_FILE,
                IS_SETTLED_WITH_IBY_FLAG, ACCOUNTING_FLAG,
                CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE,
                LAST_UPDATE_LOGIN, SYNC_DATE
            ) VALUES (
                src.bank_account_transfer_id, src.bank_account_transfer_number,
                src.transaction_date, src.memo,
                src.payment_request_id, src.payment_amount, src.from_amount,
                src.from_external_trx_id, src.to_external_trx_id,
                src.conversion_rate, src.from_bank_account_name, src.to_bank_account_name,
                src.from_currency_code, src.to_currency_code, src.payment_currency_code,
                src.conversion_rate_type, src.status, src.payment_status, src.payment_method,
                src.payment_profile_name, src.business_unit, src.payment_file,
                src.is_settled_with_iby_flag, NVL(src.accounting_flag, 'N'),
                src.created_by, src.creation_date, src.last_updated_by, src.last_update_date,
                src.last_update_login, SYSTIMESTAMP
            );

        p_count   := p_count + 1;
        p_last_id := l_transfer_id;
    END LOOP;

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        p_error := SQLERRM;
        ROLLBACK;
END RR_SYNC_BANK_ACCOUNT_TRANSFERS;
/


-- ── 3. Update GET handler to include accountingFlag ───────────────────────
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
               BUSINESS_UNIT,
               PAYMENT_FILE,
               IS_SETTLED_WITH_IBY_FLAG,
               NVL(ACCOUNTING_FLAG, 'N')                           AS ACCOUNTING_FLAG,
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
        APEX_JSON.WRITE('businessUnit',              r.BUSINESS_UNIT);
        APEX_JSON.WRITE('paymentFile',               r.PAYMENT_FILE);
        APEX_JSON.WRITE('isSettledWithIbyFlag',      r.IS_SETTLED_WITH_IBY_FLAG);
        APEX_JSON.WRITE('accountingFlag',            r.ACCOUNTING_FLAG);
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


-- ── 4. Add dedicated PUT acctflag endpoint ────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers/:transferId/acctflag',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers/:transferId/acctflag'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/banktransfers/:transferId/acctflag',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Stamp accounting flag on bank transfer'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/banktransfers/:transferId/acctflag',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Stamp ACCOUNTING_FLAG = Y; no body needed',
        p_source         => q'[
DECLARE
    l_rows NUMBER;
BEGIN
    UPDATE RR_BANK_ACCOUNT_TRANSFERS
    SET    ACCOUNTING_FLAG  = 'Y',
           LAST_UPDATED_BY  = NVL(:updated_by, 'SYSTEM'),
           LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE  BANK_ACCOUNT_TRANSFER_ID = :transferId;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"message":"Transfer not found"}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"success":true,"rows":' || l_rows || '}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/
