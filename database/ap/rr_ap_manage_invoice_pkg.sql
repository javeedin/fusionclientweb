-- =====================================================
-- RR_AP_MANAGE_INVOICE_PKG
-- =====================================================
-- Purpose: Update AP Invoice Header, Add/Update/Delete Lines
-- Business Rules:
--   - Edit allowed only if PAID_STATUS != 'Paid' AND ACCOUNTING_STATUS != 'Accounted'
--   - Payment allowed only if VALIDATION_STATUS = 'Validated' AND ACCOUNTING_STATUS = 'Accounted'
-- Target Tables: RR_AP_INVOICES_ALL (header), RR_AP_INVOICE_LINES_ALL (lines)
-- =====================================================

-- =====================================================
-- 1. Package Specification
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AP_MANAGE_INVOICE_PKG AS

    -- =====================================================
    -- Update invoice header
    -- JSON: { "InvoiceId": 900001, "InvoiceNumber": "...", ... }
    -- Only editable columns are updated; status columns untouched
    -- =====================================================
    PROCEDURE update_header(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    );

    -- =====================================================
    -- Add new lines to an existing invoice
    -- JSON: { "InvoiceId": 900001, "lines": [ { ... }, { ... } ] }
    -- =====================================================
    PROCEDURE add_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    );

    -- =====================================================
    -- Update existing lines
    -- JSON: { "InvoiceId": 900001, "lines": [ { "LineNumber": 1, ... } ] }
    -- Matched by InvoiceId + LineNumber
    -- =====================================================
    PROCEDURE update_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    );

    -- =====================================================
    -- Delete lines from an invoice
    -- JSON: { "InvoiceId": 900001, "lineNumbers": [2, 3] }
    -- =====================================================
    PROCEDURE delete_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    );

    -- =====================================================
    -- Full update: header + add/update/delete lines in one call
    -- JSON: {
    --   "InvoiceId": 900001,
    --   "header": { ... },
    --   "addLines": [ { ... } ],
    --   "updateLines": [ { "LineNumber": 1, ... } ],
    --   "deleteLineNumbers": [3, 4]
    -- }
    -- =====================================================
    PROCEDURE update_invoice_full(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    );

END RR_AP_MANAGE_INVOICE_PKG;
/

