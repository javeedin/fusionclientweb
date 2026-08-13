-- ============================================================
-- RR_SUPPORT  — Alter scripts (run once after initial install)
-- ============================================================

-- Fix ORA-04091: replace mutating-table trigger with sequence-based one.
-- The old trigger did SELECT MAX(LINE_NUMBER) FROM RR_SUPPORT_TICKET_LINES
-- which fails during multi-row INSERT...SELECT (e.g. from JSON_TABLE).
CREATE SEQUENCE RR_SUPPORT_LINE_SEQ START WITH 1 INCREMENT BY 1 NOCACHE;

CREATE OR REPLACE TRIGGER RR_SUPPORT_LINES_BIR
BEFORE INSERT ON RR_SUPPORT_TICKET_LINES
FOR EACH ROW
BEGIN
    IF :NEW.LINE_NUMBER IS NULL THEN
        :NEW.LINE_NUMBER := RR_SUPPORT_LINE_SEQ.NEXTVAL;
    END IF;
    :NEW.CREATION_DATE := TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS');
END;
/

-- Add REPLY_TYPE to ticket lines to distinguish who commented:
--   USER    = ticket raiser (customer) reply
--   SUPPORT = support staff reply
ALTER TABLE RR_SUPPORT_TICKET_LINES
    ADD (REPLY_TYPE VARCHAR2(10) DEFAULT 'SUPPORT');

ALTER TABLE RR_SUPPORT_TICKET_LINES
    ADD CONSTRAINT RR_SUPP_LINES_RT_CHK
    CHECK (REPLY_TYPE IN ('USER','SUPPORT'));

-- ISSUE lines created at ticket creation should be USER
UPDATE RR_SUPPORT_TICKET_LINES SET REPLY_TYPE = 'USER' WHERE LINE_TYPE = 'ISSUE';

-- RESOLUTION lines are always SUPPORT
UPDATE RR_SUPPORT_TICKET_LINES SET REPLY_TYPE = 'SUPPORT' WHERE LINE_TYPE = 'RESOLUTION';

COMMIT;
