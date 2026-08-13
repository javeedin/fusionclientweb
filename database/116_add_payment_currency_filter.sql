-- ============================================================
-- 116_add_payment_currency_filter.sql
-- Adds p_payment_currency filter to XXAP_PAYMENTS_PKG.get_payments
-- and updates the ORDS GET /ap/payments handler to pass :payment_currency
-- ============================================================

-- Step 1: Add p_payment_currency to get_payments function
-- Run this in SQL Developer against the BCLDIFC schema.
-- NOTE: Replace the full package body below — only the get_payments
-- function signature and WHERE clause change.

-- Step 2: Replace the ORDS handler
BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'payments',
    p_method      => 'GET'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'payments',
    p_method         => 'GET',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_comments       => 'Get AP Payments with optional filters including payment_currency',
    p_source         => q'[
DECLARE
    v_result     CLOB;
    v_date_from  DATE := NULL;
    v_date_to    DATE := NULL;
    v_only_pdc   VARCHAR2(1) := NVL(:only_pdc, 'N');
    v_off        NUMBER := 1;
    v_chunk_size NUMBER := 30000;
    v_length     NUMBER;
BEGIN
    IF :date_from IS NOT NULL THEN
        BEGIN
            v_date_from := TO_DATE(:date_from, 'YYYY-MM-DD');
        EXCEPTION
            WHEN OTHERS THEN v_date_from := NULL;
        END;
    END IF;
    IF :date_to IS NOT NULL THEN
        BEGIN
            v_date_to := TO_DATE(:date_to, 'YYYY-MM-DD');
        EXCEPTION
            WHEN OTHERS THEN v_date_to := NULL;
        END;
    END IF;

    v_result := XXAP_PAYMENTS_PKG.get_payments(
        p_payment_number   => :payment_number,
        p_payment_status   => :payment_status,
        p_payee            => :payee,
        p_supplier_number  => :supplier_number,
        p_business_unit    => :business_unit,
        p_payment_currency => :payment_currency,
        p_date_from        => v_date_from,
        p_date_to          => v_date_to,
        p_only_pdc         => v_only_pdc,
        p_limit  => NVL(TO_NUMBER(:limit  DEFAULT 100 ON CONVERSION ERROR), 100),
        p_offset => NVL(TO_NUMBER(:offset DEFAULT 0   ON CONVERSION ERROR), 0)
    );

    OWA_UTIL.MIME_HEADER('application/json', FALSE);

    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_off <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk_size, v_off));
        v_off := v_off + v_chunk_size;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/

-- Step 3: Add the p_payment_currency parameter to the package spec and body.
-- Add to XXAP_PAYMENTS_PKG spec (get_payments signature):
--
--   FUNCTION get_payments(
--       p_payment_number    IN VARCHAR2 DEFAULT NULL,
--       p_payment_status    IN VARCHAR2 DEFAULT NULL,
--       p_payee             IN VARCHAR2 DEFAULT NULL,
--       p_supplier_number   IN VARCHAR2 DEFAULT NULL,
--       p_business_unit     IN VARCHAR2 DEFAULT NULL,
--       p_payment_currency  IN VARCHAR2 DEFAULT NULL,   -- NEW
--       p_date_from         IN DATE     DEFAULT NULL,
--       p_date_to           IN DATE     DEFAULT NULL,
--       p_only_pdc          IN VARCHAR2 DEFAULT 'N',
--       p_limit             IN NUMBER   DEFAULT 100,
--       p_offset            IN NUMBER   DEFAULT 0
--   ) RETURN CLOB;
--
-- Add to WHERE clause in the body:
--   AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
--
-- Full WHERE clause becomes:
--   WHERE (p_payment_number   IS NULL OR PAYMENT_NUMBER   = p_payment_number)
--     AND (p_payment_status   IS NULL OR PAYMENT_STATUS   = p_payment_status)
--     AND (p_payee            IS NULL OR UPPER(PAYEE) LIKE '%' || UPPER(p_payee) || '%')
--     AND (p_supplier_number  IS NULL OR SUPPLIER_NUMBER  = p_supplier_number)
--     AND (p_business_unit    IS NULL OR BUSINESS_UNIT    = p_business_unit)
--     AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
--     AND (p_date_from        IS NULL OR PAYMENT_DATE    >= p_date_from)
--     AND (p_date_to          IS NULL OR PAYMENT_DATE    <= p_date_to)
--     AND (p_only_pdc <> 'Y' OR MATURITY_DATE IS NOT NULL);