-- =====================================================
-- 2. Package Body
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AP_MANAGE_INVOICE_PKG AS

    -- =====================================================
    -- Internal: Check if invoice is editable
    -- Returns TRUE if PAID_STATUS != 'Paid' AND ACCOUNTING_STATUS != 'Accounted'
    -- =====================================================
    FUNCTION is_editable(p_invoice_id NUMBER) RETURN BOOLEAN IS
        l_paid_status       VARCHAR2(30);
        l_accounting_status VARCHAR2(30);
    BEGIN
        SELECT NVL(paid_status, 'Unpaid'),
               NVL(accounting_status, 'Not Accounted')
        INTO   l_paid_status, l_accounting_status
        FROM   RR_AP_INVOICES_ALL
        WHERE  invoice_id = p_invoice_id;

        IF l_paid_status = 'Paid' THEN
            RETURN FALSE;
        END IF;

        IF l_accounting_status = 'Accounted' THEN
            RETURN FALSE;
        END IF;

        RETURN TRUE;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN FALSE;
    END is_editable;

    -- =====================================================
    -- Internal: Reset validation after edit
    -- When invoice is modified, set VALIDATION_STATUS = 'Needs Revalidation'
    -- =====================================================
    PROCEDURE reset_validation(p_invoice_id NUMBER) IS
    BEGIN
        UPDATE RR_AP_INVOICES_ALL
        SET    validation_status = 'Needs Revalidation',
               last_updated_by   = USER,
               last_update_date   = SYSTIMESTAMP
        WHERE  invoice_id = p_invoice_id;
    END reset_validation;

    -- =====================================================
    -- Update invoice header
    -- =====================================================
    PROCEDURE update_header(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    ) AS
        l_invoice_id NUMBER;
    BEGIN
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'InvoiceId is required';
            RETURN;
        END IF;

        IF NOT is_editable(l_invoice_id) THEN
            p_status  := 'ERROR';
            p_message := 'Invoice cannot be edited: already Paid or Accounted';
            RETURN;
        END IF;

        UPDATE RR_AP_INVOICES_ALL
        SET    invoice_number      = NVL(JSON_VALUE(p_json, '$.InvoiceNumber'), invoice_number),
               invoice_currency    = NVL(JSON_VALUE(p_json, '$.InvoiceCurrency'), invoice_currency),
               payment_currency    = NVL(JSON_VALUE(p_json, '$.PaymentCurrency'), payment_currency),
               invoice_amount      = NVL(JSON_VALUE(p_json, '$.InvoiceAmount' RETURNING NUMBER), invoice_amount),
               invoice_date        = NVL(TO_DATE(JSON_VALUE(p_json, '$.InvoiceDate'), 'YYYY-MM-DD'), invoice_date),
               business_unit       = NVL(JSON_VALUE(p_json, '$.BusinessUnit'), business_unit),
               legal_entity        = NVL(JSON_VALUE(p_json, '$.LegalEntity'), legal_entity),
               supplier            = NVL(JSON_VALUE(p_json, '$.Supplier'), supplier),
               supplier_number     = NVL(JSON_VALUE(p_json, '$.SupplierNumber'), supplier_number),
               supplier_site       = NVL(JSON_VALUE(p_json, '$.SupplierSite'), supplier_site),
               invoice_type        = NVL(JSON_VALUE(p_json, '$.InvoiceType'), invoice_type),
               description         = NVL(JSON_VALUE(p_json, '$.Description' RETURNING VARCHAR2(4000)), description),
               invoice_group       = NVL(JSON_VALUE(p_json, '$.InvoiceGroup'), invoice_group),
               accounting_date     = NVL(TO_DATE(JSON_VALUE(p_json, '$.AccountingDate'), 'YYYY-MM-DD'), accounting_date),
               terms_date          = NVL(TO_DATE(JSON_VALUE(p_json, '$.TermsDate'), 'YYYY-MM-DD'), terms_date),
               goods_received_date = NVL(TO_DATE(JSON_VALUE(p_json, '$.GoodsReceivedDate'), 'YYYY-MM-DD'), goods_received_date),
               pay_group           = NVL(JSON_VALUE(p_json, '$.PayGroup'), pay_group),
               payment_terms       = NVL(JSON_VALUE(p_json, '$.PaymentTerms'), payment_terms),
               payment_method      = NVL(JSON_VALUE(p_json, '$.PaymentMethod'), payment_method),
               pay_alone_flag      = NVL(JSON_VALUE(p_json, '$.PayAlone'), pay_alone_flag),
               last_updated_by     = USER,
               last_update_date    = SYSTIMESTAMP
        WHERE  invoice_id = l_invoice_id;

        IF SQL%ROWCOUNT = 0 THEN
            p_status  := 'ERROR';
            p_message := 'Invoice not found: ' || l_invoice_id;
            RETURN;
        END IF;

        -- Reset validation status after edit
        reset_validation(l_invoice_id);

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Invoice header updated (ID: ' || l_invoice_id || ')';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'Error updating header: ' || SQLERRM;
    END update_header;

    -- =====================================================
    -- Add new lines to an existing invoice
    -- =====================================================
    PROCEDURE add_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    ) AS
        l_invoice_id     NUMBER;
        l_invoice_number VARCHAR2(50);
        l_invoice_date   DATE;
        l_count          NUMBER := 0;
        l_error_count    NUMBER := 0;
    BEGIN
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'InvoiceId is required';
            RETURN;
        END IF;

        IF NOT is_editable(l_invoice_id) THEN
            p_status  := 'ERROR';
            p_message := 'Invoice cannot be edited: already Paid or Accounted';
            RETURN;
        END IF;

        -- Get invoice number and date for the lines
        SELECT invoice_number, invoice_date
        INTO   l_invoice_number, l_invoice_date
        FROM   RR_AP_INVOICES_ALL
        WHERE  invoice_id = l_invoice_id;

        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number              NUMBER          PATH '$.LineNumber',
                    line_type                VARCHAR2(50)    PATH '$.LineType',
                    line_amount              NUMBER          PATH '$.LineAmount',
                    description              VARCHAR2(4000)  PATH '$.Description',
                    accounting_date          VARCHAR2(10)    PATH '$.AccountingDate',
                    distribution_combination VARCHAR2(500)   PATH '$.DistributionCombination',
                    distribution_set         VARCHAR2(240)   PATH '$.DistributionSet',
                    tax_classification       VARCHAR2(240)   PATH '$.TaxClassification',
                    quantity                 NUMBER          PATH '$.Quantity',
                    unit_price               NUMBER          PATH '$.UnitPrice',
                    uom                      VARCHAR2(25)    PATH '$.UOM',
                    purchase_order_number    VARCHAR2(50)    PATH '$.PONumber',
                    purchase_order_line_number NUMBER        PATH '$.POLineNumber',
                    receipt_number           VARCHAR2(50)    PATH '$.ReceiptNumber',
                    receipt_line_number      NUMBER          PATH '$.ReceiptLineNumber',
                    ship_to_location         VARCHAR2(240)   PATH '$.ShipToLocation'
                )
            ) jt
        ) LOOP
            BEGIN
                INSERT INTO RR_AP_INVOICE_LINES_ALL (
                    INVOICE_ID, INVOICE_NUMBER, LINE_NUMBER, LINE_TYPE, LINE_AMOUNT,
                    DESCRIPTION, ACCOUNTING_DATE, DISTRIBUTION_COMBINATION,
                    DISTRIBUTION_SET, TAX_CLASSIFICATION, QUANTITY, UNIT_PRICE, UOM,
                    PURCHASE_ORDER_NUMBER, PURCHASE_ORDER_LINE_NUMBER,
                    RECEIPT_NUMBER, RECEIPT_LINE_NUMBER, SHIP_TO_LOCATION,
                    PROCESS_STATUS, CREATED_BY, CREATION_DATE
                ) VALUES (
                    l_invoice_id, l_invoice_number, rec.line_number,
                    NVL(rec.line_type, 'Item'), rec.line_amount,
                    rec.description,
                    NVL(TO_DATE(rec.accounting_date, 'YYYY-MM-DD'), l_invoice_date),
                    rec.distribution_combination, rec.distribution_set,
                    rec.tax_classification, rec.quantity, rec.unit_price, rec.uom,
                    rec.purchase_order_number, rec.purchase_order_line_number,
                    rec.receipt_number, rec.receipt_line_number, rec.ship_to_location,
                    'NEW', USER, SYSTIMESTAMP
                );
                l_count := l_count + 1;
            EXCEPTION
                WHEN OTHERS THEN
                    l_error_count := l_error_count + 1;
            END;
        END LOOP;

        IF l_error_count > 0 THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := l_error_count || ' of ' || (l_count + l_error_count) || ' lines failed to insert';
        ELSE
            reset_validation(l_invoice_id);
            COMMIT;
            p_status  := 'SUCCESS';
            p_message := l_count || ' lines added to invoice ' || l_invoice_id;
        END IF;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status  := 'ERROR';
            p_message := 'Invoice not found: ' || l_invoice_id;
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'Error adding lines: ' || SQLERRM;
    END add_lines;

    -- =====================================================
    -- Update existing lines (matched by InvoiceId + LineNumber)
    -- =====================================================
    PROCEDURE update_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    ) AS
        l_invoice_id  NUMBER;
        l_count       NUMBER := 0;
        l_error_count NUMBER := 0;
    BEGIN
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'InvoiceId is required';
            RETURN;
        END IF;

        IF NOT is_editable(l_invoice_id) THEN
            p_status  := 'ERROR';
            p_message := 'Invoice cannot be edited: already Paid or Accounted';
            RETURN;
        END IF;

        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number              NUMBER          PATH '$.LineNumber',
                    line_type                VARCHAR2(50)    PATH '$.LineType',
                    line_amount              NUMBER          PATH '$.LineAmount',
                    description              VARCHAR2(4000)  PATH '$.Description',
                    accounting_date          VARCHAR2(10)    PATH '$.AccountingDate',
                    distribution_combination VARCHAR2(500)   PATH '$.DistributionCombination',
                    distribution_set         VARCHAR2(240)   PATH '$.DistributionSet',
                    tax_classification       VARCHAR2(240)   PATH '$.TaxClassification',
                    quantity                 NUMBER          PATH '$.Quantity',
                    unit_price               NUMBER          PATH '$.UnitPrice',
                    uom                      VARCHAR2(25)    PATH '$.UOM',
                    purchase_order_number    VARCHAR2(50)    PATH '$.PONumber',
                    purchase_order_line_number NUMBER        PATH '$.POLineNumber',
                    receipt_number           VARCHAR2(50)    PATH '$.ReceiptNumber',
                    receipt_line_number      NUMBER          PATH '$.ReceiptLineNumber',
                    ship_to_location         VARCHAR2(240)   PATH '$.ShipToLocation'
                )
            ) jt
        ) LOOP
            BEGIN
                UPDATE RR_AP_INVOICE_LINES_ALL
                SET    line_type                = NVL(rec.line_type, line_type),
                       line_amount              = NVL(rec.line_amount, line_amount),
                       description              = NVL(rec.description, description),
                       accounting_date          = NVL(TO_DATE(rec.accounting_date, 'YYYY-MM-DD'), accounting_date),
                       distribution_combination = NVL(rec.distribution_combination, distribution_combination),
                       distribution_set         = NVL(rec.distribution_set, distribution_set),
                       tax_classification       = NVL(rec.tax_classification, tax_classification),
                       quantity                 = NVL(rec.quantity, quantity),
                       unit_price               = NVL(rec.unit_price, unit_price),
                       uom                      = NVL(rec.uom, uom),
                       purchase_order_number    = NVL(rec.purchase_order_number, purchase_order_number),
                       purchase_order_line_number = NVL(rec.purchase_order_line_number, purchase_order_line_number),
                       receipt_number           = NVL(rec.receipt_number, receipt_number),
                       receipt_line_number      = NVL(rec.receipt_line_number, receipt_line_number),
                       ship_to_location         = NVL(rec.ship_to_location, ship_to_location),
                       last_updated_by          = USER,
                       last_update_date         = SYSTIMESTAMP
                WHERE  invoice_id  = l_invoice_id
                AND    line_number = rec.line_number;

                IF SQL%ROWCOUNT > 0 THEN
                    l_count := l_count + 1;
                ELSE
                    l_error_count := l_error_count + 1;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    l_error_count := l_error_count + 1;
            END;
        END LOOP;

        IF l_error_count > 0 AND l_count = 0 THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'No lines updated. ' || l_error_count || ' lines not found or failed';
        ELSE
            reset_validation(l_invoice_id);
            COMMIT;
            p_status  := 'SUCCESS';
            p_message := l_count || ' lines updated' ||
                         CASE WHEN l_error_count > 0
                              THEN ' (' || l_error_count || ' not found/failed)'
                              ELSE '' END;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'Error updating lines: ' || SQLERRM;
    END update_lines;

    -- =====================================================
    -- Delete lines from an invoice
    -- =====================================================
    PROCEDURE delete_lines(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    ) AS
        l_invoice_id  NUMBER;
        l_deleted     NUMBER := 0;
    BEGIN
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'InvoiceId is required';
            RETURN;
        END IF;

        IF NOT is_editable(l_invoice_id) THEN
            p_status  := 'ERROR';
            p_message := 'Invoice cannot be edited: already Paid or Accounted';
            RETURN;
        END IF;

        -- Delete lines matching the provided line numbers
        FOR rec IN (
            SELECT jt.line_number
            FROM JSON_TABLE(p_json, '$.lineNumbers[*]'
                COLUMNS (
                    line_number NUMBER PATH '$'
                )
            ) jt
        ) LOOP
            DELETE FROM RR_AP_INVOICE_LINES_ALL
            WHERE  invoice_id  = l_invoice_id
            AND    line_number = rec.line_number;

            l_deleted := l_deleted + SQL%ROWCOUNT;
        END LOOP;

        IF l_deleted > 0 THEN
            reset_validation(l_invoice_id);
            COMMIT;
            p_status  := 'SUCCESS';
            p_message := l_deleted || ' lines deleted from invoice ' || l_invoice_id;
        ELSE
            p_status  := 'ERROR';
            p_message := 'No matching lines found to delete';
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'Error deleting lines: ' || SQLERRM;
    END delete_lines;

    -- =====================================================
    -- Full update: header + add/update/delete lines in one call
    -- =====================================================
    PROCEDURE update_invoice_full(
        p_json       IN  CLOB,
        p_status     OUT VARCHAR2,
        p_message    OUT VARCHAR2
    ) AS
        l_invoice_id     NUMBER;
        l_has_header     NUMBER := 0;
        l_has_add        NUMBER := 0;
        l_has_update     NUMBER := 0;
        l_has_delete     NUMBER := 0;
        l_sub_status     VARCHAR2(20);
        l_sub_message    VARCHAR2(4000);
        l_messages       VARCHAR2(4000) := '';
        l_any_error      BOOLEAN := FALSE;
    BEGIN
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'InvoiceId is required';
            RETURN;
        END IF;

        IF NOT is_editable(l_invoice_id) THEN
            p_status  := 'ERROR';
            p_message := 'Invoice cannot be edited: already Paid or Accounted';
            RETURN;
        END IF;

        -- Check what operations are requested
        SELECT COUNT(*) INTO l_has_header FROM DUAL WHERE JSON_EXISTS(p_json, '$.header');
        SELECT COUNT(*) INTO l_has_add    FROM DUAL WHERE JSON_EXISTS(p_json, '$.addLines[0]');
        SELECT COUNT(*) INTO l_has_update FROM DUAL WHERE JSON_EXISTS(p_json, '$.updateLines[0]');
        SELECT COUNT(*) INTO l_has_delete FROM DUAL WHERE JSON_EXISTS(p_json, '$.deleteLineNumbers[0]');

        -- 1. Update header (if provided)
        IF l_has_header > 0 THEN
            DECLARE
                l_header_json CLOB;
            BEGIN
                -- Build header JSON with InvoiceId injected
                SELECT JSON_MERGEPATCH(
                    JSON_QUERY(p_json, '$.header'),
                    '{"InvoiceId":' || l_invoice_id || '}'
                ) INTO l_header_json FROM DUAL;

                update_header(l_header_json, l_sub_status, l_sub_message);
                l_messages := l_messages || 'Header: ' || l_sub_message || '. ';
                IF l_sub_status != 'SUCCESS' THEN l_any_error := TRUE; END IF;
            END;
        END IF;

        -- 2. Delete lines (do before add to avoid line number conflicts)
        IF l_has_delete > 0 THEN
            DECLARE
                l_delete_json CLOB;
            BEGIN
                SELECT JSON_OBJECT(
                    'InvoiceId' VALUE l_invoice_id,
                    'lineNumbers' VALUE JSON_QUERY(p_json, '$.deleteLineNumbers')
                ) INTO l_delete_json FROM DUAL;

                delete_lines(l_delete_json, l_sub_status, l_sub_message);
                l_messages := l_messages || 'Delete: ' || l_sub_message || '. ';
                IF l_sub_status != 'SUCCESS' THEN l_any_error := TRUE; END IF;
            END;
        END IF;

        -- 3. Update existing lines
        IF l_has_update > 0 THEN
            DECLARE
                l_update_json CLOB;
            BEGIN
                SELECT JSON_OBJECT(
                    'InvoiceId' VALUE l_invoice_id,
                    'lines' VALUE JSON_QUERY(p_json, '$.updateLines')
                ) INTO l_update_json FROM DUAL;

                update_lines(l_update_json, l_sub_status, l_sub_message);
                l_messages := l_messages || 'Update: ' || l_sub_message || '. ';
                IF l_sub_status != 'SUCCESS' THEN l_any_error := TRUE; END IF;
            END;
        END IF;

        -- 4. Add new lines
        IF l_has_add > 0 THEN
            DECLARE
                l_add_json CLOB;
            BEGIN
                SELECT JSON_OBJECT(
                    'InvoiceId' VALUE l_invoice_id,
                    'lines' VALUE JSON_QUERY(p_json, '$.addLines')
                ) INTO l_add_json FROM DUAL;

                add_lines(l_add_json, l_sub_status, l_sub_message);
                l_messages := l_messages || 'Add: ' || l_sub_message || '. ';
                IF l_sub_status != 'SUCCESS' THEN l_any_error := TRUE; END IF;
            END;
        END IF;

        IF l_any_error THEN
            p_status  := 'PARTIAL';
            p_message := l_messages;
        ELSE
            p_status  := 'SUCCESS';
            p_message := NVL(NULLIF(l_messages, ''), 'No operations performed');
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := 'Error: ' || SQLERRM;
    END update_invoice_full;

