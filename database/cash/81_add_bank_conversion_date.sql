-- ============================================================
-- Patch 81: Add BANK_CONVERSION_DATE to external transactions
--
-- Changes:
--   1. Add BANK_CONVERSION_DATE column (idempotent)
--   2. Update BMS rate GET handler to accept optional rate_date param
--      (returns most recent rate on or before that date)
--   3. Recreate RR_SYNC_EXTERNAL_CASH_TRANSACTIONS to save BankConversionDate
--   4. Rebuild GET /cash/externaltransactions to return bankConversionDate
-- ============================================================

-- ── Step 1: Add BANK_CONVERSION_DATE column ──────────────────
BEGIN
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD BANK_CONVERSION_DATE DATE';
        DBMS_OUTPUT.PUT_LINE('BANK_CONVERSION_DATE column added');
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -1430 THEN
                DBMS_OUTPUT.PUT_LINE('BANK_CONVERSION_DATE already exists — skipped');
            ELSE RAISE;
            END IF;
    END;
END;
/

-- ── Step 2: Update BMS rate handler to accept rate_date param ─
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'currencies/bmsrate',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'currencies/bmsrate',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'currencies/bmsrate',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'BMS currency rate lookup — accepts optional rate_date (YYYY-MM-DD) for historical rates',
        p_source         => q'[
