-- =============================================================================
-- RR_AP_MIGRATION_CHECK_PKG
-- =============================================================================
-- Purpose : Check data integrity of AP invoice migration.
--           Compares RR_AP_INVOICES_ALL header amounts against the sum of
--           RR_AP_INVOICE_LINES_ALL line amounts, highlights missing lines,
--           amount mismatches, and invoices possibly truncated at 25 lines.
--
-- Tables  : RR_AP_INVOICES_ALL          (invoice headers)
--           RR_AP_INVOICE_LINES_ALL      (invoice lines)
--           RR_AP_INVOICE_INSTALLMENTS   (payment installments)
--
-- Endpoints:
--   GET /reerp/ap/migration-check/summary  → get_summary()
--   GET /reerp/ap/migration-check/details  → get_details()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Package spec
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE RR_AP_MIGRATION_CHECK_PKG AS

    -- Summary: counts and amount totals across all invoices
    FUNCTION get_summary(
        p_business_unit VARCHAR2 DEFAULT NULL
    ) RETURN CLOB;

    -- Details: per-invoice comparison rows (paginated)
    -- p_filter: ALL | ISSUES | MISSING_LINES | AMOUNT_MISMATCH | TRUNCATED
    FUNCTION get_details(
        p_business_unit VARCHAR2 DEFAULT NULL,
        p_filter        VARCHAR2 DEFAULT 'ISSUES',
        p_limit         NUMBER   DEFAULT 500,
        p_offset        NUMBER   DEFAULT 0
    ) RETURN CLOB;

END RR_AP_MIGRATION_CHECK_PKG;
/


