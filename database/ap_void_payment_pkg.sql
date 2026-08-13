-- ============================================
-- XXAP_VOID_PAYMENT_PKG
-- Voids an AP payment and restores invoice balance
--
-- Eligibility rules (is_eligible_for_void):
--   RECONCILED_FLAG = 'Y'                    → blocked (reconciled against bank)
--   CLEARING_DATE   IS NOT NULL              → blocked (cleared at bank)
--   CLEARING_AMOUNT IS NOT NULL AND != 0     → blocked (clearing amount posted)
--   PAYMENT_STATUS  = 'Voided'               → blocked (already voided)
--
-- What void_payment touches (in order):
--   1. is_eligible_for_void           → pre-validation, aborts if not eligible
--   2. RR_AP_PAYMENTS_ALL             → PAYMENT_STATUS='Voided'
--                                        VOID_DATE, VOID_ACCOUNTING_DATE
--                                        STOP_DATE, STOP_REASON, STOP_REFERENCE
--   3. RR_AP_PAYMENTS_RELATED_INVOICES → INVOICE_PAYMENT_STATUS='Voided'
--   4. RR_AP_INVOICE_INSTALLMENTS      → UNPAID_AMOUNT restored to GROSS_AMOUNT
--                                        PAYMENT_STATUS='Unpaid'
--                                        (only when INSTALLMENT_NUMBER is set)
--
-- Balance restores automatically because get_invoice_balance already
-- excludes rows where PAYMENT_STATUS = 'Voided'.
-- ============================================

CREATE OR REPLACE PACKAGE XXAP_VOID_PAYMENT_PKG AS

    -- ----------------------------------------------------------------
    -- is_eligible_for_void
    -- Call this before showing the Void popup.
    -- Input:  p_check_id  (NUMBER)
    -- Returns JSON:
    -- {
    --   "eligible":       true | false,
    --   "errors":         ["..."],          -- one message per blocking condition
    --   "paymentNumber":  "PAY-20260301-000042",
    --   "paymentStatus":  "Negotiable",
    --   "reconciledFlag": "N",
    --   "clearingDate":   null | "YYYY-MM-DD",
    --   "clearingAmount": null | 12345.00
    -- }
    -- ----------------------------------------------------------------
    FUNCTION is_eligible_for_void(
        p_check_id IN NUMBER
    ) RETURN CLOB;

    -- ----------------------------------------------------------------
    -- void_payment
    -- Performs the full void: validates, then updates all 3 tables.
    -- Input JSON:
    -- {
    --   "CheckId":      -42,
    --   "VoidDate":     "2026-03-01",       -- optional, defaults to today
    --   "VoidedBy":     "jsmith",           -- optional
    --   "StopReason":   "Payment in error", -- optional
    --   "StopReference":"REF-001"           -- optional
    -- }
    -- Returns JSON:
    -- {
    --   "status":        "success" | "error",
    --   "message":       "...",
    --   "eligible":      false,             -- only on validation failure
    --   "errors":        [...],             -- only on validation failure
    --   "checkId":       -42,
    --   "paymentNumber": "PAY-20260301-000042",
    --   "invoiceId":     300000084552581,
    --   "newBalance":    50000
    -- }
    -- ----------------------------------------------------------------
    PROCEDURE void_payment(
        p_json_data IN  CLOB,
        p_result    OUT VARCHAR2
    );

END XXAP_VOID_PAYMENT_PKG;
/

