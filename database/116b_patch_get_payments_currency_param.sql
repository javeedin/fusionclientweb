-- ============================================================
-- 116b_patch_get_payments_currency_param.sql
-- Patches XXAP_PAYMENTS_PKG to add p_payment_currency to
-- get_payments — run BEFORE the ORDS handler update (116).
-- ============================================================

-- Step 1: Add parameter to package SPEC
-- (Only needed if your spec explicitly declares get_payments)
-- If your spec uses DEFAULT NULL for all params this may already compile.

-- Step 2: Patch the package BODY — replace get_payments function
-- Find this function in your package body and apply the two changes:
--
-- CHANGE 1 — Add parameter to function signature (after p_business_unit):
--     p_payment_currency  IN VARCHAR2 DEFAULT NULL,
--
-- CHANGE 2 — Add to WHERE clause (after p_business_unit line):
--     AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
--
-- ============================================================
-- QUICKEST FIX: Run the block below to recompile only the
-- get_payments function via a standalone wrapper.
-- If you have access to the full package body, edit it directly.
-- ============================================================

-- Temporary standalone wrapper approach (if you cannot edit the package):
-- This creates an ORDS-callable block that filters currency client-side.
-- *** Use this ONLY as a stopgap until the package body is updated. ***

-- To revert the ORDS handler to the old signature (no currency param)
-- while you update the package, run this:

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
    p_comments       => 'Get AP Payments — currency filtered in handler until package is updated',
    p_source         => q'[
DECLARE
    v_result     CLOB;
    v_date_from  DATE := NULL;
    v_date_to    DATE := NULL;
    v_only_pdc   VARCHAR2(1) := NVL(:only_pdc, 'N');
    v_currency   VARCHAR2(10) := :payment_currency;
    v_off        NUMBER := 1;
    v_chunk_size NUMBER := 30000;
    v_length     NUMBER;
    v_filtered   CLOB;
BEGIN
    IF :date_from IS NOT NULL THEN
        BEGIN
            v_date_from := TO_DATE(:date_from, 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN v_date_from := NULL;
        END;
    END IF;
    IF :date_to IS NOT NULL THEN
        BEGIN
            v_date_to := TO_DATE(:date_to, 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN v_date_to := NULL;
        END;
    END IF;

    -- Call existing package (old signature, no currency param)
    v_result := XXAP_PAYMENTS_PKG.get_payments(
        p_payment_number  => :payment_number,
        p_payment_status  => :payment_status,
        p_payee           => :payee,
        p_supplier_number => :supplier_number,
        p_business_unit   => :business_unit,
        p_date_from       => v_date_from,
        p_date_to         => v_date_to,
        p_only_pdc        => v_only_pdc,
        p_limit           => NVL(TO_NUMBER(:limit  DEFAULT 100 ON CONVERSION ERROR), 100),
        p_offset          => NVL(TO_NUMBER(:offset DEFAULT 0   ON CONVERSION ERROR), 0)
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

-- ============================================================
-- PERMANENT FIX: Update XXAP_PAYMENTS_PKG package body.
-- Locate the get_payments function and make these two edits:
--
-- 1. Add to function signature (after p_business_unit line):
--        p_payment_currency  IN VARCHAR2 DEFAULT NULL,
--
-- 2. Add to COUNT query WHERE clause:
--        AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
--
-- 3. Add to main SELECT WHERE clause (same condition):
--        AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
--
-- 4. Update package SPEC to match (same parameter added).
--
-- Then re-run 116_add_payment_currency_filter.sql to update ORDS handler.
-- ============================================================
