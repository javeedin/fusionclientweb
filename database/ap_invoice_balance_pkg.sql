-- ============================================
-- XXAP_INVOICE_BALANCE_PKG Package
-- Invoice balance calculation and payment validations
-- ============================================

CREATE OR REPLACE PACKAGE XXAP_INVOICE_BALANCE_PKG AS

    -- Get invoice balance summary
    -- Returns: invoiceAmount, totalPaid (excluding voided), balance
    FUNCTION get_invoice_balance(
        p_invoice_id IN NUMBER
    ) RETURN CLOB;

    -- Validate before recording a payment
    -- Checks: remaining balance > 0, payment <= balance,
    --         installment amount > 0, installment not on hold
    -- Returns: { "valid": true/false, "errors": [...], "balance": N, "installmentAmount": N }
    FUNCTION validate_payment(
        p_invoice_id         IN NUMBER,
        p_payment_amount     IN NUMBER,
        p_installment_number IN NUMBER DEFAULT NULL
    ) RETURN CLOB;

    -- Validate before voiding a payment
    -- Checks: payment exists, not already voided, not reconciled
    -- Returns: { "valid": true/false, "errors": [...] }
    FUNCTION validate_void_payment(
        p_invoice_payment_id IN NUMBER
    ) RETURN CLOB;

    -- Get invoice net balance including prepayment applications
    -- Returns: invoiceAmount, totalPaid, totalPrepaymentApplied, netBalance
    -- netBalance = invoiceAmount - totalPaid - totalPrepaymentApplied
    FUNCTION get_invoice_net_balance(
        p_invoice_id IN NUMBER
    ) RETURN CLOB;

END XXAP_INVOICE_BALANCE_PKG;
/

