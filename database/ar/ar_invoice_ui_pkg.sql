-- =====================================================
-- RR_AR_INVOICE_UI_PKG
-- UI-driven create / update of AR invoices.
-- Completely separate from RR_AR_INVOICES_PKG which
-- is reserved for bulk sync from Oracle Fusion.
--
-- ORDS endpoints wired here:
--   POST   /ar/invoicesUI                     → create_invoice
--   GET    /ar/invoicesUI/:id                → get invoice + lines + installments
--   PUT    /ar/invoicesUI/:id               → update_invoice
--   PUT    /ar/invoicesUI/:id/lines         → save_lines  (full replace)
--   DELETE /ar/invoicesUI/:id/lines/:line_id → delete_line
--
-- Sequences (created by ar_invoices_create_patch.sql):
--   RR_AR_INVOICE_HEADERS_S
--   RR_AR_INVOICE_LINES_S
--   RR_AR_INVOICE_INSTALLMENTS_S
-- =====================================================


-- =====================================================
-- PACKAGE SPEC
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AR_INVOICE_UI_PKG AS

    -- Create a brand-new invoice; IDs come from sequences
    PROCEDURE create_invoice (
        p_invoice_json        IN  CLOB,
        p_customer_trx_id     OUT NUMBER,
        p_transaction_number  OUT VARCHAR2,
        p_status              OUT VARCHAR2,
        p_message             OUT VARCHAR2
    );

    -- Update header fields for an existing invoice
    PROCEDURE update_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

    -- Replace all lines for a transaction (DELETE + INSERT), then recalc header totals
    PROCEDURE save_lines (
        p_transaction_id  IN  NUMBER,
        p_lines_json      IN  CLOB,   -- {"items":[{...},...]}
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    );

    -- Hard-delete a single line then recalc header totals
    PROCEDURE delete_line (
        p_transaction_id  IN  NUMBER,
        p_line_id         IN  NUMBER,
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    );

    -- Replace all installments for a transaction (DELETE + INSERT).
    -- Validates that sum of amounts equals the invoice ENTERED_AMOUNT.
    -- JSON shape: {"items":[{"DueDate":"YYYY-MM-DD","Amount":nnn,"SequenceNumber":n},...]}
    PROCEDURE save_installments (
        p_transaction_id     IN  NUMBER,
        p_installments_json  IN  CLOB,
        p_status             OUT VARCHAR2,
        p_message            OUT VARCHAR2
    );

END RR_AR_INVOICE_UI_PKG;
/