DECLARE
    v_source_cur    VARCHAR2(10);
    v_target_cur    VARCHAR2(10);
    v_rate_type     VARCHAR2(50);
    v_rate_date_in  VARCHAR2(20);   -- optional: find rate on or before this date
    v_rate          NUMBER;
    v_inverse       NUMBER;
    v_rate_date_out VARCHAR2(20);
    v_type_found    VARCHAR2(50);
    v_found         NUMBER := 0;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    v_source_cur   := UPPER(TRIM(:source_cur));
    v_target_cur   := UPPER(TRIM(:target_cur));
    v_rate_type    := UPPER(TRIM(:rate_type));
    v_rate_date_in := TRIM(:rate_date);

    IF v_source_cur IS NULL OR v_target_cur IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Parameters source_cur and target_cur are required"}');
        RETURN;
    END IF;

    -- Same-currency shortcut
    IF v_source_cur = v_target_cur THEN
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',      'ok');
        APEX_JSON.WRITE('sourceCur',   v_source_cur);
        APEX_JSON.WRITE('targetCur',   v_target_cur);
        APEX_JSON.WRITE('rate',        1);
        APEX_JSON.WRITE('inverseRate', 1);
        APEX_JSON.WRITE('rateType',    'Corporate');
        APEX_JSON.WRITE('rateDate',    NVL(v_rate_date_in, TO_CHAR(SYSDATE, 'YYYY-MM-DD')));
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    -- Primary lookup: FROM_CURRENCY → TO_CURRENCY
    -- When rate_date provided: most recent rate on or before that date
    BEGIN
        SELECT RATE, INVERSE_RATE,
               TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
               RATE_TYPE, 1
        INTO   v_rate, v_inverse, v_rate_date_out, v_type_found, v_found
        FROM (
            SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
            FROM   RR_CURRENCY_DAILY_RATES
            WHERE  FROM_CURRENCY = v_source_cur
              AND  TO_CURRENCY   = v_target_cur
              AND  (v_rate_type    IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
              AND  (v_rate_date_in IS NULL OR RATE_DATE <= TO_DATE(v_rate_date_in, 'YYYY-MM-DD'))
            ORDER BY RATE_DATE DESC
            FETCH FIRST 1 ROW ONLY
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN v_found := 0;
    END;

    -- Fallback: inverse direction
    IF v_found = 0 THEN
        BEGIN
            SELECT INVERSE_RATE, RATE,
                   TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
                   RATE_TYPE, 1
            INTO   v_rate, v_inverse, v_rate_date_out, v_type_found, v_found
            FROM (
                SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
                FROM   RR_CURRENCY_DAILY_RATES
                WHERE  FROM_CURRENCY = v_target_cur
                  AND  TO_CURRENCY   = v_source_cur
                  AND  (v_rate_type    IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
                  AND  (v_rate_date_in IS NULL OR RATE_DATE <= TO_DATE(v_rate_date_in, 'YYYY-MM-DD'))
                ORDER BY RATE_DATE DESC
                FETCH FIRST 1 ROW ONLY
            );
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_found := 0;
        END;
    END IF;

    IF v_found = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"not_found","code":404,"sourceCur":"' || v_source_cur
              || '","targetCur":"' || v_target_cur
              || '","message":"No rate found in RR_CURRENCY_DAILY_RATES"}');
        RETURN;
    END IF;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',      'ok');
    APEX_JSON.WRITE('sourceCur',   v_source_cur);
    APEX_JSON.WRITE('targetCur',   v_target_cur);
    APEX_JSON.WRITE('rate',        v_rate);
    APEX_JSON.WRITE('inverseRate', v_inverse);
    APEX_JSON.WRITE('rateType',    v_type_found);
    APEX_JSON.WRITE('rateDate',    v_rate_date_out);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 3: Recreate sync procedure with BankConversionDate ──
CREATE OR REPLACE PROCEDURE RR_SYNC_EXTERNAL_CASH_TRANSACTIONS (
    p_json  IN  CLOB,
    p_count OUT NUMBER,
    p_error OUT VARCHAR2
) AS
    l_ext_id  NUMBER;
BEGIN
    p_count := 0;
    p_error := NULL;

    FOR rec IN (
        SELECT *
        FROM JSON_TABLE(p_json, '$.items[*]'
            COLUMNS (
                external_transaction_id      NUMBER          PATH '$.ExternalTransactionId',
                transaction_id               NUMBER          PATH '$.TransactionId',
                transaction_date             VARCHAR2(30)    PATH '$.TransactionDate',
                value_date                   VARCHAR2(30)    PATH '$.ValueDate',
                cleared_date                 VARCHAR2(30)    PATH '$.ClearedDate',
                amount                       NUMBER          PATH '$.Amount',
                currency_code                VARCHAR2(15)    PATH '$.CurrencyCode',
                description                  VARCHAR2(1000)  PATH '$.Description',
                reference_text               VARCHAR2(360)   PATH '$.ReferenceText',
                source                       VARCHAR2(60)    PATH '$.Source',
                status                       VARCHAR2(30)    PATH '$.Status',
                transaction_type             VARCHAR2(60)    PATH '$.TransactionType',
                accounting_flag              VARCHAR2(10)    PATH '$.AccountingFlag',
                bank_account_name            VARCHAR2(360)   PATH '$.BankAccountName',
                business_unit_name           VARCHAR2(360)   PATH '$.BusinessUnitName',
                legal_entity_name            VARCHAR2(360)   PATH '$.LegalEntityName',
                asset_account_combination    VARCHAR2(200)   PATH '$.AssetAccountCombination',
                offset_account_combination   VARCHAR2(200)   PATH '$.OffsetAccountCombination',
                bank_conversion_rate         NUMBER          PATH '$.BankConversionRate',
                bank_conversion_rate_type    VARCHAR2(60)    PATH '$.BankConversionRateType',
                bank_conversion_date         VARCHAR2(30)    PATH '$.BankConversionDate',
                transfer_id                  NUMBER          PATH '$.TransferId',
                accnt_servicer_reference     VARCHAR2(200)   PATH '$.AccntServicerReference',
                addenda_txt                  VARCHAR2(1000)  PATH '$.AddendaTxt',
                check_number                 VARCHAR2(100)   PATH '$.CheckNumber',
                clearing_system_reference    VARCHAR2(200)   PATH '$.ClearingSystemReference',
                customer_reference           VARCHAR2(200)   PATH '$.CustomerReference',
                end_to_end_id                VARCHAR2(200)   PATH '$.EndToEndId',
                instruction_identification   VARCHAR2(200)   PATH '$.InstructionIdentification',
                recon_reference              VARCHAR2(200)   PATH '$.ReconReference',
                structured_payment_reference VARCHAR2(200)   PATH '$.StructuredPaymentReference',
                bank_transaction_id          NUMBER          PATH '$.BankTransactionId',
                created_by                   VARCHAR2(150)   PATH '$.CreatedBy',
                creation_date                VARCHAR2(50)    PATH '$.CreationDate',
                last_updated_by              VARCHAR2(150)   PATH '$.LastUpdatedBy',
                last_update_date             VARCHAR2(50)    PATH '$.LastUpdateDate',
                last_update_login            VARCHAR2(200)   PATH '$.LastUpdateLogin',
                payment_method               VARCHAR2(60)    PATH '$.PaymentMethod',
                payment_document             VARCHAR2(240)   PATH '$.PaymentDocument',
                paper_document_number        VARCHAR2(60)    PATH '$.PaperDocumentNumber',
                payee_name                   VARCHAR2(360)   PATH '$.PayeeName',
                payee_id                     NUMBER          PATH '$.PayeeId',
                transaction_direction        VARCHAR2(2)     PATH '$.TransactionDirection'
            )
        )
    ) LOOP
        IF rec.external_transaction_id IS NULL THEN
            SELECT RR_ECT_MANUAL_SEQ.NEXTVAL INTO l_ext_id FROM DUAL;
        ELSE
            l_ext_id := rec.external_transaction_id;
        END IF;

        MERGE INTO RR_EXTERNAL_CASH_TRANSACTIONS tgt
        USING (
            SELECT
                l_ext_id                                        AS external_transaction_id,
                rec.transaction_id                              AS transaction_id,
                TO_DATE(SUBSTR(rec.transaction_date, 1, 10), 'YYYY-MM-DD')  AS transaction_date,
                TO_DATE(SUBSTR(rec.value_date,        1, 10), 'YYYY-MM-DD') AS value_date,
                TO_DATE(SUBSTR(rec.cleared_date,      1, 10), 'YYYY-MM-DD') AS cleared_date,
                rec.amount                                      AS amount,
                rec.currency_code                               AS currency_code,
                rec.description                                 AS description,
                rec.reference_text                              AS reference_text,
                rec.source                                      AS source,
                rec.status                                      AS status,
                rec.transaction_type                            AS transaction_type,
                CASE WHEN LOWER(rec.accounting_flag) = 'true' THEN 'Y' ELSE 'N' END AS accounting_flag,
                rec.bank_account_name                           AS bank_account_name,
                rec.business_unit_name                          AS business_unit_name,
                rec.legal_entity_name                           AS legal_entity_name,
                rec.asset_account_combination                   AS asset_account_combination,
                rec.offset_account_combination                  AS offset_account_combination,
                rec.bank_conversion_rate                        AS bank_conversion_rate,
                rec.bank_conversion_rate_type                   AS bank_conversion_rate_type,
                TO_DATE(SUBSTR(rec.bank_conversion_date, 1, 10), 'YYYY-MM-DD') AS bank_conversion_date,
                rec.transfer_id                                 AS transfer_id,
                rec.accnt_servicer_reference                    AS accnt_servicer_reference,
                rec.addenda_txt                                 AS addenda_txt,
                rec.check_number                                AS check_number,
                rec.clearing_system_reference                   AS clearing_system_reference,
                rec.customer_reference                          AS customer_reference,
                rec.end_to_end_id                               AS end_to_end_id,
                rec.instruction_identification                  AS instruction_identification,
                rec.recon_reference                             AS recon_reference,
                rec.structured_payment_reference                AS structured_payment_reference,
                rec.bank_transaction_id                         AS bank_transaction_id,
                rec.created_by                                  AS created_by,
                TO_TIMESTAMP(
                    REGEXP_REPLACE(rec.creation_date, '(Z|[+-]\d{2}:\d{2})$', ''),
                    'YYYY-MM-DD"T"HH24:MI:SS.FF3'
                ) AS creation_date,
                rec.last_updated_by                             AS last_updated_by,
                TO_TIMESTAMP(
                    REGEXP_REPLACE(rec.last_update_date, '(Z|[+-]\d{2}:\d{2})$', ''),
                    'YYYY-MM-DD"T"HH24:MI:SS.FF3'
                ) AS last_update_date,
                rec.last_update_login                           AS last_update_login,
                rec.payment_method                              AS payment_method,
                rec.payment_document                            AS payment_document,
                rec.paper_document_number                       AS paper_document_number,
                rec.payee_name                                  AS payee_name,
                rec.payee_id                                    AS payee_id,
                rec.transaction_direction                       AS transaction_direction
            FROM DUAL
        ) src
        ON (tgt.EXTERNAL_TRANSACTION_ID = src.external_transaction_id)
        WHEN MATCHED THEN
            UPDATE SET
                tgt.TRANSACTION_ID               = src.transaction_id,
                tgt.TRANSACTION_DATE             = src.transaction_date,
                tgt.VALUE_DATE                   = src.value_date,
                tgt.CLEARED_DATE                 = src.cleared_date,
                tgt.AMOUNT                       = src.amount,
                tgt.CURRENCY_CODE                = src.currency_code,
                tgt.DESCRIPTION                  = src.description,
                tgt.REFERENCE_TEXT               = src.reference_text,
                tgt.SOURCE                       = src.source,
                tgt.STATUS                       = src.status,
                tgt.TRANSACTION_TYPE             = src.transaction_type,
                tgt.ACCOUNTING_FLAG              = src.accounting_flag,
                tgt.BANK_ACCOUNT_NAME            = src.bank_account_name,
                tgt.BUSINESS_UNIT_NAME           = src.business_unit_name,
                tgt.LEGAL_ENTITY_NAME            = src.legal_entity_name,
                tgt.ASSET_ACCOUNT_COMBINATION    = src.asset_account_combination,
                tgt.OFFSET_ACCOUNT_COMBINATION   = src.offset_account_combination,
                tgt.BANK_CONVERSION_RATE         = src.bank_conversion_rate,
                tgt.BANK_CONVERSION_RATE_TYPE    = src.bank_conversion_rate_type,
                tgt.BANK_CONVERSION_DATE         = src.bank_conversion_date,
                tgt.TRANSFER_ID                  = src.transfer_id,
                tgt.ACCNT_SERVICER_REFERENCE     = src.accnt_servicer_reference,
                tgt.ADDENDA_TXT                  = src.addenda_txt,
                tgt.CHECK_NUMBER                 = src.check_number,
                tgt.CLEARING_SYSTEM_REFERENCE    = src.clearing_system_reference,
                tgt.CUSTOMER_REFERENCE           = src.customer_reference,
                tgt.END_TO_END_ID                = src.end_to_end_id,
                tgt.INSTRUCTION_IDENTIFICATION   = src.instruction_identification,
                tgt.RECON_REFERENCE              = src.recon_reference,
                tgt.STRUCTURED_PAYMENT_REFERENCE = src.structured_payment_reference,
                tgt.BANK_TRANSACTION_ID          = src.bank_transaction_id,
                tgt.CREATED_BY                   = src.created_by,
                tgt.CREATION_DATE                = src.creation_date,
                tgt.LAST_UPDATED_BY              = src.last_updated_by,
                tgt.LAST_UPDATE_DATE             = src.last_update_date,
                tgt.LAST_UPDATE_LOGIN            = src.last_update_login,
                tgt.PAYMENT_METHOD               = src.payment_method,
                tgt.PAYMENT_DOCUMENT             = src.payment_document,
                tgt.PAPER_DOCUMENT_NUMBER        = src.paper_document_number,
                tgt.PAYEE_NAME                   = src.payee_name,
                tgt.PAYEE_ID                     = src.payee_id,
                tgt.TRANSACTION_DIRECTION        = src.transaction_direction,
                tgt.SYNC_DATE                    = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                EXTERNAL_TRANSACTION_ID, TRANSACTION_ID,
                TRANSACTION_DATE, VALUE_DATE, CLEARED_DATE,
                AMOUNT, CURRENCY_CODE, DESCRIPTION, REFERENCE_TEXT,
                SOURCE, STATUS, TRANSACTION_TYPE, ACCOUNTING_FLAG,
                BANK_ACCOUNT_NAME, BUSINESS_UNIT_NAME, LEGAL_ENTITY_NAME,
                ASSET_ACCOUNT_COMBINATION, OFFSET_ACCOUNT_COMBINATION,
                BANK_CONVERSION_RATE, BANK_CONVERSION_RATE_TYPE, BANK_CONVERSION_DATE,
                TRANSFER_ID, ACCNT_SERVICER_REFERENCE, ADDENDA_TXT,
                CHECK_NUMBER, CLEARING_SYSTEM_REFERENCE, CUSTOMER_REFERENCE,
                END_TO_END_ID, INSTRUCTION_IDENTIFICATION, RECON_REFERENCE,
                STRUCTURED_PAYMENT_REFERENCE, BANK_TRANSACTION_ID,
                CREATED_BY, CREATION_DATE, LAST_UPDATED_BY,
                LAST_UPDATE_DATE, LAST_UPDATE_LOGIN,
                PAYMENT_METHOD, PAYMENT_DOCUMENT, PAPER_DOCUMENT_NUMBER,
                PAYEE_NAME, PAYEE_ID, TRANSACTION_DIRECTION,
                SYNC_DATE
            ) VALUES (
                src.external_transaction_id, src.transaction_id,
                src.transaction_date, src.value_date, src.cleared_date,
                src.amount, src.currency_code, src.description, src.reference_text,
                src.source, src.status, src.transaction_type, src.accounting_flag,
                src.bank_account_name, src.business_unit_name, src.legal_entity_name,
                src.asset_account_combination, src.offset_account_combination,
                src.bank_conversion_rate, src.bank_conversion_rate_type, src.bank_conversion_date,
                src.transfer_id, src.accnt_servicer_reference, src.addenda_txt,
                src.check_number, src.clearing_system_reference, src.customer_reference,
                src.end_to_end_id, src.instruction_identification, src.recon_reference,
                src.structured_payment_reference, src.bank_transaction_id,
                src.created_by, src.creation_date, src.last_updated_by,
                src.last_update_date, src.last_update_login,
                src.payment_method, src.payment_document, src.paper_document_number,
                src.payee_name, src.payee_id, src.transaction_direction,
                SYSTIMESTAMP
            );

        p_count := p_count + 1;
    END LOOP;

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        p_error := SQLERRM;
        ROLLBACK;
END RR_SYNC_EXTERNAL_CASH_TRANSACTIONS;
/

-- ── Step 4: Rebuild GET /cash/externaltransactions with bankConversionDate ──
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Query external cash transactions with optional filters',
        p_source         => q'[
DECLARE
    l_txn_number   VARCHAR2(100) := :transaction_number;
    l_bank_acct    VARCHAR2(360) := :bank_account;
    l_currency     VARCHAR2(15)  := :currency_code;
    l_bu           VARCHAR2(360) := :business_unit;
    l_txn_type     VARCHAR2(60)  := :transaction_type;
    l_source       VARCHAR2(60)  := :source;
    l_status       VARCHAR2(30)  := :status;
    l_reference    VARCHAR2(360) := :reference;
    l_date_from    VARCHAR2(30)  := :date_from;
    l_date_to      VARCHAR2(30)  := :date_to;
    l_amt_from     VARCHAR2(30)  := :amount_from;
    l_amt_to       VARCHAR2(30)  := :amount_to;
    l_cr_from      VARCHAR2(30)  := :creation_date_from;
    l_cr_to        VARCHAR2(30)  := :creation_date_to;
    l_limit        NUMBER        := NVL(TO_NUMBER(:row_limit), 500);
    l_offset       NUMBER        := NVL(TO_NUMBER(:row_offset), 0);

    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
    l_pos   INTEGER;
    l_len   INTEGER;
    l_chunk VARCHAR2(32767);

    CURSOR c_txns IS
        SELECT EXTERNAL_TRANSACTION_ID,
               TRANSACTION_ID,
               TO_CHAR(TRANSACTION_DATE,      'YYYY-MM-DD') AS TRANSACTION_DATE,
               TO_CHAR(VALUE_DATE,            'YYYY-MM-DD') AS VALUE_DATE,
               TO_CHAR(CLEARED_DATE,          'YYYY-MM-DD') AS CLEARED_DATE,
               AMOUNT,
               CURRENCY_CODE,
               DESCRIPTION,
               REFERENCE_TEXT,
               SOURCE,
               STATUS,
               TRANSACTION_TYPE,
               NVL(ACCOUNTING_FLAG, 'N')                    AS ACCOUNTING_FLAG,
               BANK_ACCOUNT_NAME,
               BUSINESS_UNIT_NAME,
               LEGAL_ENTITY_NAME,
               ASSET_ACCOUNT_COMBINATION,
               OFFSET_ACCOUNT_COMBINATION,
               BANK_CONVERSION_RATE,
               BANK_CONVERSION_RATE_TYPE,
               TO_CHAR(BANK_CONVERSION_DATE,  'YYYY-MM-DD') AS BANK_CONVERSION_DATE,
               TRANSFER_ID,
               CHECK_NUMBER,
               RECON_REFERENCE,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
               LAST_UPDATED_BY,
               TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               TRANSACTION_DIRECTION,
               PAYMENT_METHOD,
               PAYMENT_DOCUMENT,
               PAPER_DOCUMENT_NUMBER,
               PAYEE_NAME,
               PAYEE_ID,
               TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE (l_txn_number IS NULL OR TO_CHAR(TRANSACTION_ID) LIKE '%' || l_txn_number || '%')
           AND (l_bank_acct  IS NULL OR UPPER(BANK_ACCOUNT_NAME)  LIKE '%' || UPPER(l_bank_acct) || '%')
           AND (l_currency   IS NULL OR CURRENCY_CODE             = l_currency)
           AND (l_bu         IS NULL OR BUSINESS_UNIT_NAME        = l_bu)
           AND (l_txn_type   IS NULL OR TRANSACTION_TYPE          = l_txn_type)
           AND (l_source     IS NULL OR SOURCE                    = l_source)
           AND (l_status     IS NULL OR STATUS                    = l_status)
           AND (l_reference  IS NULL OR UPPER(REFERENCE_TEXT)     LIKE '%' || UPPER(l_reference) || '%')
           AND (l_date_from  IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
           AND (l_date_to    IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
           AND (l_amt_from   IS NULL OR AMOUNT >= TO_NUMBER(l_amt_from))
           AND (l_amt_to     IS NULL OR AMOUNT <= TO_NUMBER(l_amt_to))
           AND (l_cr_from    IS NULL OR TRUNC(CREATION_DATE) >= TO_DATE(l_cr_from, 'YYYY-MM-DD'))
           AND (l_cr_to      IS NULL OR TRUNC(CREATION_DATE) <= TO_DATE(l_cr_to,   'YYYY-MM-DD'))
         ORDER BY TRANSACTION_DATE DESC, EXTERNAL_TRANSACTION_ID DESC
         OFFSET l_offset ROWS FETCH NEXT l_limit ROWS ONLY;

    r c_txns%ROWTYPE;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p;
    BEGIN
        IF v IS NULL THEN RETURN 'null'; END IF;
        v := REPLACE(v, '\',   '\\');
        v := REPLACE(v, '"',   '\"');
        v := REPLACE(v, CHR(9),  '\t');
        v := REPLACE(v, CHR(10), '\n');
        v := REPLACE(v, CHR(13), '\r');
        v := REGEXP_REPLACE(v, '[[:cntrl:]]', '');
        RETURN '"' || v || '"';
    END jstr;

BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('{"success":true,"items":['));

    OPEN c_txns;
    LOOP
        FETCH c_txns INTO r;
        EXIT WHEN c_txns%NOTFOUND;

        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
        v_first := FALSE;

        DBMS_LOB.APPEND(v_clob, TO_CLOB('{'));
        DBMS_LOB.APPEND(v_clob, TO_CLOB('"externalTransactionId":' || TO_CHAR(r.EXTERNAL_TRANSACTION_ID)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionId":'    || NVL(TO_CHAR(r.TRANSACTION_ID), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionDate":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TRANSACTION_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"valueDate":')       ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.VALUE_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"clearedDate":')     ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CLEARED_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"amount":'           || NVL(TO_CHAR(r.AMOUNT), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"currencyCode":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CURRENCY_CODE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"description":')     ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.DESCRIPTION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"referenceText":')   ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.REFERENCE_TEXT)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"source":')          ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.SOURCE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"status":')          ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.STATUS)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionType":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TRANSACTION_TYPE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"accountingFlag":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ACCOUNTING_FLAG)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankAccountName":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BANK_ACCOUNT_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"businessUnitName":')   ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BUSINESS_UNIT_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"legalEntityName":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.LEGAL_ENTITY_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"assetAccountCombination":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ASSET_ACCOUNT_COMBINATION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"offsetAccountCombination":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.OFFSET_ACCOUNT_COMBINATION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankConversionRate":' || NVL(TO_CHAR(r.BANK_CONVERSION_RATE), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankConversionRateType":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BANK_CONVERSION_RATE_TYPE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankConversionDate":')     ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BANK_CONVERSION_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transferId":'  || NVL(TO_CHAR(r.TRANSFER_ID), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"checkNumber":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CHECK_NUMBER)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"reconReference":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.RECON_REFERENCE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"createdBy":')      ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CREATED_BY)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"creationDate":')   ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CREATION_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"lastUpdatedBy":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.LAST_UPDATED_BY)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"lastUpdateDate":')      ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.LAST_UPDATE_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionDirection":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TRANSACTION_DIRECTION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paymentMethod":')        ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYMENT_METHOD)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paymentDocument":')      ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYMENT_DOCUMENT)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paperDocumentNumber":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAPER_DOCUMENT_NUMBER)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"payeeName":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYEE_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"payeeId":'     || NVL(TO_CHAR(r.PAYEE_ID), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"syncDate":')   ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.SYNC_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB('}'));
    END LOOP;
    CLOSE c_txns;

    DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));

    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(v_clob);
    l_pos := 1;
    WHILE l_pos <= l_len LOOP
        l_chunk := DBMS_LOB.SUBSTR(v_clob, 32767, l_pos);
        HTP.PRN(l_chunk);
        l_pos := l_pos + 32767;
    END LOOP;
    DBMS_LOB.FREETEMPORARY(v_clob);

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.PRN('{"success":false,"message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );

    COMMIT;
END;
/
