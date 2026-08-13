-- =====================================================
-- AR Invoice: Sequences + create_invoice + ORDS fix
-- Run in Oracle APEX SQL Workshop as schema user
-- =====================================================

-- 1. Sequences (skip if already exist)
BEGIN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_AR_INVOICE_HEADERS_S      START WITH 10000 INCREMENT BY 1 NOCACHE NOCYCLE';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_AR_INVOICE_LINES_S        START WITH 10000 INCREMENT BY 1 NOCACHE NOCYCLE';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_AR_INVOICE_INSTALLMENTS_S START WITH 10000 INCREMENT BY 1 NOCACHE NOCYCLE';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 2. Add TRANSACTION_CLASS column if missing
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_AR_INVOICE_HEADERS ADD TRANSACTION_CLASS VARCHAR2(30)';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 3. Package spec
CREATE OR REPLACE PACKAGE RR_AR_INVOICES_PKG AS
    PROCEDURE create_invoice (
        p_invoice_json         IN  CLOB,
        p_customer_trx_id     OUT NUMBER,
        p_transaction_number  OUT VARCHAR2,
        p_status              OUT VARCHAR2,
        p_message             OUT VARCHAR2
    );
    PROCEDURE save_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );
    PROCEDURE save_invoices_bulk (
        p_invoices_json IN  CLOB,
        p_inserted      OUT NUMBER,
        p_updated       OUT NUMBER,
        p_errors        OUT NUMBER,
        p_error_msgs    OUT VARCHAR2
    );
    PROCEDURE save_invoice_lines (
        p_transaction_id  IN  NUMBER,
        p_lines_json      IN  CLOB,
        p_inserted        OUT NUMBER,
        p_updated         OUT NUMBER,
        p_errors          OUT NUMBER,
        p_error_msgs      OUT VARCHAR2
    );
    PROCEDURE save_invoice_installments (
        p_transaction_id     IN  NUMBER,
        p_installments_json  IN  CLOB,
        p_status             OUT VARCHAR2,
        p_message            OUT VARCHAR2
    );
    PROCEDURE save_invoice_distributions (
        p_transaction_id       IN  NUMBER,
        p_distributions_json   IN  CLOB,
        p_inserted             OUT NUMBER,
        p_updated              OUT NUMBER,
        p_errors               OUT NUMBER,
        p_error_msgs           OUT VARCHAR2
    );
END RR_AR_INVOICES_PKG;
/