-- =====================================================
-- PACKAGE BODY
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AR_INVOICE_UI_PKG AS

    -- ── helpers ──────────────────────────────────────
    FUNCTION to_date_safe (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_date_safe;

    -- Recalculate ENTERED_AMOUNT on the header and keep the single
    -- installment (seq 1) in sync.  Called after every line change.
    PROCEDURE recalc_totals (p_transaction_id IN NUMBER) IS
        l_total  NUMBER := 0;
    BEGIN
        SELECT NVL(SUM(NVL(LINE_AMOUNT, 0)), 0)
        INTO   l_total
        FROM   RR_AR_INVOICE_LINES
        WHERE  CUSTOMER_TRANSACTION_ID = p_transaction_id;

        UPDATE RR_AR_INVOICE_HEADERS
        SET    ENTERED_AMOUNT        = l_total,
               INVOICE_BALANCE_AMOUNT = l_total,
               LAST_UPDATED_BY       = USER,
               LAST_UPDATE_DATE      = SYSTIMESTAMP
        WHERE  CUSTOMER_TRANSACTION_ID = p_transaction_id;

        -- Keep the primary installment (seq 1) in sync
        UPDATE RR_AR_INVOICE_INSTALLMENTS
        SET    ORIGINAL_AMOUNT              = l_total,
               INSTALLMENT_BALANCE_DUE      = l_total,
               ACCOUNTED_BALANCE_DUE        = l_total,
               INSTALLMENT_LINE_AMOUNT_ORIGINAL = l_total,
               LAST_UPDATED_BY             = USER,
               LAST_UPDATE_DATE            = SYSTIMESTAMP
        WHERE  CUSTOMER_TRANSACTION_ID     = p_transaction_id
          AND  INSTALLMENT_SEQUENCE_NUMBER = 1;
    END recalc_totals;


    -- ── create_invoice ────────────────────────────────
    -- Generates CUSTOMER_TRANSACTION_ID and line IDs from sequences.
    -- Auto-creates a single installment (seq 1, full amount, status Open).
    PROCEDURE create_invoice (
        p_invoice_json        IN  CLOB,
        p_customer_trx_id     OUT NUMBER,
        p_transaction_number  OUT VARCHAR2,
        p_status              OUT VARCHAR2,
        p_message             OUT VARCHAR2
    ) IS
        l_txn_id     NUMBER;
        l_txn_num    VARCHAR2(150);
        l_total_amt  NUMBER := 0;
        l_line_count NUMBER := 0;
        l_inst_id    NUMBER;
        l_txn_date   DATE;
        l_acct_date  DATE;
        l_conv_date  DATE;
    BEGIN
        -- Validate required fields
        IF JSON_VALUE(p_invoice_json, '$.BusinessUnit') IS NULL THEN
            p_status  := 'ERROR'; p_message := 'BusinessUnit is required'; RETURN;
        END IF;
        IF JSON_VALUE(p_invoice_json, '$.BillToCustomerName') IS NULL
           AND JSON_VALUE(p_invoice_json, '$.BillToCustomerNumber') IS NULL THEN
            p_status  := 'ERROR'; p_message := 'BillToCustomer is required'; RETURN;
        END IF;

        -- Generate header ID
        l_txn_id := RR_AR_INVOICE_HEADERS_S.NEXTVAL;

        -- Transaction number: use provided or auto-generate
        l_txn_num := TRIM(JSON_VALUE(p_invoice_json, '$.TransactionNumber'));
        IF l_txn_num IS NULL OR l_txn_num = '' THEN
            l_txn_num := 'AR-INV-' || TO_CHAR(l_txn_id);
        END IF;

        l_txn_date  := to_date_safe(JSON_VALUE(p_invoice_json, '$.TransactionDate'));
        l_acct_date := to_date_safe(JSON_VALUE(p_invoice_json, '$.AccountingDate'));
        l_conv_date := to_date_safe(JSON_VALUE(p_invoice_json, '$.ConversionDate'));

        -- Sum line amounts to derive total
        SELECT NVL(SUM(
                   NVL(JSON_VALUE(j.line_clob, '$.LineAmount'       RETURNING NUMBER),
                       NVL(JSON_VALUE(j.line_clob, '$.Quantity'     RETURNING NUMBER), 0) *
                       NVL(JSON_VALUE(j.line_clob, '$.UnitSellingPrice' RETURNING NUMBER), 0))
               ), 0)
        INTO l_total_amt
        FROM JSON_TABLE(p_invoice_json, '$.lines[*]'
             COLUMNS (line_clob CLOB FORMAT JSON PATH '$')) j;

        -- Override total if caller supplied EnteredAmount explicitly
        l_total_amt := NVL(JSON_VALUE(p_invoice_json, '$.EnteredAmount' RETURNING NUMBER), l_total_amt);

        -- Insert header
        INSERT INTO RR_AR_INVOICE_HEADERS (
            CUSTOMER_TRANSACTION_ID,  TRANSACTION_NUMBER,      TRANSACTION_CLASS,
            TRANSACTION_TYPE,         TRANSACTION_SOURCE,      TRANSACTION_DATE,
            ACCOUNTING_DATE,          INVOICE_STATUS,          INVOICE_CURRENCY_CODE,
            CONVERSION_RATE_TYPE,     CONVERSION_DATE,         CONVERSION_RATE,
            ENTERED_AMOUNT,           INVOICE_BALANCE_AMOUNT,
            BILL_TO_CUSTOMER_NUMBER,  BILL_TO_CUSTOMER_NAME,   BILL_TO_SITE,
            BILL_TO_CONTACT,          SHIP_TO_CUSTOMER_NAME,   SHIP_TO_SITE,
            SHIP_TO_CONTACT,          PAYING_CUSTOMER_NAME,    PAYING_CUSTOMER_SITE,
            PAYING_CUSTOMER_ACCOUNT,  BUSINESS_UNIT,           LEGAL_ENTITY_IDENTIFIER,
            PAYMENT_TERMS,            RECEIPT_METHOD,          PURCHASE_ORDER,
            SPECIAL_INSTRUCTIONS,     COMMENTS,                INTERNAL_NOTES,
            INVOICING_RULE,           CROSS_REFERENCE,         REMIT_TO_ADDRESS,
            SYNC_STATUS,              LAST_UPDATED_BY,         LAST_UPDATE_DATE,
            SYNC_DATE
        ) VALUES (
            l_txn_id,  l_txn_num,
            NVL(JSON_VALUE(p_invoice_json, '$.TransactionClass'), 'Invoice'),
            JSON_VALUE(p_invoice_json, '$.TransactionType'),
            JSON_VALUE(p_invoice_json, '$.TransactionSource'),
            NVL(l_txn_date, TRUNC(SYSDATE)),
            NVL(l_acct_date, TRUNC(SYSDATE)),
            'Incomplete',
            NVL(JSON_VALUE(p_invoice_json, '$.InvoiceCurrencyCode'), 'AED'),
            JSON_VALUE(p_invoice_json, '$.ConversionType'),
            l_conv_date,
            JSON_VALUE(p_invoice_json, '$.ConversionRate' RETURNING NUMBER),
            l_total_amt,  l_total_amt,
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
            JSON_VALUE(p_invoice_json, '$.ReceiptMethod'),
            JSON_VALUE(p_invoice_json, '$.PurchaseOrder'),
            JSON_VALUE(p_invoice_json, '$.SpecialInstructions'),
            JSON_VALUE(p_invoice_json, '$.Comments'),
            JSON_VALUE(p_invoice_json, '$.InternalNotes'),
            JSON_VALUE(p_invoice_json, '$.InvoicingRule'),
            JSON_VALUE(p_invoice_json, '$.CrossReference'),
            JSON_VALUE(p_invoice_json, '$.RemitToAddress'),
            'UI_CREATED',  USER,  SYSTIMESTAMP,  SYSTIMESTAMP
        );

        -- Insert lines
        FOR rec IN (
            SELECT j.line_clob
            FROM JSON_TABLE(p_invoice_json, '$.lines[*]'
                 COLUMNS (line_clob CLOB FORMAT JSON PATH '$')) j
        ) LOOP
            l_line_count := l_line_count + 1;
            INSERT INTO RR_AR_INVOICE_LINES (
                CUSTOMER_TRANSACTION_LINE_ID,  CUSTOMER_TRANSACTION_ID,
                LINE_NUMBER,                   DESCRIPTION,
                ITEM_NUMBER,                   UNIT_OF_MEASURE,
                MEMO_LINE,                     QUANTITY,
                UNIT_SELLING_PRICE,            LINE_AMOUNT,
                TAX_CLASSIFICATION_CODE,       TRANSACTION_BUSINESS_CATEGORY,
                SYNC_STATUS,                   LAST_UPDATED_BY,
                LAST_UPDATE_DATE,              SYNC_DATE
            ) VALUES (
                RR_AR_INVOICE_LINES_S.NEXTVAL,  l_txn_id,
                NVL(JSON_VALUE(rec.line_clob, '$.LineNumber'          RETURNING NUMBER), l_line_count),
                JSON_VALUE(rec.line_clob, '$.Description'),
                JSON_VALUE(rec.line_clob, '$.ItemNumber'),
                JSON_VALUE(rec.line_clob, '$.UnitOfMeasure'),
                JSON_VALUE(rec.line_clob, '$.MemoLine'),
                JSON_VALUE(rec.line_clob, '$.Quantity'                RETURNING NUMBER),
                JSON_VALUE(rec.line_clob, '$.UnitSellingPrice'        RETURNING NUMBER),
                NVL(JSON_VALUE(rec.line_clob, '$.LineAmount'          RETURNING NUMBER),
                    NVL(JSON_VALUE(rec.line_clob, '$.Quantity'        RETURNING NUMBER), 0) *
                    NVL(JSON_VALUE(rec.line_clob, '$.UnitSellingPrice' RETURNING NUMBER), 0)),
                JSON_VALUE(rec.line_clob, '$.TaxClassificationCode'),
                JSON_VALUE(rec.line_clob, '$.TransactionBusinessCategory'),
                'UI_CREATED',  USER,  SYSTIMESTAMP,  SYSTIMESTAMP
            );
        END LOOP;

        -- Auto installment: seq 1, full amount, due = txn date
        l_inst_id := RR_AR_INVOICE_INSTALLMENTS_S.NEXTVAL;
        INSERT INTO RR_AR_INVOICE_INSTALLMENTS (
            INSTALLMENT_ID,                    CUSTOMER_TRANSACTION_ID,
            INSTALLMENT_SEQUENCE_NUMBER,       INSTALLMENT_STATUS,
            INSTALLMENT_DUE_DATE,              ORIGINAL_AMOUNT,
            INSTALLMENT_BALANCE_DUE,           ACCOUNTED_BALANCE_DUE,
            INSTALLMENT_LINE_AMOUNT_ORIGINAL,  SYNC_STATUS,
            LAST_UPDATED_BY,                   LAST_UPDATE_DATE,  SYNC_DATE
        ) VALUES (
            l_inst_id,          l_txn_id,
            1,                  'Open',
            NVL(l_txn_date, TRUNC(SYSDATE)),
            l_total_amt,        l_total_amt,
            l_total_amt,        l_total_amt,
            'UI_CREATED',       USER,  SYSTIMESTAMP,  SYSTIMESTAMP
        );

        COMMIT;
        p_customer_trx_id    := l_txn_id;
        p_transaction_number := l_txn_num;
        p_status             := 'SUCCESS';
        p_message            := 'Invoice created: ' || l_txn_num || ' — Lines: ' || l_line_count;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_customer_trx_id    := NULL;
            p_transaction_number := NULL;
            p_status             := 'ERROR';
            p_message            := SQLERRM;
    END create_invoice;


    -- ── update_invoice ────────────────────────────────
    -- Updates header fields only; does NOT touch lines or installments.
    -- Use save_lines to replace lines separately.
    PROCEDURE update_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_txn_id    NUMBER;
        l_txn_num   VARCHAR2(150);
        l_txn_date  DATE;
        l_acct_date DATE;
        l_conv_date DATE;
        l_po_date   DATE;
        l_rows      NUMBER;
    BEGIN
        l_txn_id    := JSON_VALUE(p_invoice_json, '$.CustomerTransactionId' RETURNING NUMBER);
        l_txn_num   := JSON_VALUE(p_invoice_json, '$.TransactionNumber');
        l_txn_date  := to_date_safe(JSON_VALUE(p_invoice_json, '$.TransactionDate'));
        l_acct_date := to_date_safe(JSON_VALUE(p_invoice_json, '$.AccountingDate'));
        l_conv_date := to_date_safe(JSON_VALUE(p_invoice_json, '$.ConversionDate'));
        l_po_date   := to_date_safe(JSON_VALUE(p_invoice_json, '$.PurchaseOrderDate'));

        IF l_txn_id IS NULL THEN
            p_status := 'ERROR'; p_message := 'CustomerTransactionId is required for update'; RETURN;
        END IF;

        UPDATE RR_AR_INVOICE_HEADERS SET
            TRANSACTION_NUMBER      = NVL(l_txn_num,   TRANSACTION_NUMBER),
            TRANSACTION_CLASS       = NVL(JSON_VALUE(p_invoice_json, '$.TransactionClass'),   TRANSACTION_CLASS),
            TRANSACTION_TYPE        = NVL(JSON_VALUE(p_invoice_json, '$.TransactionType'),    TRANSACTION_TYPE),
            TRANSACTION_SOURCE      = NVL(JSON_VALUE(p_invoice_json, '$.TransactionSource'),  TRANSACTION_SOURCE),
            TRANSACTION_DATE        = NVL(l_txn_date,  TRANSACTION_DATE),
            ACCOUNTING_DATE         = NVL(l_acct_date, ACCOUNTING_DATE),
            INVOICE_CURRENCY_CODE   = NVL(JSON_VALUE(p_invoice_json, '$.InvoiceCurrencyCode'), INVOICE_CURRENCY_CODE),
            CONVERSION_RATE_TYPE    = JSON_VALUE(p_invoice_json, '$.ConversionType'),
            CONVERSION_DATE         = l_conv_date,
            CONVERSION_RATE         = JSON_VALUE(p_invoice_json, '$.ConversionRate'   RETURNING NUMBER),
            BILL_TO_CUSTOMER_NUMBER = NVL(JSON_VALUE(p_invoice_json, '$.BillToCustomerNumber'), BILL_TO_CUSTOMER_NUMBER),
            BILL_TO_CUSTOMER_NAME   = NVL(JSON_VALUE(p_invoice_json, '$.BillToCustomerName'),   BILL_TO_CUSTOMER_NAME),
            BILL_TO_SITE            = JSON_VALUE(p_invoice_json, '$.BillToSite'),
            BILL_TO_CONTACT         = JSON_VALUE(p_invoice_json, '$.BillToContact'),
            SHIP_TO_CUSTOMER_NAME   = JSON_VALUE(p_invoice_json, '$.ShipToCustomerName'),
            SHIP_TO_SITE            = JSON_VALUE(p_invoice_json, '$.ShipToSite'),
            SHIP_TO_CONTACT         = JSON_VALUE(p_invoice_json, '$.ShipToContact'),
            PAYING_CUSTOMER_NAME    = JSON_VALUE(p_invoice_json, '$.PayingCustomerName'),
            PAYING_CUSTOMER_SITE    = JSON_VALUE(p_invoice_json, '$.PayingCustomerSite'),
            PAYING_CUSTOMER_ACCOUNT = JSON_VALUE(p_invoice_json, '$.PayingCustomerAccount'),
            BUSINESS_UNIT           = NVL(JSON_VALUE(p_invoice_json, '$.BusinessUnit'), BUSINESS_UNIT),
            LEGAL_ENTITY_IDENTIFIER = JSON_VALUE(p_invoice_json, '$.LegalEntityIdentifier'),
            PAYMENT_TERMS           = JSON_VALUE(p_invoice_json, '$.PaymentTerms'),
            RECEIPT_METHOD          = JSON_VALUE(p_invoice_json, '$.ReceiptMethod'),
            PURCHASE_ORDER          = JSON_VALUE(p_invoice_json, '$.PurchaseOrder'),
            PURCHASE_ORDER_DATE     = l_po_date,
            SPECIAL_INSTRUCTIONS    = JSON_VALUE(p_invoice_json, '$.SpecialInstructions'),
            COMMENTS                = JSON_VALUE(p_invoice_json, '$.Comments'),
            INTERNAL_NOTES          = JSON_VALUE(p_invoice_json, '$.InternalNotes'),
            INVOICING_RULE          = JSON_VALUE(p_invoice_json, '$.InvoicingRule'),
            CROSS_REFERENCE         = JSON_VALUE(p_invoice_json, '$.CrossReference'),
            REMIT_TO_ADDRESS        = JSON_VALUE(p_invoice_json, '$.RemitToAddress'),
            SYNC_STATUS             = 'UI_UPDATED',
            LAST_UPDATED_BY         = USER,
            LAST_UPDATE_DATE        = SYSTIMESTAMP
        WHERE CUSTOMER_TRANSACTION_ID = l_txn_id;

        l_rows := SQL%ROWCOUNT;

        -- Also update the installment due date if txn date changed
        IF l_txn_date IS NOT NULL THEN
            UPDATE RR_AR_INVOICE_INSTALLMENTS
            SET    INSTALLMENT_DUE_DATE  = l_txn_date,
                   LAST_UPDATED_BY       = USER,
                   LAST_UPDATE_DATE      = SYSTIMESTAMP
            WHERE  CUSTOMER_TRANSACTION_ID     = l_txn_id
              AND  INSTALLMENT_SEQUENCE_NUMBER = 1;
        END IF;

        COMMIT;
        IF l_rows = 0 THEN
            p_status  := 'ERROR';
            p_message := 'Invoice not found: ' || l_txn_id;
        ELSE
            p_status  := 'SUCCESS';
            p_message := 'Invoice updated: ' || NVL(l_txn_num, TO_CHAR(l_txn_id));
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END update_invoice;


    -- ── save_lines ────────────────────────────────────
    -- Full replace: delete all existing lines for the transaction,
    -- then insert the new set from JSON, then recalculate header totals.
    -- JSON shape: {"items":[{LineNumber,Description,Quantity,UnitSellingPrice,...},...]}
    PROCEDURE save_lines (
        p_transaction_id  IN  NUMBER,
        p_lines_json      IN  CLOB,
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    ) IS
        l_line_count  NUMBER := 0;
        l_line_num    NUMBER;
    BEGIN
        -- Wipe existing lines (UI operation: full replace)
        DELETE FROM RR_AR_INVOICE_LINES
        WHERE  CUSTOMER_TRANSACTION_ID = p_transaction_id;

        -- Insert new lines
        FOR rec IN (
            SELECT j.line_clob
            FROM JSON_TABLE(p_lines_json, '$.items[*]'
                 COLUMNS (line_clob CLOB FORMAT JSON PATH '$')) j
        ) LOOP
            l_line_count := l_line_count + 1;
            l_line_num   := NVL(JSON_VALUE(rec.line_clob, '$.LineNumber' RETURNING NUMBER), l_line_count);

            INSERT INTO RR_AR_INVOICE_LINES (
                CUSTOMER_TRANSACTION_LINE_ID,  CUSTOMER_TRANSACTION_ID,
                LINE_NUMBER,                   DESCRIPTION,
                ITEM_NUMBER,                   UNIT_OF_MEASURE,
                MEMO_LINE,                     QUANTITY,
                UNIT_SELLING_PRICE,            LINE_AMOUNT,
                TAX_CLASSIFICATION_CODE,       TRANSACTION_BUSINESS_CATEGORY,
                SALES_ORDER,                   ACCOUNTING_RULE,
                SYNC_STATUS,                   LAST_UPDATED_BY,
                LAST_UPDATE_DATE,              SYNC_DATE
            ) VALUES (
                RR_AR_INVOICE_LINES_S.NEXTVAL,  p_transaction_id,
                l_line_num,
                JSON_VALUE(rec.line_clob, '$.Description'),
                JSON_VALUE(rec.line_clob, '$.ItemNumber'),
                JSON_VALUE(rec.line_clob, '$.UnitOfMeasure'),
                JSON_VALUE(rec.line_clob, '$.MemoLine'),
                JSON_VALUE(rec.line_clob, '$.Quantity'           RETURNING NUMBER),
                JSON_VALUE(rec.line_clob, '$.UnitSellingPrice'   RETURNING NUMBER),
                NVL(JSON_VALUE(rec.line_clob, '$.LineAmount'     RETURNING NUMBER),
                    NVL(JSON_VALUE(rec.line_clob, '$.Quantity'   RETURNING NUMBER), 0) *
                    NVL(JSON_VALUE(rec.line_clob, '$.UnitSellingPrice' RETURNING NUMBER), 0)),
                JSON_VALUE(rec.line_clob, '$.TaxClassificationCode'),
                JSON_VALUE(rec.line_clob, '$.TransactionBusinessCategory'),
                JSON_VALUE(rec.line_clob, '$.SalesOrder'),
                JSON_VALUE(rec.line_clob, '$.AccountingRule'),
                'UI_UPDATED',  USER,  SYSTIMESTAMP,  SYSTIMESTAMP
            );
        END LOOP;

        -- Keep header totals and installment in sync
        recalc_totals(p_transaction_id);

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Lines replaced: ' || l_line_count;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_lines;


    -- ── delete_line ───────────────────────────────────
    -- Hard-delete a single line then recalc header totals.
    PROCEDURE delete_line (
        p_transaction_id  IN  NUMBER,
        p_line_id         IN  NUMBER,
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    ) IS
        l_rows NUMBER;
    BEGIN
        DELETE FROM RR_AR_INVOICE_LINES
        WHERE  CUSTOMER_TRANSACTION_LINE_ID = p_line_id
          AND  CUSTOMER_TRANSACTION_ID      = p_transaction_id;

        l_rows := SQL%ROWCOUNT;

        IF l_rows > 0 THEN
            recalc_totals(p_transaction_id);
        END IF;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := CASE WHEN l_rows > 0 THEN 'Line deleted' ELSE 'Line not found' END;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END delete_line;

    -- ── save_installments ─────────────────────────────
    -- Full replace: delete all installments for the transaction,
    -- insert the new split set, then validate total = ENTERED_AMOUNT.
    -- Rolls back and returns ERROR if totals do not match.
    PROCEDURE save_installments (
        p_transaction_id     IN  NUMBER,
        p_installments_json  IN  CLOB,
        p_status             OUT VARCHAR2,
        p_message            OUT VARCHAR2
    ) IS
        l_header_total  NUMBER;
        l_inst_total    NUMBER := 0;
        l_inst_count    NUMBER := 0;
        l_row_num       NUMBER := 0;
        l_seq           NUMBER;
        l_due_date      DATE;
        l_amount        NUMBER;
        l_inst_id       NUMBER;
    BEGIN
        -- Get the invoice total to validate against
        SELECT NVL(ENTERED_AMOUNT, 0)
        INTO   l_header_total
        FROM   RR_AR_INVOICE_HEADERS
        WHERE  CUSTOMER_TRANSACTION_ID = p_transaction_id;

        -- Pre-sum submitted installment amounts for validation
        SELECT NVL(SUM(NVL(JSON_VALUE(j.item_clob, '$.Amount' RETURNING NUMBER), 0)), 0),
               COUNT(*)
        INTO   l_inst_total, l_inst_count
        FROM   JSON_TABLE(p_installments_json, '$.items[*]'
               COLUMNS (item_clob CLOB FORMAT JSON PATH '$')) j;

        -- Validate: total must match invoice entered amount
        IF ABS(l_inst_total - l_header_total) > 0.01 THEN
            p_status  := 'ERROR';
            p_message := 'Installment total (' || TO_CHAR(l_inst_total) ||
                         ') does not match invoice total (' || TO_CHAR(l_header_total) || ')';
            RETURN;
        END IF;

        IF l_inst_count = 0 THEN
            p_status  := 'ERROR';
            p_message := 'At least one installment is required';
            RETURN;
        END IF;

        -- Wipe existing installments
        DELETE FROM RR_AR_INVOICE_INSTALLMENTS
        WHERE  CUSTOMER_TRANSACTION_ID = p_transaction_id;

        -- Insert new split installments
        FOR rec IN (
            SELECT j.item_clob
            FROM JSON_TABLE(p_installments_json, '$.items[*]'
                 COLUMNS (item_clob CLOB FORMAT JSON PATH '$')) j
        ) LOOP
            l_row_num  := l_row_num + 1;
            l_seq      := NVL(JSON_VALUE(rec.item_clob, '$.SequenceNumber' RETURNING NUMBER), l_row_num);
            l_due_date := to_date_safe(JSON_VALUE(rec.item_clob, '$.DueDate'));
            l_amount   := NVL(JSON_VALUE(rec.item_clob, '$.Amount' RETURNING NUMBER), 0);
            l_inst_id  := RR_AR_INVOICE_INSTALLMENTS_S.NEXTVAL;

            INSERT INTO RR_AR_INVOICE_INSTALLMENTS (
                INSTALLMENT_ID,                    CUSTOMER_TRANSACTION_ID,
                INSTALLMENT_SEQUENCE_NUMBER,       INSTALLMENT_STATUS,
                INSTALLMENT_DUE_DATE,              ORIGINAL_AMOUNT,
                INSTALLMENT_BALANCE_DUE,           ACCOUNTED_BALANCE_DUE,
                INSTALLMENT_LINE_AMOUNT_ORIGINAL,  SYNC_STATUS,
                LAST_UPDATED_BY,                   LAST_UPDATE_DATE,  SYNC_DATE
            ) VALUES (
                l_inst_id,   p_transaction_id,
                l_seq,       'Open',
                NVL(l_due_date, TRUNC(SYSDATE)),
                l_amount,    l_amount,   l_amount,   l_amount,
                'UI_UPDATED', USER,  SYSTIMESTAMP,  SYSTIMESTAMP
            );
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Installments saved: ' || l_inst_count || ', Total: ' || TO_CHAR(l_inst_total);
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_installments;

END RR_AR_INVOICE_UI_PKG;
/


-- =====================================================
-- ORDS HANDLERS
-- New UI-only endpoints under ar/invoicesUI.
-- Does NOT touch the existing ar/invoices (sync) endpoints.
-- =====================================================

-- Drop + recreate invoices template to ensure clean handlers
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoicesUI');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoicesUI',
        p_comments    => 'AR Invoices — UI create/update'
    );
    COMMIT;
