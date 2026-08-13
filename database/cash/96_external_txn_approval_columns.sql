-- =============================================================================
-- PATCH 96: External Transaction Approval Workflow
--
-- What this does:
--   1. Adds approval columns to RR_EXTERNAL_CASH_TRANSACTIONS
--   2. Adds TRANSACTION_TYPE to RR_APPROVAL_TOKENS
--   3. Adds TRANSACTION_TYPE to RR_APPROVAL_EMAIL_REPLIES
--   4. Redeploys GET cash/externaltransactions with new approval + bankConversionDate fields
--   5. New PUT cash/externaltransactions/:id/approval endpoint
--   6. Redeploys POST approvals/generate-links accepting transactionType
--   7. Redeploys GET approvals/tokens returning transactionType
--   8. Redeploys GET approvals/approve with cross-update of external txn table
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── Step 1: Add approval columns to RR_EXTERNAL_CASH_TRANSACTIONS ─────────────
BEGIN
    BEGIN EXECUTE IMMEDIATE q'[ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_STATUS VARCHAR2(20) DEFAULT 'NONE']';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_SENT_DATE TIMESTAMP';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_SENT_BY VARCHAR2(200)';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_APPROVER_NAME VARCHAR2(300)';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_APPROVER_EMAIL VARCHAR2(500)';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVED_DATE TIMESTAMP';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD APPROVAL_REF VARCHAR2(200)';
    EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;

    DBMS_OUTPUT.PUT_LINE('Step 1: RR_EXTERNAL_CASH_TRANSACTIONS approval columns OK');
END;
/

-- ── Step 2: Add TRANSACTION_TYPE to RR_APPROVAL_TOKENS ───────────────────────
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_TOKENS ADD TRANSACTION_TYPE VARCHAR2(100)';
    DBMS_OUTPUT.PUT_LINE('TRANSACTION_TYPE added to RR_APPROVAL_TOKENS');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN DBMS_OUTPUT.PUT_LINE('TRANSACTION_TYPE already exists in RR_APPROVAL_TOKENS');
        ELSE RAISE; END IF;
END;
/

-- ── Step 3: Add TRANSACTION_TYPE to RR_APPROVAL_EMAIL_REPLIES ────────────────
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_EMAIL_REPLIES ADD TRANSACTION_TYPE VARCHAR2(100)';
    DBMS_OUTPUT.PUT_LINE('TRANSACTION_TYPE added to RR_APPROVAL_EMAIL_REPLIES');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN DBMS_OUTPUT.PUT_LINE('TRANSACTION_TYPE already exists in RR_APPROVAL_EMAIL_REPLIES');
        ELSE RAISE; END IF;
END;
/

