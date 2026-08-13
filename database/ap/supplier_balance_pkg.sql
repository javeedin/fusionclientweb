-- ============================================================================
-- SUPPLIER BALANCE PACKAGE
-- Purpose: Provides APIs for Supplier Balance Dashboard
-- Author: REERP Team
-- Version: 1.1
-- ============================================================================

-- ============================================================================
-- PACKAGE SPECIFICATION
-- ============================================================================
CREATE OR REPLACE PACKAGE PKG_SUPPLIER_BALANCE AS

    -- ========================================================================
    -- FUNCTION: Get Supplier Details
    -- Returns JSON with supplier master and address info
    -- ========================================================================
    FUNCTION get_supplier_details(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Balance Summary
    -- Returns JSON with total invoices, payments, balance
    -- ========================================================================
    FUNCTION get_balance_summary(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Aging Report
    -- Returns JSON with aging buckets
    -- ========================================================================
    FUNCTION get_aging_report(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Supplier Invoices
    -- Returns JSON with invoice list (paginated)
    -- ========================================================================
    FUNCTION get_supplier_invoices(
        p_supplier_number IN VARCHAR2,
        p_status          IN VARCHAR2 DEFAULT 'All',
        p_limit           IN NUMBER DEFAULT 100,
        p_offset          IN NUMBER DEFAULT 0
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Supplier Payments
    -- Returns JSON with payment list (paginated)
    -- ========================================================================
    FUNCTION get_supplier_payments(
        p_supplier_number IN VARCHAR2,
        p_status          IN VARCHAR2 DEFAULT 'All',
        p_limit           IN NUMBER DEFAULT 100,
        p_offset          IN NUMBER DEFAULT 0
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Payment Related Invoices (Drilldown)
    -- Returns JSON with invoices paid by a specific payment
    -- ========================================================================
    FUNCTION get_payment_invoices(
        p_check_id IN NUMBER
    ) RETURN CLOB;

    -- ========================================================================
    -- FUNCTION: Get Complete Dashboard
    -- Returns JSON with all dashboard data in one call
    -- ========================================================================
    FUNCTION get_dashboard(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB;

    -- ========================================================================
    -- PROCEDURE: Output JSON Response (for ORDS handlers)
    -- ========================================================================
    PROCEDURE output_response(
        p_json        IN CLOB,
        p_status_code OUT NUMBER
    );

END PKG_SUPPLIER_BALANCE;
/


-- ============================================================================
-- PACKAGE BODY
-- ============================================================================
CREATE OR REPLACE PACKAGE BODY PKG_SUPPLIER_BALANCE AS

    -- ========================================================================
    -- PRIVATE: Helper function to safely parse date
    -- ========================================================================
    FUNCTION safe_to_date(p_date_str IN VARCHAR2) RETURN DATE IS
        l_date DATE;
    BEGIN
        IF p_date_str IS NULL THEN
            RETURN NULL;
        END IF;

        -- Try MM/DD/YYYY format first
        BEGIN
            l_date := TO_DATE(p_date_str, 'MM/DD/YYYY');
            RETURN l_date;
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;

        -- Try YYYY-MM-DD format
        BEGIN
            l_date := TO_DATE(p_date_str, 'YYYY-MM-DD');
            RETURN l_date;
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;

        -- Try DD-MON-YY format
        BEGIN
            l_date := TO_DATE(p_date_str, 'DD-MON-YY');
            RETURN l_date;
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;

        RETURN NULL;
    END safe_to_date;

    -- ========================================================================
    -- PRIVATE: Get supplier address as JSON
    -- ========================================================================
    FUNCTION get_address_json(p_supplier_id IN NUMBER) RETURN CLOB IS
        l_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'address_id'         VALUE SUPPLIER_ADDRESS_ID,
            'address_name'       VALUE ADDRESS_NAME,
            'address_line_1'     VALUE ADDRESS_LINE1,
            'address_line_2'     VALUE ADDRESS_LINE2,
            'address_line_3'     VALUE ADDRESS_LINE3,
            'city'               VALUE CITY,
            'state'              VALUE STATE,
            'country'            VALUE COUNTRY,
            'postal_code'        VALUE POSTAL_CODE,
            'formatted_address'  VALUE FORMATTED_ADDRESS,
            'phone'              VALUE PHONE_NUMBER,
            'email'              VALUE EMAIL
            ABSENT ON NULL
        )
        INTO l_result
        FROM RR_SUPPLIER_ADDRESS
        WHERE SUPPLIER_ID = p_supplier_id
        AND STATUS = 'ACTIVE'
        AND ROWNUM = 1;

        RETURN l_result;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
        WHEN OTHERS THEN
            RETURN NULL;
    END get_address_json;

    -- ========================================================================
    -- FUNCTION: Get Supplier Details
    -- ========================================================================
    FUNCTION get_supplier_details(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB IS
        l_result        CLOB;
        l_supplier_id   NUMBER;
        l_address       CLOB;
    BEGIN
        -- Get supplier ID first
        SELECT SUPPLIER_ID INTO l_supplier_id
        FROM RR_SUPPLIER_MASTER
        WHERE SUPPLIER_NUMBER = p_supplier_number;

        -- Get address
        l_address := get_address_json(l_supplier_id);

        -- Build full response
        SELECT JSON_OBJECT(
            'success' VALUE 'true',
            'supplier' VALUE JSON_OBJECT(
                'supplier_id'              VALUE sm.SUPPLIER_ID,
                'supplier_party_id'        VALUE sm.SUPPLIER_PARTY_ID,
                'supplier_name'            VALUE sm.SUPPLIER,
                'supplier_number'          VALUE sm.SUPPLIER_NUMBER,
                'alternate_name'           VALUE sm.ALTERNATE_NAME,
                'supplier_type'            VALUE sm.SUPPLIER_TYPE,
                'status'                   VALUE sm.STATUS,
                'business_relationship'    VALUE sm.BUSINESS_RELATIONSHIP,
                'tax_registration_number'  VALUE sm.TAX_REGISTRATION_NUMBER,
                'taxpayer_id'              VALUE sm.TAXPAYER_ID,
                'customer_number'          VALUE sm.CUSTOMER_NUMBER,
                'corporate_website'        VALUE sm.CORPORATE_WEBSITE,
                'creation_date'            VALUE TO_CHAR(sm.CREATION_DATE, 'YYYY-MM-DD'),
                'address'                  VALUE TREAT(l_address AS JSON)
                ABSENT ON NULL
            )
        )
        INTO l_result
        FROM RR_SUPPLIER_MASTER sm
        WHERE sm.SUPPLIER_NUMBER = p_supplier_number;

        RETURN l_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"success": "false", "error": "Supplier not found", "supplier_number": "' || p_supplier_number || '"}';
        WHEN OTHERS THEN
            RETURN '{"success": "false", "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_supplier_details;

    -- ========================================================================
    -- FUNCTION: Get Balance Summary
    -- ========================================================================
    FUNCTION get_balance_summary(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB IS
        l_result            CLOB;
        l_total_invoices    NUMBER := 0;
        l_total_paid        NUMBER := 0;
        l_invoice_count     NUMBER := 0;
        l_payment_count     NUMBER := 0;
        l_unpaid_count      NUMBER := 0;
        l_balance           NUMBER := 0;
    BEGIN
        -- Invoice totals (regular invoices only, for display)
        SELECT
            NVL(SUM(i.INVOICE_AMOUNT), 0),
            COUNT(*),
            NVL(SUM(NVL(pay_sum.total_paid, 0) + NVL(prep_sum.total_applied, 0)), 0),
            COUNT(CASE WHEN NVL(i.PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled') THEN 1 END)
        INTO l_total_invoices, l_invoice_count, l_total_paid, l_unpaid_count
        FROM RR_AP_INVOICES_ALL i
        LEFT JOIN (
            SELECT ri.INVOICE_ID,
                   SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
            WHERE  NVL(p.PAYMENT_STATUS,           'Active') != 'Voided'
            AND    NVL(ri.INVOICE_PAYMENT_STATUS,  'Active') != 'Voided'
            GROUP BY ri.INVOICE_ID
        ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
        LEFT JOIN (
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                     AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                ON  ap.INVOICE_ID IS NULL
                AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
        WHERE i.SUPPLIER_NUMBER = p_supplier_number
        AND NVL(i.CANCELED_FLAG, 'N')      != 'Y'
        AND NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment';

        -- Get payment count
        SELECT COUNT(DISTINCT CHECK_ID)
        INTO l_payment_count
        FROM RR_AP_PAYMENTS_ALL
        WHERE SUPPLIER_NUMBER = p_supplier_number;

        -- True outstanding balance: sum of remaining amounts across ALL invoice types.
        -- Prepayment invoices with an unapplied balance reduce the net payable to the supplier.
        SELECT NVL(SUM(
            CASE WHEN NVL(i.INVOICE_AMOUNT, 0) < 0 THEN
                NVL(i.INVOICE_AMOUNT, 0)
                - NVL(pay_sum.total_paid,            0)
                - NVL(prep_sum.total_applied,        0)
                - NVL(prepaid_sum.total_applied_out, 0)
            ELSE
                GREATEST(0,
                    NVL(i.INVOICE_AMOUNT, 0)
                    - NVL(pay_sum.total_paid,            0)
                    - NVL(prep_sum.total_applied,        0)
                    - NVL(prepaid_sum.total_applied_out, 0))
            END
        ), 0)
        INTO l_balance
        FROM RR_AP_INVOICES_ALL i
        LEFT JOIN (
            SELECT ri.INVOICE_ID,
                   SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
            WHERE  NVL(p.PAYMENT_STATUS,           'Active') != 'Voided'
            AND    NVL(ri.INVOICE_PAYMENT_STATUS,  'Active') != 'Voided'
            GROUP BY ri.INVOICE_ID
        ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
        LEFT JOIN (
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                     AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                ON  ap.INVOICE_ID IS NULL
                AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
        LEFT JOIN (
            SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS PREPAYMENT_INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                                AS total_applied_out
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL prep_r
                ON  ap.PREPAYMENT_INVOICE_ID IS NULL
                AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
        ) prepaid_sum ON prepaid_sum.PREPAYMENT_INVOICE_ID = i.INVOICE_ID
        WHERE i.SUPPLIER_NUMBER = p_supplier_number
        AND NVL(i.CANCELED_FLAG, 'N') != 'Y';

        -- Build JSON response
        l_result := JSON_OBJECT(
            'success'           VALUE 'true',
            'supplier_number'   VALUE p_supplier_number,
            'balance_summary'   VALUE JSON_OBJECT(
                'total_invoice_amount'    VALUE l_total_invoices,
                'total_payment_amount'    VALUE l_total_paid,
                'balance'                 VALUE l_balance,
                'total_invoices'          VALUE l_invoice_count,
                'total_payments'          VALUE l_payment_count,
                'unpaid_invoices'         VALUE l_unpaid_count,
                'currency'                VALUE 'AED'
            )
        );

        RETURN l_result;

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"success": "false", "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_balance_summary;

    -- ========================================================================
    -- PRIVATE: number → valid JSON number (prevents leading-dot: .695 → 0.695)
    -- ========================================================================
    FUNCTION jn_ap(p_val IN NUMBER) RETURN VARCHAR2 IS
        v_str VARCHAR2(100);
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        v_str := TO_CHAR(p_val, 'TM9');
        IF v_str LIKE '.%'  THEN v_str := '0'  || v_str; END IF;
        IF v_str LIKE '-.%' THEN v_str := '-0.' || SUBSTR(v_str, 3); END IF;
        RETURN v_str;
    END jn_ap;

    -- ========================================================================
    -- PRIVATE: escape VARCHAR2 value for JSON string (handles \, ", newline)
    -- ========================================================================
    FUNCTION js(p_val IN VARCHAR2) RETURN VARCHAR2 IS
        v_str VARCHAR2(32767);
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        v_str := p_val;
        v_str := REPLACE(v_str, '\',    '\\');   -- backslash first
        v_str := REPLACE(v_str, '"',    '\"');   -- double quote
        v_str := REPLACE(v_str, CHR(13), '\r');  -- carriage return (causes "Workfl ow" split)
        v_str := REPLACE(v_str, CHR(10), '\n');  -- line feed
        v_str := REPLACE(v_str, CHR(9),  '\t');  -- tab
        v_str := REPLACE(v_str, CHR(8),  '\b');  -- backspace
        v_str := REPLACE(v_str, CHR(12), '\f');  -- form feed
        RETURN '"' || v_str || '"';
    END js;

    -- ========================================================================
    -- FUNCTION: Get Aging Report
    -- ========================================================================
    FUNCTION get_aging_report(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB IS
        l_result            CLOB;
        l_current           NUMBER := 0;
        l_current_cnt       NUMBER := 0;
        l_days_1_30         NUMBER := 0;
        l_days_1_30_cnt     NUMBER := 0;
        l_days_31_60        NUMBER := 0;
        l_days_31_60_cnt    NUMBER := 0;
        l_days_61_90        NUMBER := 0;
        l_days_61_90_cnt    NUMBER := 0;
        l_days_91_120       NUMBER := 0;
        l_days_91_120_cnt   NUMBER := 0;
        l_days_over_120     NUMBER := 0;
        l_days_over_120_cnt NUMBER := 0;
        l_total_outstanding NUMBER := 0;
        l_pct_current       NUMBER := 0;
        l_pct_1_30          NUMBER := 0;
        l_pct_31_60         NUMBER := 0;
        l_pct_61_90         NUMBER := 0;
        l_pct_91_120        NUMBER := 0;
        l_pct_over_120      NUMBER := 0;
    BEGIN
        -- Calculate aging based on invoice date and actual unpaid amount (all invoice types)
        FOR rec IN (
            SELECT
                i.INVOICE_AMOUNT,
                NVL(pay_sum.total_paid, 0)
                    + NVL(prep_sum.total_applied,        0)
                    + NVL(prepaid_sum.total_applied_out, 0) AS AMOUNT_PAID,
                i.INVOICE_DATE   -- DATE column: used directly, no string conversion
            FROM RR_AP_INVOICES_ALL i
            LEFT JOIN (
                SELECT ri.INVOICE_ID,
                       SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
                WHERE  NVL(p.PAYMENT_STATUS, 'Active') != 'Voided'
                GROUP BY ri.INVOICE_ID
            ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
            LEFT JOIN (
                SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                       SUM(ap.APPLIED_AMOUNT)                     AS total_applied
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL inv_r
                    ON  ap.INVOICE_ID IS NULL
                    AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
            ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
            LEFT JOIN (
                SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS PREPAYMENT_INVOICE_ID,
                       SUM(ap.APPLIED_AMOUNT)                                AS total_applied_out
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL prep_r
                    ON  ap.PREPAYMENT_INVOICE_ID IS NULL
                    AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
            ) prepaid_sum ON prepaid_sum.PREPAYMENT_INVOICE_ID = i.INVOICE_ID
            WHERE i.SUPPLIER_NUMBER = p_supplier_number
            AND NVL(i.CANCELED_FLAG, 'N') != 'Y'
            AND NVL(i.PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled')
        ) LOOP
            DECLARE
                l_days_old   NUMBER;
                l_unpaid_amt NUMBER;
            BEGIN
                -- Use DATE column directly — no string round-trip that loses date info
                l_unpaid_amt := rec.INVOICE_AMOUNT - rec.AMOUNT_PAID;

                -- Include credit notes (l_unpaid_amt < 0): they reduce the aging bucket totals
                IF rec.INVOICE_DATE IS NOT NULL AND l_unpaid_amt <> 0 THEN
                    l_days_old := TRUNC(SYSDATE) - TRUNC(rec.INVOICE_DATE);

                    IF l_days_old <= 0 THEN
                        l_current := l_current + l_unpaid_amt;
                        l_current_cnt := l_current_cnt + 1;
                    ELSIF l_days_old BETWEEN 1 AND 30 THEN
                        l_days_1_30 := l_days_1_30 + l_unpaid_amt;
                        l_days_1_30_cnt := l_days_1_30_cnt + 1;
                    ELSIF l_days_old BETWEEN 31 AND 60 THEN
                        l_days_31_60 := l_days_31_60 + l_unpaid_amt;
                        l_days_31_60_cnt := l_days_31_60_cnt + 1;
                    ELSIF l_days_old BETWEEN 61 AND 90 THEN
                        l_days_61_90 := l_days_61_90 + l_unpaid_amt;
                        l_days_61_90_cnt := l_days_61_90_cnt + 1;
                    ELSIF l_days_old BETWEEN 91 AND 120 THEN
                        l_days_91_120 := l_days_91_120 + l_unpaid_amt;
                        l_days_91_120_cnt := l_days_91_120_cnt + 1;
                    ELSE
                        l_days_over_120 := l_days_over_120 + l_unpaid_amt;
                        l_days_over_120_cnt := l_days_over_120_cnt + 1;
                    END IF;
                END IF;
            END;
        END LOOP;

        l_total_outstanding := l_current + l_days_1_30 + l_days_31_60 +
                               l_days_61_90 + l_days_91_120 + l_days_over_120;

        -- Calculate percentages
        IF l_total_outstanding > 0 THEN
            l_pct_current := ROUND(l_current / l_total_outstanding * 100, 2);
            l_pct_1_30 := ROUND(l_days_1_30 / l_total_outstanding * 100, 2);
            l_pct_31_60 := ROUND(l_days_31_60 / l_total_outstanding * 100, 2);
            l_pct_61_90 := ROUND(l_days_61_90 / l_total_outstanding * 100, 2);
            l_pct_91_120 := ROUND(l_days_91_120 / l_total_outstanding * 100, 2);
            l_pct_over_120 := ROUND(l_days_over_120 / l_total_outstanding * 100, 2);
        END IF;

        -- Build JSON — jn_ap() prevents leading-dot invalid JSON for decimals
        l_result := '{"success":"true","supplier_number":"' || p_supplier_number || '","aging_report":[' ||
            '{"bucket":"Current","amount":'    || jn_ap(l_current)      || ',"invoice_count":' || l_current_cnt      || ',"percentage":' || jn_ap(l_pct_current)  || '},' ||
            '{"bucket":"1-30 Days","amount":' || jn_ap(l_days_1_30)    || ',"invoice_count":' || l_days_1_30_cnt    || ',"percentage":' || jn_ap(l_pct_1_30)     || '},' ||
            '{"bucket":"31-60 Days","amount":' || jn_ap(l_days_31_60)  || ',"invoice_count":' || l_days_31_60_cnt   || ',"percentage":' || jn_ap(l_pct_31_60)    || '},' ||
            '{"bucket":"61-90 Days","amount":' || jn_ap(l_days_61_90)  || ',"invoice_count":' || l_days_61_90_cnt   || ',"percentage":' || jn_ap(l_pct_61_90)    || '},' ||
            '{"bucket":"91-120 Days","amount":' || jn_ap(l_days_91_120) || ',"invoice_count":' || l_days_91_120_cnt || ',"percentage":' || jn_ap(l_pct_91_120)   || '},' ||
            '{"bucket":"120+ Days","amount":' || jn_ap(l_days_over_120) || ',"invoice_count":' || l_days_over_120_cnt || ',"percentage":' || jn_ap(l_pct_over_120) || '}' ||
            '],"total_outstanding":' || jn_ap(l_total_outstanding) || ',"currency":"AED"}';

        RETURN l_result;

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"success":"false","error":' || js(SQLERRM) || '}';
    END get_aging_report;

    -- ========================================================================
    -- FUNCTION: Get Supplier Invoices
    -- ========================================================================
    FUNCTION get_supplier_invoices(
        p_supplier_number IN VARCHAR2,
        p_status          IN VARCHAR2 DEFAULT 'All',
        p_limit           IN NUMBER DEFAULT 100,
        p_offset          IN NUMBER DEFAULT 0
    ) RETURN CLOB IS
        l_result        CLOB;
        l_invoices      CLOB := '[';
        l_total_count   NUMBER := 0;
        l_row_count     NUMBER := 0;
        l_first         BOOLEAN := TRUE;
        -- Buffers sized generously to avoid ORA-06502 on long column values
        l_inv_id        NUMBER;
        l_inv_num       VARCHAR2(500);
        l_inv_date      DATE;
        l_inv_amt       NUMBER;
        l_amt_paid      NUMBER;
        l_balance       NUMBER;
        l_currency      VARCHAR2(30);
        l_inv_type      VARCHAR2(100);
        l_desc          VARCHAR2(4000);
        l_val_status    VARCHAR2(100);
        l_appr_status   VARCHAR2(100);
        l_paid_status   VARCHAR2(100);
        l_acct_status   VARCHAR2(100);
        l_pay_terms     VARCHAR2(200);
        l_acct_date     DATE;
        l_bu            VARCHAR2(500);
        l_rn            NUMBER;

        CURSOR c_invoices IS
            SELECT * FROM (
                SELECT
                    i.INVOICE_ID,
                    i.INVOICE_NUMBER,
                    i.INVOICE_DATE,
                    NVL(i.INVOICE_AMOUNT, 0)                                                                          AS INVOICE_AMOUNT,
                    NVL(pay_sum.total_paid, 0) + NVL(prep_sum.total_applied, 0) + NVL(prepaid_sum.total_applied_out, 0) AS AMOUNT_PAID,
                    -- Credit notes (invoice_amount < 0) retain their negative balance so open
                    -- credits are visible; GREATEST(0) is only used for positive invoices.
                    CASE
                        WHEN NVL(i.INVOICE_AMOUNT, 0) < 0 THEN
                            NVL(i.INVOICE_AMOUNT, 0)
                            - NVL(pay_sum.total_paid,           0)
                            - NVL(prep_sum.total_applied,       0)
                            - NVL(prepaid_sum.total_applied_out, 0)
                        ELSE
                            GREATEST(0, NVL(i.INVOICE_AMOUNT, 0)
                                        - NVL(pay_sum.total_paid,            0)
                                        - NVL(prep_sum.total_applied,        0)
                                        - NVL(prepaid_sum.total_applied_out, 0))
                    END                                                                                               AS BALANCE_DUE,
                    i.INVOICE_CURRENCY,
                    i.INVOICE_TYPE,
                    SUBSTR(i.DESCRIPTION, 1, 4000)                                        AS DESCRIPTION,
                    i.VALIDATION_STATUS,
                    i.APPROVAL_STATUS,
                    i.PAID_STATUS,
                    i.ACCOUNTING_STATUS,
                    i.PAYMENT_TERMS,
                    i.ACCOUNTING_DATE,
                    i.BUSINESS_UNIT,
                    ROW_NUMBER() OVER (ORDER BY i.INVOICE_ID DESC)                        AS RN
                FROM RR_AP_INVOICES_ALL i
                LEFT JOIN (
                    SELECT ri.INVOICE_ID,
                           SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
                    FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                    JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
                    WHERE  NVL(p.PAYMENT_STATUS, 'Active') != 'Voided'
                    GROUP BY ri.INVOICE_ID
                ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
                LEFT JOIN (
                    -- Prepayments applied TO this invoice (reduces regular invoice balance)
                    SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                           SUM(ap.APPLIED_AMOUNT)                     AS total_applied
                    FROM   RR_AP_APPLIED_PREPAYMENTS ap
                    LEFT JOIN RR_AP_INVOICES_ALL inv_r
                        ON  ap.INVOICE_ID IS NULL
                        AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                    GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
                ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
                LEFT JOIN (
                    -- Amount applied OUT from this prepayment invoice to other invoices
                    SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS PREPAYMENT_INVOICE_ID,
                           SUM(ap.APPLIED_AMOUNT)                                AS total_applied_out
                    FROM   RR_AP_APPLIED_PREPAYMENTS ap
                    LEFT JOIN RR_AP_INVOICES_ALL prep_r
                        ON  ap.PREPAYMENT_INVOICE_ID IS NULL
                        AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
                    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                    GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
                ) prepaid_sum ON prepaid_sum.PREPAYMENT_INVOICE_ID = i.INVOICE_ID
                WHERE i.SUPPLIER_NUMBER = p_supplier_number
                AND NVL(i.CANCELED_FLAG,  'N') != 'Y'
                AND (p_status = 'All'
                     OR (p_status = 'Paid'   AND i.PAID_STATUS = 'Paid')
                     OR (p_status = 'Unpaid' AND NVL(i.PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled')))
            )
            WHERE RN > p_offset AND RN <= (p_offset + p_limit);
    BEGIN
        -- Total count (respects same status filter)
        BEGIN
            SELECT COUNT(*)
            INTO l_total_count
            FROM RR_AP_INVOICES_ALL
            WHERE SUPPLIER_NUMBER = p_supplier_number
            AND NVL(CANCELED_FLAG, 'N') != 'Y'
            AND (p_status = 'All'
                 OR (p_status = 'Paid'   AND PAID_STATUS = 'Paid')
                 OR (p_status = 'Unpaid' AND NVL(PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled')));
        EXCEPTION
            WHEN OTHERS THEN l_total_count := 0;
        END;

        -- Build invoices JSON array row by row (CLOB append avoids 32767 limit)
        OPEN c_invoices;
        LOOP
            FETCH c_invoices INTO l_inv_id, l_inv_num, l_inv_date, l_inv_amt, l_amt_paid,
                                  l_balance, l_currency, l_inv_type, l_desc, l_val_status,
                                  l_appr_status, l_paid_status, l_acct_status, l_pay_terms,
                                  l_acct_date, l_bu, l_rn;
            EXIT WHEN c_invoices%NOTFOUND;

            IF NOT l_first THEN
                DBMS_LOB.APPEND(l_invoices, TO_CLOB(','));
            END IF;
            l_first := FALSE;

            -- jn_ap() for numbers prevents leading-dot invalid JSON (.695 → 0.695)
            -- js() for strings handles backslash, quote and newline escaping
            DBMS_LOB.APPEND(l_invoices, TO_CLOB(
                '{"invoice_id": '        || jn_ap(l_inv_id)                          || ',' ||
                '"invoice_number": '     || js(l_inv_num)                             || ',' ||
                '"invoice_date": '       || CASE WHEN l_inv_date IS NULL THEN 'null'
                                             ELSE '"' || TO_CHAR(l_inv_date, 'YYYY-MM-DD') || '"' END || ',' ||
                '"invoice_amount": '     || jn_ap(l_inv_amt)                          || ',' ||
                '"amount_paid": '        || jn_ap(l_amt_paid)                         || ',' ||
                '"amount_remaining": '   || jn_ap(l_balance)                          || ',' ||
                '"currency": '           || js(l_currency)                            || ',' ||
                '"invoice_type": '       || js(l_inv_type)                            || ',' ||
                '"description": '        || js(SUBSTR(l_desc, 1, 500))               || ',' ||
                '"validation_status": '  || js(l_val_status)                          || ',' ||
                '"approval_status": '    || js(l_appr_status)                         || ',' ||
                '"invoice_status": '     || js(l_paid_status)                         || ',' ||
                '"accounting_status": '  || js(l_acct_status)                         || ',' ||
                '"payment_terms": '      || js(l_pay_terms)                           || ',' ||
                '"accounting_date": '    || CASE WHEN l_acct_date IS NULL THEN 'null'
                                             ELSE '"' || TO_CHAR(l_acct_date, 'YYYY-MM-DD') || '"' END || ',' ||
                '"business_unit": '      || js(l_bu)                                  ||
                '}'
            ));

            l_row_count := l_row_count + 1;
        END LOOP;
        CLOSE c_invoices;

        DBMS_LOB.APPEND(l_invoices, TO_CLOB(']'));

        -- Wrap in response envelope (CLOB concat keeps type as CLOB throughout)
        DBMS_LOB.CREATETEMPORARY(l_result, TRUE);
        DBMS_LOB.APPEND(l_result, TO_CLOB(
            '{"success":"true","supplier_number":"' || p_supplier_number ||
            '","total_count":'  || l_total_count ||
            ',"limit":'         || NVL(p_limit, 100) ||
            ',"offset":'        || NVL(p_offset, 0) ||
            ',"has_more":'      || CASE WHEN (NVL(p_offset,0) + NVL(p_limit,100)) < l_total_count
                                        THEN 'true' ELSE 'false' END ||
            ',"invoices":'
        ));
        DBMS_LOB.APPEND(l_result, l_invoices);
        DBMS_LOB.APPEND(l_result, TO_CLOB('}'));

        RETURN l_result;

    EXCEPTION
        WHEN OTHERS THEN
            IF c_invoices%ISOPEN THEN CLOSE c_invoices; END IF;
            RETURN '{"success":"false","error":' || js(SQLERRM) ||
                   ',"error_line":"' || REPLACE(DBMS_UTILITY.FORMAT_ERROR_BACKTRACE, '"', '\"') || '"}';
    END get_supplier_invoices;

    -- ========================================================================
    -- FUNCTION: Get Supplier Payments
    -- ========================================================================
    FUNCTION get_supplier_payments(
        p_supplier_number IN VARCHAR2,
        p_status          IN VARCHAR2 DEFAULT 'All',
        p_limit           IN NUMBER DEFAULT 100,
        p_offset          IN NUMBER DEFAULT 0
    ) RETURN CLOB IS
        l_result        CLOB;
        l_payments      CLOB := '[';
        l_total_count   NUMBER := 0;
        l_first         BOOLEAN := TRUE;
        -- Buffers sized to avoid ORA-06502 on long column values
        l_check_id      NUMBER;
        l_pay_id        NUMBER;
        l_pay_num       VARCHAR2(500);
        l_pay_date      DATE;
        l_pay_amt       NUMBER;
        l_currency      VARCHAR2(30);
        l_pay_status    VARCHAR2(100);
        l_pay_type      VARCHAR2(100);
        l_pay_method    VARCHAR2(100);
        l_desc          VARCHAR2(4000);
        l_clear_date    DATE;
        l_clear_amt     NUMBER;
        l_void_date     DATE;
        l_bu            VARCHAR2(500);
        l_bank_acct     VARCHAR2(500);
        l_acct_status   VARCHAR2(100);
        l_reconciled    VARCHAR2(10);
        l_rn            NUMBER;

        CURSOR c_payments IS
            SELECT * FROM (
                SELECT
                    p.CHECK_ID,
                    p.PAYMENT_ID,
                    p.PAYMENT_NUMBER,
                    p.PAYMENT_DATE,
                    NVL(p.PAYMENT_AMOUNT, 0)                          AS PAYMENT_AMOUNT,
                    p.PAYMENT_CURRENCY,
                    p.PAYMENT_STATUS,
                    p.PAYMENT_TYPE,
                    p.PAYMENT_METHOD,
                    SUBSTR(p.PAYMENT_DESCRIPTION, 1, 4000)            AS PAYMENT_DESCRIPTION,
                    p.CLEARING_DATE,
                    p.CLEARING_AMOUNT,
                    p.VOID_DATE,
                    p.BUSINESS_UNIT,
                    p.DISBURSEMENT_BANK_ACCOUNT_NAME,
                    p.ACCOUNTING_STATUS,
                    p.RECONCILED_FLAG,
                    ROW_NUMBER() OVER (ORDER BY p.CHECK_ID DESC)      AS RN
                FROM RR_AP_PAYMENTS_ALL p
                WHERE p.SUPPLIER_NUMBER = p_supplier_number
                AND (p_status = 'All' OR p.PAYMENT_STATUS = p_status)
            )
            WHERE RN > p_offset AND RN <= (p_offset + p_limit);
    BEGIN
        BEGIN
            SELECT COUNT(*)
            INTO l_total_count
            FROM RR_AP_PAYMENTS_ALL
            WHERE SUPPLIER_NUMBER = p_supplier_number
            AND (p_status = 'All' OR PAYMENT_STATUS = p_status);
        EXCEPTION
            WHEN OTHERS THEN l_total_count := 0;
        END;

        OPEN c_payments;
        LOOP
            FETCH c_payments INTO l_check_id, l_pay_id, l_pay_num, l_pay_date, l_pay_amt,
                                  l_currency, l_pay_status, l_pay_type, l_pay_method, l_desc,
                                  l_clear_date, l_clear_amt, l_void_date, l_bu, l_bank_acct,
                                  l_acct_status, l_reconciled, l_rn;
            EXIT WHEN c_payments%NOTFOUND;

            IF NOT l_first THEN
                DBMS_LOB.APPEND(l_payments, TO_CLOB(','));
            END IF;
            l_first := FALSE;

            DBMS_LOB.APPEND(l_payments, TO_CLOB(
                '{"payment_id":'       || jn_ap(l_pay_id)    || ',' ||
                '"check_id":'          || jn_ap(l_check_id)  || ',' ||
                '"payment_number":'    || js(l_pay_num)       || ',' ||
                '"payment_date":'      || CASE WHEN l_pay_date IS NULL THEN 'null'
                                          ELSE '"' || TO_CHAR(l_pay_date, 'YYYY-MM-DD') || '"' END || ',' ||
                '"payment_amount":'    || jn_ap(l_pay_amt)   || ',' ||
                '"currency":'          || js(l_currency)      || ',' ||
                '"payment_status":'    || js(l_pay_status)    || ',' ||
                '"payment_type":'      || js(l_pay_type)      || ',' ||
                '"payment_method":'    || js(l_pay_method)    || ',' ||
                '"description":'       || js(SUBSTR(l_desc,1,500)) || ',' ||
                '"clearing_date":'     || CASE WHEN l_clear_date IS NULL THEN 'null'
                                          ELSE '"' || TO_CHAR(l_clear_date, 'YYYY-MM-DD') || '"' END || ',' ||
                '"clearing_amount":'   || jn_ap(l_clear_amt) || ',' ||
                '"void_date":'         || CASE WHEN l_void_date IS NULL THEN 'null'
                                          ELSE '"' || TO_CHAR(l_void_date, 'YYYY-MM-DD') || '"' END || ',' ||
                '"business_unit":'     || js(l_bu)            || ',' ||
                '"bank_account_name":' || js(l_bank_acct)     || ',' ||
                '"accounting_status":' || js(l_acct_status)   || ',' ||
                '"reconciled_flag":'   || js(l_reconciled)    ||
                '}'
            ));
        END LOOP;
        CLOSE c_payments;

        DBMS_LOB.APPEND(l_payments, TO_CLOB(']'));

        DBMS_LOB.CREATETEMPORARY(l_result, TRUE);
        DBMS_LOB.APPEND(l_result, TO_CLOB(
            '{"success":"true","supplier_number":"' || p_supplier_number ||
            '","total_count":'  || l_total_count ||
            ',"limit":'         || NVL(p_limit, 100) ||
            ',"offset":'        || NVL(p_offset, 0) ||
            ',"has_more":'      || CASE WHEN (NVL(p_offset,0) + NVL(p_limit,100)) < l_total_count
                                        THEN 'true' ELSE 'false' END ||
            ',"payments":'
        ));
        DBMS_LOB.APPEND(l_result, l_payments);
        DBMS_LOB.APPEND(l_result, TO_CLOB('}'));

        RETURN l_result;

    EXCEPTION
        WHEN OTHERS THEN
            IF c_payments%ISOPEN THEN CLOSE c_payments; END IF;
            RETURN '{"success":"false","error":' || js(SQLERRM) ||
                   ',"error_line":"' || REPLACE(DBMS_UTILITY.FORMAT_ERROR_BACKTRACE, '"', '\"') || '"}';
    END get_supplier_payments;

    -- ========================================================================
    -- FUNCTION: Get Payment Related Invoices (Drilldown)
    -- ========================================================================
    FUNCTION get_payment_invoices(
        p_check_id IN NUMBER
    ) RETURN CLOB IS
        l_result    CLOB;
        l_invoices  CLOB := '[';
        l_payment   CLOB;
        l_count     NUMBER := 0;
        l_first     BOOLEAN := TRUE;
    BEGIN
        -- Get payment header
        SELECT JSON_OBJECT(
            'check_id'           VALUE CHECK_ID,
            'payment_number'     VALUE PAYMENT_NUMBER,
            'payment_amount'     VALUE PAYMENT_AMOUNT,
            'payment_date'       VALUE PAYMENT_DATE,
            'payee'              VALUE PAYEE,
            'supplier_number'    VALUE SUPPLIER_NUMBER,
            'payment_status'     VALUE PAYMENT_STATUS
        )
        INTO l_payment
        FROM RR_AP_PAYMENTS_ALL
        WHERE CHECK_ID = p_check_id;

        -- Get related invoices
        FOR rec IN (
            SELECT
                INVOICE_PAYMENT_ID,
                CHECK_ID,
                INVOICE_ID,
                INVOICE_NUMBER,
                INVOICE_BUSINESS_UNIT,
                INSTALLMENT_NUMBER,
                AMOUNT_PAID_PAYMENT_CURRENCY,
                AMOUNT_PAID_INVOICE_CURRENCY,
                INVOICE_AMOUNT,
                INVOICE_CURRENCY,
                DISCOUNT_TAKEN,
                DISCOUNT_LOST,
                INVOICE_PAYMENT_STATUS
            FROM RR_AP_PAYMENTS_RELATED_INVOICES
            WHERE CHECK_ID = p_check_id
        ) LOOP
            IF NOT l_first THEN
                l_invoices := l_invoices || ',';
            END IF;
            l_first := FALSE;

            l_invoices := l_invoices || JSON_OBJECT(
                'invoice_payment_id'          VALUE rec.INVOICE_PAYMENT_ID,
                'check_id'                    VALUE rec.CHECK_ID,
                'invoice_id'                  VALUE rec.INVOICE_ID,
                'invoice_number'              VALUE rec.INVOICE_NUMBER,
                'invoice_business_unit'       VALUE rec.INVOICE_BUSINESS_UNIT,
                'installment_number'          VALUE rec.INSTALLMENT_NUMBER,
                'amount_applied'              VALUE rec.AMOUNT_PAID_PAYMENT_CURRENCY,
                'amount_paid_invoice_currency' VALUE rec.AMOUNT_PAID_INVOICE_CURRENCY,
                'invoice_amount'              VALUE rec.INVOICE_AMOUNT,
                'invoice_currency'            VALUE rec.INVOICE_CURRENCY,
                'discount_taken'              VALUE rec.DISCOUNT_TAKEN,
                'discount_lost'               VALUE rec.DISCOUNT_LOST,
                'invoice_payment_status'      VALUE rec.INVOICE_PAYMENT_STATUS
                ABSENT ON NULL
            );

            l_count := l_count + 1;
        END LOOP;

        l_invoices := l_invoices || ']';

        -- Build response
        l_result := '{"success": "true", "payment": ' || l_payment ||
                    ', "invoices": ' || l_invoices ||
                    ', "invoice_count": ' || l_count || '}';

        RETURN l_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"success": "false", "error": "Payment not found", "check_id": ' || p_check_id || '}';
        WHEN OTHERS THEN
            RETURN '{"success": "false", "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_payment_invoices;

    -- ========================================================================
    -- FUNCTION: Get Complete Dashboard
    -- ========================================================================
    FUNCTION get_dashboard(
        p_supplier_number IN VARCHAR2
    ) RETURN CLOB IS
        l_result            CLOB;
        l_address           CLOB;

        -- Supplier info
        l_supplier_id       NUMBER;
        l_supplier_name     VARCHAR2(500);
        l_supplier_type     VARCHAR2(100);
        l_supplier_status   VARCHAR2(50);
        l_tax_reg_number    VARCHAR2(100);
        l_creation_date     VARCHAR2(20);

        -- Summary
        l_total_invoices    NUMBER := 0;
        l_total_paid        NUMBER := 0;
        l_invoice_count     NUMBER := 0;
        l_payment_count     NUMBER := 0;
        l_unpaid_count      NUMBER := 0;
        l_balance           NUMBER := 0;

        -- Aging
        l_current           NUMBER := 0;
        l_current_cnt       NUMBER := 0;
        l_days_1_30         NUMBER := 0;
        l_days_1_30_cnt     NUMBER := 0;
        l_days_31_60        NUMBER := 0;
        l_days_31_60_cnt    NUMBER := 0;
        l_days_61_90        NUMBER := 0;
        l_days_61_90_cnt    NUMBER := 0;
        l_days_91_120       NUMBER := 0;
        l_days_91_120_cnt   NUMBER := 0;
        l_days_over_120     NUMBER := 0;
        l_days_over_120_cnt NUMBER := 0;
        l_total_outstanding NUMBER := 0;

        l_pct_current       NUMBER := 0;
        l_pct_1_30          NUMBER := 0;
        l_pct_31_60         NUMBER := 0;
        l_pct_61_90         NUMBER := 0;
        l_pct_91_120        NUMBER := 0;
        l_pct_over_120      NUMBER := 0;
    BEGIN
        -- Get supplier info
        SELECT
            SUPPLIER_ID,
            SUPPLIER,
            SUPPLIER_TYPE,
            STATUS,
            TAX_REGISTRATION_NUMBER,
            TO_CHAR(CREATION_DATE, 'YYYY-MM-DD')
        INTO
            l_supplier_id,
            l_supplier_name,
            l_supplier_type,
            l_supplier_status,
            l_tax_reg_number,
            l_creation_date
        FROM RR_SUPPLIER_MASTER
        WHERE SUPPLIER_NUMBER = p_supplier_number;

        -- Get address
        l_address := get_address_json(l_supplier_id);

        -- Get invoice summary — actual amounts from payment and prepayment tables
        SELECT
            NVL(SUM(i.INVOICE_AMOUNT), 0),
            COUNT(*),
            NVL(SUM(NVL(pay_sum.total_paid, 0) + NVL(prep_sum.total_applied, 0)), 0),
            COUNT(CASE WHEN NVL(i.PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled') THEN 1 END)
        INTO l_total_invoices, l_invoice_count, l_total_paid, l_unpaid_count
        FROM RR_AP_INVOICES_ALL i
        LEFT JOIN (
            SELECT ri.INVOICE_ID,
                   SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
            JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
            WHERE  NVL(p.PAYMENT_STATUS,           'Active') != 'Voided'
            AND    NVL(ri.INVOICE_PAYMENT_STATUS,  'Active') != 'Voided'
            GROUP BY ri.INVOICE_ID
        ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
        LEFT JOIN (
            SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                   SUM(ap.APPLIED_AMOUNT)                     AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS ap
            LEFT JOIN RR_AP_INVOICES_ALL inv_r
                ON  ap.INVOICE_ID IS NULL
                AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
            WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
            GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
        ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
        WHERE i.SUPPLIER_NUMBER = p_supplier_number
        AND NVL(i.CANCELED_FLAG,  'N')      != 'Y'
        AND NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment';

        l_balance := l_total_invoices - l_total_paid;

        -- Get payment count
        SELECT COUNT(DISTINCT CHECK_ID)
        INTO l_payment_count
        FROM RR_AP_PAYMENTS_ALL
        WHERE SUPPLIER_NUMBER = p_supplier_number;

        -- Calculate aging with actual payment amounts (all invoice types)
        FOR rec IN (
            SELECT
                i.INVOICE_AMOUNT,
                NVL(pay_sum.total_paid, 0)
                    + NVL(prep_sum.total_applied,        0)
                    + NVL(prepaid_sum.total_applied_out, 0) AS AMOUNT_PAID,
                i.INVOICE_DATE
            FROM RR_AP_INVOICES_ALL i
            LEFT JOIN (
                SELECT ri.INVOICE_ID,
                       SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
                FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
                JOIN   RR_AP_PAYMENTS_ALL              p ON p.CHECK_ID = ri.CHECK_ID
                WHERE  NVL(p.PAYMENT_STATUS, 'Active') != 'Voided'
                GROUP BY ri.INVOICE_ID
            ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
            LEFT JOIN (
                SELECT COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID) AS INVOICE_ID,
                       SUM(ap.APPLIED_AMOUNT)                     AS total_applied
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL inv_r
                    ON  ap.INVOICE_ID IS NULL
                    AND inv_r.INVOICE_NUMBER = ap.INVOICE_NUMBER
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                GROUP BY COALESCE(ap.INVOICE_ID, inv_r.INVOICE_ID)
            ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
            LEFT JOIN (
                SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID) AS PREPAYMENT_INVOICE_ID,
                       SUM(ap.APPLIED_AMOUNT)                                AS total_applied_out
                FROM   RR_AP_APPLIED_PREPAYMENTS ap
                LEFT JOIN RR_AP_INVOICES_ALL prep_r
                    ON  ap.PREPAYMENT_INVOICE_ID IS NULL
                    AND prep_r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
                WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
                GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, prep_r.INVOICE_ID)
            ) prepaid_sum ON prepaid_sum.PREPAYMENT_INVOICE_ID = i.INVOICE_ID
            WHERE i.SUPPLIER_NUMBER = p_supplier_number
            AND NVL(i.CANCELED_FLAG, 'N') != 'Y'
            AND NVL(i.PAID_STATUS, 'Unpaid') NOT IN ('Paid', 'Cancelled')
        ) LOOP
            DECLARE
                l_days_old   NUMBER;
                l_unpaid_amt NUMBER;
            BEGIN
                l_unpaid_amt := rec.INVOICE_AMOUNT - rec.AMOUNT_PAID;

                -- Include credit notes (l_unpaid_amt < 0): they reduce the aging bucket totals
                IF rec.INVOICE_DATE IS NOT NULL AND l_unpaid_amt <> 0 THEN
                    l_days_old := TRUNC(SYSDATE) - TRUNC(rec.INVOICE_DATE);

                    IF l_days_old <= 0 THEN
                        l_current := l_current + l_unpaid_amt;
                        l_current_cnt := l_current_cnt + 1;
                    ELSIF l_days_old BETWEEN 1 AND 30 THEN
                        l_days_1_30 := l_days_1_30 + l_unpaid_amt;
                        l_days_1_30_cnt := l_days_1_30_cnt + 1;
                    ELSIF l_days_old BETWEEN 31 AND 60 THEN
                        l_days_31_60 := l_days_31_60 + l_unpaid_amt;
                        l_days_31_60_cnt := l_days_31_60_cnt + 1;
                    ELSIF l_days_old BETWEEN 61 AND 90 THEN
                        l_days_61_90 := l_days_61_90 + l_unpaid_amt;
                        l_days_61_90_cnt := l_days_61_90_cnt + 1;
                    ELSIF l_days_old BETWEEN 91 AND 120 THEN
                        l_days_91_120 := l_days_91_120 + l_unpaid_amt;
                        l_days_91_120_cnt := l_days_91_120_cnt + 1;
                    ELSE
                        l_days_over_120 := l_days_over_120 + l_unpaid_amt;
                        l_days_over_120_cnt := l_days_over_120_cnt + 1;
                    END IF;
                END IF;
            END;
        END LOOP;

        l_total_outstanding := l_current + l_days_1_30 + l_days_31_60 +
                               l_days_61_90 + l_days_91_120 + l_days_over_120;

        -- Calculate percentages
        IF l_total_outstanding > 0 THEN
            l_pct_current := ROUND(l_current / l_total_outstanding * 100, 2);
            l_pct_1_30 := ROUND(l_days_1_30 / l_total_outstanding * 100, 2);
            l_pct_31_60 := ROUND(l_days_31_60 / l_total_outstanding * 100, 2);
            l_pct_61_90 := ROUND(l_days_61_90 / l_total_outstanding * 100, 2);
            l_pct_91_120 := ROUND(l_days_91_120 / l_total_outstanding * 100, 2);
            l_pct_over_120 := ROUND(l_days_over_120 / l_total_outstanding * 100, 2);
        END IF;

        -- Build dashboard JSON — jn_ap() prevents leading-dot decimals
        DBMS_LOB.CREATETEMPORARY(l_result, TRUE);
        DBMS_LOB.APPEND(l_result, TO_CLOB(
            '{"success":"true",' ||
            '"supplier":{' ||
                '"supplier_id":'              || jn_ap(l_supplier_id)       || ',' ||
                '"supplier_number":'          || js(p_supplier_number)      || ',' ||
                '"supplier_name":'            || js(l_supplier_name)        || ',' ||
                '"supplier_type":'            || js(l_supplier_type)        || ',' ||
                '"status":'                   || js(l_supplier_status)      || ',' ||
                '"tax_registration_number":'  || js(l_tax_reg_number)       || ',' ||
                '"creation_date":'            || js(l_creation_date)        || ',' ||
                '"address":'                  || NVL(l_address, 'null')     ||
            '},' ||
            '"balance_summary":{' ||
                '"total_invoices":'           || l_invoice_count            || ',' ||
                '"total_invoice_amount":'     || jn_ap(l_total_invoices)    || ',' ||
                '"total_payments":'           || l_payment_count            || ',' ||
                '"total_payment_amount":'     || jn_ap(l_total_paid)        || ',' ||
                '"balance":'                  || jn_ap(l_balance)           || ',' ||
                '"currency":"AED"' ||
            '},' ||
            '"aging_report":[' ||
                '{"bucket":"Current","amount":'     || jn_ap(l_current)      || ',"invoice_count":' || l_current_cnt      || ',"percentage":' || jn_ap(l_pct_current)  || '},' ||
                '{"bucket":"1-30 Days","amount":'   || jn_ap(l_days_1_30)   || ',"invoice_count":' || l_days_1_30_cnt    || ',"percentage":' || jn_ap(l_pct_1_30)     || '},' ||
                '{"bucket":"31-60 Days","amount":'  || jn_ap(l_days_31_60)  || ',"invoice_count":' || l_days_31_60_cnt   || ',"percentage":' || jn_ap(l_pct_31_60)    || '},' ||
                '{"bucket":"61-90 Days","amount":'  || jn_ap(l_days_61_90)  || ',"invoice_count":' || l_days_61_90_cnt   || ',"percentage":' || jn_ap(l_pct_61_90)    || '},' ||
                '{"bucket":"91-120 Days","amount":' || jn_ap(l_days_91_120) || ',"invoice_count":' || l_days_91_120_cnt  || ',"percentage":' || jn_ap(l_pct_91_120)   || '},' ||
                '{"bucket":"120+ Days","amount":'   || jn_ap(l_days_over_120) || ',"invoice_count":' || l_days_over_120_cnt || ',"percentage":' || jn_ap(l_pct_over_120) || '}' ||
            ']}'
        ));

        RETURN l_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"success":"false","error":"Supplier not found","supplier_number":"' || p_supplier_number || '"}';
        WHEN OTHERS THEN
            RETURN '{"success":"false","error":' || js(SQLERRM) || '}';
    END get_dashboard;

    -- ========================================================================
    -- PROCEDURE: Output JSON Response (for ORDS handlers)
    -- ========================================================================
    PROCEDURE output_response(
        p_json        IN CLOB,
        p_status_code OUT NUMBER
    ) IS
        l_success VARCHAR2(10);
        l_len     INTEGER;
        l_offset  INTEGER := 1;
        l_chunk   CONSTANT INTEGER := 32000;
    BEGIN
        -- Determine status code based on response
        BEGIN
            SELECT JSON_VALUE(p_json, '$.success') INTO l_success FROM DUAL;
            IF l_success = 'true' THEN
                p_status_code := 200;
            ELSE
                IF INSTR(p_json, 'not found') > 0 THEN
                    p_status_code := 404;
                ELSE
                    p_status_code := 500;
                END IF;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                p_status_code := 500;
        END;

        -- Output the JSON in 32 KB chunks — HTP.p accepts VARCHAR2 only (max 32767)
        -- and an implicit CLOB→VARCHAR2 cast raises ORA-06502 for large responses.
        l_len := NVL(DBMS_LOB.GETLENGTH(p_json), 0);
        IF l_len = 0 THEN
            HTP.p('');
            RETURN;
        END IF;

        WHILE l_offset <= l_len LOOP
            HTP.prn(DBMS_LOB.SUBSTR(p_json, l_chunk, l_offset));
            l_offset := l_offset + l_chunk;
        END LOOP;
    END output_response;

END PKG_SUPPLIER_BALANCE;
/


-- ============================================================================
-- ORDS HANDLER DEFINITIONS (Simple calls to package)
-- ============================================================================

/*
================================================================================
ORDS Handler Setup Instructions:
================================================================================

1. Supplier Details Handler
   Module: reerp
   Pattern: suppliers/balance/details/:supplier_number
   Method: GET
   Source:

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_supplier_details(:supplier_number);
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


2. Balance Summary Handler
   Pattern: suppliers/balance/summary/:supplier_number
   Method: GET

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_balance_summary(:supplier_number);
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


3. Aging Report Handler
   Pattern: suppliers/balance/aging/:supplier_number
   Method: GET

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_aging_report(:supplier_number);
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


4. Invoices List Handler
   Pattern: suppliers/balance/invoices/:supplier_number
   Method: GET
   Query Params: status, limit, offset

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_supplier_invoices(
        p_supplier_number => :supplier_number,
        p_status          => NVL(:status, 'All'),
        p_limit           => NVL(:limit, 100),
        p_offset          => NVL(:offset, 0)
    );
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


5. Payments List Handler
   Pattern: suppliers/balance/payments/:supplier_number
   Method: GET
   Query Params: status, limit, offset

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_supplier_payments(
        p_supplier_number => :supplier_number,
        p_status          => NVL(:status, 'All'),
        p_limit           => NVL(:limit, 100),
        p_offset          => NVL(:offset, 0)
    );
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


6. Payment Drilldown Handler
   Pattern: suppliers/balance/payment-invoices/:check_id
   Method: GET

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_payment_invoices(:check_id);
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;


7. Dashboard Handler (All-in-One)
   Pattern: suppliers/balance/dashboard/:supplier_number
   Method: GET

DECLARE
    l_json CLOB;
BEGIN
    l_json := PKG_SUPPLIER_BALANCE.get_dashboard(:supplier_number);
    PKG_SUPPLIER_BALANCE.output_response(l_json, :status_code);
END;

*/


-- ============================================================================
-- SUMMARY OF API ENDPOINTS
-- ============================================================================
/*
| # | Endpoint                                       | Method | Package Function           |
|---|------------------------------------------------|--------|----------------------------|
| 1 | /suppliers/balance/details/:supplier_number   | GET    | get_supplier_details()     |
| 2 | /suppliers/balance/summary/:supplier_number   | GET    | get_balance_summary()      |
| 3 | /suppliers/balance/aging/:supplier_number     | GET    | get_aging_report()         |
| 4 | /suppliers/balance/invoices/:supplier_number  | GET    | get_supplier_invoices()    |
| 5 | /suppliers/balance/payments/:supplier_number  | GET    | get_supplier_payments()    |
| 6 | /suppliers/balance/payment-invoices/:check_id | GET    | get_payment_invoices()     |
| 7 | /suppliers/balance/dashboard/:supplier_number | GET    | get_dashboard()            |

Query Parameters for endpoints 4 & 5:
- status: 'All', 'Paid', 'Unpaid' (invoices) or 'All', 'Cleared', 'Voided' (payments)
- limit: Number of records (default 100)
- offset: Starting position (default 0)
*/
