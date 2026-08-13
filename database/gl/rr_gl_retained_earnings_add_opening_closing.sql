-- ============================================================
-- Migration: Add OPENING_RE and CLOSING_RE to RR_GL_RETAINED_EARNINGS
-- Run once in SQL Workshop
-- ============================================================

ALTER TABLE RR_GL_RETAINED_EARNINGS
  ADD (
    OPENING_RE   NUMBER(20,2) DEFAULT 0,
    CLOSING_RE   NUMBER(20,2) DEFAULT 0
  );

COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.OPENING_RE  IS 'Opening Retained Earnings balance for this year (seeded from GL for first year, carried from prior year thereafter)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CLOSING_RE  IS 'Closing Retained Earnings = Opening RE + Net P&L';
