-- ============================================================
-- RR_AP_CANCEL_INVOICE_PKG
-- Invoice Cancellation: eligibility check + cancel + SLA reversal
--
-- Endpoints:
--   GET  /ap/invoices/:invoice_id/cancel-eligibility
--   POST /ap/invoices/:invoice_id/cancel
-- ============================================================

-- ============================================================
-- Step 0: One-time migration — copy old wrong-named columns
-- (cancellation_date → canceled_date, cancelled_by → canceled_by)
-- Safe to run multiple times; skips silently if columns don't exist.
-- ============================================================
DECLARE
    PROCEDURE migrate_col(p_src VARCHAR2, p_dst VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE
            'UPDATE RR_AP_INVOICES_ALL '
            || 'SET ' || p_dst || ' = ' || p_src || ' '
            || 'WHERE ' || p_src || ' IS NOT NULL AND (' || p_dst || ' IS NULL)';
        COMMIT;
    EXCEPTION WHEN OTHERS THEN NULL;  -- column may not exist — skip
    END;
BEGIN
    migrate_col('cancellation_date', 'canceled_date');
    migrate_col('cancelled_by',      'canceled_by');
END;
/

-- ============================================================
-- Step 1: Add cancellation columns to RR_AP_INVOICES_ALL
-- (safe — skips if columns already exist)
-- ============================================================
DECLARE
    PROCEDURE add_col(p_col VARCHAR2, p_def VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_AP_INVOICES_ALL ADD (' || p_col || ' ' || p_def || ')';
    EXCEPTION WHEN OTHERS THEN NULL;   -- ORA-01430: column already exists
    END;
BEGIN
    add_col('canceled_flag',  'VARCHAR2(1)  DEFAULT ''N''');
    add_col('canceled_date', 'DATE');
    add_col('canceled_by',   'VARCHAR2(100)');
END;
/

-- ============================================================
-- Step 2: Package Spec
-- ============================================================
CREATE OR REPLACE PACKAGE RR_AP_CANCEL_INVOICE_PKG AS

    -- Returns JSON: { eligible, invoiceNumber, invoiceType, paidStatus, checks:[{check,passed,detail}] }
    FUNCTION check_eligibility(
        p_invoice_id IN NUMBER
    ) RETURN CLOB;

    -- Cancels the invoice; creates SLA reversal if accounting was posted.
    -- Returns JSON: { status, message, invoiceId, slaReversalCreated }
    FUNCTION cancel_invoice(
        p_invoice_id   IN NUMBER,
        p_cancelled_by IN VARCHAR2 DEFAULT 'SYSTEM'
    ) RETURN CLOB;

END RR_AP_CANCEL_INVOICE_PKG;
/

-- ============================================================
-- Step 3: Package Body
-- ============================================================
CREATE OR REPLACE PACKAGE BODY RR_AP_CANCEL_INVOICE_PKG AS

    -- --------------------------------------------------------
    -- Private helper: build one check JSON object
    -- --------------------------------------------------------
    FUNCTION jcheck(
        p_label  IN VARCHAR2,
        p_passed IN BOOLEAN,
        p_detail IN VARCHAR2 DEFAULT NULL
    ) RETURN VARCHAR2 IS
        v_p VARCHAR2(5) := CASE WHEN p_passed THEN 'true' ELSE 'false' END;
    BEGIN
        IF p_detail IS NOT NULL THEN
            RETURN '{"check":"' || REPLACE(p_label,'"','\"') || '","passed":' || v_p
                || ',"detail":"' || REPLACE(p_detail,'"','\"') || '"}';
        ELSE
            RETURN '{"check":"' || REPLACE(p_label,'"','\"') || '","passed":' || v_p || '}';
        END IF;
    END jcheck;

    -- --------------------------------------------------------
    -- check_eligibility
    -- --------------------------------------------------------
    FUNCTION check_eligibility(
        p_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_invoice_number  VARCHAR2(100);
        v_invoice_type    VARCHAR2(50);
        v_paid_status     VARCHAR2(50);
        v_canceled_flag   VARCHAR2(1);
        v_invoice_amount  NUMBER := 0;

        -- balance calculation
        v_cash_paid       NUMBER := 0;   -- non-voided, positive payments
        v_prepay_net      NUMBER := 0;   -- net prepayment amount still active
        v_outstanding     NUMBER := 0;   -- invoice_amount - cash_paid - prepay_net

        v_applied_count   NUMBER := 0;   -- for display only
        v_prepay_used     NUMBER := 0;

        c_not_cancelled   BOOLEAN;
        c_not_paid        BOOLEAN;
        c_no_applied      BOOLEAN;
        c_prepay_ok       BOOLEAN := TRUE;

        v_checks          VARCHAR2(4000) := '';
        v_eligible        BOOLEAN;
    BEGIN
        -- Fetch invoice header
        BEGIN
            SELECT invoice_number, invoice_type,
                   NVL(paid_status, 'Unpaid'),
                   NVL(canceled_flag, 'N'),
                   NVL(invoice_amount, 0)
            INTO   v_invoice_number, v_invoice_type,
                   v_paid_status, v_canceled_flag,
                   v_invoice_amount
            FROM   RR_AP_INVOICES_ALL
            WHERE  invoice_id = p_invoice_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN '{"eligible":false,"invoiceNumber":"","checks":['
                    || jcheck('Invoice exists', FALSE, 'Invoice ID ' || p_invoice_id || ' not found')
                    || ']}';
        END;

        -- Calculate net cash paid (exclude voided payments and negative reversals)
        SELECT NVL(SUM(ri.AMOUNT_PAID_INVOICE_CURRENCY), 0)
        INTO   v_cash_paid
        FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
        WHERE  ri.invoice_id = p_invoice_id
          AND  NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
          AND  ri.AMOUNT_PAID_INVOICE_CURRENCY > 0;

        -- Calculate net prepayment applied:
        -- A prepayment application is "voided" when its payment record is voided.
        -- We only count applications whose underlying prepayment payment is still active.
        SELECT NVL(SUM(ap.applied_amount), 0)
        INTO   v_prepay_net
        FROM   RR_AP_APPLIED_PREPAYMENTS ap
        WHERE  ap.invoice_id = p_invoice_id
          AND  NVL(ap.status, 'Applied') != 'Cancelled'
          AND  EXISTS (
              -- The prepayment's payment must be non-voided and positive
              SELECT 1
              FROM   RR_AP_PAYMENTS_RELATED_INVOICES pr
              WHERE  pr.invoice_id = ap.prepayment_invoice_id
                AND  NVL(pr.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
                AND  pr.AMOUNT_PAID_INVOICE_CURRENCY > 0
          );

        -- Row count for display (any record with status=Applied regardless of payment state)
        SELECT COUNT(*) INTO v_applied_count
        FROM   RR_AP_APPLIED_PREPAYMENTS
        WHERE  invoice_id = p_invoice_id
          AND  NVL(status, 'Applied') = 'Applied';

        -- Outstanding balance: if = invoice amount, nothing is effectively paid/applied
        v_outstanding := v_invoice_amount - v_cash_paid - v_prepay_net;

        -- Check 1: not already cancelled
        c_not_cancelled := (v_canceled_flag != 'Y');

        -- Check 2: no effective cash payments
        -- Pass if outstanding balance = invoice amount (all payments voided/reversed)
        c_not_paid := (v_cash_paid <= 0.005)
                      AND NVL(v_paid_status, 'Unpaid') NOT IN ('Paid', 'Fully Paid', 'Partial');

        -- Check 3: no effective prepayment applications
        -- Pass if net active prepay applied = 0 (voided prepayments don't count)
        c_no_applied := (v_prepay_net <= 0.005);

        -- Check 4 (Prepayment only): not applied to any invoice
        IF v_invoice_type = 'Prepayment' THEN
            SELECT COUNT(*) INTO v_prepay_used
            FROM   RR_AP_APPLIED_PREPAYMENTS
            WHERE  prepayment_invoice_id = p_invoice_id
              AND  NVL(status, 'Applied') = 'Applied';
            c_prepay_ok := (v_prepay_used = 0);
        END IF;

        v_eligible := c_not_cancelled AND c_not_paid AND c_no_applied AND c_prepay_ok;

        -- Build checks array
        v_checks := jcheck('Not already cancelled', c_not_cancelled,
                        CASE WHEN NOT c_not_cancelled THEN 'Invoice is already cancelled' END);
        v_checks := v_checks || ','
                 || jcheck('No effective cash payments', c_not_paid,
                        CASE WHEN NOT c_not_paid
                             THEN 'Invoice has active payments (paid status: ' || v_paid_status || ')'
                        END);
        v_checks := v_checks || ','
                 || jcheck('No effective prepayment applications', c_no_applied,
                        CASE WHEN NOT c_no_applied
                             THEN TO_CHAR(v_applied_count) || ' prepayment application(s) — net applied: '
                                  || TO_CHAR(v_prepay_net, 'FM999,999,990.00')
                        END);
        IF v_invoice_type = 'Prepayment' THEN
            v_checks := v_checks || ','
                     || jcheck('Prepayment not applied to invoices', c_prepay_ok,
                            CASE WHEN NOT c_prepay_ok
                                 THEN 'This prepayment has been applied to ' || v_prepay_used || ' invoice(s)'
                            END);
        END IF;

        RETURN '{"eligible":' || CASE WHEN v_eligible THEN 'true' ELSE 'false' END
            || ',"invoiceNumber":"' || REPLACE(v_invoice_number,'"','\"') || '"'
            || ',"invoiceType":"'   || REPLACE(v_invoice_type,  '"','\"') || '"'
            || ',"paidStatus":"'    || REPLACE(v_paid_status,   '"','\"') || '"'
            || ',"invoiceAmount":'  || TO_CHAR(v_invoice_amount)
            || ',"outstanding":'    || TO_CHAR(v_outstanding)
            || ',"checks":[' || v_checks || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"eligible":false,"invoiceNumber":"","checks":[]'
                || ',"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END check_eligibility;

    -- --------------------------------------------------------
    -- cancel_invoice
    -- --------------------------------------------------------
    FUNCTION cancel_invoice(
        p_invoice_id   IN NUMBER,
        p_cancelled_by IN VARCHAR2 DEFAULT 'SYSTEM'
    ) RETURN CLOB IS
        v_elig            CLOB;
        v_eligible        VARCHAR2(10);
        v_invoice_number  VARCHAR2(100);
        v_invoice_type    VARCHAR2(50);
        v_invoice_amount  NUMBER;
        v_currency        VARCHAR2(10);
        v_business_unit   VARCHAR2(100);
        v_acct_date       DATE;
        v_liability_dist  VARCHAR2(200);

        -- SLA reversal variables
        v_sla_header_id      NUMBER;
        v_sla_ledger_id      NUMBER;
        v_sla_ledger_name    VARCHAR2(200);
        v_sla_ledger_ccy     VARCHAR2(15);
        v_cancel_header_id   NUMBER;
        v_sla_period         VARCHAR2(20);
        v_sla_body           CLOB;
        v_sla_status         NUMBER;
        v_sla_response       CLOB;
        v_sla_created        BOOLEAN := FALSE;
        v_line_cursor        SYS_REFCURSOR;
        v_line_num           NUMBER := 0;
        v_line_type          VARCHAR2(2);
        v_acct_class         VARCHAR2(50);
        v_acct_combo         VARCHAR2(200);
        v_entered_dr         NUMBER;
        v_entered_cr         NUMBER;
        v_accted_dr          NUMBER;
        v_accted_cr          NUMBER;
        v_line_desc          VARCHAR2(200);
        v_line_ccy           VARCHAR2(10);
        v_lines_json         CLOB := '';
        v_comma              VARCHAR2(1) := '';
    BEGIN
        -- 1. Re-check eligibility
        v_elig := check_eligibility(p_invoice_id);
        SELECT JSON_VALUE(v_elig, '$.eligible') INTO v_eligible FROM DUAL;

        IF v_eligible != 'true' THEN
            RETURN '{"status":"error","message":"Invoice is not eligible for cancellation"'
                || ',"eligibility":' || v_elig || '}';
        END IF;

        -- 2. Fetch invoice details
        SELECT invoice_number, invoice_type, invoice_amount,
               invoice_currency, business_unit,
               NVL(accounting_date, invoice_date),
               liability_distribution
        INTO   v_invoice_number, v_invoice_type, v_invoice_amount,
               v_currency, v_business_unit,
               v_acct_date, v_liability_dist
        FROM   RR_AP_INVOICES_ALL
        WHERE  invoice_id = p_invoice_id;

        -- 3. Check if a POSTED SLA header exists — also get ledger from it
        BEGIN
            SELECT header_id, ledger_id, ledger_name,
                   NVL(currency_code, 'AED')
            INTO   v_sla_header_id, v_sla_ledger_id, v_sla_ledger_name,
                   v_sla_ledger_ccy
            FROM   RR_SLA_ACCOUNTING_HEADERS
            WHERE  source_id    = p_invoice_id
              AND  source_table = 'AP_INVOICES'
              AND  accounting_status = 'POSTED'
            FETCH FIRST 1 ROW ONLY;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_sla_header_id := NULL;
        END;

        -- 4. If POSTED SLA exists, build reversal payload and call create_accounting
        IF v_sla_header_id IS NOT NULL THEN

            -- Period based on cancellation date (SYSDATE), format Mon-YY (e.g. Apr-26)
            v_sla_period := TO_CHAR(SYSDATE, 'Mon-RR');

            -- Collect original lines, swap DR/CR
            OPEN v_line_cursor FOR
                SELECT line_number, line_type, accounting_class,
                       account_combination,
                       entered_dr, entered_cr,
                       accounted_dr, accounted_cr,
                       NVL(description, ''), NVL(currency_code, v_currency)
                FROM   RR_SLA_ACCOUNTING_LINES
                WHERE  header_id = v_sla_header_id
                ORDER  BY line_number;

            LOOP
                FETCH v_line_cursor INTO
                    v_line_num, v_line_type, v_acct_class, v_acct_combo,
                    v_entered_dr, v_entered_cr,
                    v_accted_dr,  v_accted_cr,
                    v_line_desc,  v_line_ccy;
                EXIT WHEN v_line_cursor%NOTFOUND;

                -- Swap DR <-> CR (reversal)
                v_lines_json := v_lines_json || v_comma || '{'
                    || '"lineNumber":'        || v_line_num  || ','
                    || '"lineType":"'         || CASE WHEN v_line_type = 'DR' THEN 'CR' ELSE 'DR' END || '",'
                    || '"accountingClass":"'  || REPLACE(v_acct_class, '"','\"') || '",'
                    || '"accountCombination":"' || REPLACE(v_acct_combo, '"','\"') || '",'
                    || '"enteredDr":'         || NVL(v_entered_cr,0) || ','
                    || '"enteredCr":'         || NVL(v_entered_dr,0) || ','
                    || '"accountedDr":'       || NVL(v_accted_cr,0)  || ','
                    || '"accountedCr":'       || NVL(v_accted_dr,0)  || ','
                    || '"currencyCode":"'     || v_line_ccy || '",'
                    || '"description":"Cancellation Reversal - ' || REPLACE(v_invoice_number,'"','\"') || '"'
                    || '}';
                v_comma := ',';
            END LOOP;
            CLOSE v_line_cursor;

            IF v_lines_json IS NOT NULL THEN
                v_sla_body :=
                    '{"header":{'
                    || '"moduleName":"AP",'
                    || '"sourceTable":"AP_INVOICES",'
                    || '"sourceId":'    || p_invoice_id    || ','
                    || '"sourceNumber":"' || REPLACE(v_invoice_number,'"','\"') || '",'
                    || '"sourceType":"'   || REPLACE(v_invoice_type,  '"','\"') || '",'
                    || '"eventTypeCode":"INVOICE_CANCELLED",'
                    || '"eventDate":"'      || TO_CHAR(SYSDATE, 'YYYY-MM-DD')      || '",'
                    || '"accountingDate":"' || TO_CHAR(SYSDATE, 'YYYY-MM-DD')      || '",'
                    || '"periodName":"'     || v_sla_period                         || '",'
                    || '"ledgerId":'        || NVL(TO_CHAR(v_sla_ledger_id), 'null') || ','
                    || '"ledgerName":"'     || REPLACE(NVL(v_sla_ledger_name,''), '"','\"') || '",'
                    || '"currencyCode":"'   || v_currency                           || '",'
                    || '"ledgerCurrency":"' || v_sla_ledger_ccy                     || '",'
                    || '"exchangeRate":1,'
                    || '"exchangeRateType":"Corporate",'
                    || '"businessUnit":"'   || REPLACE(v_business_unit,'"','\"')    || '",'
                    || '"description":"Invoice Cancellation - ' || REPLACE(v_invoice_number,'"','\"') || '",'
                    || '"createdBy":"'      || REPLACE(p_cancelled_by,'"','\"')     || '"'
                    || '},"lines":[' || v_lines_json || ']}';

                RR_SLA_PKG.create_accounting(
                    p_body_json => v_sla_body,
                    p_status    => v_sla_status,
                    p_response  => v_sla_response
                );
                v_sla_created := (v_sla_status IN (200, 201));

                -- Auto-post the cancellation reversal immediately
                IF v_sla_created THEN
                    BEGIN
                        v_cancel_header_id := TO_NUMBER(JSON_VALUE(v_sla_response, '$.headerId'));
                        IF v_cancel_header_id IS NOT NULL THEN
                            UPDATE RR_SLA_ACCOUNTING_HEADERS
                            SET    accounting_status = 'POSTED',
                                   posting_status    = 'POSTED',
                                   posted_date       = SYSDATE,
                                   posted_by         = p_cancelled_by,
                                   gl_batch_name     = 'CANCEL-' || p_invoice_id
                                                       || '-' || TO_CHAR(SYSDATE,'YYYYMMDD')
                            WHERE  header_id = v_cancel_header_id;
                        END IF;
                    EXCEPTION WHEN OTHERS THEN NULL;  -- non-critical; reversal still created
                    END;
                END IF;
            END IF;

        ELSE
            -- Draft SLA (never posted): mark existing draft headers as VOID
            UPDATE RR_SLA_ACCOUNTING_HEADERS
            SET    accounting_status = 'VOID'
            WHERE  source_id    = p_invoice_id
              AND  source_table = 'AP_INVOICES'
              AND  accounting_status IN ('DRAFT', 'ERROR');
        END IF;

        -- 5. Cancel multiperiod schedule lines (if any)
        UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
        SET    transaction_status = 'Cancelled',
               last_updated_by    = p_cancelled_by,
               last_update_date   = SYSTIMESTAMP
        WHERE  invoice_id         = p_invoice_id
          AND  transaction_status = 'Active';

        -- 6. Cancel the invoice
        UPDATE RR_AP_INVOICES_ALL
        SET    canceled_flag = 'Y',
               paid_status   = 'Cancelled',
               canceled_date = SYSDATE,
               canceled_by   = p_cancelled_by
        WHERE  invoice_id = p_invoice_id;

        COMMIT;

        RETURN '{"status":"success"'
            || ',"message":"Invoice ' || REPLACE(v_invoice_number,'"','\"') || ' has been cancelled"'
            || ',"invoiceId":' || p_invoice_id
            || ',"invoiceNumber":"' || REPLACE(v_invoice_number,'"','\"') || '"'
            || ',"slaReversalCreated":' || CASE WHEN v_sla_created THEN 'true' ELSE 'false' END
            || '}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END cancel_invoice;

END RR_AP_CANCEL_INVOICE_PKG;
/

-- ============================================================
-- Step 4: ORDS REST Handlers
-- Module: ap   (matches all other AP endpoints)
-- ============================================================

-- Template: ap/invoices/:invoice_id/cancel-eligibility
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/:invoice_id/cancel-eligibility'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/:invoice_id/cancel-eligibility',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Invoice cancellation eligibility check'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:invoice_id/cancel-eligibility',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Check if invoice can be cancelled',
        p_source         => q'[
DECLARE
    v_result CLOB;
BEGIN
    v_result := RR_AP_CANCEL_INVOICE_PKG.check_eligibility(
        p_invoice_id => TO_NUMBER(:invoice_id)
    );
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN(v_result);
END;]'
    );
    COMMIT;
END;
/

-- Template: ap/invoices/:invoice_id/cancel
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/:invoice_id/cancel'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/:invoice_id/cancel',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Cancel an AP invoice'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:invoice_id/cancel',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_items_per_page => 0,
        p_comments       => 'Cancel invoice + SLA reversal if accounting was posted',
        p_source         => q'[
DECLARE
    v_body         CLOB    := :body_text;
    v_cancelled_by VARCHAR2(100);
    v_result       CLOB;
BEGIN
    -- Optional: read cancelledBy from JSON body
    BEGIN
        SELECT JSON_VALUE(v_body, '$.cancelledBy')
        INTO   v_cancelled_by
        FROM   DUAL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_result := RR_AP_CANCEL_INVOICE_PKG.cancel_invoice(
        p_invoice_id   => TO_NUMBER(:invoice_id),
        p_cancelled_by => NVL(v_cancelled_by, 'SYSTEM')
    );

    IF v_result LIKE '%"status":"success"%' THEN
        :status_code := 200;
    ELSE
        :status_code := 422;
    END IF;

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN(v_result);
END;]'
    );
    COMMIT;
END;
/