END;
/

-- POST /ar/invoicesUI — create new invoice, returns customerTransactionId
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'UI: Create new AR invoice',
        p_source         => q'[
DECLARE
    l_trx_id  NUMBER;
    l_trx_num VARCHAR2(150);
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_UI_PKG.create_invoice(
        p_invoice_json        => :body_text,
        p_customer_trx_id     => l_trx_id,
        p_transaction_number  => l_trx_num,
        p_status              => l_status,
        p_message             => l_message
    );
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 201 ELSE 400 END;
    HTP.P('{"status":"' || l_status ||
          '","customerTransactionId":' || NVL(TO_CHAR(l_trx_id), 'null') ||
          ',"transactionNumber":"' || NVL(l_trx_num, '') ||
          '","message":"' || NVL(l_message, '') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- Drop + recreate invoicesUI/:id template
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoicesUI/:id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoicesUI/:id',
        p_comments    => 'AR Invoice by ID'
    );
    COMMIT;
END;
/

-- PUT /ar/invoicesUI/:id — update existing invoice header
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI/:id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'UI: Update AR invoice header',
        p_source         => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_UI_PKG.update_invoice(
        p_invoice_json => :body_text,
        p_status       => l_status,
        p_message      => l_message
    );
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status ||
          '","message":"' || NVL(l_message, '') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- Drop + recreate invoicesUI/:id/lines template
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoicesUI/:id/lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoicesUI/:id/lines',
        p_comments    => 'AR Invoice lines — full replace'
    );
    COMMIT;