CREATE OR REPLACE PACKAGE BODY XXAP_VOID_PAYMENT_PKG AS

    -- ================================================================
    -- is_eligible_for_void
    -- ================================================================
    FUNCTION is_eligible_for_void(
        p_check_id IN NUMBER
    ) RETURN CLOB IS
        v_payment_status   VARCHAR2(50);
        v_reconciled_flag  VARCHAR2(1);
        v_clearing_date    DATE;
        v_clearing_amount  NUMBER;
        v_payment_number   VARCHAR2(100);

        v_eligible         VARCHAR2(5)    := 'true';
        v_err_arr          VARCHAR2(4000) := '';
        v_err_count        NUMBER         := 0;

        PROCEDURE add_error(p_msg IN VARCHAR2) IS
        BEGIN
            v_err_arr   := v_err_arr || '"' || REPLACE(p_msg, '"', '\"') || '",';
            v_err_count := v_err_count + 1;
            v_eligible  := 'false';
        END;

    BEGIN
        -- Look up the payment header
        BEGIN
            SELECT PAYMENT_STATUS,
                   NVL(RECONCILED_FLAG, 'N'),
                   CLEARING_DATE,
                   CLEARING_AMOUNT,
                   PAYMENT_NUMBER
            INTO   v_payment_status,
                   v_reconciled_flag,
                   v_clearing_date,
                   v_clearing_amount,
                   v_payment_number
            FROM   RR_AP_PAYMENTS_ALL
            WHERE  CHECK_ID = p_check_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN '{"eligible":false,"errors":["Payment not found for CheckId ' || p_check_id || '"],'
                    || '"paymentNumber":null,"paymentStatus":null,"reconciledFlag":null,'
                    || '"clearingDate":null,"clearingAmount":null}';
        END;

        -- Rule 1: Already voided
        IF v_payment_status = 'Voided' THEN
            add_error('Payment is already voided');
        END IF;

        -- Rule 2: Reconciled against bank statement
        IF v_reconciled_flag = 'Y' THEN
            add_error('Payment has been reconciled against a bank statement and cannot be voided');
        END IF;

        -- Rule 3: Clearing date set — payment cleared at bank
        IF v_clearing_date IS NOT NULL THEN
            add_error('Payment has a bank clearing date (' || TO_CHAR(v_clearing_date, 'DD-MON-YYYY') || ') and cannot be voided');
        END IF;

        -- Rule 4: Clearing amount posted — bank cleared with amount
        IF v_clearing_amount IS NOT NULL AND v_clearing_amount != 0 THEN
            add_error('Payment has a bank clearing amount (' || TO_CHAR(v_clearing_amount) || ') and cannot be voided');
        END IF;

        IF v_err_count > 0 THEN
            v_err_arr := RTRIM(v_err_arr, ',');
        END IF;

        RETURN
            '{"eligible":'       || v_eligible                                          ||
            ',"errors":['        || v_err_arr                                           || ']' ||
            ',"paymentNumber":"' || NVL(v_payment_number, '')                           || '"' ||
            ',"paymentStatus":"' || NVL(v_payment_status, '')                           || '"' ||
            ',"reconciledFlag":"'|| v_reconciled_flag                                   || '"' ||
            ',"clearingDate":'   || CASE WHEN v_clearing_date IS NOT NULL
                                         THEN '"' || TO_CHAR(v_clearing_date, 'YYYY-MM-DD') || '"'
                                         ELSE 'null' END                                       ||
            ',"clearingAmount":' || NVL(TO_CHAR(v_clearing_amount), 'null')            ||
            '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"eligible":false,"errors":["' || REPLACE(SQLERRM, '"', '\"') || '"],'
                || '"paymentNumber":null,"paymentStatus":null,"reconciledFlag":null,'
                || '"clearingDate":null,"clearingAmount":null}';
    END is_eligible_for_void;


    -- ================================================================
    -- void_payment
    -- ================================================================
    PROCEDURE void_payment(
        p_json_data IN  CLOB,
        p_result    OUT VARCHAR2
    ) IS
        -- Input
        v_check_id           NUMBER;
        v_void_date          DATE;
        v_voided_by          VARCHAR2(100);
        v_stop_reason        VARCHAR2(500);
        v_stop_reference     VARCHAR2(240);

        -- Looked up from DB
        v_invoice_payment_id NUMBER;
        v_invoice_id         NUMBER;
        v_installment_number NUMBER;
        v_payment_number     VARCHAR2(100);
        v_gross_amount       NUMBER;

        -- Eligibility check
        v_eligible_json      CLOB;
        v_is_eligible        VARCHAR2(5);

        -- New balance after void
        v_new_balance        NUMBER;

    BEGIN
        -- ── 1. Parse input ───────────────────────────────────────────
        v_check_id       := JSON_VALUE(p_json_data, '$.CheckId'       RETURNING NUMBER);
        v_voided_by      := JSON_VALUE(p_json_data, '$.VoidedBy');
        v_stop_reason    := JSON_VALUE(p_json_data, '$.StopReason');
        v_stop_reference := JSON_VALUE(p_json_data, '$.StopReference');

        BEGIN
            v_void_date := TO_DATE(
                SUBSTR(JSON_VALUE(p_json_data, '$.VoidDate'), 1, 10), 'YYYY-MM-DD'
            );
        EXCEPTION WHEN OTHERS THEN
            v_void_date := TRUNC(SYSDATE);
        END;

        IF v_void_date IS NULL THEN
            v_void_date := TRUNC(SYSDATE);
        END IF;

        IF v_check_id IS NULL THEN
            p_result := '{"status":"error","message":"CheckId is required"}';
            RETURN;
        END IF;

        -- ── 2. Eligibility check ─────────────────────────────────────
        --    Blocks if: already voided, reconciled, clearing date set,
        --               or clearing amount posted.
        v_eligible_json := is_eligible_for_void(p_check_id => v_check_id);
        v_is_eligible   := JSON_VALUE(v_eligible_json, '$.eligible');

        IF v_is_eligible != 'true' THEN
            p_result :=
                '{"status":"error"' ||
                ',"message":"Payment is not eligible for void"' ||
                ',"eligible":false' ||
                ',"errors":'    || REGEXP_SUBSTR(v_eligible_json, '\[.*?\]') ||
                ',"checkId":'   || v_check_id ||
                '}';
            RETURN;
        END IF;

        -- ── 3. Look up the related invoice link ──────────────────────
        BEGIN
            SELECT ri.INVOICE_PAYMENT_ID,
                   ri.INVOICE_ID,
                   ri.INSTALLMENT_NUMBER,
                   p.PAYMENT_NUMBER
            INTO   v_invoice_payment_id,
                   v_invoice_id,
                   v_installment_number,
                   v_payment_number
            FROM   RR_AP_PAYMENTS_ALL             p
            JOIN   RR_AP_PAYMENTS_RELATED_INVOICES ri
                   ON ri.CHECK_ID = p.CHECK_ID
            WHERE  p.CHECK_ID = v_check_id
            AND    ROWNUM = 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                p_result := '{"status":"error","message":"No related invoice link found for CheckId ' || v_check_id || '"}';
                RETURN;
        END;

        -- ── 4. Void the payment header ───────────────────────────────
        --    Sets VOID_DATE, VOID_ACCOUNTING_DATE, STOP_DATE,
        --    STOP_REASON, STOP_REFERENCE
        UPDATE RR_AP_PAYMENTS_ALL
        SET    PAYMENT_STATUS        = 'Voided',
               VOID_DATE             = v_void_date,
               VOID_ACCOUNTING_DATE  = v_void_date,
               STOP_DATE             = v_void_date,
               STOP_REASON           = NVL(v_stop_reason,    'Payment Voided'),
               STOP_REFERENCE        = NVL(v_stop_reference,  v_payment_number),
               LAST_UPDATED_BY       = NVL(v_voided_by,      LAST_UPDATED_BY),
               LAST_UPDATE_DATE      = SYSTIMESTAMP,
               LOCAL_UPDATED_DATE    = SYSTIMESTAMP
        WHERE  CHECK_ID = v_check_id;

        IF SQL%ROWCOUNT = 0 THEN
            p_result := '{"status":"error","message":"Payment header not found for CheckId ' || v_check_id || '"}';
            RETURN;
        END IF;

        -- ── 5. Void the related invoice link ─────────────────────────
        UPDATE RR_AP_PAYMENTS_RELATED_INVOICES
        SET    INVOICE_PAYMENT_STATUS = 'Voided',
               LAST_UPDATED_BY        = NVL(v_voided_by, LAST_UPDATED_BY),
               LAST_UPDATE_DATE       = SYSTIMESTAMP,
               LOCAL_UPDATED_DATE     = SYSTIMESTAMP
        WHERE  INVOICE_PAYMENT_ID = v_invoice_payment_id;

        -- ── 6. Restore installment if one was linked ─────────────────
        IF v_installment_number IS NOT NULL AND v_invoice_id IS NOT NULL THEN
            BEGIN
                SELECT GROSS_AMOUNT
                INTO   v_gross_amount
                FROM   RR_AP_INVOICE_INSTALLMENTS
                WHERE  INVOICE_ID        = v_invoice_id
                AND    INSTALLMENT_NUMBER = v_installment_number;

                UPDATE RR_AP_INVOICE_INSTALLMENTS
                SET    UNPAID_AMOUNT      = v_gross_amount,
                       PAYMENT_STATUS     = 'Unpaid',
                       LAST_UPDATED_BY    = NVL(v_voided_by, LAST_UPDATED_BY),
                       LAST_UPDATE_DATE   = SYSTIMESTAMP
                WHERE  INVOICE_ID        = v_invoice_id
                AND    INSTALLMENT_NUMBER = v_installment_number;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN NULL; -- non-fatal
            END;
        END IF;

        COMMIT;

        -- ── 7. Return updated invoice balance ────────────────────────
        BEGIN
            SELECT (i.INVOICE_AMOUNT - NVL(SUM(ri2.AMOUNT_PAID_INVOICE_CURRENCY), 0))
            INTO   v_new_balance
            FROM   RR_AP_INVOICES_ALL              i
            LEFT JOIN RR_AP_PAYMENTS_RELATED_INVOICES ri2
                   ON ri2.INVOICE_ID = i.INVOICE_ID
                  AND NVL(ri2.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
            WHERE  i.INVOICE_ID = v_invoice_id
            GROUP BY i.INVOICE_AMOUNT;
        EXCEPTION
            WHEN OTHERS THEN v_new_balance := NULL;
        END;

        p_result :=
            '{"status":"success"'  ||
            ',"message":"Payment voided successfully"' ||
            ',"checkId":'          || v_check_id                              ||
            ',"paymentNumber":"'   || NVL(v_payment_number, '')               || '"' ||
            ',"invoiceId":'        || NVL(TO_CHAR(v_invoice_id),   'null')    ||
            ',"newBalance":'       || NVL(TO_CHAR(v_new_balance),  'null')    ||
            '}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END void_payment;

END XXAP_VOID_PAYMENT_PKG;
/
