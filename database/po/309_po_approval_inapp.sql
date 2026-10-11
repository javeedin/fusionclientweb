-- =============================================================================
-- Purchasing-RR (module PO) — 309: single-level in-app approval for purchasing documents
--
--   Like cash external transactions and AP invoices, the buyer submits a purchase order (or a
--   requisition) TO an approver they choose. The request appears in the approver's notifications
--   (bell) and on Purchasing › Approvals. The document stays PENDING_APPROVAL — it cannot be
--   received, invoiced, changed or sent as approved — until that approver approves it. Rejected →
--   the buyer edits it and submits again (a new request).
--
--   RR_PO_APPROVAL_PKG (moved here from 302 and extended — 302 no longer creates it):
--     SUBMIT_PO_TO   (p_po_header_id, p_approver)   submit a PO to the chosen approver (approval user e-mail)
--     SUBMIT_REQ_TO  (p_req_header_id, p_approver)  the same for a requisition
--     DECIDE         approve / reject; never your own document; records who decided
--     request()      the chosen approver; else the matching approval rule (module PROCUREMENT);
--                    a change order without a rule goes to the approver of its purchase order
--     on_decision()  the decision flows back to the document, with the approver's name in its history
--   RR_APPROVAL_REQUESTS.DECIDED_BY / DECIDED_DATE — who decided and when (shown on the PO)
--   RR_PO_V_DOC_APPROVAL — the approval request of a purchasing document: status, approver, decision
--   po/execute registry: SUBMIT_PO_TO, SUBMIT_REQ_TO
--
--   Submitting without choosing an approver (RR_PO_DOC_PKG.SUBMIT_PO) still works with approval rules.
--   "PO approval required" = N in Purchasing Options still approves on submit.
--
-- Run after 302 (and 308). Safe to re-run.
-- =============================================================================

