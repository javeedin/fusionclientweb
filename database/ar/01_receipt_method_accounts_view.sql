-- ============================================================
-- View: RR_V_RECEIPT_METHODS_BANK_ACCOUNTS
-- Joins:
--   AR_RECEIPT_METHOD_ACCOUNTS_ALL  — base bank account rows
--   RR_AR_RECEIPT_METHODS           — receipt method name + class
--   RR_BANK_ACCOUNTS                — bank account name, number, bank/branch
--   RR_GL_BUSINESS_UNITS            — business unit name + company (via org_id)
--   REERP_GL_CODE_COMBINATIONS      — GL code combinations per CCID
-- ============================================================
CREATE OR REPLACE VIEW RR_V_RECEIPT_METHODS_BANK_ACCOUNTS AS
SELECT
    r.ID,
    r.RECEIPT_METHOD_ID,

    -- Receipt Method details
    COALESCE(rm.NAME,         'Method-' || r.RECEIPT_METHOD_ID) AS RECEIPT_METHOD_NAME,
    COALESCE(rm.RECEIPTCLASS, 'Unknown')                        AS RECEIPT_CLASS,
    rm.RECEIPTMETHODID                                          AS FUSION_RECEIPT_METHOD_ID,

    -- Business Unit details (org_id = business_unit_id)
    r.ORG_ID,
    bu.BUSINESS_UNIT_NAME,
    bu.COMPANY,

    -- Bank Account details
    r.BANK_ACCOUNT_ID,
    ba.BANK_ACCOUNT_NAME,
    ba.BANK_ACCOUNT_NUMBER,
    ba.BANK_NAME,
    ba.BANK_BRANCH_NAME,
    ba.CURRENCY_CODE     AS BANK_CURRENCY,

    r.PRIMARY_FLAG,
    r.START_DATE,
    r.END_DATE,

    -- Cash Account
    r.CASH_CCID,
    cc_cash."buimercFinGlbCoaCo"         || '.' ||
    cc_cash."buimercFinGlbCoaLob"        || '.' ||
    cc_cash."buimercFinGlbCoaDepartment" || '.' ||
    cc_cash."buimercFinGlbCoaAccount"    || '.' ||
    cc_cash."buimercFinGlbCoaSubAcc"     || '.' ||
    cc_cash."buimercFinGlbCoaAlys"       || '.' ||
    cc_cash."buimercFinGlbCoaIc"         || '.' ||
    cc_cash."buimercFinGlbCoaFut1"       || '.' ||
    cc_cash."buimercFinGlbCoaFut2"       AS CASH_COMBINATION,

    -- Unapplied Account
    r.UNAPPLIED_CCID,
    cc_unap."buimercFinGlbCoaCo"         || '.' ||
    cc_unap."buimercFinGlbCoaLob"        || '.' ||
    cc_unap."buimercFinGlbCoaDepartment" || '.' ||
    cc_unap."buimercFinGlbCoaAccount"    || '.' ||
    cc_unap."buimercFinGlbCoaSubAcc"     || '.' ||
    cc_unap."buimercFinGlbCoaAlys"       || '.' ||
    cc_unap."buimercFinGlbCoaIc"         || '.' ||
    cc_unap."buimercFinGlbCoaFut1"       || '.' ||
    cc_unap."buimercFinGlbCoaFut2"       AS UNAPPLIED_COMBINATION,

    -- Unidentified Account
    r.UNIDENTIFIED_CCID,
    cc_unid."buimercFinGlbCoaCo"         || '.' ||
    cc_unid."buimercFinGlbCoaLob"        || '.' ||
    cc_unid."buimercFinGlbCoaDepartment" || '.' ||
    cc_unid."buimercFinGlbCoaAccount"    || '.' ||
    cc_unid."buimercFinGlbCoaSubAcc"     || '.' ||
    cc_unid."buimercFinGlbCoaAlys"       || '.' ||
    cc_unid."buimercFinGlbCoaIc"         || '.' ||
    cc_unid."buimercFinGlbCoaFut1"       || '.' ||
    cc_unid."buimercFinGlbCoaFut2"       AS UNIDENTIFIED_COMBINATION,

    -- On Account
    r.ON_ACCOUNT_CCID,
    cc_onac."buimercFinGlbCoaCo"         || '.' ||
    cc_onac."buimercFinGlbCoaLob"        || '.' ||
    cc_onac."buimercFinGlbCoaDepartment" || '.' ||
    cc_onac."buimercFinGlbCoaAccount"    || '.' ||
    cc_onac."buimercFinGlbCoaSubAcc"     || '.' ||
    cc_onac."buimercFinGlbCoaAlys"       || '.' ||
    cc_onac."buimercFinGlbCoaIc"         || '.' ||
    cc_onac."buimercFinGlbCoaFut1"       || '.' ||
    cc_onac."buimercFinGlbCoaFut2"       AS ON_ACCOUNT_COMBINATION,

    -- Receipt Clearing Account
    r.RECEIPT_CLEARING_CCID,
    cc_clr."buimercFinGlbCoaCo"          || '.' ||
    cc_clr."buimercFinGlbCoaLob"         || '.' ||
    cc_clr."buimercFinGlbCoaDepartment"  || '.' ||
    cc_clr."buimercFinGlbCoaAccount"     || '.' ||
    cc_clr."buimercFinGlbCoaSubAcc"      || '.' ||
    cc_clr."buimercFinGlbCoaAlys"        || '.' ||
    cc_clr."buimercFinGlbCoaIc"          || '.' ||
    cc_clr."buimercFinGlbCoaFut1"        || '.' ||
    cc_clr."buimercFinGlbCoaFut2"        AS RECEIPT_CLEARING_COMBINATION,

    -- Remittance Account
    r.REMITTANCE_CCID,
    cc_rem."buimercFinGlbCoaCo"          || '.' ||
    cc_rem."buimercFinGlbCoaLob"         || '.' ||
    cc_rem."buimercFinGlbCoaDepartment"  || '.' ||
    cc_rem."buimercFinGlbCoaAccount"     || '.' ||
    cc_rem."buimercFinGlbCoaSubAcc"      || '.' ||
    cc_rem."buimercFinGlbCoaAlys"        || '.' ||
    cc_rem."buimercFinGlbCoaIc"          || '.' ||
    cc_rem."buimercFinGlbCoaFut1"        || '.' ||
    cc_rem."buimercFinGlbCoaFut2"        AS REMITTANCE_COMBINATION