CREATE OR REPLACE PACKAGE BODY XXAP_INVOICE_BALANCE_PKG AS

    -- ----------------------------------------------------------------
    -- get_invoice_balance
    -- ----------------------------------------------------------------
    FUNCTION get_invoice_balance(
        p_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_invoice_amount    NUMBER;
        v_total_paid        NUMBER := 0;
        v_total_discount    NUMBER := 0;
        v_balance           NUMBER;
        v_result            CLOB;
    BEGIN
        SELECT INVOICE_AMOUNT
        INTO v_invoice_amount
        FROM RR_AP_INVOICES_ALL
        WHERE INVOICE_ID = p_invoice_id;

        -- Sum cash payments, excluding voided
        SELECT NVL(SUM(AMOUNT_PAID_INVOICE_CURRENCY), 0)
        INTO v_total_paid
        FROM V_RR_AP_RELATED_PAYMENTS_ALL
        WHERE INVOICE_ID = p_invoice_id
          AND NVL(PAYMENT_STATUS, 'Active') != 'Voided';

        -- Sum discount taken (reduces outstanding balance)
        SELECT NVL(SUM(ri.DISCOUNT_TAKEN), 0)
        INTO v_total_discount
        FROM RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
        WHERE ri.INVOICE_ID = p_invoice_id
          AND NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
          AND NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided';

        v_balance := v_invoice_amount - v_total_paid - v_total_discount;

        SELECT JSON_OBJECT(
            'invoiceId'     VALUE p_invoice_id,
            'invoiceAmount' VALUE v_invoice_amount,
            'totalPaid'     VALUE v_total_paid,
            'balance'       VALUE v_balance
            RETURNING CLOB
        )
        INTO v_result
        FROM DUAL;

        RETURN v_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"status":"error","message":"Invoice not found"}';
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_invoice_balance;


    -- ----------------------------------------------------------------
    -- validate_payment
    -- ----------------------------------------------------------------
    FUNCTION validate_payment(
        p_invoice_id         IN NUMBER,
        p_payment_amount     IN NUMBER,
        p_installment_number IN NUMBER DEFAULT NULL
    ) RETURN CLOB IS
        v_invoice_amount     NUMBER;
        v_total_paid         NUMBER := 0;
        v_total_discount     NUMBER := 0;
        v_balance            NUMBER;
        v_gross_amount       NUMBER;
        v_unpaid_amount      NUMBER;
        v_hold_flag          VARCHAR2(1);
        v_valid              VARCHAR2(5) := 'true';
        v_err_arr            VARCHAR2(4000) := '';
        v_err_count          NUMBER := 0;
    BEGIN
        -- Step 1: Invoice must exist
        BEGIN
            SELECT INVOICE_AMOUNT
            INTO v_invoice_amount
            FROM RR_AP_INVOICES_ALL
            WHERE INVOICE_ID = p_invoice_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN '{"valid":false,"errors":["Invoice ' || p_invoice_id || ' not found"],"balance":null,"installmentAmount":null}';
        END;

        -- Step 2: Remaining balance (exclude voided payments)
        SELECT NVL(SUM(AMOUNT_PAID_INVOICE_CURRENCY), 0)
        INTO v_total_paid
        FROM V_RR_AP_RELATED_PAYMENTS_ALL
        WHERE INVOICE_ID = p_invoice_id
          AND NVL(PAYMENT_STATUS, 'Active') != 'Voided';

        -- Discount taken reduces outstanding balance
        SELECT NVL(SUM(ri.DISCOUNT_TAKEN), 0)
        INTO v_total_discount
        FROM RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
        WHERE ri.INVOICE_ID = p_invoice_id
          AND NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
          AND NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided';

        v_balance := v_invoice_amount - v_total_paid - v_total_discount;

        -- Validation: balance must be > 0
        IF v_balance <= 0 THEN
            v_valid := 'false';
            v_err_arr := v_err_arr || '"Invoice is fully paid, remaining balance is ' || TO_CHAR(v_balance) || '",';
            v_err_count := v_err_count + 1;
        END IF;

        -- Validation: payment amount must not exceed remaining balance
        IF p_payment_amount > v_balance THEN
            v_valid := 'false';
            v_err_arr := v_err_arr || '"Payment amount ' || TO_CHAR(p_payment_amount) || ' exceeds remaining balance ' || TO_CHAR(v_balance) || '",';
            v_err_count := v_err_count + 1;
        END IF;

        -- Step 3: Installment checks (only when installment number is provided)
        IF p_installment_number IS NOT NULL THEN
            BEGIN
                SELECT GROSS_AMOUNT, NVL(UNPAID_AMOUNT, GROSS_AMOUNT), NVL(HOLD_FLAG, 'N')
                INTO v_gross_amount, v_unpaid_amount, v_hold_flag
                FROM RR_AP_INVOICE_INSTALLMENTS
                WHERE INVOICE_ID         = p_invoice_id
                  AND INSTALLMENT_NUMBER = p_installment_number;

                -- Installment gross amount must be > 0
                IF NVL(v_gross_amount, 0) <= 0 THEN
                    v_valid := 'false';
                    v_err_arr := v_err_arr || '"Installment ' || p_installment_number || ' has zero amount, payment not allowed",';
                    v_err_count := v_err_count + 1;
                END IF;

                -- Installment unpaid amount must be > 0
                IF NVL(v_unpaid_amount, 0) <= 0 THEN
                    v_valid := 'false';
                    v_err_arr := v_err_arr || '"Installment ' || p_installment_number || ' is already fully paid",';
                    v_err_count := v_err_count + 1;
                END IF;

                -- Installment must not be on hold
                IF v_hold_flag = 'Y' THEN
                    v_valid := 'false';
                    v_err_arr := v_err_arr || '"Installment ' || p_installment_number || ' is on hold, payment not allowed",';
                    v_err_count := v_err_count + 1;
                END IF;

            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    v_valid := 'false';
                    v_err_arr := v_err_arr || '"Installment ' || p_installment_number || ' not found for invoice ' || p_invoice_id || '",';
                    v_err_count := v_err_count + 1;
                    v_gross_amount  := NULL;
                    v_unpaid_amount := NULL;
            END;
        END IF;

        -- Trim trailing comma from error array
        IF v_err_count > 0 THEN
            v_err_arr := RTRIM(v_err_arr, ',');
        END IF;

        RETURN '{"valid":' || v_valid ||
               ',"errors":[' || v_err_arr || ']' ||
               ',"balance":' || TO_CHAR(v_balance) ||
               CASE WHEN p_installment_number IS NOT NULL
                    THEN ',"installmentAmount":' || NVL(TO_CHAR(v_gross_amount), 'null') ||
                         ',"installmentUnpaidAmount":' || NVL(TO_CHAR(v_unpaid_amount), 'null')
                    ELSE ''
               END ||
               '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"valid":false,"errors":["' || REPLACE(SQLERRM, '"', '\"') || '"],"balance":null,"installmentAmount":null}';
    END validate_payment;


    -- ----------------------------------------------------------------
    -- validate_void_payment
    -- ----------------------------------------------------------------
    FUNCTION validate_void_payment(
        p_invoice_payment_id IN NUMBER
    ) RETURN CLOB IS
        v_invoice_payment_status  VARCHAR2(50);
        v_payment_status          VARCHAR2(50);
        v_reconciled_flag         VARCHAR2(1);
        v_valid                   VARCHAR2(5) := 'true';
        v_err_arr                 VARCHAR2(4000) := '';
        v_err_count               NUMBER := 0;
    BEGIN
        BEGIN
            SELECT INVOICE_PAYMENT_STATUS, NVL(PAYMENT_STATUS, 'Active'), NVL(RECONCILED_FLAG, 'N')
            INTO v_invoice_payment_status, v_payment_status, v_reconciled_flag
            FROM V_RR_AP_RELATED_PAYMENTS_ALL
            WHERE INVOICE_PAYMENT_ID = p_invoice_payment_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN '{"valid":false,"errors":["Payment ' || p_invoice_payment_id || ' not found"]}';
        END;

        -- Cannot void an already voided payment
        IF v_payment_status = 'Voided' OR v_invoice_payment_status = 'Voided' THEN
            v_valid := 'false';
            v_err_arr := v_err_arr || '"Payment is already voided",';
            v_err_count := v_err_count + 1;
        END IF;

        -- Cannot void a reconciled payment
        IF v_reconciled_flag = 'Y' THEN
            v_valid := 'false';
            v_err_arr := v_err_arr || '"Cannot void a reconciled payment",';
            v_err_count := v_err_count + 1;
        END IF;

        IF v_err_count > 0 THEN
            v_err_arr := RTRIM(v_err_arr, ',');
        END IF;

        RETURN '{"valid":' || v_valid || ',"errors":[' || v_err_arr || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"valid":false,"errors":["' || REPLACE(SQLERRM, '"', '\"') || '"]}';
    END validate_void_payment;

    -- ----------------------------------------------------------------
    -- get_invoice_net_balance
    -- Net balance = invoice_amount - cash payments - discount_taken - prepayment applications
    -- ----------------------------------------------------------------
    FUNCTION get_invoice_net_balance(
        p_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_invoice_amount           NUMBER;
        v_total_paid               NUMBER := 0;
        v_total_discount           NUMBER := 0;
        v_total_prepayment_applied NUMBER := 0;
        v_net_balance              NUMBER;
        v_result                   CLOB;
    BEGIN
        -- Invoice amount
        SELECT INVOICE_AMOUNT
        INTO   v_invoice_amount
        FROM   RR_AP_INVOICES_ALL
        WHERE  INVOICE_ID = p_invoice_id;

        -- Cash payments, excluding voided
        SELECT NVL(SUM(AMOUNT_PAID_INVOICE_CURRENCY), 0)
        INTO   v_total_paid
        FROM   V_RR_AP_RELATED_PAYMENTS_ALL
        WHERE  INVOICE_ID = p_invoice_id
          AND  NVL(PAYMENT_STATUS, 'Active') != 'Voided';

        -- Discount taken (reduces outstanding balance)
        SELECT NVL(SUM(ri.DISCOUNT_TAKEN), 0)
        INTO   v_total_discount
        FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
        WHERE  ri.INVOICE_ID = p_invoice_id
          AND  NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
          AND  NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided';

        -- Prepayment applications on this invoice, excluding cancelled
        SELECT NVL(SUM(APPLIED_AMOUNT), 0)
        INTO   v_total_prepayment_applied
        FROM   RR_AP_APPLIED_PREPAYMENTS
        WHERE  INVOICE_ID = p_invoice_id
          AND  NVL(STATUS, 'Applied') != 'Cancelled';

        v_net_balance := v_invoice_amount - v_total_paid - v_total_discount - v_total_prepayment_applied;

        SELECT JSON_OBJECT(
            'invoiceId'               VALUE p_invoice_id,
            'invoiceAmount'           VALUE v_invoice_amount,
            'totalPaid'               VALUE v_total_paid,
            'totalDiscountTaken'      VALUE v_total_discount,
            'totalPrepaymentApplied'  VALUE v_total_prepayment_applied,
            'netBalance'              VALUE v_net_balance
            RETURNING CLOB
        )
        INTO v_result
        FROM DUAL;

        RETURN v_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"status":"error","message":"Invoice not found"}';
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_invoice_net_balance;

END XXAP_INVOICE_BALANCE_PKG;
/