END RR_AP_MANAGE_INVOICE_PKG;
/

-- =====================================================
-- 3. ORDS REST Handlers
-- =====================================================

-- ----- Update Header -----
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoice/update',
        p_comments    => 'Update AP Invoice Header'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'invoice/update',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments    => 'Update invoice header fields',
        p_source      => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AP_MANAGE_INVOICE_PKG.update_header(:body_text, l_status, l_message);
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status || '","message":"' || l_message || '","success":' || CASE WHEN l_status='SUCCESS' THEN 'true' ELSE 'false' END || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ----- Add Lines -----
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoice/addlines',
        p_comments    => 'Add lines to AP Invoice'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'invoice/addlines',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments    => 'Add new lines to existing invoice',
        p_source      => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AP_MANAGE_INVOICE_PKG.add_lines(:body_text, l_status, l_message);
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 201 ELSE 400 END;
    HTP.P('{"status":"' || l_status || '","message":"' || l_message || '","success":' || CASE WHEN l_status='SUCCESS' THEN 'true' ELSE 'false' END || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ----- Update Lines -----
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoice/updatelines',
        p_comments    => 'Update lines on AP Invoice'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'invoice/updatelines',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments    => 'Update existing lines on an invoice',
        p_source      => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AP_MANAGE_INVOICE_PKG.update_lines(:body_text, l_status, l_message);
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status || '","message":"' || l_message || '","success":' || CASE WHEN l_status='SUCCESS' THEN 'true' ELSE 'false' END || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ----- Delete Lines -----
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoice/deletelines',
        p_comments    => 'Delete lines from AP Invoice'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'invoice/deletelines',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments    => 'Delete lines from an invoice by line numbers',
        p_source      => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AP_MANAGE_INVOICE_PKG.delete_lines(:body_text, l_status, l_message);
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;
    HTP.P('{"status":"' || l_status || '","message":"' || l_message || '","success":' || CASE WHEN l_status='SUCCESS' THEN 'true' ELSE 'false' END || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ----- Full Update (header + lines combined) -----
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoice/updatefull',
        p_comments    => 'Full update: header + add/update/delete lines'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'invoice/updatefull',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments    => 'Full invoice update: header + add/update/delete lines in one call',
        p_source      => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AP_MANAGE_INVOICE_PKG.update_invoice_full(:body_text, l_status, l_message);
    :status_code := CASE
        WHEN l_status = 'SUCCESS' THEN 200
        WHEN l_status = 'PARTIAL' THEN 207
        ELSE 400
    END;
    HTP.P('{');
    HTP.P('"status":"' || l_status || '",');
    HTP.P('"message":"' || l_message || '",');
    HTP.P('"success":' || CASE WHEN l_status IN ('SUCCESS','PARTIAL') THEN 'true' ELSE 'false' END);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. Verify Endpoints
-- =====================================================
SELECT
    module_name,
    uri_template,
    method,
    source_type
FROM user_ords_handlers
WHERE module_name = 'ap'
  AND uri_template LIKE '%invoice/%'
ORDER BY uri_template, method;

-- =====================================================
-- 5. Sample JSON for Postman Testing
-- =====================================================
/*

-- ===== UPDATE HEADER ONLY =====
POST /ap/invoice/update
{
    "InvoiceId": 900001,
    "InvoiceAmount": 2100.00,
    "Description": "Updated description",
    "SupplierSite": "ABU DHABI"
}

-- ===== ADD LINES =====
POST /ap/invoice/addlines
{
    "InvoiceId": 900001,
    "lines": [
        {
            "LineNumber": 3,
            "LineType": "Item",
            "LineAmount": 500.00,
            "Description": "New line item",
            "DistributionCombination": "01-000-6310-0000-000"
        }
    ]
}

-- ===== UPDATE LINES =====
POST /ap/invoice/updatelines
{
    "InvoiceId": 900001,
    "lines": [
        {
            "LineNumber": 1,
            "LineAmount": 1200.00,
            "Description": "Updated line 1"
        }
    ]
}

-- ===== DELETE LINES =====
POST /ap/invoice/deletelines
{
    "InvoiceId": 900001,
    "lineNumbers": [2, 3]
}

-- ===== FULL UPDATE (all operations in one call) =====
POST /ap/invoice/updatefull
{
    "InvoiceId": 900001,
    "header": {
        "InvoiceAmount": 2500.00,
        "Description": "Updated invoice"
    },
    "addLines": [
        {
            "LineNumber": 4,
            "LineType": "Item",
            "LineAmount": 400.00,
            "Description": "Added line"
        }
    ],
    "updateLines": [
        {
            "LineNumber": 1,
            "LineAmount": 1500.00,
            "Description": "Updated line 1"
        }
    ],
    "deleteLineNumbers": [3]
}

-- ===== EXPECTED RESPONSES =====

-- Success:
{
    "status": "SUCCESS",
    "message": "Header: Invoice header updated (ID: 900001). Delete: 1 lines deleted. Update: 1 lines updated. Add: 1 lines added.",
    "success": true
}

-- Error (Paid invoice):
{
    "status": "ERROR",
    "message": "Invoice cannot be edited: already Paid or Accounted",
    "success": false
}

-- ===== BUSINESS RULES =====
-- Invoice is EDITABLE when:
--   PAID_STATUS     != 'Paid'
--   ACCOUNTING_STATUS != 'Accounted'
--
-- Invoice PAYMENT allowed when:
--   VALIDATION_STATUS  = 'Validated'
--   ACCOUNTING_STATUS  = 'Accounted'
--
-- After any edit, VALIDATION_STATUS is reset to 'Needs Revalidation'

*/