-- ── Step 4: Redeploy GET cash/externaltransactions with approval + bankConversionDate ──
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

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
    l_recon_status VARCHAR2(30)  := :recon_status;
    l_reference    VARCHAR2(360) := :reference;
    l_date_from    VARCHAR2(30)  := :date_from;
    l_date_to      VARCHAR2(30)  := :date_to;
    l_amt_from     VARCHAR2(30)  := :amount_from;
    l_amt_to       VARCHAR2(30)  := :amount_to;
    l_cr_date_from VARCHAR2(30)  := :creation_date_from;
    l_cr_date_to   VARCHAR2(30)  := :creation_date_to;
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
               TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD')  AS TRANSACTION_DATE,
               TO_CHAR(VALUE_DATE,       'YYYY-MM-DD')  AS VALUE_DATE,
               TO_CHAR(CLEARED_DATE,     'YYYY-MM-DD')  AS CLEARED_DATE,
               AMOUNT,
               CURRENCY_CODE,
               DESCRIPTION,
               REFERENCE_TEXT,
               SOURCE,
               CASE WHEN NVL(RECONCILED_FLAG, 'N') = 'Y' THEN 'REC'
                    ELSE NVL(STATUS, 'UNR')
               END                                       AS STATUS,
               TRANSACTION_TYPE,
               NVL(ACCOUNTING_FLAG,  'N')                AS ACCOUNTING_FLAG,
               NVL(RECONCILED_FLAG,  'N')                AS RECONCILED_FLAG,
               BANK_ACCOUNT_NAME,
               BUSINESS_UNIT_NAME,
               LEGAL_ENTITY_NAME,
               ASSET_ACCOUNT_COMBINATION,
               OFFSET_ACCOUNT_COMBINATION,
               BANK_CONVERSION_RATE,
               BANK_CONVERSION_RATE_TYPE,
               TO_CHAR(BANK_CONVERSION_DATE, 'YYYY-MM-DD') AS BANK_CONVERSION_DATE,
               TRANSFER_ID,
               CHECK_NUMBER,
               RECON_REFERENCE,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,   'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
               LAST_UPDATED_BY,
               TO_CHAR(LAST_UPDATE_DATE,'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               TRANSACTION_DIRECTION,
               PAYMENT_METHOD,
               PAYMENT_DOCUMENT,
               PAPER_DOCUMENT_NUMBER,
               PAYEE_NAME,
               PAYEE_ID,
               TO_CHAR(SYNC_DATE,       'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE,
               NVL(APPROVAL_STATUS, 'NONE')                               AS APPROVAL_STATUS,
               TO_CHAR(APPROVAL_SENT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS')    AS APPROVAL_SENT_DATE,
               APPROVAL_SENT_BY,
               APPROVAL_APPROVER_NAME,
               APPROVAL_APPROVER_EMAIL,
               TO_CHAR(APPROVED_DATE,      'YYYY-MM-DD"T"HH24:MI:SS')    AS APPROVED_DATE,
               APPROVAL_REF
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE (l_txn_number    IS NULL OR TO_CHAR(TRANSACTION_ID) LIKE '%' || l_txn_number || '%')
           AND (l_bank_acct     IS NULL OR UPPER(BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(l_bank_acct)  || '%')
           AND (l_currency      IS NULL OR CURRENCY_CODE              = l_currency)
           AND (l_bu            IS NULL OR BUSINESS_UNIT_NAME         = l_bu)
           AND (l_txn_type      IS NULL OR TRANSACTION_TYPE           = l_txn_type)
           AND (l_source        IS NULL OR SOURCE                     = l_source)
           AND (l_status        IS NULL
                OR (l_status = 'REC' AND NVL(RECONCILED_FLAG, 'N') = 'Y')
                OR (l_status != 'REC' AND NVL(RECONCILED_FLAG, 'N') != 'Y' AND NVL(STATUS, 'UNR') = l_status))
           AND (l_recon_status  IS NULL
                OR (l_recon_status = 'RECONCILED'   AND NVL(RECONCILED_FLAG,'N') = 'Y')
                OR (l_recon_status = 'UNRECONCILED' AND NVL(RECONCILED_FLAG,'N') != 'Y'))
           AND (l_reference     IS NULL OR UPPER(REFERENCE_TEXT)      LIKE '%' || UPPER(l_reference)  || '%')
           AND (l_date_from     IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
           AND (l_date_to       IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
           AND (l_cr_date_from  IS NULL OR TRUNC(CREATION_DATE) >= TO_DATE(l_cr_date_from, 'YYYY-MM-DD'))
           AND (l_cr_date_to    IS NULL OR TRUNC(CREATION_DATE) <= TO_DATE(l_cr_date_to,   'YYYY-MM-DD'))
           AND (l_amt_from      IS NULL OR AMOUNT >= TO_NUMBER(l_amt_from))
           AND (l_amt_to        IS NULL OR AMOUNT <= TO_NUMBER(l_amt_to))
         ORDER BY TRANSACTION_DATE DESC, EXTERNAL_TRANSACTION_ID DESC
         OFFSET l_offset ROWS FETCH NEXT l_limit ROWS ONLY;

    r c_txns%ROWTYPE;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p;
    BEGIN
        IF v IS NULL THEN RETURN 'null'; END IF;
        v := REPLACE(v, '\',  '\\');
        v := REPLACE(v, '"',  '\"');
        v := REPLACE(v, CHR(10), '\n');
        v := REPLACE(v, CHR(13), '\r');
        v := REPLACE(v, CHR(9),  '\t');
        RETURN '"' || v || '"';
    END;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('{"success":true,"items":['));

    OPEN c_txns;
    LOOP
        FETCH c_txns INTO r;
        EXIT WHEN c_txns%NOTFOUND;

        IF NOT v_first THEN
            DBMS_LOB.APPEND(v_clob, TO_CLOB(','));
        END IF;
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
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"reconciledFlag":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.RECONCILED_FLAG)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionType":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TRANSACTION_TYPE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"accountingFlag":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ACCOUNTING_FLAG)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankAccountName":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BANK_ACCOUNT_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"businessUnitName":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BUSINESS_UNIT_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"legalEntityName":')     ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.LEGAL_ENTITY_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"assetAccountCombination":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ASSET_ACCOUNT_COMBINATION)));
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
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"lastUpdateDate":')       ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.LAST_UPDATE_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transactionDirection":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TRANSACTION_DIRECTION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paymentMethod":')        ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYMENT_METHOD)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paymentDocument":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYMENT_DOCUMENT)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paperDocumentNumber":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAPER_DOCUMENT_NUMBER)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"payeeName":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYEE_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"payeeId":'     || NVL(TO_CHAR(r.PAYEE_ID), 'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"syncDate":')           ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.SYNC_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalStatus":')      ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_STATUS)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalSentDate":')    ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_SENT_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalSentBy":')      ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_SENT_BY)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalApproverName":')  ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_APPROVER_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalApproverEmail":') ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_APPROVER_EMAIL)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvedDate":')        ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVED_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"approvalRef":')         ); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.APPROVAL_REF)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB('}'));
    END LOOP;
    CLOSE c_txns;

    DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));

    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(v_clob);
    l_pos := 1;
    LOOP
        EXIT WHEN l_pos > l_len;
        l_chunk := DBMS_LOB.SUBSTR(v_clob, 32767, l_pos);
        HTP.PRN(l_chunk);
        l_pos := l_pos + 32767;
    END LOOP;
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── Step 5: New PUT cash/externaltransactions/:id/approval ────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:id/approval',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:id/approval',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body          CLOB    := :body_text;
    v_id            NUMBER  := TO_NUMBER(:id);
    v_status        VARCHAR2(20);
    v_sent_by       VARCHAR2(200);
    v_appr_name     VARCHAR2(300);
    v_appr_email    VARCHAR2(500);
    v_appr_ref      VARCHAR2(200);
    v_cnt           NUMBER;
