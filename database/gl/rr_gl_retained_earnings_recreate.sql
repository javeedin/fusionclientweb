-- ============================================================
-- Drop and recreate RR_GL_RETAINED_EARNINGS with full schema
-- Run in APEX SQL Workshop
-- ============================================================

-- 1. DROP (safe — cascades constraints)
DROP TABLE RR_GL_RETAINED_EARNINGS CASCADE CONSTRAINTS PURGE;

-- 2. RECREATE with OPENING_RE / CLOSING_RE
CREATE TABLE RR_GL_RETAINED_EARNINGS (
    ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    LEDGER_NAME   VARCHAR2(200)  NOT NULL,
    YEAR          NUMBER(4)      NOT NULL,
    LAST_PERIOD   VARCHAR2(30),
    COMPANY       VARCHAR2(30),
    RE_ACCOUNT    VARCHAR2(30),
    REVENUE       NUMBER(20,2)   DEFAULT 0,
    EXPENSES      NUMBER(20,2)   DEFAULT 0,
    NET_PL        NUMBER(20,2)   DEFAULT 0,
    RE_BALANCE    NUMBER(20,2)   DEFAULT 0,   -- RE account closing balance from GL
    OPENING_RE    NUMBER(20,2)   DEFAULT 0,   -- seeded from GL for first year; carried forward thereafter
    CLOSING_RE    NUMBER(20,2)   DEFAULT 0,   -- OPENING_RE + NET_PL
    CUMULATIVE_RE NUMBER(20,2)   DEFAULT 0,   -- same as CLOSING_RE (kept for backward compat)
    CREATED_DATE  DATE           DEFAULT SYSDATE,
    UPDATED_DATE  DATE           DEFAULT SYSDATE,
    CONSTRAINT UQ_RE_LEDGER_YEAR_CO UNIQUE (LEDGER_NAME, YEAR, COMPANY)
);

COMMENT ON TABLE  RR_GL_RETAINED_EARNINGS                IS 'Retained Earnings rollforward by ledger / fiscal year / company';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.LEDGER_NAME    IS 'Oracle Fusion ledger name';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.YEAR           IS 'Fiscal year (e.g. 2024)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.LAST_PERIOD    IS 'Last period of the year used (e.g. Mar-24)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.COMPANY        IS 'Company segment filter (NULL = all companies)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_ACCOUNT     IS 'Retained Earnings GL account code (e.g. 3112100)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.REVENUE        IS 'Total revenue closing balance (credit = negative)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.EXPENSES       IS 'Total expenses closing balance (debit = positive)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.NET_PL         IS 'Net P&L = Revenue + Expenses (negative = profit)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_BALANCE     IS 'Closing balance of the RE GL account itself';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.OPENING_RE     IS 'Opening RE: seeded from GL balance for first year; = prior year CLOSING_RE for subsequent years';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CLOSING_RE     IS 'Closing RE = OPENING_RE + NET_PL';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CUMULATIVE_RE  IS 'Same as CLOSING_RE — kept for compatibility';
