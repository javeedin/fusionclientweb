-- =============================================================================
-- RR ERP – Subledger Accounting (SLA) Tables
-- Run in Oracle APEX SQL Workshop / SQL*Plus
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sequences
-- -----------------------------------------------------------------------------
CREATE SEQUENCE RR_SLA_HDR_SEQ  START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;
CREATE SEQUENCE RR_SLA_LINE_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;

-- -----------------------------------------------------------------------------
-- RR_SLA_ACCOUNTING_HEADERS
-- One row per accounting event per source transaction
-- STATUS FLOW: DRAFT → FINAL → POSTED | ERROR
-- -----------------------------------------------------------------------------
CREATE TABLE RR_SLA_ACCOUNTING_HEADERS (
  -- PK
  HEADER_ID               NUMBER          DEFAULT RR_SLA_HDR_SEQ.NEXTVAL  NOT NULL,

  -- Source Transaction
  MODULE_NAME             VARCHAR2(60)    NOT NULL,   -- 'AP','AR','GL','CM','FA'
  SOURCE_TABLE            VARCHAR2(60)    NOT NULL,   -- 'AP_INVOICES','AP_PAYMENTS','AR_RECEIPTS'
  SOURCE_ID               NUMBER          NOT NULL,   -- e.g. INVOICE_ID
  SOURCE_NUMBER           VARCHAR2(100),              -- e.g. Invoice number
  SOURCE_TYPE             VARCHAR2(60),               -- 'STANDARD','PREPAYMENT','CREDIT_MEMO'
  EVENT_TYPE_CODE         VARCHAR2(60)    NOT NULL,   -- 'INVOICE_VALIDATED','PAYMENT_CREATED', etc.
  EVENT_DATE              DATE,
  ACCOUNTING_DATE         DATE            NOT NULL,
  PERIOD_NAME             VARCHAR2(15),               -- e.g. 'Dec-2025'

  -- Ledger / Org
  LEDGER_ID               NUMBER,
  LEDGER_NAME             VARCHAR2(100),
  CURRENCY_CODE           VARCHAR2(15),
  LEDGER_CURRENCY         VARCHAR2(15)    DEFAULT 'AED',
  EXCHANGE_RATE           NUMBER          DEFAULT 1,
  EXCHANGE_RATE_TYPE      VARCHAR2(30)    DEFAULT 'Corporate',
  BUSINESS_UNIT           VARCHAR2(100),
  LEGAL_ENTITY            VARCHAR2(100),

  -- Description
  DESCRIPTION             VARCHAR2(500),

  -- Accounting Status (controls edit lock)
  ACCOUNTING_STATUS       VARCHAR2(20)    DEFAULT 'DRAFT'   NOT NULL,
  -- DRAFT   = created, editable
  -- FINAL   = finalised, ready to post
  -- POSTED  = transferred to GL, locked
  -- ERROR   = posting failed

  -- Posting Status
  POSTING_STATUS          VARCHAR2(20)    DEFAULT 'UNPOSTED' NOT NULL,
  -- UNPOSTED / POSTED / REJECTED

  -- GL Transfer Details (populated after Post to Ledger)
  GL_BATCH_ID             NUMBER,
  GL_BATCH_NAME           VARCHAR2(240),
  GL_HEADER_ID            NUMBER,
  GL_TRANSFER_DATE        DATE,
  POSTED_BY               VARCHAR2(100),
  POSTED_DATE             DATE,

  -- Reversal
  REVERSAL_FLAG           VARCHAR2(1)     DEFAULT 'N',
  REVERSED_HEADER_ID      NUMBER,         -- FK → self (original header being reversed)

  -- Who columns
  CREATED_BY              VARCHAR2(100)   DEFAULT USER,
  CREATION_DATE           DATE            DEFAULT SYSDATE,
  LAST_UPDATED_BY         VARCHAR2(100)   DEFAULT USER,
  LAST_UPDATE_DATE        DATE            DEFAULT SYSDATE,

  CONSTRAINT RR_SLA_HDR_PK  PRIMARY KEY (HEADER_ID),
  CONSTRAINT RR_SLA_HDR_STATUS_CHK
    CHECK (ACCOUNTING_STATUS IN ('DRAFT','FINAL','POSTED','ERROR')),
  CONSTRAINT RR_SLA_HDR_POST_CHK
    CHECK (POSTING_STATUS IN ('UNPOSTED','POSTED','REJECTED')),
  CONSTRAINT RR_SLA_HDR_REV_CHK
    CHECK (REVERSAL_FLAG IN ('Y','N')),
  CONSTRAINT RR_SLA_HDR_SELF_FK
    FOREIGN KEY (REVERSED_HEADER_ID) REFERENCES RR_SLA_ACCOUNTING_HEADERS(HEADER_ID)
);

