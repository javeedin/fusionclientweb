-- ============================================================
-- Fix: gl/rr-trialbalance/standard handler missing YTD columns
--
-- The handler SELECT was missing ytd_opening, ytd_debit, ytd_credit
-- and their entered-currency equivalents.  The frontend received
-- NULL/0 for those fields and had to recompute YTD itself.
--
-- With the view fix in 44_fix_standard_tb_view_ytd_suppression.sql
-- the view now returns correct, consistent YTD values — this handler
-- update exposes them to the API response.
--
-- Also ensures company and currency_code bind params are applied
-- server-side so the webservice filters correctly before returning.
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Live TB via RR_V_STANDARD_TB — PTD + YTD columns with optional filters',
        p_source         => q'[
SELECT
    ledger_name,
    period_name,
    fiscal_year,
    fiscal_period,
    currency_code,
    account_combination,
    company,
    account,
    account_type,
    account_desc,
    opening,
    debit,
    credit,
    closing,
    entered_opening,
    entered_debit,
    entered_credit,
    entered_closing,
    ytd_opening,
    ytd_debit,
    ytd_credit,
    ytd_entered_opening,
    ytd_entered_debit,
    ytd_entered_credit
FROM RR_V_STANDARD_TB
WHERE ledger_name          = :ledger_name
  AND (:period_name   IS NULL OR period_name          = :period_name)
  AND (:period_year   IS NULL OR TO_CHAR(fiscal_year) = :period_year)
  AND (:account_type  IS NULL OR account_type         = :account_type)
  AND (:company       IS NULL OR company              = :company)
  AND (:currency_code IS NULL OR currency_code        = :currency_code)
  AND (:account       IS NULL OR account              = :account)
ORDER BY
    fiscal_year,
    fiscal_period,
    CASE account_type
        WHEN 'A' THEN 1 WHEN 'L' THEN 2 WHEN 'O' THEN 3
        WHEN 'R' THEN 4 WHEN 'E' THEN 5 ELSE 6
    END,
    account,
    account_combination,
    currency_code
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('gl/rr-trialbalance/standard handler updated with YTD columns');
END;
/