BEGIN
    SELECT jt.approval_status, jt.approval_sent_by, jt.approver_name, jt.approver_email, jt.approval_ref
    INTO   v_status, v_sent_by, v_appr_name, v_appr_email, v_appr_ref
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               approval_status  VARCHAR2(20)  PATH '$.approvalStatus',
               approval_sent_by VARCHAR2(200) PATH '$.approvalSentBy',
               approver_name    VARCHAR2(300) PATH '$.approverName',
               approver_email   VARCHAR2(500) PATH '$.approverEmail',
               approval_ref     VARCHAR2(200) PATH '$.approvalRef'
             )
           ) jt;

    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
    SET    APPROVAL_STATUS         = NVL(v_status, 'PENDING'),
           APPROVAL_SENT_DATE      = SYSTIMESTAMP,
           APPROVAL_SENT_BY        = v_sent_by,
           APPROVAL_APPROVER_NAME  = v_appr_name,
           APPROVAL_APPROVER_EMAIL = v_appr_email,
           APPROVAL_REF            = v_appr_ref
    WHERE  EXTERNAL_TRANSACTION_ID = v_id;

    v_cnt := SQL%ROWCOUNT;
    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Transaction not found: ' || v_id || '"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","approvalStatus":"' || NVL(v_status,'PENDING') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 6: Redeploy POST approvals/generate-links with transactionType ───────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/generate-links',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/generate-links',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body       CLOB    := :body_text;
    v_ref        VARCHAR2(200);
    v_req_id     NUMBER;
    v_to_email   VARCHAR2(500);
    v_to_name    VARCHAR2(300);
    v_txn_type   VARCHAR2(100);
    v_tok_app    VARCHAR2(128);
    v_tok_rej    VARCHAR2(128);
    v_expires    TIMESTAMP := SYSTIMESTAMP + INTERVAL '72' HOUR;
