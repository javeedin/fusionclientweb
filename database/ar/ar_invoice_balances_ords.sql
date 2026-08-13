-- =====================================================
-- ORDS REST Handler — AR Invoice Balance Details
-- Module  : ar  (already defined)
-- Base    : /ar/
-- Package : RR_AR_INVOICE_BALANCES
-- =====================================================

-- =====================================================
-- 1. Template: ar/invoice-balances
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoice-balances');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoice-balances',
        p_comments    => 'AR Invoice Balance Details'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. GET /ar/invoice-balances
--    Parameters:
--      customer_transaction_id  NUMBER  (required)
--      transaction_number       VARCHAR2 (optional; resolved from header if omitted)
--    Returns:
--      {"status":"SUCCESS","balance":nnn,"items":[
--        {"category":"Original Amount","line_amount":n,...,"is_total":"N"},
--        ...
--        {"category":"Balance","line_amount":n,...,"is_total":"Y"}
--      ]}
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoice-balances',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_comments       => 'Compute invoice balance breakdown',
        p_source         => '
DECLARE
    l_json    CLOB;
    l_cust_id NUMBER;
    l_txn_num VARCHAR2(50);
BEGIN
    l_cust_id := TO_NUMBER(:customer_transaction_id);
    l_txn_num := :transaction_number;
    l_json := RR_AR_INVOICE_BALANCES.get_balance_json(
        l_cust_id,
        CASE WHEN TRIM(l_txn_num) IS NULL THEN NULL ELSE TRIM(l_txn_num) END
    );
    :status_code := 200;
    HTP.P(l_json);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM,'"','\"') || '","balance":0,"items":[]}');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET {base}/ar/invoice-balances
--   ?customer_transaction_id=   NUMBER  (required)
--   ?transaction_number=        VARCHAR2 (optional)
--
-- Response:
--   {
--     "status":  "SUCCESS",
--     "balance": 18750.00,          <-- current outstanding balance
--     "items": [
--       { "category":       "Original Amount",
--         "line_amount":    25000.00,
--         "tax_amount":     0.00,
--         "freight_amount": 0.00,
--         "charge_amount":  0.00,
--         "total_amount":   25000.00,
--         "sort_order":     1,
--         "is_total":       "N" },
--       { "category": "Prepayments",  "total_amount":     0.00, ... },
--       { "category": "Receipts",     "total_amount": -4543.75, ... },
--       { "category": "Credits/Refunds","total_amount":   0.00, ... },
--       { "category": "Adjustments",  "total_amount": -1706.25, ... },
--       { "category": "Bills Receivable","total_amount":  0.00, ... },
--       { "category": "Discounts",    "total_amount":    0.00, ... },
--       { "category": "Balance",      "total_amount": 18750.00, ..., "is_total":"Y" }
--     ]
--   }
-- =====================================================