-- 4. Package body
CREATE OR REPLACE PACKAGE BODY RR_AR_INVOICES_PKG AS

    FUNCTION to_safe_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_date;

    FUNCTION to_safe_ts (p_str IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP(SUBSTR(REPLACE(TRIM(p_str), 'T', ' '), 1, 19), 'YYYY-MM-DD HH24:MI:SS');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_ts;

    -- create_invoice: new invoice, generates all IDs from sequences
    PROCEDURE create_invoice (
        p_invoice_json         IN  CLOB,
        p_customer_trx_id     OUT NUMBER,
        p_transaction_number  OUT VARCHAR2,
        p_status              OUT VARCHAR2,
        p_message             OUT VARCHAR2
    ) IS
        l_txn_id      NUMBER;
        l_txn_num     VARCHAR2(150);
        l_total_amt   NUMBER := 0;
        l_entered_amt NUMBER;
        l_txn_date    DATE;
        l_acct_date   DATE;
        l_conv_date   DATE;
        l_line_count  NUMBER := 0;
        l_inst_id     NUMBER;
    BEGIN
        l_txn_id  := RR_AR_INVOICE_HEADERS_S.NEXTVAL;

        l_txn_num := TRIM(JSON_VALUE(p_invoice_json, '$.TransactionNumber'));
        IF l_txn_num IS NULL OR l_txn_num = '' THEN
            l_txn_num := 'AR-INV-' || TO_CHAR(l_txn_id);
        END IF;

        l_txn_date  := to_safe_date(JSON_VALUE(p_invoice_json, '$.TransactionDate'));
        l_acct_date := to_safe_date(JSON_VALUE(p_invoice_json, '$.AccountingDate'));
        l_conv_date := to_safe_date(JSON_VALUE(p_invoice_json, '$.ConversionDate'));

        SELECT NVL(SUM(
            NVL(JSON_VALUE(j.line_clob, '$.Quantity'         RETURNING NUMBER), 0) *
            NVL(JSON_VALUE(j.line_clob, '$.UnitSellingPrice' RETURNING NUMBER), 0)
        ), 0)
        INTO l_total_amt
        FROM JSON_TABLE(p_invoice_json, '$.lines[*]' COLUMNS (line_clob CLOB FORMAT JSON PATH '$')) j;

        l_entered_amt := NVL(JSON_VALUE(p_invoice_json, '$.EnteredAmount' RETURNING NUMBER), l_total_amt);

        INSERT INTO RR_AR_INVOICE_HEADERS (
            CUSTOMER_TRANSACTION_ID, TRANSACTION_NUMBER,   TRANSACTION_CLASS,
            TRANSACTION_TYPE,        TRANSACTION_SOURCE,   TRANSACTION_DATE,
            ACCOUNTING_DATE,         INVOICE_STATUS,       INVOICE_CURRENCY_CODE,
            CONVERSION_RATE_TYPE,    CONVERSION_DATE,      CONVERSION_RATE,
            ENTERED_AMOUNT,          INVOICE_BALANCE_AMOUNT,
            BILL_TO_CUSTOMER_NUMBER, BILL_TO_CUSTOMER_NAME, BILL_TO_SITE,        BILL_TO_CONTACT,
            SHIP_TO_CUSTOMER_NAME,   SHIP_TO_SITE,         SHIP_TO_CONTACT,
            PAYING_CUSTOMER_NAME,    PAYING_CUSTOMER_SITE, PAYING_CUSTOMER_ACCOUNT,
            BUSINESS_UNIT,           LEGAL_ENTITY_IDENTIFIER, PAYMENT_TERMS,
            PURCHASE_ORDER,          SPECIAL_INSTRUCTIONS, COMMENTS,
            INVOICING_RULE,          CROSS_REFERENCE,      REMIT_TO_ADDRESS,
            SYNC_STATUS,             LAST_UPDATED_BY,      LAST_UPDATE_DATE,     SYNC_DATE
        ) VALUES (
            l_txn_id,  l_txn_num,
            JSON_VALUE(p_invoice_json, '$.TransactionClass'),
            JSON_VALUE(p_invoice_json, '$.TransactionType'),
            JSON_VALUE(p_invoice_json, '$.TransactionSource'),
            l_txn_date, NVL(l_acct_date, l_txn_date),
            'Incomplete',
            NVL(JSON_VALUE(p_invoice_json, '$.InvoiceCurrencyCode'), 'AED'),
            JSON_VALUE(p_invoice_json, '$.ConversionType'),
            l_conv_date,
            JSON_VALUE(p_invoice_json, '$.ConversionRate' RETURNING NUMBER),
            l_entered_amt, l_entered_amt,
            JSON_VALUE(p_invoice_json, '$.BillToCustomerNumber'),
            JSON_VALUE(p_invoice_json, '$.BillToCustomerName'),
            JSON_VALUE(p_invoice_json, '$.BillToSite'),
            JSON_VALUE(p_invoice_json, '$.BillToContact'),
            JSON_VALUE(p_invoice_json, '$.ShipToCustomerName'),
            JSON_VALUE(p_invoice_json, '$.ShipToSite'),
            JSON_VALUE(p_invoice_json, '$.ShipToContact'),
            JSON_VALUE(p_invoice_json, '$.PayingCustomerName'),
            JSON_VALUE(p_invoice_json, '$.PayingCustomerSite'),
            JSON_VALUE(p_invoice_json, '$.PayingCustomerAccount'),
            JSON_VALUE(p_invoice_json, '$.BusinessUnit'),
            JSON_VALUE(p_invoice_json, '$.LegalEntityIdentifier'),
            JSON_VALUE(p_invoice_json, '$.PaymentTerms'),
            JSON_VALUE(p_invoice_json, '$.PurchaseOrder'),
            JSON_VALUE(p_invoice_json, '$.SpecialInstructions'),
            JSON_VALUE(p_invoice_json, '$.Comments'),
            JSON_VALUE(p_invoice_json, '$.InvoicingRule'),
            JSON_VALUE(p_invoice_json, '$.CrossReference'),
            JSON_VALUE(p_invoice_json, '$.RemitToAddress'),
            'NEW', USER, SYSTIMESTAMP, SYSTIMESTAMP
        );

        FOR rec IN (
            SELECT j.line_clob
            FROM JSON_TABLE(p_invoice_json, '$.lines[*]' COLUMNS (line_clob CLOB FORMAT JSON PATH '$')) j
        ) LOOP
            l_line_count := l_line_count + 1;
            INSERT INTO RR_AR_INVOICE_LINES (
                CUSTOMER_TRANSACTION_LINE_ID, CUSTOMER_TRANSACTION_ID,
                LINE_NUMBER,                  DESCRIPTION,
                ITEM_NUMBER,                  UNIT_OF_MEASURE,
                MEMO_LINE,                    QUANTITY,
                UNIT_SELLING_PRICE,           LINE_AMOUNT,
                TAX_CLASSIFICATION_CODE,      TRANSACTION_BUSINESS_CATEGORY,
                SYNC_STATUS,                  LAST_UPDATED_BY,
                LAST_UPDATE_DATE,             SYNC_DATE
            ) VALUES (
                RR_AR_INVOICE_LINES_S.NEXTVAL, l_txn_id,
                NVL(JSON_VALUE(rec.line_clob, '$.LineNumber'         RETURNING NUMBER), l_line_count),
                JSON_VALUE(rec.line_clob, '$.Description'),
                JSON_VALUE(rec.line_clob, '$.ItemNumber'),
                JSON_VALUE(rec.line_clob, '$.UnitOfMeasure'),
                JSON_VALUE(rec.line_clob, '$.MemoLine'),
                JSON_VALUE(rec.line_clob, '$.Quantity'               RETURNING NUMBER),
                JSON_VALUE(rec.line_clob, '$.UnitSellingPrice'       RETURNING NUMBER),
                NVL(JSON_VALUE(rec.line_clob, '$.LineAmount'         RETURNING NUMBER),
                    NVL(JSON_VALUE(rec.line_clob, '$.Quantity'       RETURNING NUMBER), 0) *
                    NVL(JSON_VALUE(rec.line_clob, '$.UnitSellingPrice' RETURNING NUMBER), 0)),
                JSON_VALUE(rec.line_clob, '$.TaxClassificationCode'),
                JSON_VALUE(rec.line_clob, '$.TransactionBusinessCategory'),
                'NEW', USER, SYSTIMESTAMP, SYSTIMESTAMP
            );
        END LOOP;

        -- Auto installment (seq 1, full amount, due = txn date)
        l_inst_id := RR_AR_INVOICE_INSTALLMENTS_S.NEXTVAL;
        INSERT INTO RR_AR_INVOICE_INSTALLMENTS (
            INSTALLMENT_ID,                CUSTOMER_TRANSACTION_ID,
            INSTALLMENT_SEQUENCE_NUMBER,   INSTALLMENT_STATUS,
            INSTALLMENT_DUE_DATE,          ORIGINAL_AMOUNT,
            INSTALLMENT_BALANCE_DUE,       ACCOUNTED_BALANCE_DUE,
            INSTALLMENT_LINE_AMOUNT_ORIGINAL, SYNC_STATUS,
            LAST_UPDATED_BY,               LAST_UPDATE_DATE, SYNC_DATE
        ) VALUES (
            l_inst_id,      l_txn_id,
            1,              'Open',
            NVL(l_txn_date, SYSDATE),
            l_entered_amt,  l_entered_amt, l_entered_amt, l_entered_amt,
            'NEW', USER, SYSTIMESTAMP, SYSTIMESTAMP
        );

        COMMIT;
        p_customer_trx_id    := l_txn_id;
        p_transaction_number := l_txn_num;
        p_status             := 'SUCCESS';
        p_message            := 'Invoice created: ' || l_txn_num || ', Lines: ' || l_line_count;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_customer_trx_id    := NULL;
            p_transaction_number := NULL;
            p_status             := 'ERROR';
            p_message            := SQLERRM;
    END create_invoice;

    -- upsert_header helper (for save_invoice / bulk)
    PROCEDURE upsert_header (p_json IN CLOB) IS
        l_id        NUMBER    := JSON_VALUE(p_json, '$.CustomerTransactionId' RETURNING NUMBER);
        l_txn_date  DATE      := to_safe_date(JSON_VALUE(p_json, '$.TransactionDate'));
        l_acct_date DATE      := to_safe_date(JSON_VALUE(p_json, '$.AccountingDate'));
        l_due_date  DATE      := to_safe_date(JSON_VALUE(p_json, '$.DueDate'));
        l_conv_date DATE      := to_safe_date(JSON_VALUE(p_json, '$.ConversionDate'));
        l_po_date   DATE      := to_safe_date(JSON_VALUE(p_json, '$.PurchaseOrderDate'));
        l_cr_ts     TIMESTAMP := to_safe_ts(JSON_VALUE(p_json, '$.CreationDate'));
        l_upd_ts    TIMESTAMP := to_safe_ts(JSON_VALUE(p_json, '$.LastUpdateDate'));
    BEGIN
        MERGE INTO RR_AR_INVOICE_HEADERS h
        USING DUAL ON (h.CUSTOMER_TRANSACTION_ID = l_id)
        WHEN MATCHED THEN UPDATE SET
            TRANSACTION_NUMBER      = JSON_VALUE(p_json, '$.TransactionNumber'),
            TRANSACTION_CLASS       = JSON_VALUE(p_json, '$.TransactionClass'),
            CROSS_REFERENCE         = JSON_VALUE(p_json, '$.CrossReference'),
            TRANSACTION_DATE        = l_txn_date,
            ACCOUNTING_DATE         = l_acct_date,
            DUE_DATE                = l_due_date,
            TRANSACTION_TYPE        = JSON_VALUE(p_json, '$.TransactionType'),
            TRANSACTION_SOURCE      = JSON_VALUE(p_json, '$.TransactionSource'),
            INVOICE_CURRENCY_CODE   = JSON_VALUE(p_json, '$.InvoiceCurrencyCode'),
            CONVERSION_RATE_TYPE    = JSON_VALUE(p_json, '$.ConversionRateType'),
            CONVERSION_DATE         = l_conv_date,
            CONVERSION_RATE         = JSON_VALUE(p_json, '$.ConversionRate'       RETURNING NUMBER),
            ENTERED_AMOUNT          = JSON_VALUE(p_json, '$.EnteredAmount'         RETURNING NUMBER),
            BILL_TO_CUSTOMER_NUMBER = JSON_VALUE(p_json, '$.BillToCustomerNumber'),
            BILL_TO_CUSTOMER_NAME   = JSON_VALUE(p_json, '$.BillToCustomerName'),
            BILL_TO_SITE            = JSON_VALUE(p_json, '$.BillToSite'),
            BILL_TO_CONTACT         = JSON_VALUE(p_json, '$.BillToContact'),
            SHIP_TO_CUSTOMER_NAME   = JSON_VALUE(p_json, '$.ShipToCustomerName'),
            SHIP_TO_SITE            = JSON_VALUE(p_json, '$.ShipToSite'),
            PAYING_CUSTOMER_NAME    = JSON_VALUE(p_json, '$.PayingCustomerName'),
            PAYING_CUSTOMER_ACCOUNT = JSON_VALUE(p_json, '$.PayingCustomerAccount'),
            BUSINESS_UNIT           = JSON_VALUE(p_json, '$.BusinessUnit'),
            PAYMENT_TERMS           = JSON_VALUE(p_json, '$.PaymentTerms'),
            PURCHASE_ORDER          = JSON_VALUE(p_json, '$.PurchaseOrder'),
            PURCHASE_ORDER_DATE     = l_po_date,
            SPECIAL_INSTRUCTIONS    = JSON_VALUE(p_json, '$.SpecialInstructions'),
            COMMENTS                = JSON_VALUE(p_json, '$.Comments'),
            INVOICING_RULE          = JSON_VALUE(p_json, '$.InvoicingRule'),
            FUSION_CREATED_BY       = JSON_VALUE(p_json, '$.CreatedBy'),
            FUSION_CREATION_DATE    = l_cr_ts,
            FUSION_LAST_UPDATED_BY  = JSON_VALUE(p_json, '$.LastUpdatedBy'),
            FUSION_LAST_UPDATE_DATE = l_upd_ts,
            LAST_UPDATED_BY         = USER,
            LAST_UPDATE_DATE        = SYSTIMESTAMP,
            SYNC_DATE               = SYSTIMESTAMP,
            SYNC_STATUS             = 'UPDATED'
        WHEN NOT MATCHED THEN INSERT (
            CUSTOMER_TRANSACTION_ID, TRANSACTION_NUMBER,   TRANSACTION_CLASS,
            CROSS_REFERENCE,         TRANSACTION_DATE,     ACCOUNTING_DATE,
            DUE_DATE,                TRANSACTION_TYPE,     TRANSACTION_SOURCE,
            INVOICE_STATUS,          INVOICE_CURRENCY_CODE, CONVERSION_RATE_TYPE,
            CONVERSION_DATE,         CONVERSION_RATE,      ENTERED_AMOUNT,
            BILL_TO_CUSTOMER_NUMBER, BILL_TO_CUSTOMER_NAME, BILL_TO_SITE,
            SHIP_TO_CUSTOMER_NAME,   SHIP_TO_SITE,         PAYING_CUSTOMER_NAME,
            PAYING_CUSTOMER_ACCOUNT, BUSINESS_UNIT,        PAYMENT_TERMS,
            PURCHASE_ORDER,          PURCHASE_ORDER_DATE,  SPECIAL_INSTRUCTIONS,
            COMMENTS,                INVOICING_RULE,       FUSION_CREATED_BY,
            FUSION_CREATION_DATE,    FUSION_LAST_UPDATED_BY, FUSION_LAST_UPDATE_DATE,
            SYNC_STATUS
        ) VALUES (
            l_id,
            JSON_VALUE(p_json, '$.TransactionNumber'),
            JSON_VALUE(p_json, '$.TransactionClass'),
            JSON_VALUE(p_json, '$.CrossReference'),
            l_txn_date, l_acct_date, l_due_date,
            JSON_VALUE(p_json, '$.TransactionType'),
            JSON_VALUE(p_json, '$.TransactionSource'),
            JSON_VALUE(p_json, '$.InvoiceStatus'),
            JSON_VALUE(p_json, '$.InvoiceCurrencyCode'),
            JSON_VALUE(p_json, '$.ConversionRateType'),
            l_conv_date,
            JSON_VALUE(p_json, '$.ConversionRate'       RETURNING NUMBER),
            JSON_VALUE(p_json, '$.EnteredAmount'         RETURNING NUMBER),
            JSON_VALUE(p_json, '$.BillToCustomerNumber'),
            JSON_VALUE(p_json, '$.BillToCustomerName'),
            JSON_VALUE(p_json, '$.BillToSite'),
            JSON_VALUE(p_json, '$.ShipToCustomerName'),
            JSON_VALUE(p_json, '$.ShipToSite'),
            JSON_VALUE(p_json, '$.PayingCustomerName'),
            JSON_VALUE(p_json, '$.PayingCustomerAccount'),
            JSON_VALUE(p_json, '$.BusinessUnit'),
            JSON_VALUE(p_json, '$.PaymentTerms'),
            JSON_VALUE(p_json, '$.PurchaseOrder'),
            l_po_date,
            JSON_VALUE(p_json, '$.SpecialInstructions'),
            JSON_VALUE(p_json, '$.Comments'),
            JSON_VALUE(p_json, '$.InvoicingRule'),
            JSON_VALUE(p_json, '$.CreatedBy'),
            l_cr_ts,
            JSON_VALUE(p_json, '$.LastUpdatedBy'),
            l_upd_ts,
            'NEW'
        );
    END upsert_header;

    PROCEDURE save_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_txn_num  VARCHAR2(150) := JSON_VALUE(p_invoice_json, '$.TransactionNumber');
    BEGIN
        upsert_header(p_invoice_json);
        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Invoice updated: ' || l_txn_num;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_invoice;

    PROCEDURE save_invoices_bulk (
        p_invoices_json IN  CLOB,
        p_inserted      OUT NUMBER,
        p_updated       OUT NUMBER,
        p_errors        OUT NUMBER,
        p_error_msgs    OUT VARCHAR2
    ) IS
        l_count     NUMBER;
        l_item_clob CLOB;
        l_txn_id    NUMBER;
        l_err_msg   VARCHAR2(4000);
        l_error_log VARCHAR2(32767) := '';
    BEGIN
        p_inserted := 0; p_updated := 0; p_errors := 0;
        SELECT COUNT(*) INTO l_count
        FROM JSON_TABLE(p_invoices_json, '$.items[*]' COLUMNS (dummy NUMBER PATH '$.CustomerTransactionId')) j;
        FOR i IN 0 .. l_count - 1 LOOP
            BEGIN
                EXECUTE IMMEDIATE
                    'SELECT JSON_QUERY(:1, ''$.items[' || TO_CHAR(i) || ']'' RETURNING CLOB) FROM DUAL'
                INTO l_item_clob USING p_invoices_json;
                l_txn_id := JSON_VALUE(l_item_clob, '$.CustomerTransactionId' RETURNING NUMBER);
                upsert_header(l_item_clob);
                p_inserted := p_inserted + 1;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                l_err_msg := SUBSTR(SQLERRM, 1, 300);
                IF p_errors <= 3 THEN
                    l_error_log := l_error_log || ' | [' || p_errors || '] TxnId=' || NVL(TO_CHAR(l_txn_id),'?') || ': ' || l_err_msg;
                END IF;
            END;
        END LOOP;
        COMMIT;
        p_error_msgs := l_error_log;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK; p_errors := p_errors + 1; p_error_msgs := SQLERRM;
    END save_invoices_bulk;

    PROCEDURE upsert_one_line (p_transaction_id IN NUMBER, p_json IN CLOB) IS
        l_line_id NUMBER := JSON_VALUE(p_json, '$.CustomerTransactionLineId' RETURNING NUMBER);
        l_eff_id  NUMBER;
    BEGIN
        l_eff_id := NVL(l_line_id, RR_AR_INVOICE_LINES_S.NEXTVAL);
        MERGE INTO RR_AR_INVOICE_LINES ln
        USING DUAL ON (ln.CUSTOMER_TRANSACTION_LINE_ID = l_eff_id)
        WHEN MATCHED THEN UPDATE SET
            LINE_NUMBER            = JSON_VALUE(p_json, '$.LineNumber'          RETURNING NUMBER),
            DESCRIPTION            = JSON_VALUE(p_json, '$.Description'),
            UNIT_OF_MEASURE        = JSON_VALUE(p_json, '$.UnitOfMeasure'),
            MEMO_LINE              = JSON_VALUE(p_json, '$.MemoLine'),
            QUANTITY               = JSON_VALUE(p_json, '$.Quantity'            RETURNING NUMBER),
            UNIT_SELLING_PRICE     = JSON_VALUE(p_json, '$.UnitSellingPrice'    RETURNING NUMBER),
            LINE_AMOUNT            = JSON_VALUE(p_json, '$.LineAmount'          RETURNING NUMBER),
            TAX_CLASSIFICATION_CODE = JSON_VALUE(p_json, '$.TaxClassificationCode'),
            LAST_UPDATED_BY        = USER,
            LAST_UPDATE_DATE       = SYSTIMESTAMP,
            SYNC_STATUS            = 'UPDATED'
        WHEN NOT MATCHED THEN INSERT (
            CUSTOMER_TRANSACTION_LINE_ID, CUSTOMER_TRANSACTION_ID,
            LINE_NUMBER,   DESCRIPTION,   ITEM_NUMBER,     UNIT_OF_MEASURE,
            MEMO_LINE,     QUANTITY,      UNIT_SELLING_PRICE, LINE_AMOUNT,
            TAX_CLASSIFICATION_CODE, TRANSACTION_BUSINESS_CATEGORY,
            SYNC_STATUS,   LAST_UPDATED_BY, LAST_UPDATE_DATE, SYNC_DATE
        ) VALUES (
            l_eff_id, p_transaction_id,
            JSON_VALUE(p_json, '$.LineNumber'          RETURNING NUMBER),
            JSON_VALUE(p_json, '$.Description'),
            JSON_VALUE(p_json, '$.ItemNumber'),
            JSON_VALUE(p_json, '$.UnitOfMeasure'),
            JSON_VALUE(p_json, '$.MemoLine'),
            JSON_VALUE(p_json, '$.Quantity'            RETURNING NUMBER),
            JSON_VALUE(p_json, '$.UnitSellingPrice'    RETURNING NUMBER),
            NVL(JSON_VALUE(p_json, '$.LineAmount'      RETURNING NUMBER),
                NVL(JSON_VALUE(p_json, '$.Quantity'    RETURNING NUMBER), 0) *
                NVL(JSON_VALUE(p_json, '$.UnitSellingPrice' RETURNING NUMBER), 0)),
            JSON_VALUE(p_json, '$.TaxClassificationCode'),
            JSON_VALUE(p_json, '$.TransactionBusinessCategory'),
            'NEW', USER, SYSTIMESTAMP, SYSTIMESTAMP
        );
    END upsert_one_line;

    PROCEDURE save_invoice_lines (
        p_transaction_id  IN  NUMBER,
        p_lines_json      IN  CLOB,
        p_inserted        OUT NUMBER,
        p_updated         OUT NUMBER,
        p_errors          OUT NUMBER,
        p_error_msgs      OUT VARCHAR2
    ) IS
        l_err_log VARCHAR2(4000) := '';
    BEGIN
        p_inserted := 0; p_updated := 0; p_errors := 0;
        FOR rec IN (
            SELECT j.item_clob
            FROM JSON_TABLE(p_lines_json, '$.items[*]' COLUMNS (item_clob CLOB FORMAT JSON PATH '$')) j
        ) LOOP
            BEGIN
                upsert_one_line(p_transaction_id, rec.item_clob);
                p_inserted := p_inserted + 1;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF p_errors <= 3 THEN l_err_log := l_err_log || ' | ' || SUBSTR(SQLERRM, 1, 200); END IF;
            END;
        END LOOP;
        COMMIT;
        p_error_msgs := l_err_log;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK; p_errors := p_errors + 1; p_error_msgs := SQLERRM;
    END save_invoice_lines;

    PROCEDURE save_invoice_installments (
        p_transaction_id     IN  NUMBER,
        p_installments_json  IN  CLOB,
        p_status             OUT VARCHAR2,
        p_message            OUT VARCHAR2
    ) IS
        l_inserted  NUMBER := 0;
        l_errors    NUMBER := 0;
        l_err_log   VARCHAR2(4000) := '';
        l_due_date  DATE;
        l_cls_date  DATE;
        l_gl_date   DATE;
        l_dsp_date  DATE;
        l_cr_ts     TIMESTAMP;
        l_upd_ts    TIMESTAMP;
        l_inst_id   NUMBER;
    BEGIN
        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_installments_json, '$.items[*]' COLUMNS (
                INSTALLMENT_ID                      NUMBER        PATH '$.InstallmentId',
                INSTALLMENT_SEQUENCE_NUMBER         NUMBER        PATH '$.InstallmentSequenceNumber',
                INSTALLMENT_STATUS                  VARCHAR2(30)  PATH '$.InstallmentStatus',
                INSTALLMENT_DUE_DATE_STR            VARCHAR2(50)  PATH '$.InstallmentDueDate',
                INSTALLMENT_CLOSED_DATE_STR         VARCHAR2(50)  PATH '$.InstallmentClosedDate',
                INSTALLMENT_GL_CLOSED_DATE_STR      VARCHAR2(50)  PATH '$.InstallmentGLClosedDate',
                DISPUTE_DATE_STR                    VARCHAR2(50)  PATH '$.DisputeDate',
                ORIGINAL_AMOUNT                     NUMBER        PATH '$.OriginalAmount',
                INSTALLMENT_LINE_AMOUNT_ORIGINAL    NUMBER        PATH '$.InstallmentLineAmountOriginal',
                INSTALLMENT_FREIGHT_AMT_ORIGINAL    NUMBER        PATH '$.InstallmentFreightAmountOriginal',
                INSTALLMENT_TAX_AMOUNT_ORIGINAL     NUMBER        PATH '$.InstallmentTaxAmountOriginal',
                INSTALLMENT_BALANCE_DUE             NUMBER        PATH '$.InstallmentBalanceDue',
                ACCOUNTED_BALANCE_DUE               NUMBER        PATH '$.AccountedBalanceDue',
                INSTALLMENT_LINE_AMOUNT_DUE         NUMBER        PATH '$.InstallmentLineAmountDue',
                INSTALLMENT_FREIGHT_AMT_DUE         NUMBER        PATH '$.InstallmentFreightAmountDue',
                INSTALLMENT_TAX_AMOUNT_DUE          NUMBER        PATH '$.InstallmentTaxAmountDue',
                AMOUNT_PAID                         NUMBER        PATH '$.AmountPaid',
                INSTALLMENT_AMOUNT_ADJUSTED         NUMBER        PATH '$.InstallmentAmountAdjusted',
                INSTALLMENT_AMOUNT_CREDITED         NUMBER        PATH '$.InstallmentAmountCredited',
                PENDING_ADJUSTMENT_AMOUNT           NUMBER        PATH '$.PendingAdjustmentAmount',
                DISPUTE_AMOUNT                      NUMBER        PATH '$.DisputeAmount',
                PAYMENT_DAYS_LATE                   NUMBER        PATH '$.PaymentDaysLate',
                EXCLUDE_FROM_COLLECTIONS            VARCHAR2(10)  PATH '$.ExcludeFromCollections',
                FUSION_CREATED_BY                   VARCHAR2(240) PATH '$.CreatedBy',
                CREATION_DATE_STR                   VARCHAR2(50)  PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY              VARCHAR2(240) PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR                VARCHAR2(50)  PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            BEGIN
                l_due_date := to_safe_date(rec.INSTALLMENT_DUE_DATE_STR);
                l_cls_date := to_safe_date(rec.INSTALLMENT_CLOSED_DATE_STR);
                l_gl_date  := to_safe_date(rec.INSTALLMENT_GL_CLOSED_DATE_STR);
                l_dsp_date := to_safe_date(rec.DISPUTE_DATE_STR);
                l_cr_ts    := to_safe_ts(rec.CREATION_DATE_STR);
                l_upd_ts   := to_safe_ts(rec.LAST_UPDATE_DATE_STR);
                l_inst_id  := NVL(rec.INSTALLMENT_ID, RR_AR_INVOICE_INSTALLMENTS_S.NEXTVAL);
                MERGE INTO RR_AR_INVOICE_INSTALLMENTS ins
                USING DUAL ON (ins.INSTALLMENT_ID = l_inst_id)
                WHEN MATCHED THEN UPDATE SET
                    INSTALLMENT_SEQUENCE_NUMBER         = rec.INSTALLMENT_SEQUENCE_NUMBER,
                    INSTALLMENT_STATUS                  = rec.INSTALLMENT_STATUS,
                    INSTALLMENT_DUE_DATE                = l_due_date,
                    INSTALLMENT_CLOSED_DATE             = l_cls_date,
                    INSTALLMENT_GL_CLOSED_DATE          = l_gl_date,
                    DISPUTE_DATE                        = l_dsp_date,
                    ORIGINAL_AMOUNT                     = rec.ORIGINAL_AMOUNT,
                    INSTALLMENT_LINE_AMOUNT_ORIGINAL    = rec.INSTALLMENT_LINE_AMOUNT_ORIGINAL,
                    INSTALLMENT_FREIGHT_AMOUNT_ORIGINAL = rec.INSTALLMENT_FREIGHT_AMT_ORIGINAL,
                    INSTALLMENT_TAX_AMOUNT_ORIGINAL     = rec.INSTALLMENT_TAX_AMOUNT_ORIGINAL,
                    INSTALLMENT_BALANCE_DUE             = rec.INSTALLMENT_BALANCE_DUE,
                    ACCOUNTED_BALANCE_DUE               = rec.ACCOUNTED_BALANCE_DUE,
                    INSTALLMENT_LINE_AMOUNT_DUE         = rec.INSTALLMENT_LINE_AMOUNT_DUE,
                    INSTALLMENT_FREIGHT_AMOUNT_DUE      = rec.INSTALLMENT_FREIGHT_AMT_DUE,
                    INSTALLMENT_TAX_AMOUNT_DUE          = rec.INSTALLMENT_TAX_AMOUNT_DUE,
                    AMOUNT_PAID                         = rec.AMOUNT_PAID,
                    LAST_UPDATED_BY                     = USER,
                    LAST_UPDATE_DATE                    = SYSTIMESTAMP,
                    SYNC_DATE                           = SYSTIMESTAMP,
                    SYNC_STATUS                         = 'UPDATED'
                WHEN NOT MATCHED THEN INSERT (
                    INSTALLMENT_ID,                     CUSTOMER_TRANSACTION_ID,
                    INSTALLMENT_SEQUENCE_NUMBER,        INSTALLMENT_STATUS,
                    INSTALLMENT_DUE_DATE,               INSTALLMENT_CLOSED_DATE,
                    INSTALLMENT_GL_CLOSED_DATE,         DISPUTE_DATE,
                    ORIGINAL_AMOUNT,                    INSTALLMENT_LINE_AMOUNT_ORIGINAL,
                    INSTALLMENT_FREIGHT_AMOUNT_ORIGINAL, INSTALLMENT_TAX_AMOUNT_ORIGINAL,
                    INSTALLMENT_BALANCE_DUE,            ACCOUNTED_BALANCE_DUE,
                    INSTALLMENT_LINE_AMOUNT_DUE,        INSTALLMENT_FREIGHT_AMOUNT_DUE,
                    INSTALLMENT_TAX_AMOUNT_DUE,         AMOUNT_PAID,
                    INSTALLMENT_AMOUNT_ADJUSTED,        INSTALLMENT_AMOUNT_CREDITED,
                    PENDING_ADJUSTMENT_AMOUNT,          DISPUTE_AMOUNT,
                    PAYMENT_DAYS_LATE,                  EXCLUDE_FROM_COLLECTIONS,
                    FUSION_CREATED_BY,                  FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY,             FUSION_LAST_UPDATE_DATE,
                    SYNC_STATUS
                ) VALUES (
                    l_inst_id,                          p_transaction_id,
                    rec.INSTALLMENT_SEQUENCE_NUMBER,    rec.INSTALLMENT_STATUS,
                    l_due_date,                         l_cls_date,
                    l_gl_date,                          l_dsp_date,
                    rec.ORIGINAL_AMOUNT,                rec.INSTALLMENT_LINE_AMOUNT_ORIGINAL,
                    rec.INSTALLMENT_FREIGHT_AMT_ORIGINAL, rec.INSTALLMENT_TAX_AMOUNT_ORIGINAL,
                    rec.INSTALLMENT_BALANCE_DUE,        rec.ACCOUNTED_BALANCE_DUE,
                    rec.INSTALLMENT_LINE_AMOUNT_DUE,    rec.INSTALLMENT_FREIGHT_AMT_DUE,
                    rec.INSTALLMENT_TAX_AMOUNT_DUE,     rec.AMOUNT_PAID,
                    rec.INSTALLMENT_AMOUNT_ADJUSTED,    rec.INSTALLMENT_AMOUNT_CREDITED,
                    rec.PENDING_ADJUSTMENT_AMOUNT,      rec.DISPUTE_AMOUNT,
                    rec.PAYMENT_DAYS_LATE,              rec.EXCLUDE_FROM_COLLECTIONS,
                    rec.FUSION_CREATED_BY,              l_cr_ts,
                    rec.FUSION_LAST_UPDATED_BY,         l_upd_ts,
                    'NEW'
                );
                l_inserted := l_inserted + 1;
            EXCEPTION WHEN OTHERS THEN
                l_errors := l_errors + 1;
                IF l_errors <= 3 THEN l_err_log := l_err_log || ' | ' || SUBSTR(SQLERRM, 1, 200); END IF;
            END;
        END LOOP;
        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Installments saved: ' || l_inserted || ', Errors: ' || l_errors ||
                     CASE WHEN l_err_log IS NOT NULL THEN ' -- ' || l_err_log ELSE '' END;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK; p_status := 'ERROR'; p_message := SQLERRM;
    END save_invoice_installments;

    PROCEDURE save_invoice_distributions (
        p_transaction_id       IN  NUMBER,
        p_distributions_json   IN  CLOB,
        p_inserted             OUT NUMBER,
        p_updated              OUT NUMBER,
        p_errors               OUT NUMBER,
        p_error_msgs           OUT VARCHAR2
    ) IS
    BEGIN
        p_inserted := 0; p_updated := 0; p_errors := 0; p_error_msgs := NULL;
    END save_invoice_distributions;

END RR_AR_INVOICES_PKG;
/

-- 5. ORDS POST /ar/invoices  (CREATE — returns customerTransactionId)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create new AR invoice, returns customerTransactionId',
        p_source         => '
DECLARE
    l_trx_id  NUMBER;
    l_trx_num VARCHAR2(150);
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICES_PKG.create_invoice(
        p_invoice_json        => :body_text,
        p_customer_trx_id     => l_trx_id,
        p_transaction_number  => l_trx_num,
        p_status              => l_status,
        p_message             => l_message
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"'' || l_status ||
          ''","customerTransactionId":'' || NVL(TO_CHAR(l_trx_id), ''null'') ||
          '',"transactionNumber":"'' || NVL(REPLACE(l_trx_num,''"'',''\\"''), '''') ||
          ''","message":"'' || REPLACE(NVL(l_message,''''),''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- 6. ORDS PUT /ar/invoices/:id  (UPDATE existing)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update existing AR invoice header',
        p_source         => '
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICES_PKG.save_invoice(
        p_invoice_json => :body_text,
        p_status       => l_status,
        p_message      => l_message
    );
    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 200 ELSE 400 END;
    HTP.P(''{"status":"'' || l_status || ''","message":"'' ||
          REPLACE(NVL(l_message,''''),''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/