BEGIN
    SELECT jt.request_ref, jt.request_id, jt.to_email, jt.to_name, jt.transaction_type
    INTO   v_ref, v_req_id, v_to_email, v_to_name, v_txn_type
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               request_ref      VARCHAR2(200) PATH '$.requestRef',
               request_id       NUMBER        PATH '$.requestId',
               to_email         VARCHAR2(500) PATH '$.toEmail',
               to_name          VARCHAR2(300) PATH '$.toName',
               transaction_type VARCHAR2(100) PATH '$.transactionType'
             )
           ) jt;

    v_tok_app := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID()));
    v_tok_rej := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID()));

    INSERT INTO RR_APPROVAL_TOKENS
        (TOKEN_VALUE, ACTION, REQUEST_REF, REQUEST_ID, TO_EMAIL, TO_NAME, EXPIRES_DATE, TRANSACTION_TYPE)
    VALUES
        (v_tok_app, 'APPROVE', v_ref, v_req_id, v_to_email, v_to_name, v_expires, v_txn_type);

    INSERT INTO RR_APPROVAL_TOKENS
        (TOKEN_VALUE, ACTION, REQUEST_REF, REQUEST_ID, TO_EMAIL, TO_NAME, EXPIRES_DATE, TRANSACTION_TYPE)
    VALUES
        (v_tok_rej, 'REJECT', v_ref, v_req_id, v_to_email, v_to_name, v_expires, v_txn_type);

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","approveToken":"' || v_tok_app || '","rejectToken":"' || v_tok_rej || '"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 7: Redeploy GET approvals/tokens returning transactionType ───────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/tokens',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/tokens',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT TOKEN_ID, ACTION, REQUEST_REF, REQUEST_ID,
               TO_EMAIL, TO_NAME, STATUS, TRANSACTION_TYPE,
               TO_CHAR(CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               TO_CHAR(EXPIRES_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS EXPIRES_DATE,
               TO_CHAR(USED_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS USED_DATE
        FROM   RR_APPROVAL_TOKENS
        ORDER  BY CREATED_DATE DESC
        FETCH  FIRST 200 ROWS ONLY
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"tokenId":'            || r.TOKEN_ID                                               ||
            ',"action":'             || APEX_JSON.STRINGIFY(NVL(r.ACTION,''))                    ||
            ',"requestRef":'         || APEX_JSON.STRINGIFY(NVL(r.REQUEST_REF,''))               ||
            ',"requestId":'          || NVL(TO_CHAR(r.REQUEST_ID),'null')                        ||
            ',"toEmail":'            || APEX_JSON.STRINGIFY(NVL(r.TO_EMAIL,''))                  ||
            ',"toName":'             || APEX_JSON.STRINGIFY(NVL(r.TO_NAME,''))                   ||
            ',"status":'             || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))             ||
            ',"transactionType":'    || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_TYPE,''))          ||
            ',"createdDate":'        || APEX_JSON.STRINGIFY(NVL(r.CREATED_DATE,''))              ||
            ',"expiresDate":'        || APEX_JSON.STRINGIFY(NVL(r.EXPIRES_DATE,''))              ||
            ',"usedDate":'           || APEX_JSON.STRINGIFY(NVL(r.USED_DATE,''))                 ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"items":[],"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 8: Redeploy GET approvals/approve with cross-update of ext txn table ─
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/approve',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/approve',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_token    VARCHAR2(128) := :token;
    v_action   VARCHAR2(10);
    v_ref      VARCHAR2(200);
    v_name     VARCHAR2(300);
    v_email    VARCHAR2(500);
    v_req_id   NUMBER;
    v_expires  TIMESTAMP;
    v_status   VARCHAR2(20);
    v_title    VARCHAR2(100);
    v_color    VARCHAR2(20);
    v_icon     VARCHAR2(10);
    v_msg      VARCHAR2(500);