-- who decided / when
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_REQUESTS ADD (DECIDED_BY VARCHAR2(200))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE <> -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_REQUESTS ADD (DECIDED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE <> -1430 THEN RAISE; END IF; END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_APPROVAL_PKG
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE RR_PO_APPROVAL_PKG AS
    PROCEDURE SUBMIT_PO_TO (p_po_header_id IN VARCHAR2, p_approver IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SUBMIT_REQ_TO (p_req_header_id IN VARCHAR2, p_approver IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DECIDE (p_request_id IN VARCHAR2, p_decision IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal
    FUNCTION  request (p_type IN VARCHAR2, p_doc_id IN NUMBER, p_po_header_id IN NUMBER, p_ref IN VARCHAR2,
                       p_amount IN NUMBER, p_currency IN VARCHAR2, p_bu IN NUMBER, p_desc IN VARCHAR2,
                       p_user IN VARCHAR2) RETURN NUMBER;
    PROCEDURE recall (p_request_id IN NUMBER, p_user IN VARCHAR2);
    PROCEDURE on_decision (p_request_id IN NUMBER, p_type IN VARCHAR2, p_txn_id IN NUMBER, p_status IN VARCHAR2,
                           p_actor IN VARCHAR2 DEFAULT NULL);
END RR_PO_APPROVAL_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_PO_APPROVAL_PKG AS

    -- approver chosen by SUBMIT_PO_TO / SUBMIT_REQ_TO, used by request() during that call only
    g_approver NUMBER;

    -- an active approval user (by e-mail or id) — never the person submitting
    FUNCTION chosen_approver (p_approver IN VARCHAR2, p_user IN VARCHAR2) RETURN NUMBER IS
        v_id    NUMBER;
        v_email VARCHAR2(300);
        v_name  VARCHAR2(200);
    BEGIN
        IF TRIM(p_approver) IS NULL THEN RR_PO_UTIL_PKG.err('Choose the approver'); END IF;
        SELECT MAX(USER_ID), MAX(EMAIL), MAX(FULL_NAME) INTO v_id, v_email, v_name
        FROM   RR_APPROVAL_USERS
        WHERE  (UPPER(EMAIL) = UPPER(TRIM(p_approver)) OR TO_CHAR(USER_ID) = TRIM(p_approver))
        AND    NVL(ACTIVE, 'Y') = 'Y';
        IF v_id IS NULL THEN
            RR_PO_UTIL_PKG.err(p_approver || ' is not an active approver (Administration › Approval Management › Users)');
        END IF;
        IF UPPER(TRIM(p_user)) IN (UPPER(v_email), UPPER(v_name), UPPER(REGEXP_SUBSTR(v_email, '^[^@]+'))) THEN
            RR_PO_UTIL_PKG.err('You cannot send your own document to yourself for approval — choose another approver');
        END IF;
        RETURN v_id;
    END;

    FUNCTION approver_name (p_id IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(200);
    BEGIN
        SELECT MAX(FULL_NAME) INTO v FROM RR_APPROVAL_USERS WHERE USER_ID = p_id;
        RETURN v;
    END;

    -- the approver: the one chosen on submit; else the rule (module PROCUREMENT, type, amount band, BU,
    -- category, priority); a change order without a rule → the approver of its purchase order.
    -- Returns NULL when nobody can approve (the caller reports it).
    FUNCTION request (p_type IN VARCHAR2, p_doc_id IN NUMBER, p_po_header_id IN NUMBER, p_ref IN VARCHAR2,
                      p_amount IN NUMBER, p_currency IN VARCHAR2, p_bu IN NUMBER, p_desc IN VARCHAR2,
                      p_user IN VARCHAR2) RETURN NUMBER IS
        v_rule NUMBER;
        v_appr NUMBER;
        v_req  NUMBER;
    BEGIN
        SELECT MAX(r.RULE_ID) KEEP (DENSE_RANK FIRST ORDER BY r.PRIORITY,
                   CASE WHEN r.BUSINESS_UNIT_ID IS NOT NULL THEN 0 ELSE 1 END,
                   CASE WHEN r.CATEGORY_CODE IS NOT NULL THEN 0 ELSE 1 END)
        INTO   v_rule
        FROM   RR_APPROVAL_RULES r
        WHERE  r.MODULE = 'PROCUREMENT' AND r.TRANSACTION_TYPE = p_type AND NVL(r.ACTIVE, 'Y') = 'Y'
        AND    p_amount >= NVL(r.MIN_AMOUNT, 0) AND (r.MAX_AMOUNT IS NULL OR p_amount <= r.MAX_AMOUNT)
        AND    (r.BUSINESS_UNIT_ID IS NULL OR r.BUSINESS_UNIT_ID = p_bu)
        AND    (r.CATEGORY_CODE IS NULL OR EXISTS (
                    SELECT 1 FROM RR_PO_REQ_LINES l JOIN RR_PO_V_CATEGORIES c ON c.CATEGORY_ID = l.CATEGORY_ID
                    WHERE p_type = 'REQUISITION' AND l.REQ_HEADER_ID = p_doc_id
                    AND (c.CATEGORY_CODE = r.CATEGORY_CODE OR c.PARENT_CODE = r.CATEGORY_CODE)
                    UNION ALL
                    SELECT 1 FROM RR_PO_LINES l JOIN RR_PO_V_CATEGORIES c ON c.CATEGORY_ID = l.CATEGORY_ID
                    WHERE p_type <> 'REQUISITION' AND l.PO_HEADER_ID = p_po_header_id
                    AND (c.CATEGORY_CODE = r.CATEGORY_CODE OR c.PARENT_CODE = r.CATEGORY_CODE)));

        IF g_approver IS NOT NULL THEN
            v_appr := g_approver;
        ELSIF v_rule IS NOT NULL THEN
            SELECT MAX(ra.USER_ID) KEEP (DENSE_RANK FIRST ORDER BY ra.SEQUENCE) INTO v_appr
            FROM   RR_APPROVAL_RULE_APPROVERS ra WHERE ra.RULE_ID = v_rule;
        ELSIF p_type = 'PO_CHANGE_ORDER' THEN
            SELECT MAX(r.CURRENT_APPROVER_ID) INTO v_appr
            FROM   RR_PO_HEADERS h JOIN RR_APPROVAL_REQUESTS r ON r.REQUEST_ID = h.APPROVAL_REQUEST_ID
            WHERE  h.PO_HEADER_ID = p_po_header_id;
            IF v_appr IS NULL THEN RETURN NULL; END IF;
        ELSE
            RETURN NULL;
        END IF;

        INSERT INTO RR_APPROVAL_REQUESTS (MODULE, TRANSACTION_TYPE, TRANSACTION_ID, TRANSACTION_REF, AMOUNT, CURRENCY,
                                          DESCRIPTION, REQUESTED_BY_NAME, STATUS, RULE_ID, CURRENT_APPROVER_ID)
        VALUES ('PROCUREMENT', p_type, p_doc_id, p_ref, p_amount, p_currency, SUBSTR(p_desc, 1, 1000), p_user, 'PENDING',
                v_rule, v_appr)
        RETURNING REQUEST_ID INTO v_req;
        INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS)
        VALUES (v_req, 'SUBMITTED', p_user,
                SUBSTR(p_type || ' ' || p_ref || CASE WHEN v_appr IS NOT NULL THEN ' → ' || approver_name(v_appr) END, 1, 2000));
        RETURN v_req;
    END;

    PROCEDURE SUBMIT_PO_TO (p_po_header_id IN VARCHAR2, p_approver IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_name VARCHAR2(200);
    BEGIN
        g_approver := chosen_approver(p_approver, p_user);
        v_name := approver_name(g_approver);
        RR_PO_DOC_PKG.SUBMIT_PO(p_po_header_id, p_user, p_id, p_number, p_status, p_message);
        g_approver := NULL;
        IF p_status = 'S' AND p_message LIKE '%submitted for approval' THEN
            p_message := p_message || ' — sent to ' || v_name || ' (in their notifications)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        g_approver := NULL;
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE SUBMIT_REQ_TO (p_req_header_id IN VARCHAR2, p_approver IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_name VARCHAR2(200);
    BEGIN
        g_approver := chosen_approver(p_approver, p_user);
        v_name := approver_name(g_approver);
        RR_PO_REQ_PKG.SUBMIT(p_req_header_id, p_user, p_id, p_number, p_status, p_message);
        g_approver := NULL;
        IF p_status = 'S' AND p_message LIKE '%submitted for approval' THEN
            p_message := p_message || ' — sent to ' || v_name || ' (in their notifications)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        g_approver := NULL;
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE recall (p_request_id IN NUMBER, p_user IN VARCHAR2) IS
    BEGIN
        IF p_request_id IS NULL THEN RETURN; END IF;
        UPDATE RR_APPROVAL_REQUESTS SET STATUS = 'RECALLED', DECIDED_BY = p_user WHERE REQUEST_ID = p_request_id AND STATUS = 'PENDING';
        IF SQL%ROWCOUNT > 0 THEN
            INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS) VALUES (p_request_id, 'RECALLED', p_user, 'Withdrawn');
        END IF;
    END;

    -- called by the trigger on RR_APPROVAL_REQUESTS whenever a PROCUREMENT request changes status
    -- (approval page, notification panel, email links or DECIDE below) — must not read RR_APPROVAL_REQUESTS
    PROCEDURE on_decision (p_request_id IN NUMBER, p_type IN VARCHAR2, p_txn_id IN NUMBER, p_status IN VARCHAR2,
                           p_actor IN VARCHAR2 DEFAULT NULL) IS
        v_cur VARCHAR2(30);
        v_rq  NUMBER;
        v_who VARCHAR2(200) := NVL(p_actor, 'APPROVER');
    BEGIN
        IF p_type = 'REQUISITION' THEN
            SELECT MAX(STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_REQ_HEADERS WHERE REQ_HEADER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_REQ_PKG.approve_internal(p_txn_id, v_who);
            ELSIF p_status = 'REJECTED' THEN
                UPDATE RR_PO_REQ_HEADERS SET STATUS = 'REJECTED', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE REQ_HEADER_ID = p_txn_id;
                RR_PO_UTIL_PKG.history('REQ', p_txn_id, 'REJECT', 'PENDING_APPROVAL', 'REJECTED', v_who);
            ELSIF p_status IN ('RECALLED', 'CANCELLED') THEN
                UPDATE RR_PO_REQ_HEADERS SET STATUS = 'INCOMPLETE', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE REQ_HEADER_ID = p_txn_id;
            END IF;
        ELSIF p_type = 'PURCHASE_ORDER' THEN
            SELECT MAX(DOCUMENT_STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_HEADERS WHERE PO_HEADER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_DOC_PKG.approve_internal(p_txn_id, v_who);
            ELSIF p_status = 'REJECTED' THEN
                UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'REJECTED', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE PO_HEADER_ID = p_txn_id;
                RR_PO_UTIL_PKG.history('PO', p_txn_id, 'REJECT', 'PENDING_APPROVAL', 'REJECTED', v_who);
            ELSIF p_status IN ('RECALLED', 'CANCELLED') THEN
                UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'INCOMPLETE', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE PO_HEADER_ID = p_txn_id;
            END IF;
        ELSIF p_type = 'PO_CHANGE_ORDER' THEN
            SELECT MAX(STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_CHANGE_ORDERS WHERE CHANGE_ORDER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_DOC_PKG.apply_change(p_txn_id, v_who);
            ELSE
                UPDATE RR_PO_CHANGE_ORDERS SET STATUS = CASE WHEN p_status = 'REJECTED' THEN 'REJECTED' ELSE 'CANCELLED' END,
                       LAST_UPDATE_DATE = SYSTIMESTAMP WHERE CHANGE_ORDER_ID = p_txn_id;
            END IF;
        END IF;
    END;

    PROCEDURE DECIDE (p_request_id IN VARCHAR2, p_decision IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id  NUMBER := RR_PO_UTIL_PKG.to_num(p_request_id);
        v_mod VARCHAR2(50); v_st VARCHAR2(30); v_by VARCHAR2(200); v_ref VARCHAR2(300);
    BEGIN
        IF UPPER(p_decision) NOT IN ('APPROVED', 'REJECTED') THEN RR_PO_UTIL_PKG.err('Decision must be APPROVED or REJECTED'); END IF;
        SELECT MODULE, STATUS, REQUESTED_BY_NAME, TRANSACTION_REF INTO v_mod, v_st, v_by, v_ref
        FROM RR_APPROVAL_REQUESTS WHERE REQUEST_ID = v_id FOR UPDATE;
        IF v_mod <> 'PROCUREMENT' THEN RR_PO_UTIL_PKG.err('Not a purchasing approval'); END IF;
        IF v_st <> 'PENDING' THEN RR_PO_UTIL_PKG.err('This request is already ' || v_st); END IF;
        IF UPPER(v_by) = UPPER(p_user) THEN RR_PO_UTIL_PKG.err('You cannot approve your own document'); END IF;
        -- fires RR_PO_APPROVAL_DECISION_TRG → the document follows
        UPDATE RR_APPROVAL_REQUESTS SET STATUS = UPPER(p_decision), DECIDED_BY = p_user, DECIDED_DATE = SYSDATE WHERE REQUEST_ID = v_id;
        INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS) VALUES (v_id, UPPER(p_decision), p_user, p_comments);
        p_id := v_id; p_number := v_ref; p_status := 'S';
        p_message := v_ref || CASE WHEN UPPER(p_decision) = 'APPROVED' THEN ' approved' ELSE ' rejected' END;
    EXCEPTION WHEN NO_DATA_FOUND THEN p_status := 'E'; p_message := 'Approval request not found';
              WHEN OTHERS THEN p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_APPROVAL_PKG;
/

-- Decisions made anywhere in the approval engine flow back to Purchasing documents
CREATE OR REPLACE TRIGGER RR_PO_APPROVAL_DECISION_TRG
AFTER UPDATE OF STATUS ON RR_APPROVAL_REQUESTS
FOR EACH ROW
WHEN (NEW.MODULE = 'PROCUREMENT' AND NEW.STATUS <> OLD.STATUS)
BEGIN
    RR_PO_APPROVAL_PKG.on_decision(:NEW.REQUEST_ID, :NEW.TRANSACTION_TYPE, :NEW.TRANSACTION_ID, :NEW.STATUS, :NEW.DECIDED_BY);
END;
/

-- When it was decided — whichever path changed the status (DECIDE, notification bell, e-mail link)
CREATE OR REPLACE TRIGGER RR_PO_APPROVAL_STAMP_TRG
BEFORE UPDATE OF STATUS ON RR_APPROVAL_REQUESTS
FOR EACH ROW
WHEN (NEW.MODULE = 'PROCUREMENT' AND NEW.STATUS <> OLD.STATUS)
BEGIN
    :NEW.DECIDED_DATE := SYSDATE;
END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- Read view: the approval request of a purchasing document
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW RR_PO_V_DOC_APPROVAL AS
SELECT r.REQUEST_ID, r.TRANSACTION_TYPE, r.TRANSACTION_ID, r.TRANSACTION_REF, r.STATUS, r.AMOUNT, r.CURRENCY,
       r.REQUESTED_BY_NAME, r.REQUESTED_DATE, r.DECIDED_BY, r.DECIDED_DATE, r.RULE_ID, ru.RULE_NAME,
       r.CURRENT_APPROVER_ID, u.FULL_NAME AS APPROVER_NAME, u.EMAIL AS APPROVER_EMAIL,
       (SELECT MAX(h.COMMENTS) KEEP (DENSE_RANK LAST ORDER BY h.ACTION_DATE, h.HISTORY_ID)
        FROM   RR_APPROVAL_HISTORY h
        WHERE  h.REQUEST_ID = r.REQUEST_ID AND h.ACTION IN ('APPROVED', 'REJECTED')) AS DECISION_COMMENTS
FROM   RR_APPROVAL_REQUESTS r
LEFT   JOIN RR_APPROVAL_RULES ru ON ru.RULE_ID = r.RULE_ID
LEFT   JOIN RR_APPROVAL_USERS u  ON u.USER_ID = r.CURRENT_APPROVER_ID
WHERE  r.MODULE = 'PROCUREMENT';

-- AI gateway access (same rule as 301: only when the ACL is in whitelist mode)
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR v IN (SELECT 'RR_PO_V_DOC_APPROVAL' n FROM dual UNION ALL SELECT 'RR_APPROVAL_REQUESTS' FROM dual
                  UNION ALL SELECT 'RR_APPROVAL_HISTORY' FROM dual UNION ALL SELECT 'RR_APPROVAL_USERS' FROM dual) LOOP
            MERGE INTO RR_AI_OBJECT_ACL t USING (SELECT v.n n FROM dual) s ON (t.OBJECT_NAME = s.n)
            WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'Y');
        END LOOP;
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;   -- AI gateway not installed: nothing to do
END;
/

-- ── registry for po/execute ─────────────────────────────────────────────────
MERGE INTO RR_PO_PROC_REGISTRY t
USING (
    SELECT 'RR_PO_APPROVAL_PKG.SUBMIT_PO_TO' n, 'p_po_header_id,p_approver' p, NULL c, 'Submit a PO to the chosen approver' d FROM dual UNION ALL
    SELECT 'RR_PO_APPROVAL_PKG.SUBMIT_REQ_TO', 'p_req_header_id,p_approver', NULL, 'Submit a requisition to the chosen approver' FROM dual UNION ALL
    SELECT 'RR_PO_APPROVAL_PKG.DECIDE', 'p_request_id,p_decision,p_comments', NULL, 'Approve / reject a procurement request' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d, t.ENABLED_FLAG = 'Y'
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH309');
COMMIT;

-- ── recompile purchasing objects that use the package ───────────────────────
BEGIN
    FOR o IN (SELECT object_name, object_type FROM user_objects
              WHERE  status = 'INVALID' AND object_name LIKE 'RR\_PO\_%' ESCAPE '\'
              AND    object_type IN ('VIEW', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'PROCEDURE', 'FUNCTION')
              ORDER  BY DECODE(object_type, 'VIEW', 1, 'PACKAGE', 2, 'PROCEDURE', 3, 'FUNCTION', 3, 'PACKAGE BODY', 4, 5)) LOOP
        BEGIN
            EXECUTE IMMEDIATE CASE o.object_type
                WHEN 'PACKAGE BODY' THEN 'ALTER PACKAGE ' || o.object_name || ' COMPILE BODY'
                ELSE 'ALTER ' || o.object_type || ' ' || o.object_name || ' COMPILE' END;
        EXCEPTION WHEN OTHERS THEN NULL;   -- reported below
        END;
    END LOOP;
END;
/

-- ── Smoke checks ─────────────────────────────────────────────────────────────
SELECT object_name, object_type, status FROM user_objects
 WHERE object_name IN ('RR_PO_APPROVAL_PKG', 'RR_PO_APPROVAL_DECISION_TRG', 'RR_PO_APPROVAL_STAMP_TRG', 'RR_PO_V_DOC_APPROVAL',
                       'RR_PO_DOC_PKG', 'RR_PO_REQ_PKG')
 ORDER BY object_name, object_type;
SELECT name, type, line, position, text FROM user_errors WHERE name IN ('RR_PO_APPROVAL_PKG', 'RR_PO_DOC_PKG', 'RR_PO_REQ_PKG')
 ORDER BY name, type, sequence;
SELECT PROC_NAME, PARAMS_CSV, ENABLED_FLAG FROM RR_PO_PROC_REGISTRY WHERE PROC_NAME LIKE 'RR\_PO\_APPROVAL\_PKG.%' ESCAPE '\';
