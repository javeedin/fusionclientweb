-- =============================================================================
-- GET reerp/ap/reports/liability-accounts
-- Liability accounts used by AP invoices — feeds the "Liability Account" picker
-- on the Payables Trial Balance report.
--
-- Module  : reerp   (base path /reerp/)
-- Pattern : ap/reports/liability-accounts
-- Full URL: .../ords/bcldifc/reerp/ap/reports/liability-accounts?P_BUSINESS_UNIT=...
--
-- Parameters (optional):
--   P_BUSINESS_UNIT – only accounts used by this BU's invoices
--
-- Response:
-- { "items": [ { "account": "01-00-00-2313101-0000-000-00-000-000",
--                "natural_account": "2313101",
--                "description": "Accounts Payables",
--                "invoice_count": 1234 } ] }
-- =============================================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/reports/liability-accounts');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/reports/liability-accounts',
        p_comments    => 'Distinct AP liability accounts (for report filters)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/reports/liability-accounts',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_comments       => 'Distinct LIABILITY_DISTRIBUTION with natural-account description and invoice count',
        p_source         => q'[
SELECT a.account,
       a.natural_account,
       MAX(v.DESCRIPTION) AS description,
       a.invoice_count
FROM (
    SELECT i.LIABILITY_DISTRIBUTION                              AS account,
           REGEXP_SUBSTR(i.LIABILITY_DISTRIBUTION, '[^-]+', 1, 4) AS natural_account,
           COUNT(*)                                              AS invoice_count
    FROM   RR_AP_INVOICES_ALL i
    WHERE  i.LIABILITY_DISTRIBUTION IS NOT NULL
    AND    (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT = :P_BUSINESS_UNIT)
    GROUP BY i.LIABILITY_DISTRIBUTION
) a
LEFT JOIN RR_VALUE_SET_VALUES v
       ON v.VALUE = a.natural_account
      AND v.VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
GROUP BY a.account, a.natural_account, a.invoice_count
ORDER BY a.invoice_count DESC, a.account
]'
    );
    COMMIT;
END;
/

-- Verify:  GET .../reerp/ap/reports/liability-accounts?P_BUSINESS_UNIT=BUIMERC CORP_DIFC_INVST
