-- =============================================================================
-- PATCH 166: Journal approval — a GL journal batch goes to an approver before it is posted
--
--   Like cash external transactions, AP invoices and purchase orders: the person who prepared the
--   journal sends the batch TO an approver; the request appears in the approver's notifications
--   (bell), with the journal's lines, and they approve or reject it there. While the batch waits for
--   approval, or after it was rejected, it cannot be posted.
--
--   RR_GL_APPROVAL_PKG (called through POST po/execute — no new ORDS handler to create):
--     SEND_FOR_APPROVAL (p_batch_id, p_approver, p_comments)
--         the batch must be unposted, have lines and balance; p_approver = approval user e-mail (or id).
--         Replaces the batch's earlier pending request. Records the approval rule that covers the
--         amount (module GL, transaction type JOURNAL), if any.
--     DECIDE   (p_request_id, p_decision, p_comments)   APPROVED / REJECTED, records who decided.
--              An approval is refused when the journal changed after it was sent.
--              APPROVED posts the journal right away (RR_POST_JOURNAL, as Post Batch does): the batch becomes
--              Posted and its approval Approved. If posting is refused (closed period …) the approval stands
--              and the reason comes back as a warning.
--     WITHDRAW (p_batch_id, p_comments)                 the sender takes the request back.
--
--   Triggers (whichever path decides — the bell, an e-mail link, the package):
--     RR_GL_APPROVAL_STAMP_TRG     stamps DECIDED_DATE on the request
--     RR_GL_APPROVAL_DECISION_TRG  RR_GL_JOURNAL_BATCHES.APPROVAL_STATUS_MEANING / APPROVER_EMPLOYEE_NAME follow
--                                  (Pending → Approved / Rejected / Withdrawn)
--     RR_GL_BATCH_APPROVAL_GUARD_TRG  posting (STATUS → 'P', e.g. PUT gl/journals/:id/post) is refused while
--                                  the batch's latest request is PENDING or REJECTED, or when the journal
--                                  changed after it was approved. Updates made by the Fusion sync are not checked.
--
--   Batches never sent for approval post exactly as before.
--   Run once in SQL Workshop › SQL Scripts. Safe to re-run. Needs po/execute (database/po/303_po_execute.sql).
-- =============================================================================