-- Indexes on HEADERS
CREATE INDEX RR_SLA_HDR_SRC_IDX  ON RR_SLA_ACCOUNTING_HEADERS (SOURCE_TABLE, SOURCE_ID);
CREATE INDEX RR_SLA_HDR_MOD_IDX  ON RR_SLA_ACCOUNTING_HEADERS (MODULE_NAME);
CREATE INDEX RR_SLA_HDR_STAT_IDX ON RR_SLA_ACCOUNTING_HEADERS (ACCOUNTING_STATUS, POSTING_STATUS);
CREATE INDEX RR_SLA_HDR_DATE_IDX ON RR_SLA_ACCOUNTING_HEADERS (ACCOUNTING_DATE);
CREATE INDEX RR_SLA_HDR_PER_IDX  ON RR_SLA_ACCOUNTING_HEADERS (PERIOD_NAME);

-- ── DB-level duplicate guards (last line of defence) ──────────────────────────
--
-- 1. POSTED guard: only one POSTED entry per (source_table, source_id, event_type).
--    Oracle excludes NULL from unique indexes, so DRAFT/ERROR rows (where the CASE
--    returns NULL) are not covered and can coexist freely.
CREATE UNIQUE INDEX RR_SLA_HDR_POSTED_UNQ
  ON RR_SLA_ACCOUNTING_HEADERS (
    CASE WHEN ACCOUNTING_STATUS = 'POSTED' THEN SOURCE_TABLE    END,
    CASE WHEN ACCOUNTING_STATUS = 'POSTED' THEN SOURCE_ID       END,
    CASE WHEN ACCOUNTING_STATUS = 'POSTED' THEN EVENT_TYPE_CODE END
  );

-- 2. DRAFT guard: at most one DRAFT per (source_table, source_id, event_type) at
--    any moment.  Prevents two concurrent sessions both inserting a DRAFT before
--    either notices the other.
CREATE UNIQUE INDEX RR_SLA_HDR_DRAFT_UNQ
  ON RR_SLA_ACCOUNTING_HEADERS (
    CASE WHEN ACCOUNTING_STATUS = 'DRAFT' THEN SOURCE_TABLE    END,
    CASE WHEN ACCOUNTING_STATUS = 'DRAFT' THEN SOURCE_ID       END,
    CASE WHEN ACCOUNTING_STATUS = 'DRAFT' THEN EVENT_TYPE_CODE END
  );

-- 3. Line-number uniqueness within a header (prevents duplicate line numbers).
CREATE UNIQUE INDEX RR_SLA_LINE_NUM_UNQ
  ON RR_SLA_ACCOUNTING_LINES (HEADER_ID, LINE_NUMBER);

COMMENT ON TABLE  RR_SLA_ACCOUNTING_HEADERS                IS 'SLA – one row per accounting event per source transaction';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_HEADERS.ACCOUNTING_STATUS IS 'DRAFT=editable | FINAL=ready to post | POSTED=locked in GL | ERROR=post failed';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_HEADERS.MODULE_NAME    IS 'AP | AR | GL | CM | FA';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_HEADERS.EVENT_TYPE_CODE IS 'INVOICE_VALIDATED | INVOICE_CANCELLED | PAYMENT_CREATED | PREPAYMENT_APPLIED | PREPAYMENT_UNAPPLIED';

