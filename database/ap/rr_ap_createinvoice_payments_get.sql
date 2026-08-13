-- =====================================================
-- GET Handler for /ap/createinvoice/payments
-- Returns payments linked to an invoice, including
-- discount_taken so the UI can calculate correct balance.
-- Parameter: P_INVOICE_ID
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'createinvoice/payments');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'createinvoice/payments',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Payments for a specific invoice, including discount_taken'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoice/payments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns payments for P_INVOICE_ID with discount_taken',
        p_source         => q'[
DECLARE
    l_rows    CLOB;
    l_first   BOOLEAN := TRUE;
    l_offset  INTEGER := 1;
    l_chunk   CONSTANT INTEGER := 32000;
    l_len     INTEGER;
BEGIN
    DBMS_LOB.CREATETEMPORARY(l_rows, TRUE);
    DBMS_LOB.APPEND(l_rows, TO_CLOB('['));

    FOR rec IN (
        SELECT
            ri.INVOICE_PAYMENT_ID,
            ri.CHECK_ID                         AS id,
            p.PAPER_DOCUMENT_NUMBER             AS paper_document_number,
            ri.INVOICE_NUMBER                   AS invoice_number,
            p.PAYMENT_STATUS                    AS payment_status,
            p.RECONCILED_FLAG                   AS reconciled_flag,
            ri.INVOICE_BUSINESS_UNIT            AS invoice_business_unit,
            p.CREATION_DATE                     AS creation_date,
            ri.AMOUNT_PAID_PAYMENT_CURRENCY     AS amount_paid_payment_currency,
            ri.AMOUNT_PAID_INVOICE_CURRENCY     AS amount_paid_invoice_currency,
            NVL(ri.DISCOUNT_TAKEN, 0)           AS discount_taken,
            ri.INVOICE_CURRENCY                 AS invoice_currency,
            ri.INVOICE_PAYMENT_STATUS           AS invoice_payment_status
        FROM RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
        WHERE ri.INVOICE_ID = :P_INVOICE_ID
        ORDER BY p.CREATION_DATE DESC
    ) LOOP
        IF NOT l_first THEN
            DBMS_LOB.APPEND(l_rows, TO_CLOB(','));
        END IF;
        l_first := FALSE;

        DBMS_LOB.APPEND(l_rows, TO_CLOB(
            '{"id":'                           || NVL(TO_CHAR(rec.id), 'null')                              || ',' ||
            '"invoice_payment_id":'            || NVL(TO_CHAR(rec.INVOICE_PAYMENT_ID), 'null')              || ',' ||
            '"paper_document_number":"'        || NVL(REPLACE(TO_CHAR(rec.paper_document_number), '"', '\"'), '') || '",' ||
            '"invoice_number":"'               || NVL(REPLACE(rec.invoice_number, '"', '\"'), '')            || '",' ||
            '"payment_status":"'               || NVL(REPLACE(rec.payment_status, '"', '\"'), '')            || '",' ||
            '"reconciled_flag":"'              || NVL(rec.reconciled_flag, 'N')                              || '",' ||
            '"invoice_business_unit":"'        || NVL(REPLACE(rec.invoice_business_unit, '"', '\"'), '')     || '",' ||
            '"creation_date":"'                || NVL(TO_CHAR(rec.creation_date, 'YYYY-MM-DD'), '')          || '",' ||
            '"amount_paid_payment_currency":'  || NVL(TO_CHAR(rec.amount_paid_payment_currency), '0')       || ',' ||
            '"amount_paid_invoice_currency":'  || NVL(TO_CHAR(rec.amount_paid_invoice_currency), '0')       || ',' ||
            '"discount_taken":'                || NVL(TO_CHAR(rec.discount_taken), '0')                     || ',' ||
            '"invoice_currency":"'             || NVL(REPLACE(rec.invoice_currency, '"', '\"'), '')          || '",' ||
            '"invoice_payment_status":"'       || NVL(REPLACE(rec.invoice_payment_status, '"', '\"'), '')   || '"' ||
            '}'
        ));
    END LOOP;

    DBMS_LOB.APPEND(l_rows, TO_CLOB(']'));

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"items":');
    l_len    := NVL(DBMS_LOB.GETLENGTH(l_rows), 0);
    WHILE l_offset <= l_len LOOP
        HTP.prn(DBMS_LOB.SUBSTR(l_rows, l_chunk, l_offset));
        l_offset := l_offset + l_chunk;
    END LOOP;
    HTP.PRN('}');

EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/
