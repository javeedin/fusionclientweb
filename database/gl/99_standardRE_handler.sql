-- ============================================================
-- 99: New endpoint gl/rr-trialbalance/standardRE
--
-- Returns ONLY saved Retained Earnings rows from RR_GL_RETAINED_EARNINGS.
-- UI calls this alongside gl/rr-trialbalance/standard and merges results.
--
-- Run in APEX SQL Workshop
-- ============================================================

BEGIN

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/rr-trialbalance/standardRE',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Retained Earnings rows only'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standardRE',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Saved RE rows from RR_GL_RETAINED_EARNINGS',
        p_source         => q'[
SELECT
    re.LEDGER_NAME                                          AS ledger_name,
    re.LAST_PERIOD                                          AS period_name,
    re.YEAR                                                 AS fiscal_year,
    12                                                      AS fiscal_period,
    'AED'                                                   AS currency_code,
    re.RE_ACCOUNT                                           AS account_combination,
    re.COMPANY                                              AS company,
    re.RE_ACCOUNT                                           AS account,
    'OE'                                                    AS account_type,
    'Retained Earnings'                                     AS account_desc,
    re.OPENING_RE                                           AS opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END     AS debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END     AS credit,
    re.CLOSING_RE                                           AS closing,
    re.OPENING_RE                                           AS entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END     AS entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END     AS entered_credit,
    re.CLOSING_RE                                           AS entered_closing,
    re.OPENING_RE                                           AS ytd_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END     AS ytd_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END     AS ytd_credit,
    re.OPENING_RE                                           AS ytd_entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END     AS ytd_entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END     AS ytd_entered_credit
FROM RR_GL_RETAINED_EARNINGS re
WHERE re.LEDGER_NAME = :ledger_name
  AND (:company     IS NULL OR re.COMPANY       = :company)
  AND (:period_name IS NULL OR re.LAST_PERIOD   = :period_name)
  AND (:period_year IS NULL OR TO_CHAR(re.YEAR) = :period_year)
ORDER BY re.YEAR, re.COMPANY
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('gl/rr-trialbalance/standardRE created successfully');

END;
/