-- ---------------------------------------------------------------------------
-- Package body
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY RR_AP_MIGRATION_CHECK_PKG AS

    -- ── JSON helpers ──────────────────────────────────────────────────────────
    FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"');
    END;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || esc(p) || '"' END;
    END;

    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null'
                    ELSE TRIM(TRAILING '.' FROM TO_CHAR(p, 'FM999999999999990.99'))
               END;
    END;

    FUNCTION jdate(p IN DATE) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null'
                    ELSE '"' || TO_CHAR(p, 'YYYY-MM-DD') || '"'
               END;
    END;

    -- ── get_summary ───────────────────────────────────────────────────────────
    FUNCTION get_summary(
        p_business_unit VARCHAR2 DEFAULT NULL
    ) RETURN CLOB IS

        v_total_invoices          NUMBER := 0;
        v_invoices_with_lines     NUMBER := 0;
        v_invoices_missing_lines  NUMBER := 0;
        v_amount_mismatches       NUMBER := 0;
        v_possibly_truncated      NUMBER := 0;
        v_total_header_amount     NUMBER := 0;
        v_total_line_amount       NUMBER := 0;
        v_invoices_with_installs  NUMBER := 0;
        v_missing_installments    NUMBER := 0;

    BEGIN
        SELECT
            COUNT(*)
          , COUNT(CASE WHEN NVL(l.line_count, 0) > 0  THEN 1 END)
          , COUNT(CASE WHEN NVL(l.line_count, 0) = 0  THEN 1 END)
          , COUNT(CASE WHEN NVL(l.line_count, 0) > 0
                        AND ABS(NVL(h.invoice_amount,0) - NVL(l.total_line_amount,0)) > 0.01
                       THEN 1 END)
          , COUNT(CASE WHEN l.line_count = 25         THEN 1 END)
          , NVL(SUM(h.invoice_amount), 0)
          , NVL(SUM(CASE WHEN NVL(l.line_count, 0) > 0 THEN l.total_line_amount END), 0)
          , COUNT(CASE WHEN NVL(inst.inst_count, 0) > 0 THEN 1 END)
          , COUNT(CASE WHEN NVL(inst.inst_count, 0) = 0 THEN 1 END)
        INTO
            v_total_invoices, v_invoices_with_lines, v_invoices_missing_lines,
            v_amount_mismatches, v_possibly_truncated,
            v_total_header_amount, v_total_line_amount,
            v_invoices_with_installs, v_missing_installments
        FROM RR_AP_INVOICES_ALL h
        LEFT JOIN (
            SELECT invoice_id
                 , SUM(line_amount) AS total_line_amount
                 , COUNT(*)         AS line_count
            FROM   RR_AP_INVOICE_LINES_ALL
            GROUP BY invoice_id
        ) l ON l.invoice_id = h.invoice_id
        LEFT JOIN (
            SELECT invoice_id, COUNT(*) AS inst_count
            FROM   RR_AP_INVOICE_INSTALLMENTS
            GROUP BY invoice_id
        ) inst ON inst.invoice_id = h.invoice_id
        WHERE (p_business_unit IS NULL OR h.business_unit = p_business_unit);

        RETURN
            '{"totalInvoices":'                || v_total_invoices
         || ',"invoicesWithLines":'            || v_invoices_with_lines
         || ',"invoicesMissingLines":'         || v_invoices_missing_lines
         || ',"amountMismatches":'             || v_amount_mismatches
         || ',"possiblyTruncated":'            || v_possibly_truncated
         || ',"totalHeaderAmount":'            || jnum(v_total_header_amount)
         || ',"totalLineAmount":'              || jnum(v_total_line_amount)
         || ',"amountVariance":'               || jnum(v_total_header_amount - v_total_line_amount)
         || ',"invoicesWithInstallments":'     || v_invoices_with_installs
         || ',"invoicesMissingInstallments":'  || v_missing_installments
         || '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"error":true,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_summary;

    -- ── get_details ───────────────────────────────────────────────────────────
    FUNCTION get_details(
        p_business_unit VARCHAR2 DEFAULT NULL,
        p_filter        VARCHAR2 DEFAULT 'ISSUES',
        p_limit         NUMBER   DEFAULT 500,
        p_offset        NUMBER   DEFAULT 0
    ) RETURN CLOB IS

        v_items   CLOB;
        v_result  CLOB;
        v_sep     VARCHAR2(1) := '';
        v_total   NUMBER      := 0;

        -- row variables
        v_invoice_id         NUMBER;
        v_invoice_number     VARCHAR2(50);
        v_supplier           VARCHAR2(360);
        v_supplier_number    VARCHAR2(30);
        v_business_unit      VARCHAR2(240);
        v_invoice_currency   VARCHAR2(15);
        v_invoice_date       DATE;
        v_invoice_type       VARCHAR2(30);
        v_validation_status  VARCHAR2(30);
        v_header_amount      NUMBER;
        v_total_line_amount  NUMBER;
        v_difference         NUMBER;
        v_line_count         NUMBER;
        v_inst_count         NUMBER;
        v_status             VARCHAR2(30);

        -- ── helper: WHERE fragment ────────────────────────────────────────────
        -- The filter logic is repeated for both the COUNT query and the cursor.
        -- We inline it in both places to avoid dynamic SQL.

        CURSOR c_rows IS
            SELECT
                h.invoice_id
              , h.invoice_number
              , h.supplier
              , h.supplier_number
              , h.business_unit
              , h.invoice_currency
              , h.invoice_date
              , h.invoice_type
              , h.validation_status
              , NVL(h.invoice_amount,        0)  AS header_amount
              , NVL(l.total_line_amount,      0)  AS total_line_amount
              , NVL(h.invoice_amount,        0)
                - NVL(l.total_line_amount,   0)   AS difference
              , NVL(l.line_count,            0)  AS line_count
              , NVL(inst.inst_count,         0)  AS inst_count
              , CASE
                    WHEN NVL(l.line_count, 0) = 0
                        THEN 'MISSING_LINES'
                    WHEN ABS(NVL(h.invoice_amount,0) - NVL(l.total_line_amount,0)) > 0.01
                        THEN 'AMOUNT_MISMATCH'
                    WHEN l.line_count = 25
                        THEN 'POSSIBLY_TRUNCATED'
                    ELSE 'OK'
                END AS status
            FROM RR_AP_INVOICES_ALL h
            LEFT JOIN (
                SELECT invoice_id
                     , SUM(line_amount) AS total_line_amount
                     , COUNT(*)         AS line_count
                FROM   RR_AP_INVOICE_LINES_ALL
                GROUP BY invoice_id
            ) l ON l.invoice_id = h.invoice_id
            LEFT JOIN (
                SELECT invoice_id, COUNT(*) AS inst_count
                FROM   RR_AP_INVOICE_INSTALLMENTS
                GROUP BY invoice_id
            ) inst ON inst.invoice_id = h.invoice_id
            WHERE  (p_business_unit IS NULL OR h.business_unit = p_business_unit)
              AND  (
                      p_filter = 'ALL'
                   OR (p_filter IN ('ISSUES','MISSING_LINES')
                       AND NVL(l.line_count, 0) = 0)
                   OR (p_filter IN ('ISSUES','AMOUNT_MISMATCH')
                       AND ABS(NVL(h.invoice_amount,0) - NVL(l.total_line_amount,0)) > 0.01)
                   OR (p_filter IN ('ISSUES','TRUNCATED')
                       AND l.line_count = 25)
                   )
            ORDER BY
                CASE
                    WHEN NVL(l.line_count,0) = 0                                                          THEN 1
                    WHEN ABS(NVL(h.invoice_amount,0) - NVL(l.total_line_amount,0)) > 0.01                 THEN 2
                    WHEN l.line_count = 25                                                                 THEN 3
                    ELSE 4
                END,
                h.invoice_number
            OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY;

    BEGIN
        -- total matching rows (for pagination)
        SELECT COUNT(*)
        INTO   v_total
        FROM   RR_AP_INVOICES_ALL h
        LEFT JOIN (
            SELECT invoice_id, SUM(line_amount) AS total_line_amount, COUNT(*) AS line_count
            FROM   RR_AP_INVOICE_LINES_ALL
            GROUP BY invoice_id
        ) l ON l.invoice_id = h.invoice_id
        WHERE  (p_business_unit IS NULL OR h.business_unit = p_business_unit)
          AND  (
                  p_filter = 'ALL'
               OR (p_filter IN ('ISSUES','MISSING_LINES')
                   AND NVL(l.line_count, 0) = 0)
               OR (p_filter IN ('ISSUES','AMOUNT_MISMATCH')
                   AND ABS(NVL(h.invoice_amount,0) - NVL(l.total_line_amount,0)) > 0.01)
               OR (p_filter IN ('ISSUES','TRUNCATED')
                   AND l.line_count = 25)
               );

        DBMS_LOB.CREATETEMPORARY(v_items, TRUE);

        OPEN c_rows;
        LOOP
            FETCH c_rows INTO
                v_invoice_id, v_invoice_number, v_supplier, v_supplier_number,
                v_business_unit, v_invoice_currency, v_invoice_date, v_invoice_type,
                v_validation_status, v_header_amount, v_total_line_amount,
                v_difference, v_line_count, v_inst_count, v_status;
            EXIT WHEN c_rows%NOTFOUND;

            DBMS_LOB.APPEND(v_items,
                v_sep
             || '{'
             || '"invoiceId":'         || NVL(TO_CHAR(v_invoice_id), 'null')
             || ',"invoiceNumber":'    || jstr(v_invoice_number)
             || ',"supplier":'         || jstr(v_supplier)
             || ',"supplierNumber":'   || jstr(v_supplier_number)
             || ',"businessUnit":'     || jstr(v_business_unit)
             || ',"invoiceCurrency":' || jstr(v_invoice_currency)
             || ',"invoiceDate":'      || jdate(v_invoice_date)
             || ',"invoiceType":'      || jstr(v_invoice_type)
             || ',"validationStatus":' || jstr(v_validation_status)
             || ',"headerAmount":'     || jnum(v_header_amount)
             || ',"totalLineAmount":'  || jnum(v_total_line_amount)
             || ',"difference":'       || jnum(v_difference)
             || ',"lineCount":'        || NVL(TO_CHAR(v_line_count), '0')
             || ',"installmentCount":' || NVL(TO_CHAR(v_inst_count), '0')
             || ',"status":'           || jstr(v_status)
             || '}'
            );
            v_sep := ',';
        END LOOP;
        CLOSE c_rows;

        v_result :=
            '{"totalCount":'  || v_total
         || ',"hasMore":'     || CASE WHEN (p_offset + p_limit) < v_total THEN 'true' ELSE 'false' END
         || ',"items":['      || v_items || ']}';

        RETURN v_result;

    EXCEPTION
        WHEN OTHERS THEN
            IF c_rows%ISOPEN THEN CLOSE c_rows; END IF;
            RETURN '{"error":true,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_details;

END RR_AP_MIGRATION_CHECK_PKG;
/


-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
SELECT object_name, object_type, status
FROM   user_objects
WHERE  object_name = 'RR_AP_MIGRATION_CHECK_PKG'
ORDER BY object_type;
