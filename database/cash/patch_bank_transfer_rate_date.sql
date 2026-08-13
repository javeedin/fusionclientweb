-- ============================================================
-- Patch: Add CONVERSION_RATE_DATE to RR_BANK_ACCOUNT_TRANSFERS
-- Run once on the target schema.
-- ============================================================

ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
    ADD CONVERSION_RATE_DATE DATE;

COMMENT ON COLUMN RR_BANK_ACCOUNT_TRANSFERS.CONVERSION_RATE_DATE
    IS 'Date of the exchange rate used (from BMS or manual entry)';

COMMIT;