END;
/

-- PUT /ar/invoicesUI/:id/lines — replace all lines
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI/:id/lines',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'UI: Replace all lines for an invoice',
        p_source         => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_UI_PKG.save_lines(
        p_transaction_id => TO_NUMBER(:id),
        p_lines_json     => :body_text,
        p_status         => l_status,
        p_message        => l_message
    );
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status ||
          '","message":"' || NVL(l_message, '') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- GET /ar/invoicesUI/:id — fetch header + lines + installments as JSON
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI/:id',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => NULL,
        p_comments       => 'UI: Get invoice header + lines + installments',
        p_source         => q'[
DECLARE
    l_id       NUMBER       := TO_NUMBER(:id);
    l_hdr_cur  SYS_REFCURSOR;
    l_result   CLOB         := '';
    l_found    NUMBER       := 0;

    -- header fields
    l_txn_id    NUMBER; l_txn_num   VARCHAR2(150); l_txn_class VARCHAR2(30);
    l_txn_type  VARCHAR2(50); l_txn_src   VARCHAR2(240);
    l_txn_date  VARCHAR2(30); l_acct_date VARCHAR2(30);
    l_status    VARCHAR2(30); l_currency  VARCHAR2(15);
    l_conv_type VARCHAR2(30); l_conv_date VARCHAR2(30);
    l_conv_rate NUMBER;       l_entered   NUMBER;
    l_balance   NUMBER;
    l_bt_num    VARCHAR2(50); l_bt_name   VARCHAR2(360); l_bt_site VARCHAR2(50);
    l_bt_cntct  VARCHAR2(360);
    l_st_name   VARCHAR2(360); l_st_site  VARCHAR2(50);
    l_pay_name  VARCHAR2(360); l_pay_site VARCHAR2(50); l_pay_acct VARCHAR2(100);
    l_bu        VARCHAR2(240); l_le        VARCHAR2(30);
    l_pmt_terms VARCHAR2(100); l_rcpt_mth  VARCHAR2(100);
    l_po        VARCHAR2(150); l_po_date   VARCHAR2(30);
    l_inv_rule  VARCHAR2(100); l_cross_ref VARCHAR2(150);
    l_remit     VARCHAR2(240); l_cmts      VARCHAR2(4000);
    l_spec_ins  VARCHAR2(4000); l_int_notes VARCHAR2(4000);

    -- lines JSON
    l_lines_json CLOB := '[';
    l_line_sep   VARCHAR2(1) := '';

    -- installments JSON
    l_inst_json  CLOB := '[';
    l_inst_sep   VARCHAR2(1) := '';