BEGIN
    IF v_token IS NULL THEN
        :status_code := 400;
        HTP.P('<html><body style="font-family:Arial;text-align:center;padding:60px"><h2>Invalid Link</h2><p>This approval link is invalid.</p></body></html>');
        RETURN;
    END IF;

    BEGIN
        SELECT ACTION, REQUEST_REF, TO_NAME, TO_EMAIL, REQUEST_ID, EXPIRES_DATE, STATUS
        INTO   v_action, v_ref, v_name, v_email, v_req_id, v_expires, v_status
        FROM   RR_APPROVAL_TOKENS
        WHERE  TOKEN_VALUE = v_token;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 200;
            HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invalid Link</title></head>'
               || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
               || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
               || '<div style="font-size:48px;margin-bottom:16px;">&#10060;</div>'
               || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Invalid Link</h2>'
               || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link does not exist or has already been removed.</p>'
               || '</div></body></html>');
            RETURN;
    END;

    IF v_status = 'USED' THEN
        :status_code := 200;
        HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Already Used</title></head>'
           || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
           || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
           || '<div style="font-size:48px;margin-bottom:16px;">&#9888;&#65039;</div>'
           || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Link Already Used</h2>'
           || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link has already been used.<br>Your action was recorded.</p>'
           || '<p style="color:#aaa;font-size:12px;margin-top:24px;">You may close this tab.</p>'
           || '</div></body></html>');
        RETURN;
    END IF;

    IF SYSTIMESTAMP > v_expires THEN
        UPDATE RR_APPROVAL_TOKENS SET STATUS = 'EXPIRED' WHERE TOKEN_VALUE = v_token;
        COMMIT;
        :status_code := 200;
        HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired</title></head>'
           || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
           || '<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.10);">'
           || '<div style="font-size:48px;margin-bottom:16px;">&#8987;</div>'
           || '<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:22px;">Link Expired</h2>'
           || '<p style="color:#666;font-size:14px;line-height:1.6;">This approval link expired 72 hours after it was sent.<br>Please contact the requester for a new link.</p>'
           || '<p style="color:#aaa;font-size:12px;margin-top:24px;">You may close this tab.</p>'
           || '</div></body></html>');
        RETURN;
    END IF;

    -- Valid token — mark USED and record action
    UPDATE RR_APPROVAL_TOKENS
    SET    STATUS    = 'USED',
           USED_DATE = SYSTIMESTAMP
    WHERE  TOKEN_VALUE = v_token;

    -- Record in email replies
    INSERT INTO RR_APPROVAL_EMAIL_REPLIES (
        FROM_EMAIL, FROM_NAME, SUBJECT, BODY_TEXT,
        ACTION_DETECTED, REF_NUMBER, REQUEST_ID, STATUS
    ) VALUES (
        v_email, v_name,
        v_action || ': ' || v_ref || ' [via approval link]',
        v_action || ' — clicked approval button in email',
        v_action, v_ref, v_req_id, 'PENDING'
    );

    -- Cross-update external transaction approval status
    BEGIN
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
        SET    APPROVAL_STATUS         = CASE v_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
               APPROVED_DATE           = SYSTIMESTAMP,
               APPROVAL_APPROVER_NAME  = v_name,
               APPROVAL_APPROVER_EMAIL = v_email
        WHERE  APPROVAL_REF = v_ref
        AND    NVL(APPROVAL_STATUS, 'NONE') = 'PENDING';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    COMMIT;

    v_color := CASE v_action WHEN 'APPROVE' THEN '#16a34a' ELSE '#dc2626' END;
    v_icon  := CASE v_action WHEN 'APPROVE' THEN '&#9989;' ELSE '&#10060;' END;
    v_title := CASE v_action WHEN 'APPROVE' THEN 'Approved!' ELSE 'Rejected' END;
    v_msg   := CASE v_action
                   WHEN 'APPROVE' THEN 'Your approval has been recorded. The requester will be notified.'
                   ELSE 'Your rejection has been recorded. The requester will be notified.'
               END;

    :status_code := 200;
    HTP.P('<!DOCTYPE html><html><head><meta charset="UTF-8">'
       || '<meta name="viewport" content="width=device-width,initial-scale=1">'
       || '<title>' || v_title || '</title></head>'
       || '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;'
       || 'display:flex;align-items:center;justify-content:center;min-height:100vh;">');

    HTP.P('<div style="background:#fff;border-radius:12px;padding:48px 40px;text-align:center;'
       || 'max-width:480px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.10);">');
    HTP.P('<div style="font-size:56px;margin-bottom:16px;">' || v_icon || '</div>');
    HTP.P('<h2 style="margin:0 0 8px;color:' || v_color || ';font-size:26px;font-weight:700;">' || v_title || '</h2>');
    HTP.P('<div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;'
       || 'margin:20px 0;text-align:left;border-left:4px solid ' || v_color || ';">');
    HTP.P('<div style="font-size:12px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Reference</div>');
    HTP.P('<div style="font-size:16px;font-weight:700;color:#1a1a1a;">' || NVL(v_ref,'—') || '</div>');
    HTP.P('<div style="font-size:12px;color:#888;margin-top:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Actioned by</div>');
    HTP.P('<div style="font-size:14px;color:#333;">' || NVL(v_name, v_email) || '</div>');
    HTP.P('<div style="font-size:12px;color:#888;margin-top:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Date &amp; Time</div>');
    HTP.P('<div style="font-size:13px;color:#333;">' || TO_CHAR(SYSDATE,'DD Mon YYYY HH24:MI') || ' (UTC)</div>');
    HTP.P('</div>');
    HTP.P('<p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">' || v_msg || '</p>');
    HTP.P('<p style="color:#bbb;font-size:12px;margin:0;">You may close this tab.</p>');
    HTP.P('<div style="margin-top:32px;padding-top:20px;border-top:1px solid #f0f0f0;">'
       || '<div style="font-size:10px;color:#ddd;letter-spacing:1px;text-transform:uppercase;">'
       || 'Bumeric Business Solutions — ERP Approval System</div>'
       || '</div>');
    HTP.P('</div></body></html>');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('<html><body style="font-family:Arial;text-align:center;padding:60px">'
           || '<h2>Error</h2><p>' || APEX_ESCAPE.HTML(SQLERRM) || '</p></body></html>');
END;
]'
    );
    COMMIT;
END;
/
