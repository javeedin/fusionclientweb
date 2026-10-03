-- =============================================================================
-- Purchasing-RR (module PO) — 305: AP invoices from purchase orders (matching)
--
--   RR_PO_INVOICE_MATCHES  one row per PO distribution billed by an AP invoice line
--   RR_PO_MATCH_PKG
--     RECORD_INVOICE(p_json)        after the AP invoice is created: bills PO lines
--                                   (quantity/amount), relieves receipt accruals,
--                                   recomputes line closure (closed for invoicing)
--     CANCEL_INVOICE(p_invoice_id)  invoice cancelled: reverses the match, lines reopen
--     SET_INVOICE_STATUS(...)       keeps the invoice status shown on the PO current
--   Billable = received − billed (3-way match) or ordered − cancelled − billed (2-way).
--   A line can be invoiced in parts; a fully billed line cannot be invoiced again.
-- Run after 300–304. Safe to re-run.
-- =============================================================================

BEGIN EXECUTE IMMEDIATE q'[
CREATE TABLE RR_PO_INVOICE_MATCHES (
    MATCH_ID            NUMBER DEFAULT RR_PO_SEQ.NEXTVAL PRIMARY KEY,
    PO_HEADER_ID        NUMBER        NOT NULL,
    PO_LINE_ID          NUMBER        NOT NULL,
    SCHEDULE_ID         NUMBER        NOT NULL,
    DISTRIBUTION_ID     NUMBER        NOT NULL,
    INVOICE_ID          NUMBER        NOT NULL,
    INVOICE_NUM         VARCHAR2(100),
    INVOICE_LINE_NUMBER NUMBER,
    QUANTITY_BILLED     NUMBER,
    AMOUNT_BILLED       NUMBER        NOT NULL,
    AMOUNT_BILLED_FUNC  NUMBER        NOT NULL,
    ACCRUAL_RELIEVED    NUMBER DEFAULT 0 NOT NULL,
    MATCH_STATUS        VARCHAR2(15) DEFAULT 'MATCHED' NOT NULL,
    INVOICE_STATUS      VARCHAR2(30),
    CANCELLED_BY        VARCHAR2(150),
    CANCELLED_DATE      TIMESTAMP,
    CREATED_BY VARCHAR2(150), CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY VARCHAR2(150), LAST_UPDATE_DATE TIMESTAMP, LAST_UPDATE_LOGIN VARCHAR2(100),
    CONSTRAINT RR_PO_INV_MATCH_ST_CK CHECK (MATCH_STATUS IN ('MATCHED', 'CANCELLED'))
)]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955) THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_INV_MATCH_PO_IX ON RR_PO_INVOICE_MATCHES (PO_HEADER_ID, MATCH_STATUS)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_INV_MATCH_INV_IX ON RR_PO_INVOICE_MATCHES (INVOICE_ID, MATCH_STATUS)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/

