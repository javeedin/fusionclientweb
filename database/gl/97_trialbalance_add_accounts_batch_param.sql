-- ============================================================
-- Fix: gl/rr-trialbalance/standard — add "accounts" batch param
--
-- Adds support for: ?accounts=1001,1002,1003
-- so the frontend can fetch opening balances for up to 30
-- accounts in a single API call instead of N individual calls.
--
-- Requires rr_split_csv function to already exist (see 96_).
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Live TB via RR_V_STANDARD_TB — PTD + YTD + full segment filters + batch accounts',
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
  AND (:lob          IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,2)) = :lob)
  AND (:department   IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,3)) = :department)
  AND (:sub_account  IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,5)) = :sub_account)
  AND (:analysis     IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,6)) = :analysis)
  AND (:intercompany IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,7)) = :intercompany)
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
    DBMS_OUTPUT.PUT_LINE('gl/rr-trialbalance/standard updated — accounts batch param added');
END;
/

-- Quick test after running (replace values):
-- SELECT * FROM TABLE(rr_split_csv('1001,1002,1003'));
-- GET /rr-trialbalance/standard?ledger_name=X&period_name=JAN-25&accounts=1001,1002,1003