BEGIN
    -- Header
    BEGIN
        SELECT
            CUSTOMER_TRANSACTION_ID, TRANSACTION_NUMBER,   TRANSACTION_CLASS,
            TRANSACTION_TYPE,        TRANSACTION_SOURCE,
            TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD'),
            TO_CHAR(ACCOUNTING_DATE,  'YYYY-MM-DD'),
            INVOICE_STATUS,          INVOICE_CURRENCY_CODE,
            CONVERSION_RATE_TYPE,
            TO_CHAR(CONVERSION_DATE,  'YYYY-MM-DD'),
            CONVERSION_RATE,         ENTERED_AMOUNT,       INVOICE_BALANCE_AMOUNT,
            BILL_TO_CUSTOMER_NUMBER, BILL_TO_CUSTOMER_NAME, BILL_TO_SITE, BILL_TO_CONTACT,
            SHIP_TO_CUSTOMER_NAME,   SHIP_TO_SITE,
            PAYING_CUSTOMER_NAME,    PAYING_CUSTOMER_SITE,  PAYING_CUSTOMER_ACCOUNT,
            BUSINESS_UNIT,           LEGAL_ENTITY_IDENTIFIER,
            PAYMENT_TERMS,           RECEIPT_METHOD,
            PURCHASE_ORDER,          TO_CHAR(PURCHASE_ORDER_DATE, 'YYYY-MM-DD'),
            INVOICING_RULE,          CROSS_REFERENCE,      REMIT_TO_ADDRESS,
            COMMENTS,                SPECIAL_INSTRUCTIONS,  INTERNAL_NOTES
        INTO
            l_txn_id, l_txn_num, l_txn_class, l_txn_type, l_txn_src,
            l_txn_date, l_acct_date, l_status, l_currency, l_conv_type,
            l_conv_date, l_conv_rate, l_entered, l_balance,
            l_bt_num, l_bt_name, l_bt_site, l_bt_cntct,
            l_st_name, l_st_site,
            l_pay_name, l_pay_site, l_pay_acct,
            l_bu, l_le, l_pmt_terms, l_rcpt_mth,
            l_po, l_po_date, l_inv_rule, l_cross_ref, l_remit,
            l_cmts, l_spec_ins, l_int_notes
        FROM RR_AR_INVOICE_HEADERS
        WHERE CUSTOMER_TRANSACTION_ID = l_id;
        l_found := 1;
    EXCEPTION WHEN NO_DATA_FOUND THEN l_found := 0;
    END;

    IF l_found = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Invoice not found: ' || l_id || '"}');
        RETURN;
    END IF;

    -- Lines
    FOR lr IN (
        SELECT CUSTOMER_TRANSACTION_LINE_ID, LINE_NUMBER, DESCRIPTION,
               ITEM_NUMBER, UNIT_OF_MEASURE, MEMO_LINE,
               QUANTITY, UNIT_SELLING_PRICE, LINE_AMOUNT,
               TAX_CLASSIFICATION_CODE, SALES_ORDER, ACCOUNTING_RULE
        FROM   RR_AR_INVOICE_LINES
        WHERE  CUSTOMER_TRANSACTION_ID = l_id
        ORDER BY LINE_NUMBER
    ) LOOP
        l_lines_json := l_lines_json || l_line_sep ||
            '{"customerTransactionLineId":' || lr.CUSTOMER_TRANSACTION_LINE_ID ||
            ',"lineNumber":' || NVL(TO_CHAR(lr.LINE_NUMBER), 'null') ||
            ',"description":"'    || REPLACE(NVL(lr.DESCRIPTION,''),'"','\"') || '"' ||
            ',"itemNumber":"'     || REPLACE(NVL(lr.ITEM_NUMBER,''),'"','\"') || '"' ||
            ',"unitOfMeasure":"'  || NVL(lr.UNIT_OF_MEASURE,'') || '"' ||
            ',"memoLine":"'       || REPLACE(NVL(lr.MEMO_LINE,''),'"','\"') || '"' ||
            ',"quantity":'        || NVL(TO_CHAR(lr.QUANTITY),'null') ||
            ',"unitSellingPrice":' || NVL(TO_CHAR(lr.UNIT_SELLING_PRICE),'null') ||
            ',"lineAmount":'      || NVL(TO_CHAR(lr.LINE_AMOUNT),'null') ||
            ',"taxClassificationCode":"' || NVL(lr.TAX_CLASSIFICATION_CODE,'') || '"' ||
            ',"salesOrder":"'     || NVL(lr.SALES_ORDER,'') || '"' ||
            ',"accountingRule":"' || NVL(lr.ACCOUNTING_RULE,'') || '"' ||
            '}';
        l_line_sep := ',';
    END LOOP;
    l_lines_json := l_lines_json || ']';

    -- Installments
    FOR ir IN (
        SELECT INSTALLMENT_ID, INSTALLMENT_SEQUENCE_NUMBER, INSTALLMENT_STATUS,
               TO_CHAR(INSTALLMENT_DUE_DATE,'YYYY-MM-DD') AS DUE_DATE,
               ORIGINAL_AMOUNT, INSTALLMENT_BALANCE_DUE, AMOUNT_PAID
        FROM   RR_AR_INVOICE_INSTALLMENTS
        WHERE  CUSTOMER_TRANSACTION_ID = l_id
        ORDER BY INSTALLMENT_SEQUENCE_NUMBER
    ) LOOP
        l_inst_json := l_inst_json || l_inst_sep ||
            '{"installmentId":'        || ir.INSTALLMENT_ID ||
            ',"sequenceNumber":'       || NVL(TO_CHAR(ir.INSTALLMENT_SEQUENCE_NUMBER),'null') ||
            ',"status":"'              || NVL(ir.INSTALLMENT_STATUS,'') || '"' ||
            ',"dueDate":"'             || NVL(ir.DUE_DATE,'') || '"' ||
            ',"originalAmount":'       || NVL(TO_CHAR(ir.ORIGINAL_AMOUNT),'null') ||
            ',"balanceDue":'           || NVL(TO_CHAR(ir.INSTALLMENT_BALANCE_DUE),'null') ||
            ',"amountPaid":'           || NVL(TO_CHAR(ir.AMOUNT_PAID),'null') ||
            '}';
        l_inst_sep := ',';
    END LOOP;
    l_inst_json := l_inst_json || ']';

    :status_code := 200;
    HTP.P('{'  ||
        '"customerTransactionId":'  || l_txn_id ||
        ',"transactionNumber":"'    || NVL(l_txn_num,'')   || '"' ||
        ',"transactionClass":"'     || NVL(l_txn_class,'') || '"' ||
        ',"transactionType":"'      || NVL(l_txn_type,'')  || '"' ||
        ',"transactionSource":"'    || NVL(l_txn_src,'')   || '"' ||
        ',"transactionDate":"'      || NVL(l_txn_date,'')  || '"' ||
        ',"accountingDate":"'       || NVL(l_acct_date,'') || '"' ||
        ',"invoiceStatus":"'        || NVL(l_status,'')    || '"' ||
        ',"invoiceCurrencyCode":"'  || NVL(l_currency,'')  || '"' ||
        ',"conversionRateType":"'   || NVL(l_conv_type,'') || '"' ||
        ',"conversionDate":"'       || NVL(l_conv_date,'') || '"' ||
        ',"conversionRate":'        || NVL(TO_CHAR(l_conv_rate),'null') ||
        ',"enteredAmount":'         || NVL(TO_CHAR(l_entered),'null') ||
        ',"invoiceBalanceAmount":'  || NVL(TO_CHAR(l_balance),'null') ||
        ',"billToCustomerNumber":"' || NVL(l_bt_num,'')   || '"' ||
        ',"billToCustomerName":"'   || REPLACE(NVL(l_bt_name,''),'"','\"') || '"' ||
        ',"billToSite":"'           || NVL(l_bt_site,'')  || '"' ||
        ',"billToContact":"'        || NVL(l_bt_cntct,'') || '"' ||
        ',"shipToCustomerName":"'   || REPLACE(NVL(l_st_name,''),'"','\"') || '"' ||
        ',"shipToSite":"'           || NVL(l_st_site,'')  || '"' ||
        ',"payingCustomerName":"'   || REPLACE(NVL(l_pay_name,''),'"','\"') || '"' ||
        ',"payingCustomerSite":"'   || NVL(l_pay_site,'') || '"' ||
        ',"payingCustomerAccount":"'|| NVL(l_pay_acct,'') || '"' ||
        ',"businessUnit":"'         || REPLACE(NVL(l_bu,''),'"','\"') || '"' ||
        ',"legalEntityIdentifier":"'|| NVL(l_le,'')       || '"' ||
        ',"paymentTerms":"'         || NVL(l_pmt_terms,'')|| '"' ||
        ',"receiptMethod":"'        || NVL(l_rcpt_mth,'') || '"' ||
        ',"purchaseOrder":"'        || NVL(l_po,'')       || '"' ||
        ',"purchaseOrderDate":"'    || NVL(l_po_date,'')  || '"' ||
        ',"invoicingRule":"'        || NVL(l_inv_rule,'') || '"' ||
        ',"crossReference":"'       || NVL(l_cross_ref,'')|| '"' ||
        ',"remitToAddress":"'       || NVL(l_remit,'')    || '"' ||
        ',"comments":"'             || REPLACE(NVL(l_cmts,''),'"','\"')     || '"' ||
        ',"specialInstructions":"'  || REPLACE(NVL(l_spec_ins,''),'"','\"') || '"' ||
        ',"internalNotes":"'        || REPLACE(NVL(l_int_notes,''),'"','\"')|| '"' ||
        ',"lines":'       || l_lines_json ||
        ',"installments":'|| l_inst_json  ||
        '}');
