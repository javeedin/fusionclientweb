-- ============================================================
-- Patch: Add FUNC_CONVERSION_RATE to RR_BANK_ACCOUNT_TRANSFERS
-- This stores the rate between payment currency and the
-- functional currency (AED) used for GL accounted amounts.
-- Run once on the target schema.
-- ============================================================

ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
    ADD FUNC_CONVERSION_RATE NUMBER;

COMMENT ON COLUMN RR_BANK_ACCOUNT_TRANSFERS.FUNC_CONVERSION_RATE
    IS 'Rate to convert payment currency to functional currency (AED). Used for GL accounted amounts.';

COMMIT;
