-- ============================================================
-- Patch 83: Server-side pagination for GET /cash/externaltransactions
--
-- Changes:
--   • Response now includes "total": N (total matching rows, pre-OFFSET)
--   • Caller sends row_limit (page size) and row_offset (skip rows)
--   • Uses COUNT(*) OVER () analytic — evaluated before OFFSET/FETCH
--     in Oracle 12c+, giving the true total without a second query.
--   • Items built into a separate CLOB so the total is known before
--     assembling the final JSON envelope.
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Paginated external cash transactions query',
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
    l_limit        NUMBER        := NVL(TO_NUMBER(:row_limit),  50);
    l_offset       NUMBER        := NVL(TO_NUMBER(:row_offset),  0);

    v_items CLOB;   -- accumulates the JSON item array
    v_clob  CLOB;   -- final response envelope
    v_first BOOLEAN := TRUE;
    l_total NUMBER  := 0;
    l_pos   INTEGER;
    l_len   INTEGER;
    l_chunk VARCHAR2(32767);

    -- COUNT(*) OVER () is evaluated before OFFSET/FETCH in Oracle 12c+,
    -- so it returns the total matching row count regardless of page size.
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
               TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE,
               COUNT(*) OVER ()                              AS TOTAL_COUNT
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
    DBMS_LOB.CREATETEMPORARY(v_items, TRUE);
    DBMS_LOB.CREATETEMPORARY(v_clob,  TRUE);

    OPEN c_txns;
    LOOP
        FETCH c_txns INTO r;
        EXIT WHEN c_txns%NOTFOUND;

        -- Capture total from first row (COUNT(*) OVER () pre-FETCH value)
        IF v_first THEN
            l_total := NVL(r.TOTAL_COUNT, 0);
        ELSE
            DBMS_LOB.APPEND(v_items, TO_CLOB(','));
        END IF;
        v_first := FALSE;

        DBMS_LOB.APPEND(v_items, TO_CLOB('{'));
        DBMS_LOB.APPEND(v_items, TO_CLOB('"externalTransactionId":' || TO_CHAR(r.EXTERNAL_TRANSACTION_ID)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"transactionId":'    || NVL(TO_CHAR(r.TRANSACTION_ID), 'null')));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"transactionDate":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.TRANSACTION_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"valueDate":')       ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.VALUE_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"clearedDate":')     ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.CLEARED_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"amount":'           || NVL(TO_CHAR(r.AMOUNT), 'null')));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"currencyCode":')    ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.CURRENCY_CODE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"description":')     ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.DESCRIPTION)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"referenceText":')   ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.REFERENCE_TEXT)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"source":')          ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.SOURCE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"status":')          ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.STATUS)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"transactionType":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.TRANSACTION_TYPE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"accountingFlag":')  ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.ACCOUNTING_FLAG)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"bankAccountName":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.BANK_ACCOUNT_NAME)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"businessUnitName":')   ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.BUSINESS_UNIT_NAME)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"legalEntityName":')    ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.LEGAL_ENTITY_NAME)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"assetAccountCombination":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.ASSET_ACCOUNT_COMBINATION)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"offsetAccountCombination":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.OFFSET_ACCOUNT_COMBINATION)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"bankConversionRate":' || NVL(TO_CHAR(r.BANK_CONVERSION_RATE), 'null')));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"bankConversionRateType":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.BANK_CONVERSION_RATE_TYPE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"bankConversionDate":')     ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.BANK_CONVERSION_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"transferId":'  || NVL(TO_CHAR(r.TRANSFER_ID), 'null')));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"checkNumber":')    ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.CHECK_NUMBER)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"reconReference":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.RECON_REFERENCE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"createdBy":')      ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.CREATED_BY)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"creationDate":')   ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.CREATION_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"lastUpdatedBy":')  ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.LAST_UPDATED_BY)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"lastUpdateDate":')      ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.LAST_UPDATE_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"transactionDirection":') ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.TRANSACTION_DIRECTION)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"paymentMethod":')        ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.PAYMENT_METHOD)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"paymentDocument":')      ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.PAYMENT_DOCUMENT)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"paperDocumentNumber":')  ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.PAPER_DOCUMENT_NUMBER)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"payeeName":')  ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.PAYEE_NAME)));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"payeeId":'     || NVL(TO_CHAR(r.PAYEE_ID), 'null')));
        DBMS_LOB.APPEND(v_items, TO_CLOB(',"syncDate":')   ); DBMS_LOB.APPEND(v_items, TO_CLOB(jstr(r.SYNC_DATE)));
        DBMS_LOB.APPEND(v_items, TO_CLOB('}'));
    END LOOP;
    CLOSE c_txns;

    -- Assemble final envelope: total is now known
    DBMS_LOB.APPEND(v_clob, TO_CLOB('{"success":true,"total":' || l_total || ',"items":['));
    DBMS_LOB.APPEND(v_clob, v_items);
    DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
    DBMS_LOB.FREETEMPORARY(v_items);

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