END;
]'
    );
    COMMIT;
END;
/

-- Drop + recreate invoicesUI/:id/lines/:line_id template
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoicesUI/:id/lines/:line_id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoicesUI/:id/lines/:line_id',
        p_comments    => 'AR Invoice — delete a single line'
    );
    COMMIT;
END;
/

-- DELETE /ar/invoicesUI/:id/lines/:line_id — delete one line
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI/:id/lines/:line_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => NULL,
        p_comments       => 'UI: Delete a single invoice line',
        p_source         => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_UI_PKG.delete_line(
        p_transaction_id => TO_NUMBER(:id),
        p_line_id        => TO_NUMBER(:line_id),
        p_status         => l_status,
        p_message        => l_message
    );
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status ||
          '","message":"' || NVL(l_message, '') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- Drop + recreate invoicesUI/:id/installments template
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoicesUI/:id/installments');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoicesUI/:id/installments',
        p_comments    => 'AR Invoice installments — full replace with validation'
    );
    COMMIT;
END;
/

-- PUT /ar/invoicesUI/:id/installments
-- Body: {"items":[{"SequenceNumber":1,"DueDate":"YYYY-MM-DD","Amount":nnn},...]};
-- Validates sum(Amount) = invoice ENTERED_AMOUNT before replacing.
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoicesUI/:id/installments',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'UI: Replace installment schedule with validation',
        p_source         => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_UI_PKG.save_installments(
        p_transaction_id    => TO_NUMBER(:id),
        p_installments_json => :body_text,
        p_status            => l_status,
        p_message           => l_message
    );
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status || '","message":"' || NVL(l_message,'') || '"}');
END;
]'
    );
    COMMIT;
END;
/