-- -----------------------------------------------------------------------------
-- RR_SLA_ACCOUNTING_LINES
-- Debit and Credit journal lines (one row per DR or CR)
-- -----------------------------------------------------------------------------
CREATE TABLE RR_SLA_ACCOUNTING_LINES (
  -- PK
  LINE_ID                 NUMBER          DEFAULT RR_SLA_LINE_SEQ.NEXTVAL  NOT NULL,
  HEADER_ID               NUMBER          NOT NULL,
  LINE_NUMBER             NUMBER          NOT NULL,

  -- DR or CR
  LINE_TYPE               VARCHAR2(2)     NOT NULL,   -- 'DR' or 'CR'
  ACCOUNTING_CLASS        VARCHAR2(60),               -- 'LIABILITY','EXPENSE','PREPAYMENT','TAX','ASSET'

  -- Account
  ACCOUNT_COMBINATION     VARCHAR2(200),              -- full string e.g. 02-00-00-1223108-0000-000-00-000-000
  SEGMENT1                VARCHAR2(30),
  SEGMENT2                VARCHAR2(30),
  SEGMENT3                VARCHAR2(30),
  SEGMENT4                VARCHAR2(30),
  SEGMENT5                VARCHAR2(30),
  SEGMENT6                VARCHAR2(30),
  SEGMENT7                VARCHAR2(30),
  SEGMENT8                VARCHAR2(30),
  SEGMENT9                VARCHAR2(30),
  SEGMENT10               VARCHAR2(30),
  SEGMENT11               VARCHAR2(30),
  SEGMENT12               VARCHAR2(30),
  SEGMENT13               VARCHAR2(30),
  SEGMENT14               VARCHAR2(30),
  SEGMENT15               VARCHAR2(30),

  -- Amounts (entered = transaction currency, accounted = ledger/functional currency)
  ENTERED_DR              NUMBER          DEFAULT 0,
  ENTERED_CR              NUMBER          DEFAULT 0,
  ACCOUNTED_DR            NUMBER          DEFAULT 0,
  ACCOUNTED_CR            NUMBER          DEFAULT 0,
  CURRENCY_CODE           VARCHAR2(15),
  EXCHANGE_RATE           NUMBER          DEFAULT 1,

  -- Description
  DESCRIPTION             VARCHAR2(500),

  -- Source Line Reference
  SOURCE_LINE_ID          NUMBER,         -- e.g. INVOICE_LINE_ID
  SOURCE_LINE_NUMBER      NUMBER,

  -- Party
  PARTY_ID                NUMBER,
  PARTY_TYPE              VARCHAR2(30),   -- 'SUPPLIER' or 'CUSTOMER'

  -- Reconciliation
  RECONCILIATION_REF      VARCHAR2(100),

  -- GL Link (populated after posting)
  GL_SL_LINK_ID           NUMBER,

  -- Who columns
  CREATED_BY              VARCHAR2(100)   DEFAULT USER,
  CREATION_DATE           DATE            DEFAULT SYSDATE,

  CONSTRAINT RR_SLA_LINE_PK     PRIMARY KEY (LINE_ID),
  CONSTRAINT RR_SLA_LINE_HDR_FK FOREIGN KEY (HEADER_ID) REFERENCES RR_SLA_ACCOUNTING_HEADERS(HEADER_ID) ON DELETE CASCADE,
  CONSTRAINT RR_SLA_LINE_TYPE_CHK CHECK (LINE_TYPE IN ('DR','CR'))
);

-- Indexes on LINES
CREATE INDEX RR_SLA_LINE_HDR_IDX  ON RR_SLA_ACCOUNTING_LINES (HEADER_ID);
CREATE INDEX RR_SLA_LINE_ACCT_IDX ON RR_SLA_ACCOUNTING_LINES (ACCOUNT_COMBINATION);
CREATE INDEX RR_SLA_LINE_SEG3_IDX ON RR_SLA_ACCOUNTING_LINES (SEGMENT3);  -- Natural account

