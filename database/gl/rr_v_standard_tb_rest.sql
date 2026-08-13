-- =====================================================
-- ORDS REST Handler for gl/rr-trialbalance/standard
-- Source view: RR_V_STANDARD_TB
--
-- Params:
--   ledger_name   REQUIRED
--   period_name   optional  e.g. 'Sep-23'
--   period_year   optional  e.g. '2024' (fiscal year as text)
--   account_type  optional  A / L / O / R / E
--   company       optional  segment 1 value
--   currency_code optional  e.g. 'AED'
--   account       optional  e.g. '1240100'
-- =====================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TEMPLATE: gl/rr-trialbalance/standard
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Standard TB format: Opening / Debit / Credit / Closing (net)'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 2. GET /reerp/gl/rr-trialbalance/standard
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Live TB via RR_V_STANDARD_TB — Opening/Debit/Credit/Closing with optional filters',
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
END;
/