-- who decided / when (also added by database/po/309 — harmless when present)
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_REQUESTS ADD (DECIDED_BY VARCHAR2(200))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE <> -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_REQUESTS ADD (DECIDED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE <> -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_APPROVAL_REQ_GL_TXN_IX ON RR_APPROVAL_REQUESTS (MODULE, TRANSACTION_ID)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_GL_APPROVAL_PKG
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE RR_GL_APPROVAL_PKG AS
    PROCEDURE SEND_FOR_APPROVAL (p_batch_id IN VARCHAR2, p_approver IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                                 p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DECIDE (p_request_id IN VARCHAR2, p_decision IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE WITHDRAW (p_batch_id IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal (triggers)
    FUNCTION  batch_amount (p_batch_id IN NUMBER) RETURN NUMBER;
    FUNCTION  post_block (p_batch_id IN NUMBER) RETURN VARCHAR2;
    PROCEDURE on_decision (p_batch_id IN NUMBER, p_old IN VARCHAR2, p_new IN VARCHAR2, p_by IN VARCHAR2);
END RR_GL_APPROVAL_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_GL_APPROVAL_PKG AS

    PROCEDURE err (p_msg IN VARCHAR2) IS
    BEGIN
        RAISE_APPLICATION_ERROR(-20001, SUBSTR(p_msg, 1, 2000));
    END;

    FUNCTION err_text (p_sqlerrm IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(4000) := p_sqlerrm;
    BEGIN
        IF REGEXP_LIKE(v, '^ORA-20[0-9]{3}: ') THEN v := TRIM(SUBSTR(v, 11)); END IF;   -- our own messages (20001, the 20460 post guard)
        IF INSTR(v, CHR(10) || 'ORA-') > 0 THEN v := SUBSTR(v, 1, INSTR(v, CHR(10) || 'ORA-') - 1); END IF;
        RETURN SUBSTR(v, 1, 4000);
    END;

    FUNCTION to_num (p IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p IS NULL THEN RETURN NULL; END IF;
        RETURN TO_NUMBER(REPLACE(TRIM(p), ',', '') DEFAULT NULL ON CONVERSION ERROR);
    END;

    FUNCTION money (p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN TRIM(TO_CHAR(NVL(p, 0), 'FM999,999,999,990.00'));
    END;

    /** Accounted debits of all the batch's journals (ledger currency) — the amount that is approved. */
    FUNCTION batch_amount (p_batch_id IN NUMBER) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        SELECT NVL(SUM(NVL(l.ACCOUNTED_DR, 0)), 0) INTO v
        FROM   RR_GL_JE_LINES_ALL l
        WHERE  l.JE_HEADER_ID IN (SELECT h.JE_HEADER_ID FROM RR_GL_JE_HEADERS h WHERE h.BATCH_ID = p_batch_id);
        RETURN ROUND(v, 2);
    END;

    PROCEDURE history (p_request_id IN NUMBER, p_action IN VARCHAR2, p_actor IN VARCHAR2, p_comments IN VARCHAR2) IS
    BEGIN
        INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS, ACTION_DATE, NOTIFICATION_SENT)
        VALUES (p_request_id, p_action, NVL(p_actor, 'System'), SUBSTR(p_comments, 1, 2000), SYSDATE, 'N');
    END;

    PROCEDURE SEND_FOR_APPROVAL (p_batch_id IN VARCHAR2, p_approver IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                                 p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_batch    NUMBER := to_num(p_batch_id);
        v_name     VARCHAR2(300);
        v_st       VARCHAR2(30);
        v_stm      VARCHAR2(80);
        v_hdrs     NUMBER;
        v_ledger   NUMBER;
        v_lname    VARCHAR2(240);
        v_period   VARCHAR2(30);
        v_cat      VARCHAR2(240);
        v_jname    VARCHAR2(300);
        v_lines    NUMBER;
        v_dr       NUMBER;
        v_cr       NUMBER;
        v_ccy      VARCHAR2(15);
        v_appr     NUMBER;
        v_appr_nm  VARCHAR2(200);
        v_rule     NUMBER;
        v_ref      VARCHAR2(300);
        v_desc     VARCHAR2(1000);
        v_req      NUMBER;
    BEGIN
        IF v_batch IS NULL THEN err('Journal batch id is required'); END IF;

        SELECT MAX(BATCH_NAME), MAX(STATUS), MAX(STATUS_MEANING) INTO v_name, v_st, v_stm
        FROM   RR_GL_JOURNAL_BATCHES WHERE JE_BATCH_ID = v_batch;
        SELECT COUNT(*), MAX(LEDGER_ID), MAX(LEDGER_NAME), MAX(PERIOD_NAME), MAX(USER_JE_CATEGORY_NAME), MAX(JOURNAL_NAME)
        INTO   v_hdrs, v_ledger, v_lname, v_period, v_cat, v_jname
        FROM   RR_GL_JE_HEADERS WHERE BATCH_ID = v_batch;
        IF v_hdrs = 0 AND v_name IS NULL THEN err('Journal batch ' || v_batch || ' was not found'); END IF;
        IF v_st = 'P' OR UPPER(v_stm) = 'POSTED' THEN err('The journal is already posted — there is nothing to approve'); END IF;

        SELECT COUNT(*), NVL(SUM(NVL(l.ACCOUNTED_DR, 0)), 0), NVL(SUM(NVL(l.ACCOUNTED_CR, 0)), 0)
        INTO   v_lines, v_dr, v_cr
        FROM   RR_GL_JE_LINES_ALL l
        WHERE  l.JE_HEADER_ID IN (SELECT h.JE_HEADER_ID FROM RR_GL_JE_HEADERS h WHERE h.BATCH_ID = v_batch);
        IF v_lines = 0 THEN err('The journal has no lines'); END IF;
        IF ABS(v_dr - v_cr) > 0.005 THEN
            err('The journal is out of balance (debit ' || money(v_dr) || ', credit ' || money(v_cr) || ') — fix it before sending it for approval');
        END IF;

        SELECT MAX(CURRENCY_CODE) INTO v_ccy FROM RR_LEDGERS
        WHERE  LEDGER_ID = v_ledger OR UPPER(LEDGER_NAME) = UPPER(v_lname);
        v_ccy := NVL(v_ccy, 'AED');

        SELECT MAX(USER_ID), MAX(FULL_NAME) INTO v_appr, v_appr_nm
        FROM   RR_APPROVAL_USERS
        WHERE  NVL(ACTIVE, 'Y') = 'Y'
        AND    (UPPER(EMAIL) = UPPER(TRIM(p_approver)) OR TO_CHAR(USER_ID) = TRIM(p_approver));
        IF v_appr IS NULL THEN
            err('Approver ' || NVL(p_approver, '(none)') || ' is not an active approval user (Approvals › Approval Users)');
        END IF;

        -- the rule that covers the amount (recorded for the trail; the chosen approver decides)
        SELECT MAX(RULE_ID) KEEP (DENSE_RANK FIRST ORDER BY NVL(PRIORITY, 10), RULE_ID) INTO v_rule
        FROM   RR_APPROVAL_RULES
        WHERE  MODULE = 'GL' AND NVL(TRANSACTION_TYPE, 'JOURNAL') = 'JOURNAL' AND NVL(ACTIVE, 'Y') = 'Y'
        AND    v_dr >= NVL(MIN_AMOUNT, 0) AND (MAX_AMOUNT IS NULL OR v_dr <= MAX_AMOUNT);

        -- a new request replaces the batch's pending one
        FOR r IN (SELECT REQUEST_ID FROM RR_APPROVAL_REQUESTS
                  WHERE  MODULE = 'GL' AND TRANSACTION_ID = v_batch AND STATUS = 'PENDING') LOOP
            UPDATE RR_APPROVAL_REQUESTS SET STATUS = 'CANCELLED', LAST_UPDATE_DATE = SYSDATE WHERE REQUEST_ID = r.REQUEST_ID;
            history(r.REQUEST_ID, 'CANCELLED', p_user, 'Replaced by a new request');
        END LOOP;

        v_ref  := SUBSTR(NVL(v_name, 'GL-JE-' || v_batch), 1, 300);
        v_desc := SUBSTR(NVL(v_cat, 'Journal') || CASE WHEN v_period IS NOT NULL THEN ' · ' || v_period END
                  || ' · ' || v_hdrs || CASE WHEN v_hdrs = 1 THEN ' journal' ELSE ' journals' END
                  || ', ' || v_lines || ' lines'
                  || CASE WHEN v_hdrs = 1 AND v_jname IS NOT NULL AND v_jname <> v_ref THEN ' · ' || v_jname END, 1, 1000);

        INSERT INTO RR_APPROVAL_REQUESTS (MODULE, TRANSACTION_TYPE, TRANSACTION_ID, TRANSACTION_REF, AMOUNT, CURRENCY,
                                          DESCRIPTION, REQUESTED_BY_NAME, STATUS, RULE_ID, CURRENT_APPROVER_ID,
                                          REQUESTED_DATE, LAST_UPDATE_DATE)
        VALUES ('GL', 'JOURNAL', v_batch, v_ref, ROUND(v_dr, 2), v_ccy, v_desc, p_user, 'PENDING', v_rule, v_appr, SYSDATE, SYSDATE)
        RETURNING REQUEST_ID INTO v_req;
        history(v_req, 'SUBMITTED', p_user, NVL(p_comments, 'Journal ' || v_ref || ' → ' || v_appr_nm));

        UPDATE RR_GL_JOURNAL_BATCHES
        SET    APPROVAL_STATUS_MEANING = 'Pending', APPROVER_EMPLOYEE_NAME = v_appr_nm,
               LAST_UPDATED_BY = SUBSTR(p_user, 1, 100), LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  JE_BATCH_ID = v_batch;

        p_id := v_req; p_number := v_ref; p_status := 'S';
        p_message := 'Sent to ' || v_appr_nm || ' for approval (request #' || v_req || ')';
    EXCEPTION WHEN OTHERS THEN p_status := 'E'; p_message := err_text(SQLERRM);
    END;

    /**
     * Post the batch with RR_POST_JOURNAL — the procedure behind PUT gl/journals/:id/post (Post Batch).
     * NULL = posted, else why not. Called dynamically: this package compiles whatever version is installed.
     */
    FUNCTION post_now (p_batch_id IN NUMBER) RETURN VARCHAR2 IS
        v_http NUMBER;
        v_out  CLOB;
        v_why  VARCHAR2(4000);
    BEGIN
        EXECUTE IMMEDIATE 'BEGIN RR_POST_JOURNAL(p_je_batch_id => :b, p_status => :s, p_message => :m); END;'
            USING IN p_batch_id, OUT v_http, OUT v_out;
        IF v_http = 200 THEN RETURN NULL; END IF;
        v_why := JSON_VALUE(v_out, '$.errors[0]' RETURNING VARCHAR2(4000) NULL ON ERROR);
        IF v_why IS NULL THEN v_why := JSON_VALUE(v_out, '$.error' RETURNING VARCHAR2(4000) NULL ON ERROR); END IF;
        RETURN err_text(NVL(v_why, 'posting refused (HTTP ' || v_http || ')'));
    EXCEPTION WHEN OTHERS THEN
        RETURN err_text(SQLERRM);
    END;

    PROCEDURE DECIDE (p_request_id IN VARCHAR2, p_decision IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id    NUMBER := to_num(p_request_id);
        v_dec   VARCHAR2(30) := UPPER(TRIM(p_decision));
        v_mod   VARCHAR2(50);
        v_st    VARCHAR2(30);
        v_batch NUMBER;
        v_ref   VARCHAR2(300);
        v_amt   NUMBER;
        v_by    VARCHAR2(200);
        v_now   NUMBER;
        v_why   VARCHAR2(4000);
    BEGIN
        IF v_dec NOT IN ('APPROVED', 'REJECTED') THEN err('Decision must be APPROVED or REJECTED'); END IF;
        SELECT MODULE, STATUS, TRANSACTION_ID, TRANSACTION_REF, AMOUNT, REQUESTED_BY_NAME
        INTO   v_mod, v_st, v_batch, v_ref, v_amt, v_by
        FROM   RR_APPROVAL_REQUESTS WHERE REQUEST_ID = v_id FOR UPDATE;
        IF v_mod <> 'GL' THEN err('Not a journal approval'); END IF;
        IF v_st <> 'PENDING' THEN err('This request is already ' || v_st); END IF;

        -- approve what was sent: a journal edited after it was sent goes back to the sender
        IF v_dec = 'APPROVED' AND v_amt IS NOT NULL THEN
            v_now := batch_amount(v_batch);
            IF ABS(v_now - v_amt) > 0.01 THEN
                err('The journal changed after it was sent (sent ' || money(v_amt) || ', now ' || money(v_now)
                    || ') — ask ' || NVL(v_by, 'the sender') || ' to send it for approval again');
            END IF;
        END IF;

        -- fires RR_GL_APPROVAL_DECISION_TRG → the batch follows
        UPDATE RR_APPROVAL_REQUESTS SET STATUS = v_dec, DECIDED_BY = p_user, DECIDED_DATE = SYSDATE, LAST_UPDATE_DATE = SYSDATE
        WHERE  REQUEST_ID = v_id;
        history(v_id, v_dec, p_user,
                CASE WHEN UPPER(v_by) = UPPER(p_user) AND p_comments IS NULL THEN 'Self-approved' ELSE p_comments END);
        p_id := v_id; p_number := v_ref; p_status := 'S';
        IF v_dec = 'REJECTED' THEN
            p_message := 'Journal ' || v_ref || ' rejected';
            RETURN;
        END IF;

        -- Approved → post it now. The approval is committed first: it stands even when posting is refused
        -- (closed period, out of balance …) — the reason comes back as a warning and it can be posted later.
        COMMIT;
        v_why := post_now(v_batch);
        IF v_why IS NULL THEN
            p_message := 'Journal ' || v_ref || ' approved and posted';
        ELSE
            p_status  := 'W';
            p_message := SUBSTR('Journal ' || v_ref || ' approved, but not posted: ' || v_why, 1, 4000);
        END IF;
    EXCEPTION WHEN NO_DATA_FOUND THEN p_status := 'E'; p_message := 'Approval request not found';
              WHEN OTHERS THEN p_status := 'E'; p_message := err_text(SQLERRM);
    END;

    PROCEDURE WITHDRAW (p_batch_id IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_batch NUMBER := to_num(p_batch_id);
        v_n     NUMBER := 0;
    BEGIN
        FOR r IN (SELECT REQUEST_ID, TRANSACTION_REF FROM RR_APPROVAL_REQUESTS
                  WHERE  MODULE = 'GL' AND TRANSACTION_ID = v_batch AND STATUS = 'PENDING') LOOP
            UPDATE RR_APPROVAL_REQUESTS SET STATUS = 'RECALLED', DECIDED_BY = p_user, DECIDED_DATE = SYSDATE, LAST_UPDATE_DATE = SYSDATE
            WHERE  REQUEST_ID = r.REQUEST_ID;
            history(r.REQUEST_ID, 'RECALLED', p_user, NVL(p_comments, 'Withdrawn by the sender'));
            v_n := v_n + 1; p_id := r.REQUEST_ID; p_number := r.TRANSACTION_REF;
        END LOOP;
        IF v_n = 0 THEN err('The journal is not waiting for approval — nothing to withdraw'); END IF;
        p_status := 'S';
        p_message := 'Approval request withdrawn — the journal can be changed, posted or sent again';
    EXCEPTION WHEN OTHERS THEN p_status := 'E'; p_message := err_text(SQLERRM);
    END;

    /** Why the batch cannot be posted now (NULL = it can). */
    FUNCTION post_block (p_batch_id IN NUMBER) RETURN VARCHAR2 IS
        v_st  VARCHAR2(30);
        v_amt NUMBER;
        v_who VARCHAR2(200);
        v_now NUMBER;
    BEGIN
        SELECT STATUS, AMOUNT, WHO INTO v_st, v_amt, v_who FROM (
            SELECT r.STATUS, r.AMOUNT,
                   NVL(r.DECIDED_BY, (SELECT u.FULL_NAME FROM RR_APPROVAL_USERS u WHERE u.USER_ID = r.CURRENT_APPROVER_ID)) AS WHO
            FROM   RR_APPROVAL_REQUESTS r
            WHERE  r.MODULE = 'GL' AND r.TRANSACTION_ID = p_batch_id
            ORDER  BY r.REQUEST_ID DESC)
        WHERE ROWNUM = 1;
        IF v_st = 'PENDING' THEN
            RETURN 'The journal is waiting for approval' || CASE WHEN v_who IS NOT NULL THEN ' from ' || v_who END
                || ' — it can be posted once it is approved';
        ELSIF v_st = 'REJECTED' THEN
            RETURN 'The journal was rejected' || CASE WHEN v_who IS NOT NULL THEN ' by ' || v_who END
                || ' — change it and send it for approval again';
        ELSIF v_st = 'APPROVED' AND v_amt IS NOT NULL THEN
            v_now := batch_amount(p_batch_id);
            IF ABS(v_now - v_amt) > 0.01 THEN
                RETURN 'The journal changed after it was approved (approved ' || money(v_amt) || ', now ' || money(v_now)
                    || ') — send it for approval again';
            END IF;
        END IF;
        RETURN NULL;
    EXCEPTION WHEN NO_DATA_FOUND THEN RETURN NULL;   -- never sent for approval
    END;

    PROCEDURE on_decision (p_batch_id IN NUMBER, p_old IN VARCHAR2, p_new IN VARCHAR2, p_by IN VARCHAR2) IS
    BEGIN
        IF p_batch_id IS NULL OR NVL(p_old, 'PENDING') <> 'PENDING' THEN RETURN; END IF;   -- only a live request moves the batch
        UPDATE RR_GL_JOURNAL_BATCHES
        SET    APPROVAL_STATUS_MEANING = CASE p_new WHEN 'APPROVED' THEN 'Approved' WHEN 'REJECTED' THEN 'Rejected' ELSE 'Withdrawn' END,
               APPROVER_EMPLOYEE_NAME  = CASE WHEN p_new IN ('APPROVED', 'REJECTED') THEN NVL(p_by, APPROVER_EMPLOYEE_NAME)
                                              ELSE APPROVER_EMPLOYEE_NAME END,
               LAST_UPDATE_DATE        = SYSTIMESTAMP
        WHERE  JE_BATCH_ID = p_batch_id;
    EXCEPTION WHEN OTHERS THEN NULL;   -- the decision stands; screens read the status from the request itself
    END;

END RR_GL_APPROVAL_PKG;
/

-- When it was decided — whichever path changed the status (DECIDE, notification bell, e-mail link)
CREATE OR REPLACE TRIGGER RR_GL_APPROVAL_STAMP_TRG
BEFORE UPDATE OF STATUS ON RR_APPROVAL_REQUESTS
FOR EACH ROW
WHEN (NEW.MODULE = 'GL' AND NEW.STATUS <> OLD.STATUS)
BEGIN
    IF :NEW.DECIDED_DATE IS NULL OR :NEW.DECIDED_DATE = :OLD.DECIDED_DATE THEN :NEW.DECIDED_DATE := SYSDATE; END IF;
END;
/

-- Decisions made anywhere flow back to the journal batch
CREATE OR REPLACE TRIGGER RR_GL_APPROVAL_DECISION_TRG
AFTER UPDATE OF STATUS ON RR_APPROVAL_REQUESTS
FOR EACH ROW
WHEN (NEW.MODULE = 'GL' AND NEW.STATUS <> OLD.STATUS)
BEGIN
    RR_GL_APPROVAL_PKG.on_decision(:NEW.TRANSACTION_ID, :OLD.STATUS, :NEW.STATUS, :NEW.DECIDED_BY);
END;
/

-- No posting while the batch waits for approval / was rejected / changed after approval
CREATE OR REPLACE TRIGGER RR_GL_BATCH_APPROVAL_GUARD_TRG
BEFORE UPDATE OF STATUS ON RR_GL_JOURNAL_BATCHES
FOR EACH ROW
WHEN (NEW.STATUS = 'P' AND NVL(OLD.STATUS, '#') <> 'P')
DECLARE
    v_why VARCHAR2(1000);
BEGIN
    -- the Fusion sync records what happened in Fusion — not checked
    IF UPDATING('SYNC_DATE') OR UPDATING('LAST_SYNC_DATE') OR UPDATING('SYNC_STATUS') THEN RETURN; END IF;
    v_why := RR_GL_APPROVAL_PKG.post_block(:NEW.JE_BATCH_ID);
    IF v_why IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20460, v_why); END IF;
END;
/

-- ── po/execute registry ──────────────────────────────────────────────────────
MERGE INTO RR_PO_PROC_REGISTRY t
USING (
    SELECT 'RR_GL_APPROVAL_PKG.SEND_FOR_APPROVAL' n, 'p_batch_id,p_approver,p_comments' p, NULL c, 'Send a GL journal batch to an approver' d FROM dual UNION ALL
    SELECT 'RR_GL_APPROVAL_PKG.DECIDE', 'p_request_id,p_decision,p_comments', NULL, 'Approve / reject a journal approval request' FROM dual UNION ALL
    SELECT 'RR_GL_APPROVAL_PKG.WITHDRAW', 'p_batch_id,p_comments', NULL, 'Withdraw a journal from approval' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d, t.ENABLED_FLAG = 'Y'
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH166');
COMMIT;

-- ── read gateway (only when RR_AI_OBJECT_ACL is in whitelist mode) ──────────
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR v IN (SELECT 'RR_APPROVAL_REQUESTS' n FROM dual UNION ALL SELECT 'RR_APPROVAL_HISTORY' FROM dual
                  UNION ALL SELECT 'RR_APPROVAL_USERS' FROM dual UNION ALL SELECT 'RR_APPROVAL_RULES' FROM dual
                  UNION ALL SELECT 'RR_APPROVAL_RULE_APPROVERS' FROM dual UNION ALL SELECT 'RR_GL_JE_HEADERS' FROM dual
                  UNION ALL SELECT 'RR_GL_JOURNAL_BATCHES' FROM dual UNION ALL SELECT 'RR_GL_JE_LINES_ALL' FROM dual
                  UNION ALL SELECT 'RR_LEDGERS' FROM dual UNION ALL SELECT 'RR_VALUE_SET_VALUES' FROM dual) LOOP
            MERGE INTO RR_AI_OBJECT_ACL t USING (SELECT v.n n FROM dual) s ON (t.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;   -- AI gateway not installed: nothing to do
END;
/

-- ── Smoke checks ─────────────────────────────────────────────────────────────
-- all VALID
SELECT object_name, object_type, status FROM user_objects
WHERE  object_name IN ('RR_GL_APPROVAL_PKG', 'RR_GL_APPROVAL_STAMP_TRG', 'RR_GL_APPROVAL_DECISION_TRG', 'RR_GL_BATCH_APPROVAL_GUARD_TRG')
ORDER  BY object_name, object_type;
-- 3 rows, ENABLED_FLAG = Y
SELECT PROC_NAME, PARAMS_CSV, ENABLED_FLAG FROM RR_PO_PROC_REGISTRY WHERE PROC_NAME LIKE 'RR\_GL\_APPROVAL\_PKG.%' ESCAPE '\';
-- journal approval requests, newest first
SELECT r.REQUEST_ID, r.TRANSACTION_ID AS JE_BATCH_ID, r.TRANSACTION_REF, r.STATUS, r.AMOUNT, r.CURRENCY,
       r.REQUESTED_BY_NAME, u.FULL_NAME AS APPROVER, r.DECIDED_BY, r.DECIDED_DATE,
       RR_GL_APPROVAL_PKG.post_block(r.TRANSACTION_ID) AS CAN_POST_CHECK
FROM   RR_APPROVAL_REQUESTS r LEFT JOIN RR_APPROVAL_USERS u ON u.USER_ID = r.CURRENT_APPROVER_ID
WHERE  r.MODULE = 'GL'
ORDER  BY r.REQUEST_ID DESC
FETCH FIRST 20 ROWS ONLY;