COMMENT ON TABLE  RR_SLA_ACCOUNTING_LINES               IS 'SLA – debit and credit lines for each accounting header';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.LINE_TYPE      IS 'DR = Debit | CR = Credit';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.ACCOUNTING_CLASS IS 'LIABILITY | EXPENSE | PREPAYMENT | TAX | ASSET | ROUNDING';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.SEGMENT1       IS 'Company';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.SEGMENT2       IS 'Cost Centre';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.SEGMENT3       IS 'Natural Account';
COMMENT ON COLUMN RR_SLA_ACCOUNTING_LINES.SEGMENT4       IS 'Intercompany / Sub-account';

-- -----------------------------------------------------------------------------
-- Trigger: auto-parse ACCOUNT_COMBINATION into segments on INSERT/UPDATE
-- Delimiter is '-' (e.g. 02-00-00-1223108-0000-000-00-000-000 → 9 segments)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER RR_SLA_LINE_SEG_TRG
  BEFORE INSERT OR UPDATE OF ACCOUNT_COMBINATION ON RR_SLA_ACCOUNTING_LINES
  FOR EACH ROW
DECLARE
  v_combo  VARCHAR2(200);
  v_segs   APEX_APPLICATION_GLOBAL.VC_ARR2;
BEGIN
  v_combo := :NEW.ACCOUNT_COMBINATION;
  IF v_combo IS NOT NULL THEN
    v_segs := APEX_UTIL.STRING_TO_TABLE(v_combo, '-');
    :NEW.SEGMENT1  := CASE WHEN v_segs.COUNT >= 1  THEN v_segs(1)  END;
    :NEW.SEGMENT2  := CASE WHEN v_segs.COUNT >= 2  THEN v_segs(2)  END;
    :NEW.SEGMENT3  := CASE WHEN v_segs.COUNT >= 3  THEN v_segs(3)  END;
    :NEW.SEGMENT4  := CASE WHEN v_segs.COUNT >= 4  THEN v_segs(4)  END;
    :NEW.SEGMENT5  := CASE WHEN v_segs.COUNT >= 5  THEN v_segs(5)  END;
    :NEW.SEGMENT6  := CASE WHEN v_segs.COUNT >= 6  THEN v_segs(6)  END;
    :NEW.SEGMENT7  := CASE WHEN v_segs.COUNT >= 7  THEN v_segs(7)  END;
    :NEW.SEGMENT8  := CASE WHEN v_segs.COUNT >= 8  THEN v_segs(8)  END;
    :NEW.SEGMENT9  := CASE WHEN v_segs.COUNT >= 9  THEN v_segs(9)  END;
    :NEW.SEGMENT10 := CASE WHEN v_segs.COUNT >= 10 THEN v_segs(10) END;
    :NEW.SEGMENT11 := CASE WHEN v_segs.COUNT >= 11 THEN v_segs(11) END;
    :NEW.SEGMENT12 := CASE WHEN v_segs.COUNT >= 12 THEN v_segs(12) END;
    :NEW.SEGMENT13 := CASE WHEN v_segs.COUNT >= 13 THEN v_segs(13) END;
    :NEW.SEGMENT14 := CASE WHEN v_segs.COUNT >= 14 THEN v_segs(14) END;
    :NEW.SEGMENT15 := CASE WHEN v_segs.COUNT >= 15 THEN v_segs(15) END;
  END IF;
END;
/

-- -----------------------------------------------------------------------------
-- Trigger: LAST_UPDATE_DATE on HEADERS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER RR_SLA_HDR_UPD_TRG
  BEFORE UPDATE ON RR_SLA_ACCOUNTING_HEADERS
  FOR EACH ROW
BEGIN
  :NEW.LAST_UPDATE_DATE := SYSDATE;
  :NEW.LAST_UPDATED_BY  := USER;
END;
/

COMMIT;
-- =============================================================================
-- END OF DDL
-- =============================================================================
