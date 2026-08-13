-- ============================================================
-- New endpoint: gl/rr-trialbalance/standardRE
--
-- Same as gl/rr-trialbalance/standard but with saved Retained
-- Earnings rows unioned in from RR_GL_RETAINED_EARNINGS.
--
-- gl/rr-trialbalance/standard remains unchanged (pure TB only).
-- ============================================================

BEGIN
    -- Template
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/rr-trialbalance/standardRE',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Trial Balance + Retained Earnings rows'
    );

    -- GET handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standardRE',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'TB + RE: RR_V_STANDARD_TB UNION ALL RR_GL_RETAINED_EARNINGS',
        p_source         => q'[
SELECT *
FROM (
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
      AND (
            (:account IS NULL AND :accounts IS NULL)
         OR (:account  IS NOT NULL AND account = :account)
         OR (:accounts IS NOT NULL AND account IN (
                 SELECT * FROM TABLE(rr_split_csv(:accounts))
             ))
          )
      AND (:lob          IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,2)) = :lob)
      AND (:department   IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,3)) = :department)
      AND (:sub_account  IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,5)) = :sub_account)
      AND (:analysis     IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,6)) = :analysis)
      AND (:intercompany IS NULL OR TRIM(REGEXP_SUBSTR(account_combination,'[^-]+',1,7)) = :intercompany)

    UNION ALL

    SELECT
        re.LEDGER_NAME,
        re.LAST_PERIOD,
        re.YEAR,
        12,
        'AED',
        re.RE_ACCOUNT,
        re.COMPANY,
        re.RE_ACCOUNT,
        'OE',
        'Retained Earnings',
        re.OPENING_RE,
        CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END,
        CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END,
        re.CLOSING_RE,
        re.OPENING_RE,
        CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END,
        CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END,
        re.CLOSING_RE,
        re.OPENING_RE,
        CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END,
        CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END,
        re.OPENING_RE,
        CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END,
        CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END
    FROM RR_GL_RETAINED_EARNINGS re
    WHERE re.LEDGER_NAME = :ledger_name
      AND (:company      IS NULL OR re.COMPANY       = :company)
      AND (:period_name  IS NULL OR re.LAST_PERIOD   = :period_name)
      AND (:period_year  IS NULL OR TO_CHAR(re.YEAR) = :period_year)
      AND (:account_type IS NULL OR 'OE'             = :account_type)
      AND (:account      IS NULL OR re.RE_ACCOUNT    = :account)
)
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
    DBMS_OUTPUT.PUT_LINE('gl/rr-trialbalance/standardRE created');
END;
/