FROM AR_RECEIPT_METHOD_ACCOUNTS_ALL r
LEFT JOIN RR_AR_RECEIPT_METHODS rm
       ON rm.RECEIPTMETHODID = r.RECEIPT_METHOD_ID
LEFT JOIN RR_GL_BUSINESS_UNITS bu
       ON bu.BUSINESS_UNIT_ID = r.ORG_ID
LEFT JOIN RR_BANK_ACCOUNTS ba
       ON ba.BANK_ACCOUNT_ID  = r.BANK_ACCOUNT_ID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_cash  ON cc_cash."_CODE_COMBINATION_ID" = r.CASH_CCID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_unap  ON cc_unap."_CODE_COMBINATION_ID" = r.UNAPPLIED_CCID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_unid  ON cc_unid."_CODE_COMBINATION_ID" = r.UNIDENTIFIED_CCID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_onac  ON cc_onac."_CODE_COMBINATION_ID" = r.ON_ACCOUNT_CCID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_clr   ON cc_clr."_CODE_COMBINATION_ID"  = r.RECEIPT_CLEARING_CCID
LEFT JOIN REERP_GL_CODE_COMBINATIONS cc_rem   ON cc_rem."_CODE_COMBINATION_ID"  = r.REMITTANCE_CCID;
/
