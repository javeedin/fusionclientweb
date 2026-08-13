-- ============================================================
-- Patch 82: Auto-sequence for TRANSACTION_ID on manual transactions
--
-- Problem: Manually-created transactions have no TRANSACTION_ID.
--          We need a sequence that continues after the last Fusion number
--          to avoid collisions with Fusion-synced data.
--
-- Approach:
--   1. Find MAX(TRANSACTION_ID) from existing Fusion data
--   2. Create RR_ECT_TXN_NUM_SEQ starting at MAX * 10 (clear separation)
--   3. Update procedure: when TRANSACTION_ID is null, auto-assign from seq
--   4. Update POST handler response to include transactionId
--
-- Run blocks in order in APEX SQL Workshop.
-- ============================================================

-- ── Step 1: Create sequence starting after Fusion range ──────
DECLARE
    l_max   NUMBER;
    l_start NUMBER;
BEGIN
    SELECT NVL(MAX(TRANSACTION_ID), 100000)
    INTO   l_max
    FROM   RR_EXTERNAL_CASH_TRANSACTIONS;

    -- Start at max * 10 to leave a clear gap from Fusion-sourced numbers
    l_start := l_max * 10;

    BEGIN
        EXECUTE IMMEDIATE
            'CREATE SEQUENCE RR_ECT_TXN_NUM_SEQ ' ||
            'START WITH ' || l_start || ' ' ||
            'INCREMENT BY 1 NOCACHE NOORDER';
        DBMS_OUTPUT.PUT_LINE('Sequence RR_ECT_TXN_NUM_SEQ created with START WITH ' || l_start);
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -955 THEN
                DBMS_OUTPUT.PUT_LINE('RR_ECT_TXN_NUM_SEQ already exists — skipped');
            ELSE RAISE;
            END IF;
    END;
END;
/

-- ── Step 2: Recreate sync procedure with auto-assign for TRANSACTION_ID ──
CREATE OR REPLACE PROCEDURE RR_SYNC_EXTERNAL_CASH_TRANSACTIONS (
    p_json  IN  CLOB,
    p_count OUT NUMBER,
    p_error OUT VARCHAR2
) AS
    l_ext_id  NUMBER;
    l_txn_id  NUMBER;   -- resolved TRANSACTION_ID (input or sequence)
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
        -- Resolve EXTERNAL_TRANSACTION_ID
        IF rec.external_transaction_id IS NULL THEN
            SELECT RR_ECT_MANUAL_SEQ.NEXTVAL INTO l_ext_id FROM DUAL;
        ELSE
            l_ext_id := rec.external_transaction_id;
        END IF;

        -- Resolve TRANSACTION_ID: when null (manual entry), use sequence
        IF rec.transaction_id IS NULL THEN
            SELECT RR_ECT_TXN_NUM_SEQ.NEXTVAL INTO l_txn_id FROM DUAL;
        ELSE
            l_txn_id := rec.transaction_id;
        END IF;

        MERGE INTO RR_EXTERNAL_CASH_TRANSACTIONS tgt
        USING (
            SELECT
                l_ext_id                                        AS external_transaction_id,
                l_txn_id                                        AS transaction_id,
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
                -- Preserve existing TRANSACTION_ID when input was null (Fusion syncs etc.)
                tgt.TRANSACTION_ID               = CASE WHEN rec.transaction_id IS NULL
                                                        THEN tgt.TRANSACTION_ID
                                                        ELSE src.transaction_id END,
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

-- ── Step 3: Update POST handler to return transactionId in response ──
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync external cash transactions — returns externalTransactionId and transactionId',
        p_source         => q'[
DECLARE
    l_json      CLOB;
    l_count     NUMBER;
    l_error     VARCHAR2(4000);
    l_ext_id    NUMBER;
    l_txn_id    NUMBER;
    l_reference VARCHAR2(360);
BEGIN
    l_json := :body_text;

    -- Extract reference text from first item for post-insert lookup
    BEGIN
        SELECT ref_text INTO l_reference
        FROM JSON_TABLE(l_json, '$.items[0]'
            COLUMNS (ref_text VARCHAR2(360) PATH '$.ReferenceText')) t;
    EXCEPTION WHEN OTHERS THEN l_reference := NULL; END;

    RR_SYNC_EXTERNAL_CASH_TRANSACTIONS(
        p_json  => l_json,
        p_count => l_count,
        p_error => l_error
    );

    IF l_error IS NOT NULL THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(l_error, '"', '\"') || '"}');
    ELSE
        -- Look up both IDs of the record just created/updated
        IF l_reference IS NOT NULL THEN
            BEGIN
                SELECT EXTERNAL_TRANSACTION_ID, TRANSACTION_ID
                INTO   l_ext_id, l_txn_id
                FROM (
                    SELECT EXTERNAL_TRANSACTION_ID, TRANSACTION_ID
                      FROM RR_EXTERNAL_CASH_TRANSACTIONS
                     WHERE REFERENCE_TEXT = l_reference
                     ORDER BY EXTERNAL_TRANSACTION_ID DESC
                )
                WHERE ROWNUM = 1;
            EXCEPTION WHEN OTHERS THEN l_ext_id := NULL; l_txn_id := NULL; END;
        END IF;

        :status_code := 200;
        IF l_ext_id IS NOT NULL THEN
            HTP.P('{"status":"success","count":' || l_count
               || ',"externalTransactionId":' || l_ext_id
               || ',"transactionId":'         || NVL(TO_CHAR(l_txn_id), 'null')
               || '}');
        ELSE
            HTP.P('{"status":"success","count":' || l_count || '}');
        END IF;
    END IF;
END;
]'
    );
    COMMIT;
END;
/