CREATE OR REPLACE PACKAGE RR_PO_MATCH_PKG AS
    PROCEDURE RECORD_INVOICE (p_json IN CLOB, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CANCEL_INVOICE (p_invoice_id IN VARCHAR2, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SET_INVOICE_STATUS (p_invoice_id IN VARCHAR2, p_invoice_status IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal: reverse an invoice's matches (used by CANCEL_INVOICE and the AP cancel trigger)
    PROCEDURE reverse_invoice (p_invoice_id IN NUMBER, p_user IN VARCHAR2);
END RR_PO_MATCH_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_PO_MATCH_PKG AS

    -- billed counters of a distribution + its receipt distributions (FIFO), accrual relief
    PROCEDURE apply_billing (p_dist_id IN NUMBER, p_qty IN NUMBER, p_amt IN NUMBER, p_user IN VARCHAR2,
                             p_relieved OUT NUMBER) IS
        d       RR_PO_DISTRIBUTIONS%ROWTYPE;
        v_left_q NUMBER := NVL(p_qty, 0);
        v_left_a NUMBER := p_amt;
        v_take_q NUMBER; v_take_a NUMBER;
        v_rel    NUMBER;
    BEGIN
        SELECT * INTO d FROM RR_PO_DISTRIBUTIONS WHERE DISTRIBUTION_ID = p_dist_id FOR UPDATE;
        UPDATE RR_PO_DISTRIBUTIONS
        SET    QUANTITY_BILLED = QUANTITY_BILLED + NVL(p_qty, 0), AMOUNT_BILLED = AMOUNT_BILLED + p_amt,
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  DISTRIBUTION_ID = p_dist_id;
        -- receipt distributions: bill the oldest unbilled receipts first (reverse: newest billed first)
        IF p_amt >= 0 THEN
            FOR rd IN (SELECT rd.RCV_DIST_ID, NVL(rd.QUANTITY, 0) - rd.QUANTITY_BILLED AS OPEN_Q, rd.AMOUNT - rd.AMOUNT_BILLED AS OPEN_A
                       FROM RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS t ON t.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
                       WHERE rd.DISTRIBUTION_ID = p_dist_id AND rd.AMOUNT - rd.AMOUNT_BILLED > 0
                       ORDER BY t.TRANSACTION_DATE, rd.RCV_DIST_ID) LOOP
                EXIT WHEN v_left_a <= 0;
                v_take_a := LEAST(v_left_a, rd.OPEN_A);
                v_take_q := LEAST(v_left_q, GREATEST(rd.OPEN_Q, 0));
                UPDATE RR_PO_RCV_DISTRIBUTIONS SET AMOUNT_BILLED = AMOUNT_BILLED + v_take_a, QUANTITY_BILLED = QUANTITY_BILLED + v_take_q,
                       LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE RCV_DIST_ID = rd.RCV_DIST_ID;
                v_left_a := v_left_a - v_take_a; v_left_q := v_left_q - v_take_q;
            END LOOP;
        ELSE
            v_left_a := -p_amt; v_left_q := -NVL(p_qty, 0);
            FOR rd IN (SELECT rd.RCV_DIST_ID, rd.QUANTITY_BILLED, rd.AMOUNT_BILLED
                       FROM RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS t ON t.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
                       WHERE rd.DISTRIBUTION_ID = p_dist_id AND rd.AMOUNT_BILLED > 0
                       ORDER BY t.TRANSACTION_DATE DESC, rd.RCV_DIST_ID DESC) LOOP
                EXIT WHEN v_left_a <= 0;
                v_take_a := LEAST(v_left_a, rd.AMOUNT_BILLED);
                v_take_q := LEAST(v_left_q, rd.QUANTITY_BILLED);
                UPDATE RR_PO_RCV_DISTRIBUTIONS SET AMOUNT_BILLED = AMOUNT_BILLED - v_take_a, QUANTITY_BILLED = QUANTITY_BILLED - v_take_q,
                       LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE RCV_DIST_ID = rd.RCV_DIST_ID;
                v_left_a := v_left_a - v_take_a; v_left_q := v_left_q - v_take_q;
            END LOOP;
        END IF;
        -- receipt accrual relief (accrue-at-receipt): the invoice debits the accrual account
        IF p_amt >= 0 THEN
            v_rel := LEAST(d.ACCRUED_AMOUNT_FUNC, ROUND(p_amt * d.RATE, 2));
        ELSE
            v_rel := ROUND(p_amt * d.RATE, 2);   -- negative: restore the accrual on cancellation
        END IF;
        IF NVL(v_rel, 0) <> 0 THEN
            UPDATE RR_PO_DISTRIBUTIONS SET ACCRUED_AMOUNT_FUNC = GREATEST(ACCRUED_AMOUNT_FUNC - v_rel, 0)
            WHERE DISTRIBUTION_ID = p_dist_id;
        END IF;
        p_relieved := NVL(v_rel, 0);
    END;

    PROCEDURE RECORD_INVOICE (p_json IN CLOB, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o        JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        lines    JSON_ARRAY_T := RR_PO_UTIL_PKG.jarr(o, 'lines');
        ln       JSON_OBJECT_T;
        v_inv    NUMBER := RR_PO_UTIL_PKG.jnum(o, 'invoiceId');
        v_num    VARCHAR2(100) := RR_PO_UTIL_PKG.jstr(o, 'invoiceNum');
        v_ist    VARCHAR2(30) := RR_PO_UTIL_PKG.jstr(o, 'invoiceStatus');
        v_line   NUMBER; v_qty NUMBER; v_amt NUMBER; v_iln NUMBER;
        l        RR_PO_LINES%ROWTYPE;
        s        RR_PO_SCHEDULES%ROWTYPE;
        h        RR_PO_HEADERS%ROWTYPE;
        v_basis  NUMBER; v_billable NUMBER; v_meas NUMBER;
        v_tot_w  NUMBER; v_dq NUMBER; v_da NUMBER; v_sq NUMBER; v_sa NUMBER; v_i NUMBER; v_cnt NUMBER;
        v_rel    NUMBER;
        v_total  NUMBER := 0;
        v_n      NUMBER := 0;
        v_hdr    NUMBER;
        v_exists NUMBER;
    BEGIN
        IF v_inv IS NULL THEN RR_PO_UTIL_PKG.err('invoiceId is required'); END IF;
        SELECT COUNT(*) INTO v_exists FROM RR_PO_INVOICE_MATCHES WHERE INVOICE_ID = v_inv AND MATCH_STATUS = 'MATCHED';
        IF v_exists > 0 THEN RR_PO_UTIL_PKG.err('Invoice ' || NVL(v_num, v_inv) || ' is already matched to a purchase order'); END IF;
        IF lines.get_size = 0 THEN RR_PO_UTIL_PKG.err('Select at least one PO line'); END IF;

        FOR i IN 0 .. lines.get_size - 1 LOOP
            ln := TREAT(lines.get(i) AS JSON_OBJECT_T);
            v_line := RR_PO_UTIL_PKG.jnum(ln, 'poLineId');
            v_qty  := RR_PO_UTIL_PKG.jnum(ln, 'quantity');
            v_amt  := RR_PO_UTIL_PKG.jnum(ln, 'amount');
            v_iln  := NVL(RR_PO_UTIL_PKG.jnum(ln, 'invoiceLineNumber'), i + 1);
            BEGIN
                SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = v_line;
                SELECT * INTO s FROM RR_PO_SCHEDULES WHERE PO_LINE_ID = v_line AND SCHEDULE_NUM = 1 FOR UPDATE;
                SELECT * INTO h FROM RR_PO_HEADERS WHERE PO_HEADER_ID = l.PO_HEADER_ID;
            EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('PO line ' || v_line || ' not found');
            END;
            IF v_hdr IS NULL THEN v_hdr := h.PO_HEADER_ID;
            ELSIF v_hdr <> h.PO_HEADER_ID THEN RR_PO_UTIL_PKG.err('All lines must belong to one purchase order');
            END IF;
            IF h.DOCUMENT_STATUS <> 'APPROVED' THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' is not approved'); END IF;
            IF h.HOLD_FLAG = 'Y' THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' is on hold'); END IF;
            IF s.CLOSURE_STATUS IN ('CLOSED', 'FINALLY_CLOSED', 'CLOSED_FOR_INVOICING') OR l.LINE_STATUS = 'CANCELLED' THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ' is ' || LOWER(REPLACE(s.CLOSURE_STATUS, '_', ' ')) || ' — it cannot be invoiced again');
            END IF;
            -- what can still be billed
            IF l.LINE_TYPE = 'QUANTITY' THEN
                v_basis := CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN s.QUANTITY_RECEIVED
                                ELSE NVL(s.QUANTITY, 0) - s.QUANTITY_CANCELLED END;
                v_billable := v_basis - s.QUANTITY_BILLED;
                IF NVL(v_qty, 0) <= 0 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': enter the quantity to invoice'); END IF;
                v_meas := v_qty;
                v_amt := ROUND(v_qty * l.UNIT_PRICE, 2);
            ELSE
                v_basis := CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN s.AMOUNT_RECEIVED
                                ELSE s.AMOUNT - s.AMOUNT_CANCELLED END;
                v_billable := v_basis - s.AMOUNT_BILLED;
                IF NVL(v_amt, 0) <= 0 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': enter the amount to invoice'); END IF;
                v_meas := v_amt; v_qty := NULL;
            END IF;
            IF v_meas > v_billable + 0.000001 THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': only ' || TO_CHAR(GREATEST(v_billable, 0), 'FM999,999,990.0999')
                    || CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN ' ' || l.UOM_CODE ELSE '' END || ' can be invoiced'
                    || CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN ' (received and not yet billed)' ELSE ' (ordered and not yet billed)' END);
            END IF;

            -- spread over the distributions by what each can still bill
            SELECT COUNT(*), SUM(GREATEST(CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN AMOUNT_DELIVERED
                                               ELSE AMOUNT_ORDERED - AMOUNT_CANCELLED END - AMOUNT_BILLED, 0))
            INTO   v_cnt, v_tot_w
            FROM   RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = s.SCHEDULE_ID;
            v_i := 0; v_sq := 0; v_sa := 0;
            FOR d IN (SELECT DISTRIBUTION_ID, RATE,
                             GREATEST(CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN AMOUNT_DELIVERED
                                           ELSE AMOUNT_ORDERED - AMOUNT_CANCELLED END - AMOUNT_BILLED, 0) AS W, AMOUNT_ORDERED
                      FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = s.SCHEDULE_ID ORDER BY DIST_NUM) LOOP
                v_i := v_i + 1;
                IF v_i = v_cnt THEN
                    v_da := v_amt - v_sa; v_dq := CASE WHEN v_qty IS NOT NULL THEN v_qty - v_sq END;
                ELSIF NVL(v_tot_w, 0) > 0 THEN
                    v_da := ROUND(v_amt * d.W / v_tot_w, 2); v_dq := CASE WHEN v_qty IS NOT NULL THEN ROUND(v_qty * d.W / v_tot_w, 6) END;
                ELSE
                    v_da := 0; v_dq := CASE WHEN v_qty IS NOT NULL THEN 0 END;
                END IF;
                v_sa := v_sa + v_da; v_sq := v_sq + NVL(v_dq, 0);
                IF v_da <> 0 OR NVL(v_dq, 0) <> 0 THEN
                    apply_billing(d.DISTRIBUTION_ID, v_dq, v_da, p_user, v_rel);
                    INSERT INTO RR_PO_INVOICE_MATCHES (PO_HEADER_ID, PO_LINE_ID, SCHEDULE_ID, DISTRIBUTION_ID, INVOICE_ID, INVOICE_NUM,
                        INVOICE_LINE_NUMBER, QUANTITY_BILLED, AMOUNT_BILLED, AMOUNT_BILLED_FUNC, ACCRUAL_RELIEVED, MATCH_STATUS,
                        INVOICE_STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                    VALUES (h.PO_HEADER_ID, l.PO_LINE_ID, s.SCHEDULE_ID, d.DISTRIBUTION_ID, v_inv, v_num, v_iln, v_dq, v_da,
                        ROUND(v_da * d.RATE, 2), v_rel, 'MATCHED', v_ist, p_user, p_user, SYSTIMESTAMP);
                END IF;
            END LOOP;
            RR_PO_DOC_PKG.rollup_schedule(s.SCHEDULE_ID);
            v_total := v_total + v_amt; v_n := v_n + 1;
        END LOOP;
        RR_PO_DOC_PKG.rollup_header(v_hdr);
        SELECT * INTO h FROM RR_PO_HEADERS WHERE PO_HEADER_ID = v_hdr;
        RR_PO_UTIL_PKG.history('PO', v_hdr, 'INVOICE_MATCHED', NULL, NULL, p_user,
                               'Invoice ' || NVL(v_num, v_inv) || ': ' || v_n || ' line(s), ' || TO_CHAR(v_total, 'FM999,999,999,990.00') || ' ' || h.CURRENCY_CODE);
        p_id := v_hdr; p_number := h.PO_NUMBER; p_status := 'S';
        p_message := 'Invoice ' || NVL(v_num, TO_CHAR(v_inv)) || ' matched to ' || h.PO_NUMBER || ' (' || v_n || ' line(s))';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE reverse_invoice (p_invoice_id IN NUMBER, p_user IN VARCHAR2) IS
        v_rel NUMBER;
        TYPE t_ids IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
        v_sched t_ids; v_hdr t_ids;
        v_num VARCHAR2(100);
    BEGIN
        FOR m IN (SELECT * FROM RR_PO_INVOICE_MATCHES WHERE INVOICE_ID = p_invoice_id AND MATCH_STATUS = 'MATCHED' FOR UPDATE) LOOP
            apply_billing(m.DISTRIBUTION_ID, -m.QUANTITY_BILLED, -m.AMOUNT_BILLED, p_user, v_rel);
            UPDATE RR_PO_INVOICE_MATCHES SET MATCH_STATUS = 'CANCELLED', CANCELLED_BY = p_user, CANCELLED_DATE = SYSTIMESTAMP,
                   INVOICE_STATUS = 'CANCELLED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE MATCH_ID = m.MATCH_ID;
            v_sched(m.SCHEDULE_ID) := m.SCHEDULE_ID; v_hdr(m.PO_HEADER_ID) := m.PO_HEADER_ID; v_num := m.INVOICE_NUM;
        END LOOP;
        DECLARE k NUMBER := v_sched.FIRST; BEGIN
            WHILE k IS NOT NULL LOOP RR_PO_DOC_PKG.rollup_schedule(k); k := v_sched.NEXT(k); END LOOP;
        END;
        DECLARE k NUMBER := v_hdr.FIRST; BEGIN
            WHILE k IS NOT NULL LOOP
                RR_PO_DOC_PKG.rollup_header(k);
                RR_PO_UTIL_PKG.history('PO', k, 'INVOICE_CANCELLED', NULL, NULL, p_user, 'Invoice ' || NVL(v_num, p_invoice_id) || ' cancelled — lines reopened for invoicing');
                k := v_hdr.NEXT(k);
            END LOOP;
        END;
    END;

    PROCEDURE CANCEL_INVOICE (p_invoice_id IN VARCHAR2, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_inv NUMBER := RR_PO_UTIL_PKG.to_num(p_invoice_id);
        v_n   NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_n FROM RR_PO_INVOICE_MATCHES WHERE INVOICE_ID = v_inv AND MATCH_STATUS = 'MATCHED';
        IF v_n = 0 THEN
            p_id := v_inv; p_status := 'S'; p_message := 'Invoice is not matched to a purchase order';
            RETURN;
        END IF;
        reverse_invoice(v_inv, p_user);
        p_id := v_inv; p_status := 'S'; p_message := 'Invoice match reversed — PO lines are open for invoicing again';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE SET_INVOICE_STATUS (p_invoice_id IN VARCHAR2, p_invoice_status IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
    BEGIN
        UPDATE RR_PO_INVOICE_MATCHES SET INVOICE_STATUS = SUBSTR(p_invoice_status, 1, 30), LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE INVOICE_ID = RR_PO_UTIL_PKG.to_num(p_invoice_id) AND MATCH_STATUS = 'MATCHED';
        p_id := SQL%ROWCOUNT; p_status := 'S'; p_message := 'Invoice status updated';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_MATCH_PKG;
/

-- ── views ───────────────────────────────────────────────────────────────────
-- invoices matched to a PO (one row per invoice line / PO line)
CREATE OR REPLACE VIEW RR_PO_V_INVOICE_MATCHES AS
SELECT m.INVOICE_ID, m.INVOICE_NUM, m.INVOICE_LINE_NUMBER, m.PO_HEADER_ID, h.PO_NUMBER, m.PO_LINE_ID, l.LINE_NUM,
       l.ITEM_DESCRIPTION, l.LINE_TYPE, l.UOM_CODE, h.CURRENCY_CODE, m.MATCH_STATUS, MAX(m.INVOICE_STATUS) AS INVOICE_STATUS,
       SUM(m.QUANTITY_BILLED) AS QUANTITY_BILLED, SUM(m.AMOUNT_BILLED) AS AMOUNT_BILLED,
       SUM(m.AMOUNT_BILLED_FUNC) AS AMOUNT_BILLED_FUNC, SUM(m.ACCRUAL_RELIEVED) AS ACCRUAL_RELIEVED,
       MIN(m.CREATED_BY) AS CREATED_BY, MIN(m.CREATION_DATE) AS CREATION_DATE, MAX(m.CANCELLED_DATE) AS CANCELLED_DATE
FROM   RR_PO_INVOICE_MATCHES m
JOIN   RR_PO_HEADERS h ON h.PO_HEADER_ID = m.PO_HEADER_ID
JOIN   RR_PO_LINES l   ON l.PO_LINE_ID = m.PO_LINE_ID
GROUP  BY m.INVOICE_ID, m.INVOICE_NUM, m.INVOICE_LINE_NUMBER, m.PO_HEADER_ID, h.PO_NUMBER, m.PO_LINE_ID, l.LINE_NUM,
          l.ITEM_DESCRIPTION, l.LINE_TYPE, l.UOM_CODE, h.CURRENCY_CODE, m.MATCH_STATUS;

-- PO lines with what can still be invoiced (the "Create AP invoice" dialog)
CREATE OR REPLACE VIEW RR_PO_V_INVOICEABLE_LINES AS
SELECT l.PO_LINE_ID, l.PO_HEADER_ID, h.PO_NUMBER, h.BUSINESS_UNIT_ID, h.SUPPLIER_ID, h.SUPPLIER_SITE_ID, h.CURRENCY_CODE,
       h.RATE, l.LINE_NUM, l.LINE_TYPE, l.ITEM_DESCRIPTION, l.UOM_CODE, l.UNIT_PRICE, l.TAX_CODE, l.CATEGORY_ID,
       s.SCHEDULE_ID, s.MATCH_LEVEL, s.ACCRUE_AT_RECEIPT_FLAG, s.CLOSURE_STATUS,
       s.QUANTITY AS QUANTITY_ORDERED, s.AMOUNT AS AMOUNT_ORDERED, s.QUANTITY_RECEIVED, s.AMOUNT_RECEIVED,
       s.QUANTITY_BILLED, s.AMOUNT_BILLED, s.QUANTITY_CANCELLED, s.AMOUNT_CANCELLED,
       CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN
            GREATEST(CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN s.QUANTITY_RECEIVED
                          ELSE NVL(s.QUANTITY, 0) - s.QUANTITY_CANCELLED END - s.QUANTITY_BILLED, 0) END AS QUANTITY_BILLABLE,
       GREATEST(CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN s.AMOUNT_RECEIVED
                     ELSE s.AMOUNT - s.AMOUNT_CANCELLED END - s.AMOUNT_BILLED, 0) AS AMOUNT_BILLABLE,
       -- the account the invoice line debits: receipt accrual (GRNI) when accrued at receipt, else the charge account
       (SELECT MIN(CASE WHEN s.ACCRUE_AT_RECEIPT_FLAG = 'Y' THEN NVL(d.ACCRUAL_ACCOUNT, d.CHARGE_ACCOUNT) ELSE d.CHARGE_ACCOUNT END)
        FROM RR_PO_DISTRIBUTIONS d WHERE d.SCHEDULE_ID = s.SCHEDULE_ID) AS INVOICE_ACCOUNT,
       (SELECT COUNT(*) FROM RR_PO_DISTRIBUTIONS d WHERE d.SCHEDULE_ID = s.SCHEDULE_ID) AS DIST_COUNT,
       CASE WHEN l.LINE_STATUS = 'CANCELLED' OR s.CLOSURE_STATUS IN ('CLOSED', 'FINALLY_CLOSED', 'CLOSED_FOR_INVOICING') THEN 'N' ELSE 'Y' END AS INVOICEABLE_FLAG
FROM   RR_PO_LINES l
JOIN   RR_PO_HEADERS h ON h.PO_HEADER_ID = l.PO_HEADER_ID
JOIN   (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.PO_LINE_ID ORDER BY x.SCHEDULE_NUM) AS RN FROM RR_PO_SCHEDULES x) s
       ON s.PO_LINE_ID = l.PO_LINE_ID AND s.RN = 1;

-- distribution accounts for the AP invoice distributions (split lines)
CREATE OR REPLACE VIEW RR_PO_V_INVOICE_DIST_ACCOUNTS AS
SELECT d.DISTRIBUTION_ID, d.PO_LINE_ID, d.PO_HEADER_ID, d.DIST_NUM, d.PERCENT,
       CASE WHEN s.ACCRUE_AT_RECEIPT_FLAG = 'Y' THEN NVL(d.ACCRUAL_ACCOUNT, d.CHARGE_ACCOUNT) ELSE d.CHARGE_ACCOUNT END AS INVOICE_ACCOUNT,
       d.CHARGE_ACCOUNT, d.ACCRUAL_ACCOUNT, s.ACCRUE_AT_RECEIPT_FLAG
FROM   RR_PO_DISTRIBUTIONS d JOIN RR_PO_SCHEDULES s ON s.SCHEDULE_ID = d.SCHEDULE_ID;

-- ── registry for po/execute ─────────────────────────────────────────────────
MERGE INTO RR_PO_PROC_REGISTRY t
USING (
    SELECT 'RR_PO_MATCH_PKG.RECORD_INVOICE' n, 'p_json' p, 'p_json' c, 'Match an AP invoice to PO lines' d FROM dual UNION ALL
    SELECT 'RR_PO_MATCH_PKG.CANCEL_INVOICE', 'p_invoice_id', NULL, 'Reverse the PO match of a cancelled AP invoice' FROM dual UNION ALL
    SELECT 'RR_PO_MATCH_PKG.SET_INVOICE_STATUS', 'p_invoice_id,p_invoice_status', NULL, 'Refresh the invoice status kept on the PO match' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d, t.ENABLED_FLAG = 'Y'
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH305');
COMMIT;

-- @@AP_CANCEL_TRIGGER@@

-- AI gateway ACL (whitelist mode only)
DECLARE v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR v IN (SELECT view_name n FROM user_views WHERE view_name IN ('RR_PO_V_INVOICE_MATCHES', 'RR_PO_V_INVOICEABLE_LINES', 'RR_PO_V_INVOICE_DIST_ACCOUNTS')) LOOP
            MERGE INTO RR_AI_OBJECT_ACL t USING (SELECT v.n n FROM dual) s ON (t.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

SELECT object_name, object_type, status FROM user_objects
WHERE object_name IN ('RR_PO_INVOICE_MATCHES', 'RR_PO_MATCH_PKG', 'RR_PO_V_INVOICE_MATCHES', 'RR_PO_V_INVOICEABLE_LINES', 'RR_PO_V_INVOICE_DIST_ACCOUNTS')
ORDER BY object_name, object_type;
SELECT name, type, line, text FROM user_errors WHERE name = 'RR_PO_MATCH_PKG' ORDER BY type, sequence;
