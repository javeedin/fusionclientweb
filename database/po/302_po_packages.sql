-- =============================================================================
-- Purchasing-RR (module PO) — 302: business logic packages
--   RR_PO_UTIL_PKG      helpers: JSON, numbering, accounts, rates, periods, history
--   RR_PO_SETUP_PKG     setup tables (generic, whitelisted save)
--   RR_PO_REQ_PKG       requisitions
--   RR_PO_DOC_PKG       purchase orders, autocreate, cancel/close, change orders
--   RR_PO_RCV_PKG       receiving, returns, corrections
--   RR_PO_ACCT_PKG      receipt accounting stamps, period-end accrual, write-off
--   RR_PO_APPROVAL_PKG  existing approval engine (RR_APPROVAL_*) + decision trigger
--
-- Every callable procedure: IN p_xxx ..., IN p_user, OUT p_id, OUT p_number,
-- OUT p_status ('S' ok / 'W' ok with warning / 'E' error), OUT p_message.
-- Procedures never COMMIT; the po/execute dispatcher (303) commits on S/W and
-- rolls back on E, so every call is one atomic transaction.
-- Run after 300 and 301.
-- =============================================================================

-- Approval rules: optional BU / category filters (existing rules keep working: NULL = any)
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_RULES ADD (BUSINESS_UNIT_ID NUMBER)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1430, -2260, -2261, -2275, -1408) THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE RR_APPROVAL_RULES ADD (CATEGORY_CODE VARCHAR2(40))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1430, -2260, -2261, -2275, -1408) THEN RAISE; END IF; END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- SPECS
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE RR_PO_UTIL_PKG AS
    PROCEDURE err (p_msg IN VARCHAR2);
    FUNCTION  err_text (p_sqlerrm IN VARCHAR2) RETURN VARCHAR2;
    FUNCTION  jstr  (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN VARCHAR2;
    FUNCTION  jnum  (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN NUMBER;
    FUNCTION  jdate (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN DATE;
    FUNCTION  jclob (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN CLOB;
    FUNCTION  jarr  (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN JSON_ARRAY_T;
    FUNCTION  to_num (p IN VARCHAR2) RETURN NUMBER;
    FUNCTION  to_dt  (p IN VARCHAR2) RETURN DATE;
    FUNCTION  opt (p_bu IN NUMBER) RETURN RR_PO_BU_OPTIONS%ROWTYPE;
    FUNCTION  bu_company (p_bu IN NUMBER) RETURN VARCHAR2;
    FUNCTION  next_number (p_bu IN NUMBER, p_doc_type IN VARCHAR2) RETURN VARCHAR2;
    FUNCTION  account_error (p_combo IN VARCHAR2, p_bu IN NUMBER) RETURN VARCHAR2;
    FUNCTION  derive_account (p_bu IN NUMBER, p_user IN VARCHAR2, p_category_id IN NUMBER, p_item_id IN NUMBER) RETURN VARCHAR2;
    FUNCTION  get_rate (p_from IN VARCHAR2, p_to IN VARCHAR2, p_type IN VARCHAR2, p_date IN DATE) RETURN NUMBER;
    FUNCTION  period_open (p_bu IN NUMBER, p_date IN DATE) RETURN BOOLEAN;
    FUNCTION  site_error (p_supplier_id IN NUMBER, p_site_id IN NUMBER, p_bu IN NUMBER) RETURN VARCHAR2;
    FUNCTION  is_buyer (p_user IN VARCHAR2, p_bu IN NUMBER) RETURN BOOLEAN;
    FUNCTION  tax_rate (p_tax_code IN VARCHAR2) RETURN NUMBER;
    PROCEDURE history (p_type IN VARCHAR2, p_id IN NUMBER, p_action IN VARCHAR2, p_from IN VARCHAR2,
                       p_to IN VARCHAR2, p_user IN VARCHAR2, p_comments IN VARCHAR2 DEFAULT NULL);
END RR_PO_UTIL_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_SETUP_PKG AS
    PROCEDURE SAVE_SETUP (p_entity IN VARCHAR2, p_json IN CLOB, p_user IN VARCHAR2,
                          p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DELETE_SETUP (p_entity IN VARCHAR2, p_row_id IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
END RR_PO_SETUP_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_REQ_PKG AS
    PROCEDURE SAVE_REQUISITION (p_json IN CLOB, p_user IN VARCHAR2,
                                p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SUBMIT (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE WITHDRAW (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CANCEL (p_req_header_id IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DELETE_DRAFT (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE RETURN_LINES (p_req_line_ids IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal (approval callback)
    PROCEDURE approve_internal (p_req_header_id IN NUMBER, p_user IN VARCHAR2);
END RR_PO_REQ_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_DOC_PKG AS
    PROCEDURE SAVE_PO (p_json IN CLOB, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE AUTOCREATE (p_json IN CLOB, p_user IN VARCHAR2,
                          p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE COPY_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SUBMIT_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE WITHDRAW_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                           p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DELETE_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CANCEL_PO (p_po_header_id IN VARCHAR2, p_po_line_id IN VARCHAR2, p_reason IN VARCHAR2,
                         p_recreate_demand IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CLOSE_PO (p_po_header_id IN VARCHAR2, p_po_line_id IN VARCHAR2, p_action IN VARCHAR2,
                        p_reason IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE HOLD_PO (p_po_header_id IN VARCHAR2, p_action IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE MARK_COMMUNICATED (p_po_header_id IN VARCHAR2, p_method IN VARCHAR2, p_to IN VARCHAR2, p_user IN VARCHAR2,
                                 p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SUBMIT_CHANGE (p_po_header_id IN VARCHAR2, p_changes_json IN CLOB, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CANCEL_CHANGE (p_change_order_id IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal
    PROCEDURE approve_internal (p_po_header_id IN NUMBER, p_user IN VARCHAR2);
    PROCEDURE apply_change (p_change_order_id IN NUMBER, p_user IN VARCHAR2);
    PROCEDURE rollup_schedule (p_schedule_id IN NUMBER);
    PROCEDURE rollup_header (p_po_header_id IN NUMBER);
END RR_PO_DOC_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_RCV_PKG AS
    PROCEDURE RECEIVE (p_json IN CLOB, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE RETURN_TO_SUPPLIER (p_rcv_transaction_id IN VARCHAR2, p_quantity IN VARCHAR2, p_amount IN VARCHAR2,
                                  p_reason IN VARCHAR2, p_txn_date IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CORRECT (p_rcv_transaction_id IN VARCHAR2, p_quantity IN VARCHAR2, p_amount IN VARCHAR2,
                       p_txn_date IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
END RR_PO_RCV_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_ACCT_PKG AS
    PROCEDURE MARK_ACCOUNTED (p_entity IN VARCHAR2, p_ids IN VARCHAR2, p_sla_header_id IN VARCHAR2,
                              p_gl_batch_id IN VARCHAR2, p_reversal_gl_batch_id IN VARCHAR2, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE RUN_PERIOD_END_ACCRUAL (p_business_unit_id IN VARCHAR2, p_period_name IN VARCHAR2,
                                      p_accrual_date IN VARCHAR2, p_reversal_date IN VARCHAR2, p_user IN VARCHAR2,
                                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE CANCEL_ACCRUAL_RUN (p_run_id IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE WRITE_OFF (p_json IN CLOB, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
END RR_PO_ACCT_PKG;
/

CREATE OR REPLACE PACKAGE RR_PO_APPROVAL_PKG AS
    PROCEDURE DECIDE (p_request_id IN VARCHAR2, p_decision IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    -- internal
    FUNCTION  request (p_type IN VARCHAR2, p_doc_id IN NUMBER, p_po_header_id IN NUMBER, p_ref IN VARCHAR2,
                       p_amount IN NUMBER, p_currency IN VARCHAR2, p_bu IN NUMBER, p_desc IN VARCHAR2,
                       p_user IN VARCHAR2) RETURN NUMBER;
    PROCEDURE recall (p_request_id IN NUMBER, p_user IN VARCHAR2);
    PROCEDURE on_decision (p_request_id IN NUMBER, p_type IN VARCHAR2, p_txn_id IN NUMBER, p_status IN VARCHAR2);
END RR_PO_APPROVAL_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_UTIL_PKG
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_UTIL_PKG AS

    PROCEDURE err (p_msg IN VARCHAR2) IS
    BEGIN
        RAISE_APPLICATION_ERROR(-20001, SUBSTR(p_msg, 1, 2000));
    END;

    FUNCTION err_text (p_sqlerrm IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(4000) := p_sqlerrm;
    BEGIN
        IF v LIKE 'ORA-20001:%' THEN
            v := TRIM(SUBSTR(v, 11));
            -- drop the trailing "ORA-06512: at ..." stack lines
            IF INSTR(v, CHR(10) || 'ORA-06512') > 0 THEN v := SUBSTR(v, 1, INSTR(v, CHR(10) || 'ORA-06512') - 1); END IF;
        ELSIF v LIKE 'ORA-00001:%' THEN
            v := 'This code or number already exists (' || v || ')';
        ELSIF v LIKE 'ORA-02291:%' THEN
            v := 'A referenced record does not exist (' || v || ')';
        END IF;
        RETURN SUBSTR(v, 1, 4000);
    END;

    FUNCTION to_num (p IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p IS NULL THEN RETURN NULL; END IF;
        RETURN TO_NUMBER(REPLACE(TRIM(p), ',', '') DEFAULT NULL ON CONVERSION ERROR);
    END;

    FUNCTION to_dt (p IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p), 1, 10) DEFAULT NULL ON CONVERSION ERROR, 'YYYY-MM-DD');
    END;

    FUNCTION jstr (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN VARCHAR2 IS
        e JSON_ELEMENT_T;
    BEGIN
        IF p_o IS NULL OR NOT p_o.has(p_k) THEN RETURN NULL; END IF;
        e := p_o.get(p_k);
        IF e IS NULL OR e.is_null THEN RETURN NULL; END IF;
        IF e.is_string THEN RETURN p_o.get_string(p_k);
        ELSIF e.is_number THEN RETURN TO_CHAR(p_o.get_number(p_k), 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''');
        ELSIF e.is_boolean THEN RETURN CASE WHEN p_o.get_boolean(p_k) THEN 'Y' ELSE 'N' END;
        ELSE RETURN e.to_string;
        END IF;
    END;

    FUNCTION jnum (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN NUMBER IS
        e JSON_ELEMENT_T;
    BEGIN
        IF p_o IS NULL OR NOT p_o.has(p_k) THEN RETURN NULL; END IF;
        e := p_o.get(p_k);
        IF e IS NULL OR e.is_null THEN RETURN NULL; END IF;
        IF e.is_number THEN RETURN p_o.get_number(p_k); END IF;
        RETURN to_num(jstr(p_o, p_k));
    END;

    FUNCTION jdate (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN DATE IS
    BEGIN
        RETURN to_dt(jstr(p_o, p_k));
    END;

    FUNCTION jclob (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN CLOB IS
        e JSON_ELEMENT_T;
    BEGIN
        IF p_o IS NULL OR NOT p_o.has(p_k) THEN RETURN NULL; END IF;
        e := p_o.get(p_k);
        IF e IS NULL OR e.is_null THEN RETURN NULL; END IF;
        IF e.is_string THEN RETURN p_o.get_clob(p_k); END IF;
        RETURN e.to_clob;
    END;

    FUNCTION jarr (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2) RETURN JSON_ARRAY_T IS
        e JSON_ELEMENT_T;
    BEGIN
        IF p_o IS NULL OR NOT p_o.has(p_k) THEN RETURN JSON_ARRAY_T(); END IF;
        e := p_o.get(p_k);
        IF e IS NULL OR e.is_null THEN RETURN JSON_ARRAY_T(); END IF;
        IF e.is_array THEN RETURN p_o.get_array(p_k); END IF;
        IF e.is_string THEN RETURN JSON_ARRAY_T.parse(p_o.get_string(p_k)); END IF;   -- stringified array
        RETURN JSON_ARRAY_T();
    END;

    FUNCTION opt (p_bu IN NUMBER) RETURN RR_PO_BU_OPTIONS%ROWTYPE IS
        r RR_PO_BU_OPTIONS%ROWTYPE;
    BEGIN
        SELECT * INTO r FROM RR_PO_BU_OPTIONS WHERE BUSINESS_UNIT_ID = p_bu;
        IF r.STATUS <> 'ACTIVE' THEN err('Purchasing is not active for this business unit (Purchasing Options).'); END IF;
        RETURN r;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        err('Purchasing Options are not set up for business unit ' || p_bu || ' — open Purchasing › Setup › Purchasing Options.');
        RETURN r;
    END;

    FUNCTION bu_company (p_bu IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(30);
    BEGIN
        SELECT MAX(COMPANY) INTO v FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = p_bu;
        RETURN v;
    END;

    FUNCTION next_number (p_bu IN NUMBER, p_doc_type IN VARCHAR2) RETURN VARCHAR2 IS
        r      RR_PO_DOC_SEQUENCES%ROWTYPE;
        v_year NUMBER := EXTRACT(YEAR FROM SYSDATE);
        v_num  NUMBER;
    BEGIN
        BEGIN
            SELECT * INTO r FROM RR_PO_DOC_SEQUENCES
            WHERE BUSINESS_UNIT_ID = p_bu AND DOC_TYPE = p_doc_type FOR UPDATE;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            INSERT INTO RR_PO_DOC_SEQUENCES (BUSINESS_UNIT_ID, DOC_TYPE, PREFIX, YEAR_IN_NUMBER, NEXT_NUMBER,
                                             PAD_LENGTH, RESET_YEARLY, CURRENT_YEAR, CREATED_BY)
            VALUES (p_bu, p_doc_type, p_doc_type || '-', 'Y', 1, 5, 'Y', v_year, 'SYSTEM');
            SELECT * INTO r FROM RR_PO_DOC_SEQUENCES
            WHERE BUSINESS_UNIT_ID = p_bu AND DOC_TYPE = p_doc_type FOR UPDATE;
        END;
        IF r.RESET_YEARLY = 'Y' AND NVL(r.CURRENT_YEAR, v_year) <> v_year THEN r.NEXT_NUMBER := 1; END IF;
        v_num := r.NEXT_NUMBER;
        UPDATE RR_PO_DOC_SEQUENCES
        SET    NEXT_NUMBER = v_num + 1, CURRENT_YEAR = v_year, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  DOC_SEQ_ID = r.DOC_SEQ_ID;
        RETURN r.PREFIX || CASE WHEN r.YEAR_IN_NUMBER = 'Y' THEN TO_CHAR(v_year) || '-' END
               || LPAD(TO_CHAR(v_num), r.PAD_LENGTH, '0');
    END;

    -- NULL when the combination is usable for the BU, else the reason
    FUNCTION account_error (p_combo IN VARCHAR2, p_bu IN NUMBER) RETURN VARCHAR2 IS
        v_company VARCHAR2(30) := bu_company(p_bu);
        v_n       NUMBER;
    BEGIN
        IF p_combo IS NULL THEN RETURN 'Charge account is required'; END IF;
        IF INSTR(p_combo, '-') = 0 THEN RETURN 'Account ' || p_combo || ' is not a full combination'; END IF;
        IF v_company IS NOT NULL AND REGEXP_SUBSTR(p_combo, '[^-]+', 1, 1) <> v_company THEN
            RETURN 'Account ' || p_combo || ' does not belong to company ' || v_company || ' of the business unit';
        END IF;
        BEGIN
            EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM reerp_gl_code_combinations WHERE concatenated_segments = :1'
                INTO v_n USING p_combo;
            IF v_n = 0 THEN
                RETURN 'Account ' || p_combo || ' does not exist in the chart of accounts (create it in GL › Account Combinations)';
            END IF;
        EXCEPTION WHEN OTHERS THEN NULL;   -- combination table not readable here: segment/company checks only
        END;
        RETURN NULL;
    END;

    FUNCTION derive_account (p_bu IN NUMBER, p_user IN VARCHAR2, p_category_id IN NUMBER, p_item_id IN NUMBER) RETURN VARCHAR2 IS
        TYPE t_segs IS TABLE OF VARCHAR2(30) INDEX BY PLS_INTEGER;
        v_tpl  VARCHAR2(200);
        v_nat  VARCHAR2(30);
        v_cat  NUMBER := p_category_id;
        v_cnt  PLS_INTEGER;
        v_out  VARCHAR2(400);
        segs   t_segs;
        v_done t_segs;
    BEGIN
        SELECT MAX(CHARGE_ACCOUNT_TEMPLATE) INTO v_tpl FROM RR_PO_REQUESTER_DEFAULTS
        WHERE  UPPER(USER_NAME) = UPPER(p_user) AND BUSINESS_UNIT_ID = p_bu;
        IF v_tpl IS NULL THEN RETURN NULL; END IF;
        v_cnt := REGEXP_COUNT(v_tpl, '-') + 1;
        FOR i IN 1 .. v_cnt LOOP segs(i) := REGEXP_SUBSTR(v_tpl, '[^-]+', 1, i); END LOOP;
        IF bu_company(p_bu) IS NOT NULL THEN segs(1) := bu_company(p_bu); END IF;
        -- natural account: item override, else category, else its ancestors
        IF p_item_id IS NOT NULL THEN
            SELECT MAX(NATURAL_ACCOUNT_OVERRIDE), NVL(MAX(CATEGORY_ID), v_cat) INTO v_nat, v_cat
            FROM RR_PO_EXPENSE_ITEMS WHERE EXPENSE_ITEM_ID = p_item_id;
        END IF;
        FOR i IN 1 .. 6 LOOP
            EXIT WHEN v_nat IS NOT NULL OR v_cat IS NULL;
            SELECT MAX(DEFAULT_NATURAL_ACCOUNT), MAX(PARENT_CATEGORY_ID) INTO v_nat, v_cat
            FROM RR_PO_CATEGORIES WHERE CATEGORY_ID = v_cat;
        END LOOP;
        IF v_nat IS NOT NULL AND v_cnt >= 4 THEN segs(4) := v_nat; END IF;
        -- account rules: first matching rule per segment (priority, then most specific)
        FOR r IN (SELECT ar.SEGMENT_NUM, ar.SEGMENT_VALUE
                  FROM   RR_PO_ACCOUNT_RULES ar
                  WHERE  ar.STATUS = 'ACTIVE'
                  AND    (ar.BUSINESS_UNIT_ID IS NULL OR ar.BUSINESS_UNIT_ID = p_bu)
                  AND    (ar.EXPENSE_ITEM_ID IS NULL OR ar.EXPENSE_ITEM_ID = p_item_id)
                  AND    (ar.CATEGORY_ID IS NULL OR ar.CATEGORY_ID IN (
                              SELECT CATEGORY_ID FROM RR_PO_CATEGORIES
                              START WITH CATEGORY_ID = p_category_id
                              CONNECT BY NOCYCLE PRIOR PARENT_CATEGORY_ID = CATEGORY_ID))
                  ORDER  BY ar.PRIORITY,
                            CASE WHEN ar.EXPENSE_ITEM_ID IS NOT NULL THEN 0 ELSE 1 END,
                            CASE WHEN ar.CATEGORY_ID IS NOT NULL THEN 0 ELSE 1 END,
                            CASE WHEN ar.BUSINESS_UNIT_ID IS NOT NULL THEN 0 ELSE 1 END) LOOP
            IF r.SEGMENT_NUM <= v_cnt AND NOT v_done.EXISTS(r.SEGMENT_NUM) THEN
                segs(r.SEGMENT_NUM) := r.SEGMENT_VALUE;
                v_done(r.SEGMENT_NUM) := 'Y';
            END IF;
        END LOOP;
        FOR i IN 1 .. v_cnt LOOP v_out := v_out || CASE WHEN i > 1 THEN '-' END || segs(i); END LOOP;
        RETURN v_out;
    END;

    FUNCTION get_rate (p_from IN VARCHAR2, p_to IN VARCHAR2, p_type IN VARCHAR2, p_date IN DATE) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RETURN 1; END IF;
        SELECT MAX(RATE) KEEP (DENSE_RANK LAST ORDER BY RATE_DATE) INTO v
        FROM   RR_CURRENCY_DAILY_RATES
        WHERE  FROM_CURRENCY = p_from AND TO_CURRENCY = p_to
        AND    UPPER(RATE_TYPE) = UPPER(NVL(p_type, 'Corporate')) AND RATE_DATE <= NVL(p_date, SYSDATE);
        IF v IS NULL THEN
            SELECT MAX(1 / NULLIF(RATE, 0)) KEEP (DENSE_RANK LAST ORDER BY RATE_DATE) INTO v
            FROM   RR_CURRENCY_DAILY_RATES
            WHERE  FROM_CURRENCY = p_to AND TO_CURRENCY = p_from
            AND    UPPER(RATE_TYPE) = UPPER(NVL(p_type, 'Corporate')) AND RATE_DATE <= NVL(p_date, SYSDATE);
        END IF;
        RETURN v;
    END;

    FUNCTION period_open (p_bu IN NUMBER, p_date IN DATE) RETURN BOOLEAN IS
        v_ledger NUMBER;
        v_rows   NUMBER;
        v_open   NUMBER;
    BEGIN
        SELECT MAX(PRIMARY_LEDGER_ID) INTO v_ledger FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = p_bu;
        IF v_ledger IS NULL THEN RETURN TRUE; END IF;
        SELECT COUNT(*), COUNT(CASE WHEN closing_status = 'O' AND p_date BETWEEN start_date AND end_date
                                     AND NVL(adjustment_period_flag, 'N') = 'N' THEN 1 END)
        INTO   v_rows, v_open
        FROM   rr_accounting_periods_status
        WHERE  ledger_id = v_ledger AND application_id = 101;
        IF v_rows = 0 THEN
            SELECT COUNT(*), COUNT(CASE WHEN closing_status = 'O' AND p_date BETWEEN start_date AND end_date THEN 1 END)
            INTO   v_rows, v_open
            FROM   rr_accounting_periods_status WHERE ledger_id = v_ledger;
        END IF;
        RETURN v_rows = 0 OR v_open > 0;
    EXCEPTION WHEN OTHERS THEN RETURN TRUE;   -- period table not available: do not block
    END;

    FUNCTION site_error (p_supplier_id IN NUMBER, p_site_id IN NUMBER, p_bu IN NUMBER) RETURN VARCHAR2 IS
        v_sup  NUMBER;
        v_hold VARCHAR2(1);
        v_why  VARCHAR2(400);
    BEGIN
        SELECT MAX(SUPPLIER_ID), MAX(PURCHASING_HOLD_FLAG), MAX(HOLD_REASON) INTO v_sup, v_hold, v_why
        FROM   RR_PO_V_SUPPLIER_SITES WHERE SUPPLIER_SITE_ID = p_site_id AND BUSINESS_UNIT_ID = p_bu;
        IF v_sup IS NULL THEN
            RETURN 'Supplier site ' || p_site_id || ' is not active or not assigned to this business unit '
                || '(RR_SUPPLIER_SITES status / RR_SUPPLIER_SITE_ASSIGNMENTS)';
        END IF;
        IF v_sup <> p_supplier_id THEN RETURN 'The site does not belong to the selected supplier'; END IF;
        IF v_hold = 'Y' THEN RETURN 'Supplier site is on purchasing hold: ' || NVL(v_why, 'no reason given'); END IF;
        RETURN NULL;
    END;

    FUNCTION is_buyer (p_user IN VARCHAR2, p_bu IN NUMBER) RETURN BOOLEAN IS
        v_any NUMBER; v_me NUMBER;
    BEGIN
        SELECT COUNT(*), COUNT(CASE WHEN UPPER(USER_NAME) = UPPER(p_user) THEN 1 END) INTO v_any, v_me
        FROM   RR_PO_BUYERS
        WHERE  STATUS = 'ACTIVE' AND (BUSINESS_UNIT_ID IS NULL OR BUSINESS_UNIT_ID = p_bu);
        RETURN v_any = 0 OR v_me > 0;   -- no buyers defined for the BU = everyone may buy
    END;

    FUNCTION tax_rate (p_tax_code IN VARCHAR2) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        IF p_tax_code IS NULL THEN RETURN 0; END IF;
        SELECT MAX(TAX_RATE) INTO v FROM RR_INPUT_OUTPUT_TAX WHERE TAX_CODE = p_tax_code AND STATUS = 'ACTIVE';
        RETURN NVL(v, 0);
    EXCEPTION WHEN OTHERS THEN RETURN 0;
    END;

    PROCEDURE history (p_type IN VARCHAR2, p_id IN NUMBER, p_action IN VARCHAR2, p_from IN VARCHAR2,
                       p_to IN VARCHAR2, p_user IN VARCHAR2, p_comments IN VARCHAR2 DEFAULT NULL) IS
    BEGIN
        INSERT INTO RR_PO_ACTION_HISTORY (ENTITY_TYPE, ENTITY_ID, ACTION, FROM_STATUS, TO_STATUS, ACTION_BY, COMMENTS, CREATED_BY)
        VALUES (p_type, p_id, p_action, p_from, p_to, p_user, SUBSTR(p_comments, 1, 2000), p_user);
    END;
END RR_PO_UTIL_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_SETUP_PKG — whitelisted generic save for setup tables
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_SETUP_PKG AS
    U CONSTANT VARCHAR2(30) := 'RR_PO_UTIL_PKG';

    PROCEDURE entity_def (p_entity IN VARCHAR2, p_table OUT VARCHAR2, p_pk OUT VARCHAR2, p_cols OUT VARCHAR2,
                          p_upsert_key OUT VARCHAR2) IS
    BEGIN
        p_upsert_key := NULL;
        CASE UPPER(p_entity)
        WHEN 'BU_OPTIONS' THEN
            p_table := 'RR_PO_BU_OPTIONS'; p_pk := 'BU_OPTION_ID'; p_upsert_key := 'BUSINESS_UNIT_ID';
            p_cols := 'BUSINESS_UNIT_ID,FUNCTIONAL_CURRENCY,DEFAULT_RATE_TYPE,DEFAULT_SHIP_TO_LOCATION_ID,DEFAULT_BILL_TO_LOCATION_ID,'
                   || 'MATCH_LEVEL_QUANTITY,MATCH_LEVEL_AMOUNT,ACCRUE_AT_RECEIPT_FLAG,RECEIPT_ACCRUAL_ACCOUNT,PRICE_VARIANCE_ACCOUNT,'
                   || 'EXCHANGE_GAIN_ACCOUNT,EXCHANGE_LOSS_ACCOUNT,ACCRUAL_WRITE_OFF_ACCOUNT,ACCRUAL_WRITE_OFF_AGE_DAYS,'
                   || 'OVER_RECEIPT_TOLERANCE_PCT,OVER_RECEIPT_ACTION,EARLY_RECEIPT_DAYS,INVOICE_QTY_TOLERANCE_PCT,'
                   || 'INVOICE_PRICE_TOLERANCE_PCT,INVOICE_AMOUNT_TOLERANCE,RECEIPT_CLOSE_TOLERANCE_PCT,INVOICE_CLOSE_TOLERANCE_PCT,'
                   || 'REQ_APPROVAL_REQUIRED,PO_APPROVAL_REQUIRED,CO_REAPPROVAL_THRESHOLD_PCT,AUTOCREATE_MODE,REQUIRE_REQUISITION,'
                   || 'ALLOW_AFTER_FACT_PO,SOD_BUYER_RECEIVE,BUDGET_CONTROL_LEVEL,PO_TERMS_TEXT,PO_EMAIL_SUBJECT,PO_EMAIL_BODY,STATUS';
        WHEN 'LOCATION' THEN
            p_table := 'RR_PO_LOCATIONS'; p_pk := 'LOCATION_ID';
            p_cols := 'LOCATION_CODE,LOCATION_NAME,BUSINESS_UNIT_ID,ADDRESS_LINE1,ADDRESS_LINE2,ADDRESS_LINE3,CITY,REGION,COUNTRY,'
                   || 'PO_BOX,CONTACT_NAME,PHONE,EMAIL,SHIP_TO_FLAG,BILL_TO_FLAG,DELIVER_TO_FLAG,STATUS';
        WHEN 'CATEGORY' THEN
            p_table := 'RR_PO_CATEGORIES'; p_pk := 'CATEGORY_ID';
            p_cols := 'CATEGORY_CODE,CATEGORY_NAME,PARENT_CATEGORY_ID,DEFAULT_NATURAL_ACCOUNT,DEFAULT_LINE_TYPE,DEFAULT_UOM,'
                   || 'DEFAULT_TAX_CODE,RECEIPT_REQUIRED_FLAG,CAPEX_FLAG,REQUESTABLE_FLAG,STATUS';
        WHEN 'EXPENSE_ITEM' THEN
            p_table := 'RR_PO_EXPENSE_ITEMS'; p_pk := 'EXPENSE_ITEM_ID';
            p_cols := 'ITEM_CODE,DESCRIPTION,LONG_DESCRIPTION,CATEGORY_ID,LINE_TYPE,UOM_CODE,LIST_PRICE,CURRENCY_CODE,'
                   || 'PREFERRED_SUPPLIER_ID,PREFERRED_SUPPLIER_SITE_ID,SUPPLIER_ITEM_NUM,LEAD_TIME_DAYS,NATURAL_ACCOUNT_OVERRIDE,TAX_CODE,STATUS';
        WHEN 'UOM' THEN
            p_table := 'RR_PO_UOMS'; p_pk := NULL; p_upsert_key := 'UOM_CODE';
            p_cols := 'UOM_CODE,UOM_NAME,UOM_CLASS,STATUS';
        WHEN 'BUYER' THEN
            p_table := 'RR_PO_BUYERS'; p_pk := 'BUYER_ID';
            p_cols := 'USER_NAME,BUSINESS_UNIT_ID,CATEGORY_ID,DIRECT_PO_ALLOWED,EMAIL,PHONE,DEFAULT_FLAG,STATUS';
        WHEN 'REQUESTER_DEFAULT' THEN
            p_table := 'RR_PO_REQUESTER_DEFAULTS'; p_pk := 'DEFAULT_ID';
            p_cols := 'USER_NAME,BUSINESS_UNIT_ID,DELIVER_TO_LOCATION_ID,CHARGE_ACCOUNT_TEMPLATE,MANAGER_USER_NAME';
        WHEN 'ACCOUNT_RULE' THEN
            p_table := 'RR_PO_ACCOUNT_RULES'; p_pk := 'RULE_ID';
            p_cols := 'BUSINESS_UNIT_ID,CATEGORY_ID,EXPENSE_ITEM_ID,SEGMENT_NUM,SEGMENT_VALUE,PRIORITY,STATUS';
        WHEN 'DOC_SEQUENCE' THEN
            p_table := 'RR_PO_DOC_SEQUENCES'; p_pk := 'DOC_SEQ_ID';
            p_cols := 'BUSINESS_UNIT_ID,DOC_TYPE,PREFIX,YEAR_IN_NUMBER,NEXT_NUMBER,PAD_LENGTH,RESET_YEARLY';
        WHEN 'SITE_OPTIONS' THEN
            p_table := 'RR_PO_SUPPLIER_SITE_OPTIONS'; p_pk := 'SITE_OPTION_ID'; p_upsert_key := 'SUPPLIER_SITE_ID';
            p_cols := 'SUPPLIER_SITE_ID,PO_COMMUNICATION,PO_EMAIL,DEFAULT_CURRENCY,MATCH_LEVEL,INVOICE_QTY_TOLERANCE_PCT,'
                   || 'INVOICE_PRICE_TOLERANCE_PCT,PURCHASING_HOLD_FLAG,HOLD_REASON';
        ELSE
            RR_PO_UTIL_PKG.err('Unknown setup entity ' || p_entity);
        END CASE;
    END;

    PROCEDURE validate (p_entity IN VARCHAR2, p_table IN VARCHAR2, p_pk IN VARCHAR2, p_id IN NUMBER, p_key IN VARCHAR2) IS
        o   RR_PO_BU_OPTIONS%ROWTYPE;
        v_e VARCHAR2(400);
        v_n NUMBER;
    BEGIN
        CASE UPPER(p_entity)
        WHEN 'BU_OPTIONS' THEN
            SELECT * INTO o FROM RR_PO_BU_OPTIONS WHERE BU_OPTION_ID = p_id;
            SELECT COUNT(*) INTO v_n FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = o.BUSINESS_UNIT_ID;
            IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Business unit ' || o.BUSINESS_UNIT_ID || ' does not exist'); END IF;
            IF o.ACCRUE_AT_RECEIPT_FLAG = 'Y' AND o.RECEIPT_ACCRUAL_ACCOUNT IS NULL THEN
                RR_PO_UTIL_PKG.err('Receipt accrual (GRNI) account is required when accruing at receipt');
            END IF;
            FOR a IN (SELECT o.RECEIPT_ACCRUAL_ACCOUNT acc, 'Receipt accrual' nm FROM dual
                      UNION ALL SELECT o.PRICE_VARIANCE_ACCOUNT, 'Price variance' FROM dual
                      UNION ALL SELECT o.EXCHANGE_GAIN_ACCOUNT, 'Exchange gain' FROM dual
                      UNION ALL SELECT o.EXCHANGE_LOSS_ACCOUNT, 'Exchange loss' FROM dual
                      UNION ALL SELECT o.ACCRUAL_WRITE_OFF_ACCOUNT, 'Accrual write-off' FROM dual) LOOP
                IF a.acc IS NOT NULL THEN
                    v_e := RR_PO_UTIL_PKG.account_error(a.acc, o.BUSINESS_UNIT_ID);
                    IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err(a.nm || ' account: ' || v_e); END IF;
                END IF;
            END LOOP;
            IF o.OVER_RECEIPT_TOLERANCE_PCT NOT BETWEEN 0 AND 100 OR o.INVOICE_QTY_TOLERANCE_PCT NOT BETWEEN 0 AND 100
               OR o.INVOICE_PRICE_TOLERANCE_PCT NOT BETWEEN 0 AND 100 THEN
                RR_PO_UTIL_PKG.err('Tolerances must be between 0 and 100');
            END IF;
        WHEN 'CATEGORY' THEN
            -- no cycles in the category tree
            SELECT COUNT(*) INTO v_n FROM (
                SELECT CATEGORY_ID FROM RR_PO_CATEGORIES START WITH CATEGORY_ID = p_id
                CONNECT BY NOCYCLE PRIOR PARENT_CATEGORY_ID = CATEGORY_ID) WHERE CATEGORY_ID = p_id;
            FOR c IN (SELECT PARENT_CATEGORY_ID FROM RR_PO_CATEGORIES WHERE CATEGORY_ID = p_id) LOOP
                IF c.PARENT_CATEGORY_ID = p_id THEN RR_PO_UTIL_PKG.err('A category cannot be its own parent'); END IF;
            END LOOP;
            SELECT COUNT(*) INTO v_n FROM RR_PO_CATEGORIES
            WHERE CATEGORY_ID = p_id AND CONNECT_BY_ISCYCLE = 1
            START WITH CATEGORY_ID = p_id CONNECT BY NOCYCLE PRIOR PARENT_CATEGORY_ID = CATEGORY_ID;
            IF v_n > 0 THEN RR_PO_UTIL_PKG.err('The parent would create a loop in the category tree'); END IF;
        WHEN 'REQUESTER_DEFAULT' THEN
            FOR r IN (SELECT CHARGE_ACCOUNT_TEMPLATE, BUSINESS_UNIT_ID FROM RR_PO_REQUESTER_DEFAULTS WHERE DEFAULT_ID = p_id) LOOP
                v_e := RR_PO_UTIL_PKG.account_error(r.CHARGE_ACCOUNT_TEMPLATE, r.BUSINESS_UNIT_ID);
                IF v_e IS NOT NULL AND v_e NOT LIKE '%does not exist%' THEN RR_PO_UTIL_PKG.err('Template account: ' || v_e); END IF;
            END LOOP;
        WHEN 'BUYER' THEN
            FOR b IN (SELECT BUSINESS_UNIT_ID, DEFAULT_FLAG FROM RR_PO_BUYERS WHERE BUYER_ID = p_id) LOOP
                IF b.DEFAULT_FLAG = 'Y' THEN
                    UPDATE RR_PO_BUYERS SET DEFAULT_FLAG = 'N'
                    WHERE BUYER_ID <> p_id AND DEFAULT_FLAG = 'Y'
                    AND NVL(BUSINESS_UNIT_ID, -1) = NVL(b.BUSINESS_UNIT_ID, -1);
                END IF;
            END LOOP;
        WHEN 'EXPENSE_ITEM' THEN
            FOR i IN (SELECT LINE_TYPE, UOM_CODE FROM RR_PO_EXPENSE_ITEMS WHERE EXPENSE_ITEM_ID = p_id) LOOP
                IF i.LINE_TYPE = 'QUANTITY' AND i.UOM_CODE IS NULL THEN RR_PO_UTIL_PKG.err('Quantity items need a unit of measure'); END IF;
            END LOOP;
        ELSE NULL;
        END CASE;
    END;

    PROCEDURE SAVE_SETUP (p_entity IN VARCHAR2, p_json IN CLOB, p_user IN VARCHAR2,
                          p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_table VARCHAR2(60); v_pk VARCHAR2(60); v_cols VARCHAR2(4000); v_key VARCHAR2(60);
        o       JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        v_id    NUMBER;
        v_keyv  VARCHAR2(400);
        v_sql   VARCHAR2(32767);
        v_set   VARCHAR2(32767);
        v_ins_c VARCHAR2(32767);
        v_ins_v VARCHAR2(32767);
        c       INTEGER;
        n       INTEGER;
        v_col   VARCHAR2(60);
        TYPE t_cols IS TABLE OF VARCHAR2(60);
        cols    t_cols := t_cols();
        v_exists NUMBER := 0;
    BEGIN
        entity_def(p_entity, v_table, v_pk, v_cols, v_key);
        FOR i IN 1 .. REGEXP_COUNT(v_cols, ',') + 1 LOOP
            v_col := REGEXP_SUBSTR(v_cols, '[^,]+', 1, i);
            IF o.has(LOWER(v_col)) THEN cols.EXTEND; cols(cols.COUNT) := v_col; END IF;
        END LOOP;
        IF v_pk IS NOT NULL THEN v_id := RR_PO_UTIL_PKG.jnum(o, LOWER(v_pk)); END IF;
        -- upsert tables: find the row by its natural key
        IF v_id IS NULL AND v_key IS NOT NULL THEN
            v_keyv := RR_PO_UTIL_PKG.jstr(o, LOWER(v_key));
            IF v_keyv IS NULL THEN RR_PO_UTIL_PKG.err(v_key || ' is required'); END IF;
            IF v_pk IS NOT NULL THEN
                EXECUTE IMMEDIATE 'SELECT MAX(' || v_pk || ') FROM ' || v_table || ' WHERE ' || v_key || ' = :1' INTO v_id USING v_keyv;
            ELSE
                EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || v_table || ' WHERE ' || v_key || ' = :1' INTO v_exists USING v_keyv;
            END IF;
        END IF;

        IF v_id IS NULL AND v_exists = 0 THEN
            FOR i IN 1 .. cols.COUNT LOOP
                v_ins_c := v_ins_c || cols(i) || ',';
                v_ins_v := v_ins_v || ':b' || i || ',';
            END LOOP;
            v_sql := 'INSERT INTO ' || v_table || ' (' || v_ins_c || 'CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE) VALUES ('
                  || v_ins_v || ':u, :u, SYSTIMESTAMP)'
                  || CASE WHEN v_pk IS NOT NULL THEN ' RETURNING ' || v_pk || ' INTO :rid' END;
        ELSE
            FOR i IN 1 .. cols.COUNT LOOP v_set := v_set || cols(i) || ' = :b' || i || ', '; END LOOP;
            v_sql := 'UPDATE ' || v_table || ' SET ' || v_set || 'LAST_UPDATED_BY = :u, LAST_UPDATE_DATE = SYSTIMESTAMP WHERE '
                  || CASE WHEN v_pk IS NOT NULL THEN v_pk || ' = :rid' ELSE v_key || ' = :kv' END;
        END IF;

        c := DBMS_SQL.OPEN_CURSOR;
        BEGIN
            DBMS_SQL.PARSE(c, v_sql, DBMS_SQL.NATIVE);
            FOR i IN 1 .. cols.COUNT LOOP
                IF cols(i) IN ('PO_TERMS_TEXT', 'PO_EMAIL_BODY') THEN
                    DBMS_SQL.BIND_VARIABLE(c, ':b' || i, RR_PO_UTIL_PKG.jclob(o, LOWER(cols(i))));
                ELSE
                    DBMS_SQL.BIND_VARIABLE(c, ':b' || i, RR_PO_UTIL_PKG.jstr(o, LOWER(cols(i))), 4000);
                END IF;
            END LOOP;
            DBMS_SQL.BIND_VARIABLE(c, ':u', p_user);
            IF v_pk IS NOT NULL THEN DBMS_SQL.BIND_VARIABLE(c, ':rid', v_id);
            ELSIF v_id IS NULL AND v_exists > 0 THEN DBMS_SQL.BIND_VARIABLE(c, ':kv', v_keyv, 400);
            END IF;
            n := DBMS_SQL.EXECUTE(c);
            IF v_pk IS NOT NULL THEN DBMS_SQL.VARIABLE_VALUE(c, ':rid', v_id); END IF;
            DBMS_SQL.CLOSE_CURSOR(c);
        EXCEPTION WHEN OTHERS THEN
            IF DBMS_SQL.IS_OPEN(c) THEN DBMS_SQL.CLOSE_CURSOR(c); END IF;
            RAISE;
        END;
        IF n = 0 THEN RR_PO_UTIL_PKG.err('Record not found'); END IF;
        IF v_pk IS NOT NULL THEN validate(p_entity, v_table, v_pk, v_id, v_key); END IF;
        p_id := v_id; p_number := v_keyv; p_status := 'S'; p_message := 'Saved';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE DELETE_SETUP (p_entity IN VARCHAR2, p_row_id IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_n NUMBER := RR_PO_UTIL_PKG.to_num(p_row_id);
    BEGIN
        CASE UPPER(p_entity)
        WHEN 'BUYER'             THEN DELETE FROM RR_PO_BUYERS WHERE BUYER_ID = v_n;
        WHEN 'REQUESTER_DEFAULT' THEN DELETE FROM RR_PO_REQUESTER_DEFAULTS WHERE DEFAULT_ID = v_n;
        WHEN 'ACCOUNT_RULE'      THEN DELETE FROM RR_PO_ACCOUNT_RULES WHERE RULE_ID = v_n;
        WHEN 'SITE_OPTIONS'      THEN DELETE FROM RR_PO_SUPPLIER_SITE_OPTIONS WHERE SITE_OPTION_ID = v_n;
        ELSE RR_PO_UTIL_PKG.err('This record cannot be deleted — set its status to INACTIVE instead');
        END CASE;
        IF SQL%ROWCOUNT = 0 THEN RR_PO_UTIL_PKG.err('Record not found'); END IF;
        p_id := v_n; p_status := 'S'; p_message := 'Deleted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_SETUP_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_REQ_PKG — requisitions
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_REQ_PKG AS

    FUNCTION hdr (p_id IN NUMBER, p_lock IN BOOLEAN DEFAULT TRUE) RETURN RR_PO_REQ_HEADERS%ROWTYPE IS
        r RR_PO_REQ_HEADERS%ROWTYPE;
    BEGIN
        IF p_lock THEN SELECT * INTO r FROM RR_PO_REQ_HEADERS WHERE REQ_HEADER_ID = p_id FOR UPDATE;
        ELSE SELECT * INTO r FROM RR_PO_REQ_HEADERS WHERE REQ_HEADER_ID = p_id; END IF;
        RETURN r;
    EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Requisition ' || p_id || ' not found'); RETURN r;
    END;

    PROCEDURE recalc (p_id IN NUMBER) IS
    BEGIN
        UPDATE RR_PO_REQ_HEADERS h
        SET    TOTAL_AMOUNT_FUNC = NVL((SELECT SUM(AMOUNT_FUNC) FROM RR_PO_REQ_LINES l
                                        WHERE l.REQ_HEADER_ID = h.REQ_HEADER_ID AND l.LINE_STATUS <> 'CANCELLED'), 0)
        WHERE  REQ_HEADER_ID = p_id;
    END;

    PROCEDURE SAVE_REQUISITION (p_json IN CLOB, p_user IN VARCHAR2,
                                p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        lines  JSON_ARRAY_T;
        l      JSON_OBJECT_T;
        dists  JSON_ARRAY_T;
        d      JSON_OBJECT_T;
        h      RR_PO_REQ_HEADERS%ROWTYPE;
        op     RR_PO_BU_OPTIONS%ROWTYPE;
        v_id   NUMBER := RR_PO_UTIL_PKG.jnum(o, 'reqHeaderId');
        v_bu   NUMBER := RR_PO_UTIL_PKG.jnum(o, 'businessUnitId');
        v_line NUMBER;
        v_type VARCHAR2(10); v_cat NUMBER; v_item NUMBER; v_desc VARCHAR2(240); v_uom VARCHAR2(10);
        v_qty  NUMBER; v_price NUMBER; v_amt NUMBER; v_cur VARCHAR2(15); v_rate NUMBER; v_tax VARCHAR2(50);
        v_req  VARCHAR2(150); v_acct VARCHAR2(200); v_pct NUMBER; v_dq NUMBER; v_da NUMBER;
        v_sum_q NUMBER; v_sum_a NUMBER; v_sum_p NUMBER;
    BEGIN
        IF v_id IS NULL THEN
            IF v_bu IS NULL THEN RR_PO_UTIL_PKG.err('Business unit is required'); END IF;
            op := RR_PO_UTIL_PKG.opt(v_bu);
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j1 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'description');
                j2 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'justification');
                j3 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'urgentFlag');
            BEGIN
                INSERT INTO RR_PO_REQ_HEADERS (BUSINESS_UNIT_ID, DESCRIPTION, JUSTIFICATION, PREPARER_USER, URGENT_FLAG,
                                               STATUS, FUNCTIONAL_CURRENCY, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                VALUES (v_bu, NVL(j1, 'Requisition'), j2,
                        p_user, NVL(j3, 'N'), 'INCOMPLETE', op.FUNCTIONAL_CURRENCY,
                        p_user, p_user, SYSTIMESTAMP)
                RETURNING REQ_HEADER_ID INTO v_id;
            END;
            RR_PO_UTIL_PKG.history('REQ', v_id, 'CREATE', NULL, 'INCOMPLETE', p_user);
            h := hdr(v_id);
        ELSE
            h := hdr(v_id);
            IF h.STATUS NOT IN ('INCOMPLETE', 'REJECTED') THEN
                RR_PO_UTIL_PKG.err('Only incomplete or rejected requisitions can be edited (status ' || h.STATUS || ')');
            END IF;
            op := RR_PO_UTIL_PKG.opt(h.BUSINESS_UNIT_ID);
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j4 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'description');
                j5 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'justification');
                j6 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'urgentFlag');
            BEGIN
                UPDATE RR_PO_REQ_HEADERS
                SET    DESCRIPTION = NVL(j4, DESCRIPTION),
                       JUSTIFICATION = j5,
                       URGENT_FLAG = NVL(j6, URGENT_FLAG),
                       STATUS = 'INCOMPLETE', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  REQ_HEADER_ID = v_id;
            END;
            DELETE FROM RR_PO_REQ_DISTRIBUTIONS WHERE REQ_LINE_ID IN (SELECT REQ_LINE_ID FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id);
            DELETE FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id;
        END IF;

        lines := RR_PO_UTIL_PKG.jarr(o, 'lines');
        FOR i IN 0 .. lines.get_size - 1 LOOP
            l := TREAT(lines.get(i) AS JSON_OBJECT_T);
            v_item := RR_PO_UTIL_PKG.jnum(l, 'expenseItemId');
            v_cat  := RR_PO_UTIL_PKG.jnum(l, 'categoryId');
            v_desc := RR_PO_UTIL_PKG.jstr(l, 'itemDescription');
            v_uom  := RR_PO_UTIL_PKG.jstr(l, 'uomCode');
            v_tax  := RR_PO_UTIL_PKG.jstr(l, 'taxCode');
            v_type := RR_PO_UTIL_PKG.jstr(l, 'lineType');
            IF v_item IS NOT NULL THEN
                FOR it IN (SELECT * FROM RR_PO_EXPENSE_ITEMS WHERE EXPENSE_ITEM_ID = v_item) LOOP
                    v_cat := NVL(v_cat, it.CATEGORY_ID); v_desc := NVL(v_desc, it.DESCRIPTION);
                    v_uom := NVL(v_uom, it.UOM_CODE); v_tax := NVL(v_tax, it.TAX_CODE); v_type := NVL(v_type, it.LINE_TYPE);
                END LOOP;
            END IF;
            IF v_cat IS NULL THEN RR_PO_UTIL_PKG.err('Line ' || (i + 1) || ': category is required'); END IF;
            FOR ct IN (SELECT DEFAULT_LINE_TYPE, DEFAULT_UOM, DEFAULT_TAX_CODE FROM RR_PO_V_CATEGORIES WHERE CATEGORY_ID = v_cat) LOOP
                v_type := NVL(v_type, ct.DEFAULT_LINE_TYPE); v_uom := NVL(v_uom, ct.DEFAULT_UOM); v_tax := NVL(v_tax, ct.DEFAULT_TAX_CODE);
            END LOOP;
            v_type := NVL(v_type, 'QUANTITY');
            IF v_desc IS NULL THEN RR_PO_UTIL_PKG.err('Line ' || (i + 1) || ': description is required'); END IF;
            v_qty := RR_PO_UTIL_PKG.jnum(l, 'quantity');
            v_price := RR_PO_UTIL_PKG.jnum(l, 'unitPrice');
            IF v_type = 'QUANTITY' THEN
                v_amt := ROUND(NVL(v_qty, 0) * NVL(v_price, 0), 2);
            ELSE
                v_amt := RR_PO_UTIL_PKG.jnum(l, 'amount'); v_qty := NULL; v_price := NULL; v_uom := NULL;
            END IF;
            v_cur := NVL(RR_PO_UTIL_PKG.jstr(l, 'currencyCode'), op.FUNCTIONAL_CURRENCY);
            v_rate := CASE WHEN v_cur = op.FUNCTIONAL_CURRENCY THEN 1
                           ELSE NVL(RR_PO_UTIL_PKG.jnum(l, 'rate'),
                                    RR_PO_UTIL_PKG.get_rate(v_cur, op.FUNCTIONAL_CURRENCY, op.DEFAULT_RATE_TYPE, SYSDATE)) END;
            IF v_rate IS NULL THEN
                RR_PO_UTIL_PKG.err('Line ' || (i + 1) || ': no ' || op.DEFAULT_RATE_TYPE || ' rate ' || v_cur || '→'
                                   || op.FUNCTIONAL_CURRENCY || ' — enter the rate');
            END IF;
            v_req := NVL(RR_PO_UTIL_PKG.jstr(l, 'requesterUser'), p_user);
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j7 DATE := RR_PO_UTIL_PKG.jdate(l, 'needByDate');
                j8 NUMBER := RR_PO_UTIL_PKG.jnum(l, 'deliverToLocationId');
                j9 NUMBER := RR_PO_UTIL_PKG.jnum(l, 'suggestedSupplierId');
                j10 NUMBER := RR_PO_UTIL_PKG.jnum(l, 'suggestedSupplierSiteId');
                j11 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(l, 'suggestedSupplierName');
                j12 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(l, 'supplierItemNum');
                j13 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(l, 'noteToBuyer');
            BEGIN
                INSERT INTO RR_PO_REQ_LINES (REQ_HEADER_ID, LINE_NUM, LINE_TYPE, EXPENSE_ITEM_ID, CATEGORY_ID, ITEM_DESCRIPTION,
                    UOM_CODE, QUANTITY, UNIT_PRICE, AMOUNT, CURRENCY_CODE, RATE_TYPE, RATE_DATE, RATE, AMOUNT_FUNC, TAX_CODE,
                    NEED_BY_DATE, DELIVER_TO_LOCATION_ID, REQUESTER_USER, SUGGESTED_SUPPLIER_ID, SUGGESTED_SUPPLIER_SITE_ID,
                    SUGGESTED_SUPPLIER_NAME, SUPPLIER_ITEM_NUM, NOTE_TO_BUYER, LINE_STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                VALUES (v_id, i + 1, v_type, v_item, v_cat, v_desc, v_uom, v_qty, v_price, NVL(v_amt, 0), v_cur,
                    op.DEFAULT_RATE_TYPE, TRUNC(SYSDATE), v_rate, ROUND(NVL(v_amt, 0) * v_rate, 2), v_tax,
                    NVL(j7, TRUNC(SYSDATE) + 7), j8,
                    v_req, j9, j10,
                    j11, j12,
                    j13, 'OPEN', p_user, p_user, SYSTIMESTAMP)
                RETURNING REQ_LINE_ID INTO v_line;
            END;

            -- distributions: given split, else one 100 % line with the derived account
            dists := RR_PO_UTIL_PKG.jarr(l, 'distributions');
            IF dists.get_size = 0 THEN
                d := JSON_OBJECT_T();
                d.put('percent', 100);
                d.put('chargeAccount', NVL(RR_PO_UTIL_PKG.jstr(l, 'chargeAccount'),
                                           RR_PO_UTIL_PKG.derive_account(h.BUSINESS_UNIT_ID, v_req, v_cat, v_item)));
                dists.append(d);
            END IF;
            v_sum_q := 0; v_sum_a := 0; v_sum_p := 0;
            FOR j IN 0 .. dists.get_size - 1 LOOP
                d := TREAT(dists.get(j) AS JSON_OBJECT_T);
                v_pct := NVL(RR_PO_UTIL_PKG.jnum(d, 'percent'), 100);
                v_acct := NVL(RR_PO_UTIL_PKG.jstr(d, 'chargeAccount'), RR_PO_UTIL_PKG.derive_account(h.BUSINESS_UNIT_ID, v_req, v_cat, v_item));
                IF v_acct IS NULL THEN
                    RR_PO_UTIL_PKG.err('Line ' || (i + 1) || ': no charge account — enter it, or set requester defaults for ' || v_req);
                END IF;
                IF j = dists.get_size - 1 THEN
                    v_da := NVL(v_amt, 0) - v_sum_a; v_dq := CASE WHEN v_qty IS NOT NULL THEN v_qty - v_sum_q END;
                ELSE
                    v_da := ROUND(NVL(v_amt, 0) * v_pct / 100, 2); v_dq := CASE WHEN v_qty IS NOT NULL THEN ROUND(v_qty * v_pct / 100, 6) END;
                END IF;
                v_sum_a := v_sum_a + v_da; v_sum_q := v_sum_q + NVL(v_dq, 0); v_sum_p := v_sum_p + v_pct;
                DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                    j14 DATE := RR_PO_UTIL_PKG.jdate(l, 'needByDate');
                BEGIN
                    INSERT INTO RR_PO_REQ_DISTRIBUTIONS (REQ_LINE_ID, DIST_NUM, PERCENT, QUANTITY, AMOUNT, CHARGE_ACCOUNT, BUDGET_DATE,
                                                         CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                    VALUES (v_line, j + 1, v_pct, v_dq, v_da, v_acct,
                            NVL(j14, TRUNC(SYSDATE) + 7), p_user, p_user, SYSTIMESTAMP);
                END;
            END LOOP;
            IF ABS(v_sum_p - 100) > 0.0001 THEN RR_PO_UTIL_PKG.err('Line ' || (i + 1) || ': distribution percentages must total 100'); END IF;
        END LOOP;
        recalc(v_id);
        h := hdr(v_id, FALSE);
        p_id := v_id; p_number := NVL(h.REQ_NUMBER, 'Draft #' || v_id); p_status := 'S'; p_message := 'Requisition saved';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE assign_buyers (p_req_header_id IN NUMBER, p_bu IN NUMBER) IS
        v_buyer NUMBER;
    BEGIN
        FOR l IN (SELECT REQ_LINE_ID, CATEGORY_ID FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = p_req_header_id AND BUYER_ID IS NULL) LOOP
            SELECT MAX(BUYER_ID) KEEP (DENSE_RANK FIRST ORDER BY
                       CASE WHEN CATEGORY_ID IS NOT NULL THEN 0 ELSE 1 END,
                       CASE WHEN BUSINESS_UNIT_ID IS NOT NULL THEN 0 ELSE 1 END,
                       CASE WHEN DEFAULT_FLAG = 'Y' THEN 0 ELSE 1 END)
            INTO   v_buyer
            FROM   RR_PO_BUYERS b
            WHERE  b.STATUS = 'ACTIVE'
            AND    (b.BUSINESS_UNIT_ID IS NULL OR b.BUSINESS_UNIT_ID = p_bu)
            AND    (b.CATEGORY_ID IS NULL OR b.CATEGORY_ID IN (
                        SELECT CATEGORY_ID FROM RR_PO_CATEGORIES START WITH CATEGORY_ID = l.CATEGORY_ID
                        CONNECT BY NOCYCLE PRIOR PARENT_CATEGORY_ID = CATEGORY_ID))
            AND    (b.CATEGORY_ID IS NOT NULL OR b.DEFAULT_FLAG = 'Y' OR b.BUSINESS_UNIT_ID IS NOT NULL);
            IF v_buyer IS NOT NULL THEN
                UPDATE RR_PO_REQ_LINES SET BUYER_ID = v_buyer WHERE REQ_LINE_ID = l.REQ_LINE_ID;
            END IF;
        END LOOP;
    END;

    PROCEDURE approve_internal (p_req_header_id IN NUMBER, p_user IN VARCHAR2) IS
        h RR_PO_REQ_HEADERS%ROWTYPE := hdr(p_req_header_id);
    BEGIN
        UPDATE RR_PO_REQ_HEADERS SET STATUS = 'APPROVED', APPROVED_DATE = TRUNC(SYSDATE),
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  REQ_HEADER_ID = p_req_header_id;
        assign_buyers(p_req_header_id, h.BUSINESS_UNIT_ID);
        RR_PO_UTIL_PKG.history('REQ', p_req_header_id, 'APPROVE', h.STATUS, 'APPROVED', p_user);
    END;

    PROCEDURE SUBMIT (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id NUMBER := RR_PO_UTIL_PKG.to_num(p_req_header_id);
        h    RR_PO_REQ_HEADERS%ROWTYPE;
        op   RR_PO_BU_OPTIONS%ROWTYPE;
        v_n  NUMBER;
        v_e  VARCHAR2(400);
        v_req NUMBER;
    BEGIN
        h := hdr(v_id);
        IF h.STATUS NOT IN ('INCOMPLETE', 'REJECTED') THEN RR_PO_UTIL_PKG.err('Requisition is ' || h.STATUS); END IF;
        op := RR_PO_UTIL_PKG.opt(h.BUSINESS_UNIT_ID);
        SELECT COUNT(*) INTO v_n FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id;
        IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Add at least one line'); END IF;
        FOR l IN (SELECT l.*, c.STATUS cat_status FROM RR_PO_REQ_LINES l LEFT JOIN RR_PO_CATEGORIES c ON c.CATEGORY_ID = l.CATEGORY_ID
                  WHERE l.REQ_HEADER_ID = v_id ORDER BY l.LINE_NUM) LOOP
            IF NVL(l.cat_status, 'INACTIVE') <> 'ACTIVE' THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': category is not active'); END IF;
            IF l.NEED_BY_DATE < TRUNC(SYSDATE) THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': need-by date is in the past'); END IF;
            IF l.AMOUNT <= 0 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': amount must be greater than zero'); END IF;
            IF l.LINE_TYPE = 'QUANTITY' AND (l.UOM_CODE IS NULL OR NVL(l.QUANTITY, 0) <= 0 OR NVL(l.UNIT_PRICE, -1) < 0) THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': unit of measure, quantity and price are required');
            END IF;
            FOR d IN (SELECT CHARGE_ACCOUNT FROM RR_PO_REQ_DISTRIBUTIONS WHERE REQ_LINE_ID = l.REQ_LINE_ID) LOOP
                v_e := RR_PO_UTIL_PKG.account_error(d.CHARGE_ACCOUNT, h.BUSINESS_UNIT_ID);
                IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': ' || v_e); END IF;
            END LOOP;
        END LOOP;
        recalc(v_id);
        h := hdr(v_id);
        IF h.REQ_NUMBER IS NULL THEN
            h.REQ_NUMBER := RR_PO_UTIL_PKG.next_number(h.BUSINESS_UNIT_ID, 'REQ');
        END IF;
        UPDATE RR_PO_REQ_HEADERS SET REQ_NUMBER = h.REQ_NUMBER, SUBMITTED_DATE = TRUNC(SYSDATE),
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP WHERE REQ_HEADER_ID = v_id;
        IF op.REQ_APPROVAL_REQUIRED = 'N' THEN
            approve_internal(v_id, p_user);
            p_message := 'Requisition ' || h.REQ_NUMBER || ' approved (approval not required)';
        ELSE
            v_req := RR_PO_APPROVAL_PKG.request('REQUISITION', v_id, NULL, h.REQ_NUMBER, h.TOTAL_AMOUNT_FUNC,
                                                h.FUNCTIONAL_CURRENCY, h.BUSINESS_UNIT_ID, h.DESCRIPTION, p_user);
            IF v_req IS NULL THEN
                RR_PO_UTIL_PKG.err('No approval rule for PROCUREMENT / REQUISITION covering ' || h.FUNCTIONAL_CURRENCY || ' '
                    || TO_CHAR(h.TOTAL_AMOUNT_FUNC, 'FM999,999,999,990.00')
                    || ' — add one in Approvals › Rules, or set "Requisition approval required" = N in Purchasing Options');
            END IF;
            UPDATE RR_PO_REQ_HEADERS SET STATUS = 'PENDING_APPROVAL', APPROVAL_REQUEST_ID = v_req WHERE REQ_HEADER_ID = v_id;
            RR_PO_UTIL_PKG.history('REQ', v_id, 'SUBMIT', h.STATUS, 'PENDING_APPROVAL', p_user);
            p_message := 'Requisition ' || h.REQ_NUMBER || ' submitted for approval';
        END IF;
        p_id := v_id; p_number := h.REQ_NUMBER; p_status := 'S';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE WITHDRAW (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id NUMBER := RR_PO_UTIL_PKG.to_num(p_req_header_id);
        h    RR_PO_REQ_HEADERS%ROWTYPE := hdr(v_id);
    BEGIN
        IF h.STATUS <> 'PENDING_APPROVAL' THEN RR_PO_UTIL_PKG.err('Only requisitions pending approval can be withdrawn'); END IF;
        RR_PO_APPROVAL_PKG.recall(h.APPROVAL_REQUEST_ID, p_user);
        UPDATE RR_PO_REQ_HEADERS SET STATUS = 'INCOMPLETE', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  REQ_HEADER_ID = v_id;
        RR_PO_UTIL_PKG.history('REQ', v_id, 'WITHDRAW', 'PENDING_APPROVAL', 'INCOMPLETE', p_user);
        p_id := v_id; p_number := h.REQ_NUMBER; p_status := 'S'; p_message := 'Withdrawn — you can edit and resubmit';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE CANCEL (p_req_header_id IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id NUMBER := RR_PO_UTIL_PKG.to_num(p_req_header_id);
        h    RR_PO_REQ_HEADERS%ROWTYPE := hdr(v_id);
        v_on NUMBER;
    BEGIN
        IF h.STATUS = 'CANCELLED' THEN RR_PO_UTIL_PKG.err('Already cancelled'); END IF;
        IF h.STATUS = 'PENDING_APPROVAL' THEN RR_PO_APPROVAL_PKG.recall(h.APPROVAL_REQUEST_ID, p_user); END IF;
        UPDATE RR_PO_REQ_LINES SET LINE_STATUS = 'CANCELLED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  REQ_HEADER_ID = v_id AND LINE_STATUS IN ('OPEN', 'RETURNED');
        SELECT COUNT(*) INTO v_on FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id AND LINE_STATUS = 'ON_PO';
        IF v_on = 0 THEN
            UPDATE RR_PO_REQ_HEADERS SET STATUS = 'CANCELLED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE REQ_HEADER_ID = v_id;
        END IF;
        recalc(v_id);
        RR_PO_UTIL_PKG.history('REQ', v_id, 'CANCEL', h.STATUS, CASE WHEN v_on = 0 THEN 'CANCELLED' ELSE h.STATUS END, p_user, p_reason);
        p_id := v_id; p_number := h.REQ_NUMBER; p_status := 'S';
        p_message := CASE WHEN v_on = 0 THEN 'Requisition cancelled' ELSE 'Open lines cancelled; ' || v_on || ' line(s) already on a PO stay' END;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE DELETE_DRAFT (p_req_header_id IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id NUMBER := RR_PO_UTIL_PKG.to_num(p_req_header_id);
        h    RR_PO_REQ_HEADERS%ROWTYPE := hdr(v_id);
    BEGIN
        IF h.STATUS <> 'INCOMPLETE' OR h.SUBMITTED_DATE IS NOT NULL THEN
            RR_PO_UTIL_PKG.err('Only drafts that were never submitted can be deleted — cancel it instead');
        END IF;
        DELETE FROM RR_PO_REQ_DISTRIBUTIONS WHERE REQ_LINE_ID IN (SELECT REQ_LINE_ID FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id);
        DELETE FROM RR_PO_REQ_LINES WHERE REQ_HEADER_ID = v_id;
        DELETE FROM RR_PO_REQ_HEADERS WHERE REQ_HEADER_ID = v_id;
        p_id := v_id; p_status := 'S'; p_message := 'Draft deleted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE RETURN_LINES (p_req_line_ids IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_n NUMBER := 0;
    BEGIN
        IF TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required'); END IF;
        FOR l IN (SELECT l.REQ_LINE_ID, l.REQ_HEADER_ID, l.LINE_STATUS, h.STATUS
                  FROM RR_PO_REQ_LINES l JOIN RR_PO_REQ_HEADERS h ON h.REQ_HEADER_ID = l.REQ_HEADER_ID
                  WHERE l.REQ_LINE_ID IN (SELECT RR_PO_UTIL_PKG.to_num(REGEXP_SUBSTR(p_req_line_ids, '[^,]+', 1, LEVEL)) FROM dual
                                          CONNECT BY LEVEL <= REGEXP_COUNT(p_req_line_ids, ',') + 1)
                  FOR UPDATE OF l.LINE_STATUS) LOOP
            IF l.STATUS <> 'APPROVED' OR l.LINE_STATUS <> 'OPEN' THEN
                RR_PO_UTIL_PKG.err('Only open lines of approved requisitions can be returned');
            END IF;
            UPDATE RR_PO_REQ_LINES SET LINE_STATUS = 'RETURNED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE REQ_LINE_ID = l.REQ_LINE_ID;
            RR_PO_UTIL_PKG.history('REQ', l.REQ_HEADER_ID, 'RETURN_LINE', 'OPEN', 'RETURNED', p_user, p_reason);
            v_n := v_n + 1;
        END LOOP;
        p_id := v_n; p_status := 'S'; p_message := v_n || ' line(s) returned to the requester';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_REQ_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_DOC_PKG — purchase orders
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_DOC_PKG AS

    FUNCTION hdr (p_id IN NUMBER, p_lock IN BOOLEAN DEFAULT TRUE) RETURN RR_PO_HEADERS%ROWTYPE IS
        r RR_PO_HEADERS%ROWTYPE;
    BEGIN
        IF p_lock THEN SELECT * INTO r FROM RR_PO_HEADERS WHERE PO_HEADER_ID = p_id FOR UPDATE;
        ELSE SELECT * INTO r FROM RR_PO_HEADERS WHERE PO_HEADER_ID = p_id; END IF;
        RETURN r;
    EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Purchase order ' || p_id || ' not found'); RETURN r;
    END;

    -- totals: ordered net of cancellations; tax estimate from the line tax codes
    PROCEDURE recalc (p_id IN NUMBER) IS
    BEGIN
        UPDATE RR_PO_HEADERS h
        SET    TOTAL_AMOUNT = NVL((SELECT SUM(s.AMOUNT - s.AMOUNT_CANCELLED) FROM RR_PO_SCHEDULES s WHERE s.PO_HEADER_ID = h.PO_HEADER_ID), 0),
               TOTAL_TAX_ESTIMATE = NVL((SELECT SUM(ROUND((s.AMOUNT - s.AMOUNT_CANCELLED) * RR_PO_UTIL_PKG.tax_rate(NVL(s.TAX_CODE, l.TAX_CODE)) / 100, 2))
                                         FROM RR_PO_SCHEDULES s JOIN RR_PO_LINES l ON l.PO_LINE_ID = s.PO_LINE_ID
                                         WHERE s.PO_HEADER_ID = h.PO_HEADER_ID), 0)
        WHERE  PO_HEADER_ID = p_id;
        UPDATE RR_PO_HEADERS SET TOTAL_AMOUNT_FUNC = ROUND(TOTAL_AMOUNT * RATE, 2) WHERE PO_HEADER_ID = p_id;
    END;

    -- the "measure" of a line: quantity for quantity lines, amount for amount lines
    PROCEDURE rollup_schedule (p_schedule_id IN NUMBER) IS
        s       RR_PO_SCHEDULES%ROWTYPE;
        v_type  VARCHAR2(10);
        v_ord   NUMBER; v_can NUMBER; v_rcv NUMBER; v_bil NUMBER; v_net NUMBER; v_basis NUMBER;
        v_rdone BOOLEAN; v_idone BOOLEAN;
        v_new   VARCHAR2(25);
    BEGIN
        SELECT * INTO s FROM RR_PO_SCHEDULES WHERE SCHEDULE_ID = p_schedule_id FOR UPDATE;
        SELECT LINE_TYPE INTO v_type FROM RR_PO_LINES WHERE PO_LINE_ID = s.PO_LINE_ID;
        -- schedule counters are the sums of their distributions
        UPDATE RR_PO_SCHEDULES sc
        SET   (QUANTITY_RECEIVED, AMOUNT_RECEIVED, QUANTITY_BILLED, AMOUNT_BILLED, QUANTITY_CANCELLED, AMOUNT_CANCELLED) =
              (SELECT NVL(SUM(QUANTITY_DELIVERED), 0), NVL(SUM(AMOUNT_DELIVERED), 0), NVL(SUM(QUANTITY_BILLED), 0),
                      NVL(SUM(AMOUNT_BILLED), 0), NVL(SUM(QUANTITY_CANCELLED), 0), NVL(SUM(AMOUNT_CANCELLED), 0)
               FROM RR_PO_DISTRIBUTIONS d WHERE d.SCHEDULE_ID = sc.SCHEDULE_ID)
        WHERE  SCHEDULE_ID = p_schedule_id
        RETURNING QUANTITY_RECEIVED, AMOUNT_RECEIVED, QUANTITY_BILLED, AMOUNT_BILLED, QUANTITY_CANCELLED, AMOUNT_CANCELLED
        INTO s.QUANTITY_RECEIVED, s.AMOUNT_RECEIVED, s.QUANTITY_BILLED, s.AMOUNT_BILLED, s.QUANTITY_CANCELLED, s.AMOUNT_CANCELLED;
        IF s.CLOSURE_STATUS = 'FINALLY_CLOSED' THEN RETURN; END IF;
        IF v_type = 'QUANTITY' THEN
            v_ord := NVL(s.QUANTITY, 0); v_can := s.QUANTITY_CANCELLED; v_rcv := s.QUANTITY_RECEIVED; v_bil := s.QUANTITY_BILLED;
        ELSE
            v_ord := s.AMOUNT; v_can := s.AMOUNT_CANCELLED; v_rcv := s.AMOUNT_RECEIVED; v_bil := s.AMOUNT_BILLED;
        END IF;
        v_net := v_ord - v_can;
        v_basis := CASE WHEN NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'THREE_WAY' THEN v_rcv ELSE v_net END;
        v_rdone := v_rcv >= v_net * (1 - NVL(s.RCV_CLOSE_TOL_PCT, 0) / 100)
                   OR (NVL(s.MATCH_LEVEL, 'TWO_WAY') = 'TWO_WAY' AND v_bil >= v_net * (1 - NVL(s.RCV_CLOSE_TOL_PCT, 0) / 100) AND v_bil > 0);
        v_idone := (v_basis > 0 AND v_bil >= v_basis * (1 - NVL(s.INV_CLOSE_TOL_PCT, 0) / 100)) OR v_net <= 0;
        IF v_net <= 0 THEN
            v_new := 'CLOSED';
        ELSIF s.MANUAL_CLOSE_FLAG = 'Y' THEN
            v_new := 'CLOSED';
        ELSIF v_rdone AND v_idone THEN v_new := 'CLOSED';
        ELSIF v_rdone THEN v_new := 'CLOSED_FOR_RECEIVING';
        ELSIF v_idone AND v_rcv > 0 THEN v_new := 'CLOSED_FOR_INVOICING';
        ELSE v_new := 'OPEN';
        END IF;
        UPDATE RR_PO_SCHEDULES
        SET    CLOSURE_STATUS = v_new,
               CANCELLED_FLAG = CASE WHEN v_net <= 0 AND v_can > 0 THEN 'Y' ELSE 'N' END
        WHERE  SCHEDULE_ID = p_schedule_id;
    END;

    PROCEDURE rollup_header (p_po_header_id IN NUMBER) IS
        v_status VARCHAR2(25);
    BEGIN
        -- line status: cancelled when every schedule is cancelled, closed when every live schedule is closed
        UPDATE RR_PO_LINES l
        SET    LINE_STATUS = CASE
                   WHEN NOT EXISTS (SELECT 1 FROM RR_PO_SCHEDULES s WHERE s.PO_LINE_ID = l.PO_LINE_ID AND s.CANCELLED_FLAG = 'N') THEN 'CANCELLED'
                   WHEN NOT EXISTS (SELECT 1 FROM RR_PO_SCHEDULES s WHERE s.PO_LINE_ID = l.PO_LINE_ID AND s.CANCELLED_FLAG = 'N'
                                    AND s.CLOSURE_STATUS NOT IN ('CLOSED', 'FINALLY_CLOSED')) THEN 'CLOSED'
                   ELSE 'OPEN' END
        WHERE  PO_HEADER_ID = p_po_header_id;
        -- header closure = least closed live schedule
        SELECT CASE MIN(CASE CLOSURE_STATUS WHEN 'OPEN' THEN 1 WHEN 'CLOSED_FOR_RECEIVING' THEN 2
                            WHEN 'CLOSED_FOR_INVOICING' THEN 2 WHEN 'CLOSED' THEN 4 WHEN 'FINALLY_CLOSED' THEN 5 END)
                   WHEN 1 THEN 'OPEN' WHEN 4 THEN 'CLOSED' WHEN 5 THEN 'FINALLY_CLOSED'
                   WHEN 2 THEN CASE WHEN COUNT(CASE WHEN CLOSURE_STATUS = 'CLOSED_FOR_INVOICING' THEN 1 END) > 0
                                     AND COUNT(CASE WHEN CLOSURE_STATUS = 'CLOSED_FOR_RECEIVING' THEN 1 END) = 0
                                    THEN 'CLOSED_FOR_INVOICING' ELSE 'CLOSED_FOR_RECEIVING' END
                   ELSE 'CLOSED' END
        INTO   v_status
        FROM   RR_PO_SCHEDULES WHERE PO_HEADER_ID = p_po_header_id AND CANCELLED_FLAG = 'N';
        UPDATE RR_PO_HEADERS SET CLOSURE_STATUS = NVL(v_status, 'CLOSED') WHERE PO_HEADER_ID = p_po_header_id;
        recalc(p_po_header_id);
    END;

    -- freeze matching / accrual settings and accounts on the schedules and distributions (at submit)
    PROCEDURE freeze (p_po_header_id IN NUMBER) IS
        h  RR_PO_HEADERS%ROWTYPE := hdr(p_po_header_id, FALSE);
        op RR_PO_BU_OPTIONS%ROWTYPE := RR_PO_UTIL_PKG.opt(h.BUSINESS_UNIT_ID);
        so RR_PO_SUPPLIER_SITE_OPTIONS%ROWTYPE;
    BEGIN
        BEGIN SELECT * INTO so FROM RR_PO_SUPPLIER_SITE_OPTIONS WHERE SUPPLIER_SITE_ID = h.SUPPLIER_SITE_ID;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL; END;
        IF op.ACCRUE_AT_RECEIPT_FLAG = 'Y' AND op.RECEIPT_ACCRUAL_ACCOUNT IS NULL THEN
            RR_PO_UTIL_PKG.err('Set the receipt accrual (GRNI) account in Purchasing Options before submitting');
        END IF;
        FOR s IN (SELECT s.SCHEDULE_ID, l.LINE_TYPE, c.RECEIPT_REQUIRED_FLAG
                  FROM RR_PO_SCHEDULES s JOIN RR_PO_LINES l ON l.PO_LINE_ID = s.PO_LINE_ID
                  LEFT JOIN RR_PO_CATEGORIES c ON c.CATEGORY_ID = l.CATEGORY_ID
                  WHERE s.PO_HEADER_ID = p_po_header_id AND s.MATCH_LEVEL IS NULL) LOOP
            UPDATE RR_PO_SCHEDULES
            SET    MATCH_LEVEL = CASE WHEN s.RECEIPT_REQUIRED_FLAG = 'Y' THEN 'THREE_WAY'
                                      ELSE NVL(so.MATCH_LEVEL, CASE WHEN s.LINE_TYPE = 'QUANTITY' THEN op.MATCH_LEVEL_QUANTITY ELSE op.MATCH_LEVEL_AMOUNT END) END,
                   ACCRUE_AT_RECEIPT_FLAG = op.ACCRUE_AT_RECEIPT_FLAG,
                   OVER_RECEIPT_TOL_PCT = op.OVER_RECEIPT_TOLERANCE_PCT,
                   OVER_RECEIPT_ACTION  = op.OVER_RECEIPT_ACTION,
                   INV_QTY_TOL_PCT      = NVL(so.INVOICE_QTY_TOLERANCE_PCT, op.INVOICE_QTY_TOLERANCE_PCT),
                   INV_PRICE_TOL_PCT    = NVL(so.INVOICE_PRICE_TOLERANCE_PCT, op.INVOICE_PRICE_TOLERANCE_PCT),
                   RCV_CLOSE_TOL_PCT    = op.RECEIPT_CLOSE_TOLERANCE_PCT,
                   INV_CLOSE_TOL_PCT    = op.INVOICE_CLOSE_TOLERANCE_PCT
            WHERE  SCHEDULE_ID = s.SCHEDULE_ID;
        END LOOP;
        UPDATE RR_PO_DISTRIBUTIONS
        SET    ACCRUAL_ACCOUNT  = NVL(ACCRUAL_ACCOUNT, op.RECEIPT_ACCRUAL_ACCOUNT),
               VARIANCE_ACCOUNT = NVL(VARIANCE_ACCOUNT, NVL(op.PRICE_VARIANCE_ACCOUNT, CHARGE_ACCOUNT)),
               RATE             = h.RATE
        WHERE  PO_HEADER_ID = p_po_header_id AND QUANTITY_DELIVERED = 0 AND AMOUNT_DELIVERED = 0;
    END;

    -- insert one PO line (+ one schedule + distributions) from a JSON line object
    FUNCTION insert_line (h IN RR_PO_HEADERS%ROWTYPE, p_line_num IN NUMBER, l IN JSON_OBJECT_T, p_user IN VARCHAR2) RETURN NUMBER IS
        dists  JSON_ARRAY_T;
        d      JSON_OBJECT_T;
        rq     JSON_ARRAY_T;
        v_line NUMBER; v_sched NUMBER;
        v_type VARCHAR2(10); v_cat NUMBER; v_item NUMBER; v_desc VARCHAR2(240); v_uom VARCHAR2(10);
        v_qty  NUMBER; v_price NUMBER; v_amt NUMBER; v_tax VARCHAR2(50); v_capex VARCHAR2(1);
        v_req  VARCHAR2(150); v_acct VARCHAR2(200); v_pct NUMBER; v_dq NUMBER; v_da NUMBER;
        v_sum_q NUMBER := 0; v_sum_a NUMBER := 0; v_sum_p NUMBER := 0;
        v_need DATE;
        v_rq_id NUMBER;
    BEGIN
        v_item := RR_PO_UTIL_PKG.jnum(l, 'expenseItemId');
        v_cat  := RR_PO_UTIL_PKG.jnum(l, 'categoryId');
        v_desc := RR_PO_UTIL_PKG.jstr(l, 'itemDescription');
        v_uom  := RR_PO_UTIL_PKG.jstr(l, 'uomCode');
        v_tax  := RR_PO_UTIL_PKG.jstr(l, 'taxCode');
        v_type := RR_PO_UTIL_PKG.jstr(l, 'lineType');
        IF v_item IS NOT NULL THEN
            FOR it IN (SELECT * FROM RR_PO_EXPENSE_ITEMS WHERE EXPENSE_ITEM_ID = v_item) LOOP
                v_cat := NVL(v_cat, it.CATEGORY_ID); v_desc := NVL(v_desc, it.DESCRIPTION);
                v_uom := NVL(v_uom, it.UOM_CODE); v_tax := NVL(v_tax, it.TAX_CODE); v_type := NVL(v_type, it.LINE_TYPE);
            END LOOP;
        END IF;
        IF v_cat IS NULL THEN RR_PO_UTIL_PKG.err('Line ' || p_line_num || ': category is required'); END IF;
        v_capex := 'N';
        FOR ct IN (SELECT DEFAULT_LINE_TYPE, DEFAULT_UOM, DEFAULT_TAX_CODE, CAPEX_FLAG FROM RR_PO_V_CATEGORIES WHERE CATEGORY_ID = v_cat) LOOP
            v_type := NVL(v_type, ct.DEFAULT_LINE_TYPE); v_uom := NVL(v_uom, ct.DEFAULT_UOM);
            v_tax := NVL(v_tax, ct.DEFAULT_TAX_CODE); v_capex := ct.CAPEX_FLAG;
        END LOOP;
        v_type := NVL(v_type, 'QUANTITY');
        IF v_desc IS NULL THEN RR_PO_UTIL_PKG.err('Line ' || p_line_num || ': description is required'); END IF;
        v_qty := RR_PO_UTIL_PKG.jnum(l, 'quantity');
        v_price := RR_PO_UTIL_PKG.jnum(l, 'unitPrice');
        IF v_type = 'QUANTITY' THEN v_amt := ROUND(NVL(v_qty, 0) * NVL(v_price, 0), 2);
        ELSE v_amt := NVL(RR_PO_UTIL_PKG.jnum(l, 'amount'), 0); v_qty := NULL; v_price := NULL; v_uom := NULL;
        END IF;
        v_need := NVL(RR_PO_UTIL_PKG.jdate(l, 'needByDate'), TRUNC(SYSDATE) + 7);
        DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
            j15 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(l, 'supplierItemNum');
            j16 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(l, 'noteToSupplier');
        BEGIN
            INSERT INTO RR_PO_LINES (PO_HEADER_ID, LINE_NUM, LINE_TYPE, EXPENSE_ITEM_ID, CATEGORY_ID, ITEM_DESCRIPTION,
                SUPPLIER_ITEM_NUM, UOM_CODE, QUANTITY, UNIT_PRICE, AMOUNT, TAX_CODE, LINE_STATUS, CAPEX_FLAG, NOTE_TO_SUPPLIER,
                CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            VALUES (h.PO_HEADER_ID, p_line_num, v_type, v_item, v_cat, v_desc, j15, v_uom,
                v_qty, v_price, v_amt, v_tax, 'OPEN', NVL(v_capex, 'N'), j16,
                p_user, p_user, SYSTIMESTAMP)
            RETURNING PO_LINE_ID INTO v_line;
        END;
        DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
            j17 NUMBER := RR_PO_UTIL_PKG.jnum(l, 'shipToLocationId');
            j18 DATE := RR_PO_UTIL_PKG.jdate(l, 'promisedDate');
        BEGIN
            INSERT INTO RR_PO_SCHEDULES (PO_LINE_ID, PO_HEADER_ID, SCHEDULE_NUM, SHIP_TO_LOCATION_ID, NEED_BY_DATE, PROMISED_DATE,
                QUANTITY, AMOUNT, TAX_CODE, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            VALUES (v_line, h.PO_HEADER_ID, 1, NVL(j17, h.SHIP_TO_LOCATION_ID), v_need,
                j18, v_qty, v_amt, v_tax, p_user, p_user, SYSTIMESTAMP)
            RETURNING SCHEDULE_ID INTO v_sched;
        END;

        v_req := NVL(RR_PO_UTIL_PKG.jstr(l, 'requesterUser'), p_user);
        dists := RR_PO_UTIL_PKG.jarr(l, 'distributions');
        IF dists.get_size = 0 THEN
            d := JSON_OBJECT_T();
            d.put('percent', 100);
            IF RR_PO_UTIL_PKG.jstr(l, 'chargeAccount') IS NOT NULL THEN d.put('chargeAccount', RR_PO_UTIL_PKG.jstr(l, 'chargeAccount')); END IF;
            dists.append(d);
        END IF;
        FOR j IN 0 .. dists.get_size - 1 LOOP
            d := TREAT(dists.get(j) AS JSON_OBJECT_T);
            v_pct := NVL(RR_PO_UTIL_PKG.jnum(d, 'percent'), 100);
            v_acct := NVL(RR_PO_UTIL_PKG.jstr(d, 'chargeAccount'),
                          RR_PO_UTIL_PKG.derive_account(h.BUSINESS_UNIT_ID, NVL(RR_PO_UTIL_PKG.jstr(d, 'requesterUser'), v_req), v_cat, v_item));
            IF v_acct IS NULL THEN
                RR_PO_UTIL_PKG.err('Line ' || p_line_num || ': no charge account — enter it, or set requester defaults for ' || v_req);
            END IF;
            IF j = dists.get_size - 1 THEN
                v_da := v_amt - v_sum_a; v_dq := CASE WHEN v_qty IS NOT NULL THEN v_qty - v_sum_q END;
            ELSE
                v_da := ROUND(v_amt * v_pct / 100, 2); v_dq := CASE WHEN v_qty IS NOT NULL THEN ROUND(v_qty * v_pct / 100, 6) END;
            END IF;
            v_sum_a := v_sum_a + v_da; v_sum_q := v_sum_q + NVL(v_dq, 0); v_sum_p := v_sum_p + v_pct;
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j19 NUMBER := RR_PO_UTIL_PKG.jnum(d, 'reqDistributionId');
                j20 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(d, 'requesterUser');
                j21 NUMBER := RR_PO_UTIL_PKG.jnum(d, 'deliverToLocationId');
                j22 NUMBER := RR_PO_UTIL_PKG.jnum(l, 'shipToLocationId');
            BEGIN
                INSERT INTO RR_PO_DISTRIBUTIONS (SCHEDULE_ID, PO_LINE_ID, PO_HEADER_ID, DIST_NUM, PERCENT, QUANTITY_ORDERED, AMOUNT_ORDERED,
                    CHARGE_ACCOUNT, RATE, BUDGET_DATE, REQ_DISTRIBUTION_ID, REQUESTER_USER, DELIVER_TO_LOCATION_ID,
                    CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                VALUES (v_sched, v_line, h.PO_HEADER_ID, j + 1, v_pct, v_dq, v_da, v_acct, h.RATE, v_need,
                    j19, NVL(j20, v_req),
                    NVL(j21, j22),
                    p_user, p_user, SYSTIMESTAMP);
            END;
        END LOOP;
        IF ABS(v_sum_p - 100) > 0.0001 THEN RR_PO_UTIL_PKG.err('Line ' || p_line_num || ': distribution percentages must total 100'); END IF;
        -- requisition lines placed on this PO line
        rq := RR_PO_UTIL_PKG.jarr(l, 'reqLineIds');
        FOR j IN 0 .. rq.get_size - 1 LOOP
            v_rq_id := rq.get_number(j);   -- object methods cannot be called inside SQL
            UPDATE RR_PO_REQ_LINES SET LINE_STATUS = 'ON_PO', PO_LINE_ID = v_line, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE REQ_LINE_ID = v_rq_id;
        END LOOP;
        RETURN v_line;
    END;

    -- requisition lines linked to PO lines go back to the buyer pool (or are cancelled)
    PROCEDURE release_req_lines (p_po_header_id IN NUMBER, p_po_line_id IN NUMBER, p_recreate IN VARCHAR2, p_user IN VARCHAR2) IS
    BEGIN
        UPDATE RR_PO_REQ_LINES
        SET    LINE_STATUS = CASE WHEN NVL(p_recreate, 'Y') = 'Y' THEN 'OPEN' ELSE 'CANCELLED' END,
               PO_LINE_ID = CASE WHEN NVL(p_recreate, 'Y') = 'Y' THEN NULL ELSE PO_LINE_ID END,
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  PO_LINE_ID IN (SELECT PO_LINE_ID FROM RR_PO_LINES
                              WHERE PO_HEADER_ID = p_po_header_id AND (p_po_line_id IS NULL OR PO_LINE_ID = p_po_line_id));
    END;

    PROCEDURE delete_lines (p_po_header_id IN NUMBER) IS
    BEGIN
        release_req_lines(p_po_header_id, NULL, 'Y', 'SYSTEM');
        DELETE FROM RR_PO_DISTRIBUTIONS WHERE PO_HEADER_ID = p_po_header_id;
        DELETE FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = p_po_header_id;
        DELETE FROM RR_PO_LINES WHERE PO_HEADER_ID = p_po_header_id;
    END;

    FUNCTION header_rate (p_cur IN VARCHAR2, p_rate IN NUMBER, op IN RR_PO_BU_OPTIONS%ROWTYPE, p_type IN VARCHAR2, p_date IN DATE) RETURN NUMBER IS
        v NUMBER;
    BEGIN
        IF p_cur = op.FUNCTIONAL_CURRENCY THEN RETURN 1; END IF;
        v := NVL(p_rate, RR_PO_UTIL_PKG.get_rate(p_cur, op.FUNCTIONAL_CURRENCY, NVL(p_type, op.DEFAULT_RATE_TYPE), NVL(p_date, SYSDATE)));
        IF v IS NULL THEN
            RR_PO_UTIL_PKG.err('No ' || NVL(p_type, op.DEFAULT_RATE_TYPE) || ' rate ' || p_cur || '→' || op.FUNCTIONAL_CURRENCY || ' — enter the rate');
        END IF;
        RETURN v;
    END;

    PROCEDURE snapshot (p_po_header_id IN NUMBER, p_change_order_id IN NUMBER, p_summary IN VARCHAR2, p_user IN VARCHAR2) IS
        v_json CLOB;
        v_rev  NUMBER;
    BEGIN
        SELECT REVISION_NUM INTO v_rev FROM RR_PO_HEADERS WHERE PO_HEADER_ID = p_po_header_id;
        SELECT JSON_OBJECT(
                 'poNumber' VALUE h.PO_NUMBER, 'revision' VALUE h.REVISION_NUM, 'supplierId' VALUE h.SUPPLIER_ID,
                 'supplierSiteId' VALUE h.SUPPLIER_SITE_ID, 'currency' VALUE h.CURRENCY_CODE, 'rate' VALUE h.RATE,
                 'paymentTerms' VALUE h.PAYMENT_TERMS, 'total' VALUE h.TOTAL_AMOUNT, 'description' VALUE h.DESCRIPTION,
                 'lines' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                    'lineNum' VALUE l.LINE_NUM, 'lineType' VALUE l.LINE_TYPE, 'description' VALUE l.ITEM_DESCRIPTION,
                                    'categoryId' VALUE l.CATEGORY_ID, 'uom' VALUE l.UOM_CODE, 'quantity' VALUE l.QUANTITY,
                                    'unitPrice' VALUE l.UNIT_PRICE, 'amount' VALUE l.AMOUNT, 'status' VALUE l.LINE_STATUS,
                                    'needBy' VALUE TO_CHAR(s.NEED_BY_DATE, 'YYYY-MM-DD'),
                                    'quantityCancelled' VALUE s.QUANTITY_CANCELLED, 'amountCancelled' VALUE s.AMOUNT_CANCELLED)
                                    ORDER BY l.LINE_NUM RETURNING CLOB)
                                FROM RR_PO_LINES l JOIN RR_PO_SCHEDULES s ON s.PO_LINE_ID = l.PO_LINE_ID AND s.SCHEDULE_NUM = 1
                                WHERE l.PO_HEADER_ID = h.PO_HEADER_ID)
               RETURNING CLOB)
        INTO   v_json
        FROM   RR_PO_HEADERS h WHERE h.PO_HEADER_ID = p_po_header_id;
        DELETE FROM RR_PO_REVISIONS WHERE PO_HEADER_ID = p_po_header_id AND REVISION_NUM = v_rev;
        INSERT INTO RR_PO_REVISIONS (PO_HEADER_ID, REVISION_NUM, SNAPSHOT_JSON, CHANGE_ORDER_ID, CHANGE_SUMMARY, CREATED_BY)
        VALUES (p_po_header_id, v_rev, v_json, p_change_order_id, SUBSTR(p_summary, 1, 4000), p_user);
    END;

    PROCEDURE SAVE_PO (p_json IN CLOB, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        lines  JSON_ARRAY_T;
        h      RR_PO_HEADERS%ROWTYPE;
        op     RR_PO_BU_OPTIONS%ROWTYPE;
        v_id   NUMBER := RR_PO_UTIL_PKG.jnum(o, 'poHeaderId');
        v_bu   NUMBER;
        v_sup  NUMBER := RR_PO_UTIL_PKG.jnum(o, 'supplierId');
        v_site NUMBER := RR_PO_UTIL_PKG.jnum(o, 'supplierSiteId');
        v_cur  VARCHAR2(15);
        v_e    VARCHAR2(400);
        v_l    NUMBER;
        v_terms VARCHAR2(240); v_terms_id NUMBER;
        v_direct NUMBER;
    BEGIN
        IF v_id IS NOT NULL THEN
            h := hdr(v_id);
            IF h.DOCUMENT_STATUS NOT IN ('INCOMPLETE', 'REJECTED') THEN
                RR_PO_UTIL_PKG.err('Approved purchase orders change through a change order (status ' || h.DOCUMENT_STATUS || ')');
            END IF;
            v_bu := h.BUSINESS_UNIT_ID;
        ELSE
            v_bu := RR_PO_UTIL_PKG.jnum(o, 'businessUnitId');
            IF v_bu IS NULL THEN RR_PO_UTIL_PKG.err('Business unit is required'); END IF;
        END IF;
        op := RR_PO_UTIL_PKG.opt(v_bu);
        IF v_sup IS NULL OR v_site IS NULL THEN RR_PO_UTIL_PKG.err('Supplier and supplier site are required'); END IF;
        v_e := RR_PO_UTIL_PKG.site_error(v_sup, v_site, v_bu);
        IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err(v_e); END IF;
        SELECT MAX(PAYMENT_TERMS), MAX(PAYMENT_TERMS_ID) INTO v_terms, v_terms_id FROM RR_SUPPLIER_SITES WHERE SUPPLIER_SITE_ID = v_site;
        v_cur := NVL(RR_PO_UTIL_PKG.jstr(o, 'currencyCode'), op.FUNCTIONAL_CURRENCY);
        h.RATE_TYPE := NVL(RR_PO_UTIL_PKG.jstr(o, 'rateType'), op.DEFAULT_RATE_TYPE);
        h.RATE_DATE := NVL(RR_PO_UTIL_PKG.jdate(o, 'rateDate'), TRUNC(SYSDATE));
        h.RATE := header_rate(v_cur, RR_PO_UTIL_PKG.jnum(o, 'rate'), op, h.RATE_TYPE, h.RATE_DATE);

        IF v_id IS NULL THEN
            -- direct PO (no requisition) unless the BU requires requisitions
            IF op.REQUIRE_REQUISITION = 'Y' THEN
                SELECT COUNT(*) INTO v_direct FROM RR_PO_BUYERS
                WHERE STATUS = 'ACTIVE' AND UPPER(USER_NAME) = UPPER(p_user) AND DIRECT_PO_ALLOWED = 'Y'
                AND (BUSINESS_UNIT_ID IS NULL OR BUSINESS_UNIT_ID = v_bu);
                IF v_direct = 0 THEN RR_PO_UTIL_PKG.err('This business unit requires purchase orders to come from requisitions'); END IF;
            END IF;
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j23 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'origin');
                j24 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'supplierContact');
                j25 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'buyerUser');
                j26 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'paymentTerms');
                j27 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'paymentTermsId');
                j28 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'shipToLocationId');
                j29 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'billToLocationId');
                j30 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'description');
                j31 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'noteToSupplier');
                j32 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'afterFactFlag');
            BEGIN
                INSERT INTO RR_PO_HEADERS (PO_NUMBER, BUSINESS_UNIT_ID, PO_TYPE, ORIGIN, SUPPLIER_ID, SUPPLIER_SITE_ID, SUPPLIER_CONTACT,
                    BUYER_USER, CURRENCY_CODE, RATE_TYPE, RATE_DATE, RATE, PAYMENT_TERMS, PAYMENT_TERMS_ID, SHIP_TO_LOCATION_ID,
                    BILL_TO_LOCATION_ID, DESCRIPTION, NOTE_TO_SUPPLIER, DOCUMENT_STATUS, CLOSURE_STATUS, AFTER_FACT_FLAG,
                    CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                VALUES (RR_PO_UTIL_PKG.next_number(v_bu, 'PO'), v_bu, 'STANDARD', NVL(j23, 'MANUAL'),
                    v_sup, v_site, j24, NVL(j25, p_user),
                    v_cur, h.RATE_TYPE, h.RATE_DATE, h.RATE, NVL(j26, v_terms),
                    NVL(j27, v_terms_id),
                    NVL(j28, op.DEFAULT_SHIP_TO_LOCATION_ID),
                    NVL(j29, op.DEFAULT_BILL_TO_LOCATION_ID),
                    j30, j31, 'INCOMPLETE', 'OPEN',
                    CASE WHEN op.ALLOW_AFTER_FACT_PO = 'Y' THEN NVL(j32, 'N') ELSE 'N' END,
                    p_user, p_user, SYSTIMESTAMP)
                RETURNING PO_HEADER_ID INTO v_id;
            END;
            RR_PO_UTIL_PKG.history('PO', v_id, 'CREATE', NULL, 'INCOMPLETE', p_user);
        ELSE
            DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                j33 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'supplierContact');
                j34 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'buyerUser');
                j35 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'paymentTerms');
                j36 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'paymentTermsId');
                j37 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'shipToLocationId');
                j38 NUMBER := RR_PO_UTIL_PKG.jnum(o, 'billToLocationId');
                j39 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'description');
                j40 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'noteToSupplier');
            BEGIN
                UPDATE RR_PO_HEADERS
                SET    SUPPLIER_ID = v_sup, SUPPLIER_SITE_ID = v_site, SUPPLIER_CONTACT = j33,
                       BUYER_USER = NVL(j34, BUYER_USER), CURRENCY_CODE = v_cur,
                       RATE_TYPE = h.RATE_TYPE, RATE_DATE = h.RATE_DATE, RATE = h.RATE,
                       PAYMENT_TERMS = NVL(j35, v_terms),
                       PAYMENT_TERMS_ID = NVL(j36, v_terms_id),
                       SHIP_TO_LOCATION_ID = j37,
                       BILL_TO_LOCATION_ID = j38,
                       DESCRIPTION = j39, NOTE_TO_SUPPLIER = j40,
                       DOCUMENT_STATUS = 'INCOMPLETE', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  PO_HEADER_ID = v_id;
            END;
            IF o.has('lines') THEN delete_lines(v_id); END IF;
        END IF;
        h := hdr(v_id);
        IF o.has('lines') THEN
            lines := RR_PO_UTIL_PKG.jarr(o, 'lines');
            FOR i IN 0 .. lines.get_size - 1 LOOP
                v_l := insert_line(h, i + 1, TREAT(lines.get(i) AS JSON_OBJECT_T), p_user);
            END LOOP;
        END IF;
        rollup_header(v_id);
        p_id := v_id; p_number := h.PO_NUMBER; p_status := 'S'; p_message := 'Purchase order ' || h.PO_NUMBER || ' saved';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE AUTOCREATE (p_json IN CLOB, p_user IN VARCHAR2,
                          p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        ids    JSON_ARRAY_T := RR_PO_UTIL_PKG.jarr(o, 'reqLineIds');
        v_ids  SYS.ODCINUMBERLIST := SYS.ODCINUMBERLIST();   -- ids as a SQL collection (no object methods in SQL)
        v_lock NUMBER;
        prices JSON_OBJECT_T;
        po     JSON_OBJECT_T := JSON_OBJECT_T();
        lines  JSON_ARRAY_T := JSON_ARRAY_T();
        l      JSON_OBJECT_T;
        dists  JSON_ARRAY_T;
        d      JSON_OBJECT_T;
        rq     JSON_ARRAY_T;
        v_bu   NUMBER;
        v_cur  VARCHAR2(15);
        v_n    NUMBER := 0;
    BEGIN
        IF ids.get_size = 0 THEN RR_PO_UTIL_PKG.err('Select at least one requisition line'); END IF;
        FOR i IN 0 .. ids.get_size - 1 LOOP
            v_ids.EXTEND; v_ids(v_ids.COUNT) := ids.get_number(i);
            -- lock each line (FOR UPDATE is not allowed on the ordered join below: ORA-01786)
            BEGIN
                SELECT REQ_LINE_ID INTO v_lock FROM RR_PO_REQ_LINES WHERE REQ_LINE_ID = v_ids(v_ids.COUNT) FOR UPDATE;
            EXCEPTION WHEN NO_DATA_FOUND THEN NULL;   -- reported below as "not found"
            END;
        END LOOP;
        IF o.has('prices') AND o.get('prices').is_object THEN prices := o.get_object('prices'); END IF;
        FOR r IN (SELECT l.*, h.BUSINESS_UNIT_ID, h.STATUS hdr_status
                  FROM RR_PO_REQ_LINES l JOIN RR_PO_REQ_HEADERS h ON h.REQ_HEADER_ID = l.REQ_HEADER_ID
                  WHERE l.REQ_LINE_ID IN (SELECT COLUMN_VALUE FROM TABLE(v_ids))
                  ORDER BY l.REQ_HEADER_ID, l.LINE_NUM) LOOP
            IF r.hdr_status <> 'APPROVED' OR r.LINE_STATUS <> 'OPEN' THEN
                RR_PO_UTIL_PKG.err('Requisition line ' || r.REQ_LINE_ID || ' is not an open line of an approved requisition');
            END IF;
            IF v_bu IS NULL THEN v_bu := r.BUSINESS_UNIT_ID; v_cur := r.CURRENCY_CODE;
            ELSIF v_bu <> r.BUSINESS_UNIT_ID THEN RR_PO_UTIL_PKG.err('All lines must belong to the same business unit');
            END IF;
            l := JSON_OBJECT_T();
            l.put('lineType', r.LINE_TYPE); l.put('categoryId', r.CATEGORY_ID); l.put('itemDescription', r.ITEM_DESCRIPTION);
            IF r.EXPENSE_ITEM_ID IS NOT NULL THEN l.put('expenseItemId', r.EXPENSE_ITEM_ID); END IF;
            IF r.UOM_CODE IS NOT NULL THEN l.put('uomCode', r.UOM_CODE); END IF;
            IF r.LINE_TYPE = 'QUANTITY' THEN
                l.put('quantity', r.QUANTITY);
                IF prices IS NOT NULL AND prices.has(TO_CHAR(r.REQ_LINE_ID)) THEN
                    l.put('unitPrice', RR_PO_UTIL_PKG.jnum(prices, TO_CHAR(r.REQ_LINE_ID)));
                ELSE l.put('unitPrice', r.UNIT_PRICE); END IF;
            ELSE
                IF prices IS NOT NULL AND prices.has(TO_CHAR(r.REQ_LINE_ID)) THEN
                    l.put('amount', RR_PO_UTIL_PKG.jnum(prices, TO_CHAR(r.REQ_LINE_ID)));
                ELSE l.put('amount', r.AMOUNT); END IF;
            END IF;
            IF r.TAX_CODE IS NOT NULL THEN l.put('taxCode', r.TAX_CODE); END IF;
            l.put('needByDate', TO_CHAR(r.NEED_BY_DATE, 'YYYY-MM-DD'));
            IF r.DELIVER_TO_LOCATION_ID IS NOT NULL THEN l.put('shipToLocationId', r.DELIVER_TO_LOCATION_ID); END IF;
            IF r.SUPPLIER_ITEM_NUM IS NOT NULL THEN l.put('supplierItemNum', r.SUPPLIER_ITEM_NUM); END IF;
            l.put('requesterUser', r.REQUESTER_USER);
            dists := JSON_ARRAY_T();
            FOR rd IN (SELECT * FROM RR_PO_REQ_DISTRIBUTIONS WHERE REQ_LINE_ID = r.REQ_LINE_ID ORDER BY DIST_NUM) LOOP
                d := JSON_OBJECT_T();
                d.put('percent', rd.PERCENT); d.put('chargeAccount', rd.CHARGE_ACCOUNT);
                d.put('requesterUser', r.REQUESTER_USER); d.put('reqDistributionId', rd.REQ_DISTRIBUTION_ID);
                IF r.DELIVER_TO_LOCATION_ID IS NOT NULL THEN d.put('deliverToLocationId', r.DELIVER_TO_LOCATION_ID); END IF;
                dists.append(d);
            END LOOP;
            l.put('distributions', dists);
            rq := JSON_ARRAY_T(); rq.append(r.REQ_LINE_ID); l.put('reqLineIds', rq);
            lines.append(l);
            v_n := v_n + 1;
        END LOOP;
        IF v_n <> ids.get_size THEN RR_PO_UTIL_PKG.err('Some requisition lines were not found'); END IF;
        po.put('businessUnitId', v_bu);
        po.put('supplierId', RR_PO_UTIL_PKG.jnum(o, 'supplierId'));
        po.put('supplierSiteId', RR_PO_UTIL_PKG.jnum(o, 'supplierSiteId'));
        po.put('currencyCode', NVL(RR_PO_UTIL_PKG.jstr(o, 'currencyCode'), v_cur));
        IF RR_PO_UTIL_PKG.jnum(o, 'rate') IS NOT NULL THEN po.put('rate', RR_PO_UTIL_PKG.jnum(o, 'rate')); END IF;
        IF RR_PO_UTIL_PKG.jstr(o, 'description') IS NOT NULL THEN po.put('description', RR_PO_UTIL_PKG.jstr(o, 'description')); END IF;
        po.put('origin', 'REQUISITION');
        po.put('lines', lines);
        SAVE_PO(po.to_clob, p_user, p_id, p_number, p_status, p_message);
        IF p_status = 'S' THEN p_message := 'Purchase order ' || p_number || ' created from ' || v_n || ' requisition line(s)'; END IF;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE COPY_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h     RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id), FALSE);
        po    JSON_OBJECT_T := JSON_OBJECT_T();
        lines JSON_ARRAY_T := JSON_ARRAY_T();
        l     JSON_OBJECT_T;
        dists JSON_ARRAY_T;
        d     JSON_OBJECT_T;
    BEGIN
        FOR r IN (SELECT ln.*, s.SHIP_TO_LOCATION_ID, s.NEED_BY_DATE, s.SCHEDULE_ID
                  FROM RR_PO_LINES ln JOIN RR_PO_SCHEDULES s ON s.PO_LINE_ID = ln.PO_LINE_ID AND s.SCHEDULE_NUM = 1
                  WHERE ln.PO_HEADER_ID = h.PO_HEADER_ID AND ln.LINE_STATUS <> 'CANCELLED' ORDER BY ln.LINE_NUM) LOOP
            l := JSON_OBJECT_T();
            l.put('lineType', r.LINE_TYPE); l.put('categoryId', r.CATEGORY_ID); l.put('itemDescription', r.ITEM_DESCRIPTION);
            IF r.EXPENSE_ITEM_ID IS NOT NULL THEN l.put('expenseItemId', r.EXPENSE_ITEM_ID); END IF;
            IF r.UOM_CODE IS NOT NULL THEN l.put('uomCode', r.UOM_CODE); END IF;
            IF r.LINE_TYPE = 'QUANTITY' THEN l.put('quantity', r.QUANTITY); l.put('unitPrice', r.UNIT_PRICE);
            ELSE l.put('amount', r.AMOUNT); END IF;
            IF r.TAX_CODE IS NOT NULL THEN l.put('taxCode', r.TAX_CODE); END IF;
            IF r.SHIP_TO_LOCATION_ID IS NOT NULL THEN l.put('shipToLocationId', r.SHIP_TO_LOCATION_ID); END IF;
            l.put('needByDate', TO_CHAR(TRUNC(SYSDATE) + 7, 'YYYY-MM-DD'));
            IF r.SUPPLIER_ITEM_NUM IS NOT NULL THEN l.put('supplierItemNum', r.SUPPLIER_ITEM_NUM); END IF;
            dists := JSON_ARRAY_T();
            FOR rd IN (SELECT * FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = r.SCHEDULE_ID ORDER BY DIST_NUM) LOOP
                d := JSON_OBJECT_T();
                d.put('percent', rd.PERCENT); d.put('chargeAccount', rd.CHARGE_ACCOUNT);
                IF rd.REQUESTER_USER IS NOT NULL THEN d.put('requesterUser', rd.REQUESTER_USER); END IF;
                dists.append(d);
            END LOOP;
            l.put('distributions', dists);
            lines.append(l);
        END LOOP;
        po.put('businessUnitId', h.BUSINESS_UNIT_ID); po.put('supplierId', h.SUPPLIER_ID); po.put('supplierSiteId', h.SUPPLIER_SITE_ID);
        po.put('currencyCode', h.CURRENCY_CODE); po.put('rateType', h.RATE_TYPE);
        IF h.SHIP_TO_LOCATION_ID IS NOT NULL THEN po.put('shipToLocationId', h.SHIP_TO_LOCATION_ID); END IF;
        IF h.BILL_TO_LOCATION_ID IS NOT NULL THEN po.put('billToLocationId', h.BILL_TO_LOCATION_ID); END IF;
        IF h.DESCRIPTION IS NOT NULL THEN po.put('description', h.DESCRIPTION); END IF;
        IF h.NOTE_TO_SUPPLIER IS NOT NULL THEN po.put('noteToSupplier', h.NOTE_TO_SUPPLIER); END IF;
        po.put('lines', lines);
        SAVE_PO(po.to_clob, p_user, p_id, p_number, p_status, p_message);
        IF p_status = 'S' THEN p_message := 'Copied ' || h.PO_NUMBER || ' to new purchase order ' || p_number; END IF;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE approve_internal (p_po_header_id IN NUMBER, p_user IN VARCHAR2) IS
        h RR_PO_HEADERS%ROWTYPE := hdr(p_po_header_id);
    BEGIN
        UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'APPROVED', APPROVED_DATE = TRUNC(SYSDATE),
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  PO_HEADER_ID = p_po_header_id;
        FOR s IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = p_po_header_id) LOOP rollup_schedule(s.SCHEDULE_ID); END LOOP;
        rollup_header(p_po_header_id);
        snapshot(p_po_header_id, NULL, CASE WHEN h.REVISION_NUM = 0 THEN 'Original' END, p_user);
        RR_PO_UTIL_PKG.history('PO', p_po_header_id, 'APPROVE', h.DOCUMENT_STATUS, 'APPROVED', p_user);
    END;

    PROCEDURE SUBMIT_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id NUMBER := RR_PO_UTIL_PKG.to_num(p_po_header_id);
        h    RR_PO_HEADERS%ROWTYPE;
        op   RR_PO_BU_OPTIONS%ROWTYPE;
        v_n  NUMBER; v_pct NUMBER;
        v_e  VARCHAR2(400);
        v_req NUMBER;
    BEGIN
        h := hdr(v_id);
        IF h.DOCUMENT_STATUS NOT IN ('INCOMPLETE', 'REJECTED') THEN RR_PO_UTIL_PKG.err('Purchase order is ' || h.DOCUMENT_STATUS); END IF;
        op := RR_PO_UTIL_PKG.opt(h.BUSINESS_UNIT_ID);
        IF NOT RR_PO_UTIL_PKG.is_buyer(h.BUYER_USER, h.BUSINESS_UNIT_ID) THEN
            RR_PO_UTIL_PKG.err(h.BUYER_USER || ' is not an active buyer for this business unit (Setup › Buyers)');
        END IF;
        v_e := RR_PO_UTIL_PKG.site_error(h.SUPPLIER_ID, h.SUPPLIER_SITE_ID, h.BUSINESS_UNIT_ID);
        IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err(v_e); END IF;
        SELECT COUNT(*) INTO v_n FROM RR_PO_LINES WHERE PO_HEADER_ID = v_id;
        IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Add at least one line'); END IF;
        FOR l IN (SELECT l.*, c.STATUS cat_status FROM RR_PO_LINES l LEFT JOIN RR_PO_CATEGORIES c ON c.CATEGORY_ID = l.CATEGORY_ID
                  WHERE l.PO_HEADER_ID = v_id ORDER BY l.LINE_NUM) LOOP
            IF NVL(l.cat_status, 'INACTIVE') <> 'ACTIVE' THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': category is not active'); END IF;
            IF l.AMOUNT <= 0 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': amount must be greater than zero'); END IF;
            IF l.LINE_TYPE = 'QUANTITY' AND (l.UOM_CODE IS NULL OR NVL(l.QUANTITY, 0) <= 0 OR NVL(l.UNIT_PRICE, -1) < 0) THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': unit of measure, quantity and price are required');
            END IF;
            IF l.TAX_CODE IS NOT NULL AND RR_PO_UTIL_PKG.tax_rate(l.TAX_CODE) = 0 THEN
                SELECT COUNT(*) INTO v_n FROM RR_INPUT_OUTPUT_TAX WHERE TAX_CODE = l.TAX_CODE AND STATUS = 'ACTIVE';
                IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': tax code ' || l.TAX_CODE || ' is not active'); END IF;
            END IF;
            FOR s IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES WHERE PO_LINE_ID = l.PO_LINE_ID) LOOP
                SELECT NVL(SUM(PERCENT), 0) INTO v_pct FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                IF ABS(v_pct - 100) > 0.0001 THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': distributions must total 100%'); END IF;
            END LOOP;
            FOR d IN (SELECT CHARGE_ACCOUNT FROM RR_PO_DISTRIBUTIONS WHERE PO_LINE_ID = l.PO_LINE_ID) LOOP
                v_e := RR_PO_UTIL_PKG.account_error(d.CHARGE_ACCOUNT, h.BUSINESS_UNIT_ID);
                IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': ' || v_e); END IF;
            END LOOP;
        END LOOP;
        freeze(v_id);
        rollup_header(v_id);
        h := hdr(v_id);
        UPDATE RR_PO_HEADERS SET SUBMITTED_DATE = TRUNC(SYSDATE), LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE PO_HEADER_ID = v_id;
        IF op.PO_APPROVAL_REQUIRED = 'N' THEN
            approve_internal(v_id, p_user);
            p_message := 'Purchase order ' || h.PO_NUMBER || ' approved (approval not required)';
        ELSE
            v_req := RR_PO_APPROVAL_PKG.request('PURCHASE_ORDER', v_id, v_id, h.PO_NUMBER, h.TOTAL_AMOUNT_FUNC,
                                                op.FUNCTIONAL_CURRENCY, h.BUSINESS_UNIT_ID, h.DESCRIPTION, p_user);
            IF v_req IS NULL THEN
                RR_PO_UTIL_PKG.err('No approval rule for PROCUREMENT / PURCHASE_ORDER covering ' || op.FUNCTIONAL_CURRENCY || ' '
                    || TO_CHAR(h.TOTAL_AMOUNT_FUNC, 'FM999,999,999,990.00')
                    || ' — add one in Approvals › Rules, or set "PO approval required" = N in Purchasing Options');
            END IF;
            UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'PENDING_APPROVAL', APPROVAL_REQUEST_ID = v_req WHERE PO_HEADER_ID = v_id;
            RR_PO_UTIL_PKG.history('PO', v_id, 'SUBMIT', h.DOCUMENT_STATUS, 'PENDING_APPROVAL', p_user);
            p_message := 'Purchase order ' || h.PO_NUMBER || ' submitted for approval';
        END IF;
        p_id := v_id; p_number := h.PO_NUMBER; p_status := 'S';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE WITHDRAW_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                           p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
    BEGIN
        IF h.DOCUMENT_STATUS <> 'PENDING_APPROVAL' THEN RR_PO_UTIL_PKG.err('Only purchase orders pending approval can be withdrawn'); END IF;
        RR_PO_APPROVAL_PKG.recall(h.APPROVAL_REQUEST_ID, p_user);
        UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'INCOMPLETE', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, 'WITHDRAW', 'PENDING_APPROVAL', 'INCOMPLETE', p_user);
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S'; p_message := 'Withdrawn — you can edit and resubmit';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE DELETE_PO (p_po_header_id IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
    BEGIN
        IF h.DOCUMENT_STATUS NOT IN ('INCOMPLETE', 'REJECTED') OR h.APPROVED_DATE IS NOT NULL THEN
            RR_PO_UTIL_PKG.err('Only purchase orders that were never approved can be deleted — cancel it instead');
        END IF;
        delete_lines(h.PO_HEADER_ID);
        DELETE FROM RR_PO_REVISIONS WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        DELETE FROM RR_PO_HEADERS WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, 'DELETE', h.DOCUMENT_STATUS, NULL, p_user, h.PO_NUMBER);
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S'; p_message := 'Purchase order ' || h.PO_NUMBER || ' deleted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    -- cancel what was neither received nor billed on one schedule
    PROCEDURE cancel_schedule (p_schedule_id IN NUMBER) IS
    BEGIN
        UPDATE RR_PO_DISTRIBUTIONS
        SET    QUANTITY_CANCELLED = CASE WHEN QUANTITY_ORDERED IS NOT NULL
                                         THEN GREATEST(QUANTITY_ORDERED - GREATEST(QUANTITY_DELIVERED, QUANTITY_BILLED), 0) ELSE 0 END,
               AMOUNT_CANCELLED   = GREATEST(AMOUNT_ORDERED - GREATEST(AMOUNT_DELIVERED, AMOUNT_BILLED), 0)
        WHERE  SCHEDULE_ID = p_schedule_id;
        rollup_schedule(p_schedule_id);
    END;

    PROCEDURE CANCEL_PO (p_po_header_id IN VARCHAR2, p_po_line_id IN VARCHAR2, p_reason IN VARCHAR2,
                         p_recreate_demand IN VARCHAR2, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h      RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
        v_line NUMBER := RR_PO_UTIL_PKG.to_num(p_po_line_id);
        v_any  NUMBER;
        v_pend NUMBER;
    BEGIN
        IF TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required'); END IF;
        IF h.DOCUMENT_STATUS <> 'APPROVED' THEN
            RR_PO_UTIL_PKG.err('Only approved purchase orders are cancelled — delete or withdraw a draft instead');
        END IF;
        SELECT COUNT(*) INTO v_pend FROM RR_PO_CHANGE_ORDERS WHERE PO_HEADER_ID = h.PO_HEADER_ID AND STATUS = 'PENDING_APPROVAL';
        IF v_pend > 0 THEN RR_PO_UTIL_PKG.err('A change order is pending approval — cancel or decide it first'); END IF;
        FOR s IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES
                  WHERE PO_HEADER_ID = h.PO_HEADER_ID AND (v_line IS NULL OR PO_LINE_ID = v_line)
                  AND CLOSURE_STATUS <> 'FINALLY_CLOSED') LOOP
            cancel_schedule(s.SCHEDULE_ID);
        END LOOP;
        release_req_lines(h.PO_HEADER_ID, v_line, p_recreate_demand, p_user);
        UPDATE RR_PO_LINES SET CANCEL_REASON = p_reason WHERE PO_HEADER_ID = h.PO_HEADER_ID AND (v_line IS NULL OR PO_LINE_ID = v_line);
        rollup_header(h.PO_HEADER_ID);
        -- nothing received or billed anywhere → the whole document is cancelled
        SELECT COUNT(*) INTO v_any FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = h.PO_HEADER_ID AND CANCELLED_FLAG = 'N';
        IF v_any = 0 THEN
            UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'CANCELLED', CANCEL_REASON = p_reason WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        END IF;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, CASE WHEN v_line IS NULL THEN 'CANCEL' ELSE 'CANCEL_LINE' END,
                               h.DOCUMENT_STATUS, CASE WHEN v_any = 0 THEN 'CANCELLED' ELSE h.DOCUMENT_STATUS END, p_user, p_reason);
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S';
        p_message := CASE WHEN v_any = 0 THEN 'Purchase order cancelled'
                          ELSE 'Unreceived quantities cancelled; received or billed quantities stay' END;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    -- p_action: CLOSE | REOPEN | FINAL_CLOSE
    PROCEDURE CLOSE_PO (p_po_header_id IN VARCHAR2, p_po_line_id IN VARCHAR2, p_action IN VARCHAR2,
                        p_reason IN VARCHAR2, p_user IN VARCHAR2,
                        p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h      RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
        v_line NUMBER := RR_PO_UTIL_PKG.to_num(p_po_line_id);
        v_acc  NUMBER;
    BEGIN
        IF h.DOCUMENT_STATUS <> 'APPROVED' THEN RR_PO_UTIL_PKG.err('Only approved purchase orders can be closed'); END IF;
        IF UPPER(p_action) = 'FINAL_CLOSE' THEN
            IF TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required for final close'); END IF;
            SELECT NVL(SUM(ACCRUED_AMOUNT_FUNC), 0) INTO v_acc FROM RR_PO_DISTRIBUTIONS
            WHERE PO_HEADER_ID = h.PO_HEADER_ID AND (v_line IS NULL OR PO_LINE_ID = v_line);
            IF v_acc <> 0 THEN
                RR_PO_UTIL_PKG.err('Uninvoiced receipt accruals of ' || TO_CHAR(v_acc, 'FM999,999,990.00')
                                   || ' remain — write them off (Purchasing › Accruals) before final close');
            END IF;
            -- cancel whatever is still open, then lock
            FOR s IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = h.PO_HEADER_ID
                      AND (v_line IS NULL OR PO_LINE_ID = v_line) AND CLOSURE_STATUS <> 'FINALLY_CLOSED') LOOP
                UPDATE RR_PO_DISTRIBUTIONS
                SET    QUANTITY_CANCELLED = CASE WHEN QUANTITY_ORDERED IS NOT NULL
                                                 THEN GREATEST(QUANTITY_ORDERED - GREATEST(QUANTITY_DELIVERED, QUANTITY_BILLED), 0) ELSE 0 END,
                       AMOUNT_CANCELLED = GREATEST(AMOUNT_ORDERED - GREATEST(AMOUNT_DELIVERED, AMOUNT_BILLED), 0)
                WHERE  SCHEDULE_ID = s.SCHEDULE_ID;
                rollup_schedule(s.SCHEDULE_ID);
                UPDATE RR_PO_SCHEDULES SET CLOSURE_STATUS = 'FINALLY_CLOSED' WHERE SCHEDULE_ID = s.SCHEDULE_ID;
            END LOOP;
        ELSE
            FOR s IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = h.PO_HEADER_ID
                      AND (v_line IS NULL OR PO_LINE_ID = v_line) AND CLOSURE_STATUS <> 'FINALLY_CLOSED') LOOP
                UPDATE RR_PO_SCHEDULES SET MANUAL_CLOSE_FLAG = CASE WHEN UPPER(p_action) = 'CLOSE' THEN 'Y' ELSE 'N' END
                WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                rollup_schedule(s.SCHEDULE_ID);
            END LOOP;
        END IF;
        rollup_header(h.PO_HEADER_ID);
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, UPPER(p_action) || CASE WHEN v_line IS NOT NULL THEN '_LINE' END,
                               h.CLOSURE_STATUS, NULL, p_user, p_reason);
        h := hdr(h.PO_HEADER_ID, FALSE);
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S'; p_message := 'Closure status: ' || h.CLOSURE_STATUS;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE HOLD_PO (p_po_header_id IN VARCHAR2, p_action IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
    BEGIN
        IF h.DOCUMENT_STATUS <> 'APPROVED' THEN RR_PO_UTIL_PKG.err('Only approved purchase orders can be put on hold'); END IF;
        IF UPPER(p_action) = 'HOLD' AND TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required'); END IF;
        UPDATE RR_PO_HEADERS SET HOLD_FLAG = CASE WHEN UPPER(p_action) = 'HOLD' THEN 'Y' ELSE 'N' END,
               HOLD_REASON = CASE WHEN UPPER(p_action) = 'HOLD' THEN p_reason END,
               LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE  PO_HEADER_ID = h.PO_HEADER_ID;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, UPPER(p_action), NULL, NULL, p_user, p_reason);
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S';
        p_message := CASE WHEN UPPER(p_action) = 'HOLD' THEN 'On hold — no receiving until released' ELSE 'Hold released' END;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE MARK_COMMUNICATED (p_po_header_id IN VARCHAR2, p_method IN VARCHAR2, p_to IN VARCHAR2, p_user IN VARCHAR2,
                                 p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
    BEGIN
        IF h.DOCUMENT_STATUS <> 'APPROVED' THEN RR_PO_UTIL_PKG.err('Only approved purchase orders are sent to suppliers'); END IF;
        UPDATE RR_PO_HEADERS SET COMMUNICATED_DATE = SYSDATE WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, 'COMMUNICATE', NULL, NULL, p_user,
                               NVL(p_method, 'PRINT') || CASE WHEN p_to IS NOT NULL THEN ' to ' || p_to END || ' (revision ' || h.REVISION_NUM || ')');
        p_id := h.PO_HEADER_ID; p_number := h.PO_NUMBER; p_status := 'S'; p_message := 'Recorded';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    -- ── change orders ────────────────────────────────────────────────────────
    -- ops: UPDATE_QTY {poLineId, value} · UPDATE_AMOUNT {poLineId, value} · UPDATE_PRICE {poLineId, value}
    --      UPDATE_NEED_BY {poLineId, value} · CANCEL_LINE {poLineId} · ADD_LINE {line} · UPDATE_NOTE {value}
    PROCEDURE check_change (h IN RR_PO_HEADERS%ROWTYPE, c IN JSON_OBJECT_T, p_delta OUT NUMBER, p_text OUT VARCHAR2,
                            p_adds OUT BOOLEAN) IS
        v_op   VARCHAR2(30) := UPPER(RR_PO_UTIL_PKG.jstr(c, 'op'));
        v_line NUMBER := RR_PO_UTIL_PKG.jnum(c, 'poLineId');
        v_val  NUMBER;
        l      RR_PO_LINES%ROWTYPE;
        s      RR_PO_SCHEDULES%ROWTYPE;
        nl     JSON_OBJECT_T;
    BEGIN
        p_delta := 0; p_adds := FALSE;
        IF v_op IN ('UPDATE_QTY', 'UPDATE_AMOUNT', 'UPDATE_PRICE', 'UPDATE_NEED_BY', 'CANCEL_LINE') THEN
            BEGIN
                SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = v_line AND PO_HEADER_ID = h.PO_HEADER_ID;
                SELECT * INTO s FROM RR_PO_SCHEDULES WHERE PO_LINE_ID = v_line AND SCHEDULE_NUM = 1;
            EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Line ' || v_line || ' is not on this purchase order');
            END;
            IF s.CLOSURE_STATUS = 'FINALLY_CLOSED' OR l.LINE_STATUS = 'CANCELLED' THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ' is finally closed or cancelled');
            END IF;
        END IF;
        CASE v_op
        WHEN 'UPDATE_QTY' THEN
            v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
            IF l.LINE_TYPE <> 'QUANTITY' THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ' is an amount line — change its amount'); END IF;
            IF v_val IS NULL OR v_val < GREATEST(s.QUANTITY_RECEIVED, s.QUANTITY_BILLED) + s.QUANTITY_CANCELLED THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': quantity cannot go below what was received or billed ('
                                   || GREATEST(s.QUANTITY_RECEIVED, s.QUANTITY_BILLED) || ')');
            END IF;
            p_delta := ROUND((v_val - l.QUANTITY) * l.UNIT_PRICE, 2);
            p_text := 'Line ' || l.LINE_NUM || ' quantity ' || l.QUANTITY || ' → ' || v_val;
        WHEN 'UPDATE_AMOUNT' THEN
            v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
            IF l.LINE_TYPE <> 'AMOUNT' THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ' is a quantity line — change its quantity or price'); END IF;
            IF v_val IS NULL OR v_val < GREATEST(s.AMOUNT_RECEIVED, s.AMOUNT_BILLED) + s.AMOUNT_CANCELLED THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': amount cannot go below what was received or billed');
            END IF;
            p_delta := v_val - l.AMOUNT;
            p_text := 'Line ' || l.LINE_NUM || ' amount ' || TO_CHAR(l.AMOUNT, 'FM999,999,990.00') || ' → ' || TO_CHAR(v_val, 'FM999,999,990.00');
        WHEN 'UPDATE_PRICE' THEN
            v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
            IF l.LINE_TYPE <> 'QUANTITY' THEN RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ' has no unit price'); END IF;
            IF s.QUANTITY_RECEIVED <> 0 OR s.QUANTITY_BILLED <> 0 THEN
                RR_PO_UTIL_PKG.err('Line ' || l.LINE_NUM || ': price cannot change after receipt or billing');
            END IF;
            IF v_val IS NULL OR v_val < 0 THEN RR_PO_UTIL_PKG.err('Price must be zero or more'); END IF;
            p_delta := ROUND((v_val - l.UNIT_PRICE) * (l.QUANTITY - s.QUANTITY_CANCELLED), 2);
            p_text := 'Line ' || l.LINE_NUM || ' price ' || l.UNIT_PRICE || ' → ' || v_val;
        WHEN 'UPDATE_NEED_BY' THEN
            IF RR_PO_UTIL_PKG.jdate(c, 'value') IS NULL THEN RR_PO_UTIL_PKG.err('Need-by date is required'); END IF;
            p_text := 'Line ' || l.LINE_NUM || ' need-by ' || TO_CHAR(s.NEED_BY_DATE, 'DD-Mon-YYYY') || ' → '
                      || TO_CHAR(RR_PO_UTIL_PKG.jdate(c, 'value'), 'DD-Mon-YYYY');
        WHEN 'CANCEL_LINE' THEN
            p_delta := -1 * CASE WHEN l.LINE_TYPE = 'QUANTITY'
                                 THEN ROUND((NVL(s.QUANTITY, 0) - s.QUANTITY_CANCELLED - GREATEST(s.QUANTITY_RECEIVED, s.QUANTITY_BILLED)) * l.UNIT_PRICE, 2)
                                 ELSE s.AMOUNT - s.AMOUNT_CANCELLED - GREATEST(s.AMOUNT_RECEIVED, s.AMOUNT_BILLED) END;
            p_text := 'Cancel line ' || l.LINE_NUM || ' (open part)';
        WHEN 'ADD_LINE' THEN
            nl := c.get_object('line');
            IF nl IS NULL THEN RR_PO_UTIL_PKG.err('ADD_LINE needs a line'); END IF;
            p_delta := CASE WHEN NVL(RR_PO_UTIL_PKG.jstr(nl, 'lineType'), 'QUANTITY') = 'QUANTITY'
                            THEN ROUND(NVL(RR_PO_UTIL_PKG.jnum(nl, 'quantity'), 0) * NVL(RR_PO_UTIL_PKG.jnum(nl, 'unitPrice'), 0), 2)
                            ELSE NVL(RR_PO_UTIL_PKG.jnum(nl, 'amount'), 0) END;
            IF p_delta <= 0 THEN RR_PO_UTIL_PKG.err('The new line needs an amount'); END IF;
            p_text := 'Add line: ' || RR_PO_UTIL_PKG.jstr(nl, 'itemDescription');
            p_adds := TRUE;
        WHEN 'UPDATE_NOTE' THEN
            p_text := 'Note to supplier changed';
        ELSE
            RR_PO_UTIL_PKG.err('Unknown change ' || v_op);
        END CASE;
    END;

    PROCEDURE SUBMIT_CHANGE (p_po_header_id IN VARCHAR2, p_changes_json IN CLOB, p_reason IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        h       RR_PO_HEADERS%ROWTYPE := hdr(RR_PO_UTIL_PKG.to_num(p_po_header_id));
        op      RR_PO_BU_OPTIONS%ROWTYPE;
        chg     JSON_ARRAY_T := JSON_ARRAY_T.parse(p_changes_json);
        v_delta NUMBER := 0; v_d NUMBER; v_t VARCHAR2(400); v_add BOOLEAN; v_adds BOOLEAN := FALSE;
        v_text  VARCHAR2(4000);
        v_n     NUMBER;
        v_co    NUMBER;
        v_num   VARCHAR2(60);
        v_req   NUMBER;
        v_needs BOOLEAN;
    BEGIN
        IF TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required'); END IF;
        IF h.DOCUMENT_STATUS <> 'APPROVED' OR h.CLOSURE_STATUS = 'FINALLY_CLOSED' THEN
            RR_PO_UTIL_PKG.err('Only approved, not finally closed purchase orders can be changed');
        END IF;
        IF h.HOLD_FLAG = 'Y' THEN RR_PO_UTIL_PKG.err('The purchase order is on hold'); END IF;
        SELECT COUNT(*) INTO v_n FROM RR_PO_CHANGE_ORDERS WHERE PO_HEADER_ID = h.PO_HEADER_ID AND STATUS = 'PENDING_APPROVAL';
        IF v_n > 0 THEN RR_PO_UTIL_PKG.err('Another change order is waiting for approval'); END IF;
        IF chg.get_size = 0 THEN RR_PO_UTIL_PKG.err('No changes'); END IF;
        op := RR_PO_UTIL_PKG.opt(h.BUSINESS_UNIT_ID);
        FOR i IN 0 .. chg.get_size - 1 LOOP
            check_change(h, TREAT(chg.get(i) AS JSON_OBJECT_T), v_d, v_t, v_add);
            v_delta := v_delta + v_d;
            v_adds := v_adds OR v_add;
            v_text := SUBSTR(v_text || CASE WHEN v_text IS NOT NULL THEN '; ' END || v_t, 1, 4000);
        END LOOP;
        SELECT COUNT(*) + 1 INTO v_n FROM RR_PO_CHANGE_ORDERS WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        v_num := h.PO_NUMBER || '-CO' || v_n;
        INSERT INTO RR_PO_CHANGE_ORDERS (PO_HEADER_ID, CO_NUMBER, FROM_REVISION, STATUS, REASON, CHANGES_JSON, CHANGE_SUMMARY,
                                         AMOUNT_DELTA_FUNC, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
        VALUES (h.PO_HEADER_ID, v_num, h.REVISION_NUM, 'PENDING_APPROVAL', p_reason, p_changes_json, v_text,
                ROUND(v_delta * h.RATE, 2), p_user, p_user, SYSTIMESTAMP)
        RETURNING CHANGE_ORDER_ID INTO v_co;
        v_needs := op.PO_APPROVAL_REQUIRED = 'Y'
                   AND (v_adds OR (v_delta > 0 AND (h.TOTAL_AMOUNT = 0 OR v_delta / h.TOTAL_AMOUNT * 100 > op.CO_REAPPROVAL_THRESHOLD_PCT)));
        IF v_needs THEN
            v_req := RR_PO_APPROVAL_PKG.request('PO_CHANGE_ORDER', v_co, h.PO_HEADER_ID, v_num,
                                                ROUND((h.TOTAL_AMOUNT + v_delta) * h.RATE, 2), op.FUNCTIONAL_CURRENCY,
                                                h.BUSINESS_UNIT_ID, v_text, p_user);
            IF v_req IS NULL THEN
                RR_PO_UTIL_PKG.err('No approval rule for PROCUREMENT / PO_CHANGE_ORDER — add one in Approvals › Rules');
            END IF;
            UPDATE RR_PO_CHANGE_ORDERS SET APPROVAL_REQUEST_ID = v_req WHERE CHANGE_ORDER_ID = v_co;
            RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, 'CHANGE_SUBMITTED', NULL, NULL, p_user, v_num || ': ' || v_text);
            p_message := 'Change order ' || v_num || ' submitted for approval';
        ELSE
            apply_change(v_co, p_user);
            p_message := 'Change order ' || v_num || ' applied — revision ' || (h.REVISION_NUM + 1);
        END IF;
        p_id := v_co; p_number := v_num; p_status := 'S';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    -- re-split a schedule's new ordered quantity/amount over its distributions by percent
    PROCEDURE resplit (p_schedule_id IN NUMBER, p_qty IN NUMBER, p_amt IN NUMBER) IS
        v_cnt NUMBER; v_i NUMBER := 0; v_sq NUMBER := 0; v_sa NUMBER := 0; v_q NUMBER; v_a NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_cnt FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = p_schedule_id;
        FOR d IN (SELECT * FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = p_schedule_id ORDER BY DIST_NUM FOR UPDATE) LOOP
            v_i := v_i + 1;
            IF v_i = v_cnt THEN v_q := CASE WHEN p_qty IS NOT NULL THEN p_qty - v_sq END; v_a := p_amt - v_sa;
            ELSE v_q := CASE WHEN p_qty IS NOT NULL THEN ROUND(p_qty * d.PERCENT / 100, 6) END; v_a := ROUND(p_amt * d.PERCENT / 100, 2);
            END IF;
            v_sq := v_sq + NVL(v_q, 0); v_sa := v_sa + v_a;
            IF (v_q IS NOT NULL AND v_q < GREATEST(d.QUANTITY_DELIVERED, d.QUANTITY_BILLED) + d.QUANTITY_CANCELLED)
               OR v_a < GREATEST(d.AMOUNT_DELIVERED, d.AMOUNT_BILLED) + d.AMOUNT_CANCELLED THEN
                RR_PO_UTIL_PKG.err('Distribution ' || d.DIST_NUM || ' would go below what was received or billed');
            END IF;
            UPDATE RR_PO_DISTRIBUTIONS SET QUANTITY_ORDERED = v_q, AMOUNT_ORDERED = v_a WHERE DISTRIBUTION_ID = d.DISTRIBUTION_ID;
        END LOOP;
    END;

    PROCEDURE apply_change (p_change_order_id IN NUMBER, p_user IN VARCHAR2) IS
        co     RR_PO_CHANGE_ORDERS%ROWTYPE;
        h      RR_PO_HEADERS%ROWTYPE;
        chg    JSON_ARRAY_T;
        c      JSON_OBJECT_T;
        v_op   VARCHAR2(30);
        v_line NUMBER; v_val NUMBER; v_new NUMBER; v_l NUMBER;
        l      RR_PO_LINES%ROWTYPE;
        s      RR_PO_SCHEDULES%ROWTYPE;
    BEGIN
        SELECT * INTO co FROM RR_PO_CHANGE_ORDERS WHERE CHANGE_ORDER_ID = p_change_order_id FOR UPDATE;
        h := hdr(co.PO_HEADER_ID);
        IF co.FROM_REVISION <> h.REVISION_NUM THEN
            RR_PO_UTIL_PKG.err('The purchase order changed since ' || co.CO_NUMBER || ' was drafted — create a new change order');
        END IF;
        chg := JSON_ARRAY_T.parse(co.CHANGES_JSON);
        FOR i IN 0 .. chg.get_size - 1 LOOP
            c := TREAT(chg.get(i) AS JSON_OBJECT_T);
            v_op := UPPER(RR_PO_UTIL_PKG.jstr(c, 'op'));
            v_line := RR_PO_UTIL_PKG.jnum(c, 'poLineId');
            IF v_line IS NOT NULL THEN
                SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = v_line FOR UPDATE;
                SELECT * INTO s FROM RR_PO_SCHEDULES WHERE PO_LINE_ID = v_line AND SCHEDULE_NUM = 1 FOR UPDATE;
            END IF;
            CASE v_op
            WHEN 'UPDATE_QTY' THEN
                v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
                v_new := ROUND(v_val * l.UNIT_PRICE, 2);
                UPDATE RR_PO_LINES SET QUANTITY = v_val, AMOUNT = v_new WHERE PO_LINE_ID = v_line;
                UPDATE RR_PO_SCHEDULES SET QUANTITY = v_val, AMOUNT = v_new WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                resplit(s.SCHEDULE_ID, v_val, v_new);
                rollup_schedule(s.SCHEDULE_ID);
            WHEN 'UPDATE_AMOUNT' THEN
                v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
                UPDATE RR_PO_LINES SET AMOUNT = v_val WHERE PO_LINE_ID = v_line;
                UPDATE RR_PO_SCHEDULES SET AMOUNT = v_val WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                resplit(s.SCHEDULE_ID, NULL, v_val);
                rollup_schedule(s.SCHEDULE_ID);
            WHEN 'UPDATE_PRICE' THEN
                v_val := RR_PO_UTIL_PKG.jnum(c, 'value');
                v_new := ROUND(l.QUANTITY * v_val, 2);
                UPDATE RR_PO_LINES SET UNIT_PRICE = v_val, AMOUNT = v_new WHERE PO_LINE_ID = v_line;
                UPDATE RR_PO_SCHEDULES SET AMOUNT = v_new WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                resplit(s.SCHEDULE_ID, l.QUANTITY, v_new);
                rollup_schedule(s.SCHEDULE_ID);
            WHEN 'UPDATE_NEED_BY' THEN
                DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                    j41 DATE := RR_PO_UTIL_PKG.jdate(c, 'value');
                BEGIN
                    UPDATE RR_PO_SCHEDULES SET NEED_BY_DATE = j41 WHERE SCHEDULE_ID = s.SCHEDULE_ID;
                END;
            WHEN 'CANCEL_LINE' THEN
                cancel_schedule(s.SCHEDULE_ID);
                release_req_lines(h.PO_HEADER_ID, v_line, 'Y', p_user);
                UPDATE RR_PO_LINES SET CANCEL_REASON = co.REASON WHERE PO_LINE_ID = v_line;
            WHEN 'ADD_LINE' THEN
                SELECT NVL(MAX(LINE_NUM), 0) + 1 INTO v_new FROM RR_PO_LINES WHERE PO_HEADER_ID = h.PO_HEADER_ID;
                v_l := insert_line(h, v_new, c.get_object('line'), p_user);
            WHEN 'UPDATE_NOTE' THEN
                DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                    j42 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(c, 'value');
                BEGIN
                    UPDATE RR_PO_HEADERS SET NOTE_TO_SUPPLIER = j42 WHERE PO_HEADER_ID = h.PO_HEADER_ID;
                END;
            ELSE NULL;
            END CASE;
        END LOOP;
        freeze(h.PO_HEADER_ID);   -- new lines get the BU settings; existing ones keep theirs
        UPDATE RR_PO_HEADERS SET REVISION_NUM = REVISION_NUM + 1, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE PO_HEADER_ID = h.PO_HEADER_ID;
        FOR sc IN (SELECT SCHEDULE_ID FROM RR_PO_SCHEDULES WHERE PO_HEADER_ID = h.PO_HEADER_ID) LOOP rollup_schedule(sc.SCHEDULE_ID); END LOOP;
        rollup_header(h.PO_HEADER_ID);
        snapshot(h.PO_HEADER_ID, co.CHANGE_ORDER_ID, co.CHANGE_SUMMARY, p_user);
        UPDATE RR_PO_CHANGE_ORDERS SET STATUS = 'APPLIED', APPLIED_DATE = SYSDATE, LAST_UPDATED_BY = p_user,
               LAST_UPDATE_DATE = SYSTIMESTAMP WHERE CHANGE_ORDER_ID = co.CHANGE_ORDER_ID;
        RR_PO_UTIL_PKG.history('PO', h.PO_HEADER_ID, 'CHANGE_APPLIED', 'REV ' || h.REVISION_NUM, 'REV ' || (h.REVISION_NUM + 1),
                               p_user, co.CO_NUMBER || ': ' || co.CHANGE_SUMMARY);
    END;

    PROCEDURE CANCEL_CHANGE (p_change_order_id IN VARCHAR2, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        co RR_PO_CHANGE_ORDERS%ROWTYPE;
    BEGIN
        SELECT * INTO co FROM RR_PO_CHANGE_ORDERS WHERE CHANGE_ORDER_ID = RR_PO_UTIL_PKG.to_num(p_change_order_id) FOR UPDATE;
        IF co.STATUS <> 'PENDING_APPROVAL' THEN RR_PO_UTIL_PKG.err('Change order is ' || co.STATUS); END IF;
        RR_PO_APPROVAL_PKG.recall(co.APPROVAL_REQUEST_ID, p_user);
        UPDATE RR_PO_CHANGE_ORDERS SET STATUS = 'CANCELLED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
        WHERE CHANGE_ORDER_ID = co.CHANGE_ORDER_ID;
        RR_PO_UTIL_PKG.history('PO', co.PO_HEADER_ID, 'CHANGE_CANCELLED', NULL, NULL, p_user, co.CO_NUMBER);
        p_id := co.CHANGE_ORDER_ID; p_number := co.CO_NUMBER; p_status := 'S'; p_message := 'Change order cancelled';
    EXCEPTION WHEN NO_DATA_FOUND THEN p_status := 'E'; p_message := 'Change order not found';
              WHEN OTHERS THEN p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_DOC_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_RCV_PKG — receiving
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_RCV_PKG AS

    -- post one receiving event against a schedule; spreads it over distributions
    -- p_basis_txn: for returns/corrections, spread like the parent receipt (net of billed)
    FUNCTION post_event (p_receipt_header_id IN NUMBER, p_type IN VARCHAR2, p_parent IN NUMBER, p_schedule_id IN NUMBER,
                         p_qty IN NUMBER, p_amt IN NUMBER, p_date IN DATE, p_reason IN VARCHAR2, p_comments IN VARCHAR2,
                         p_user IN VARCHAR2) RETURN NUMBER IS
        s      RR_PO_SCHEDULES%ROWTYPE;
        l      RR_PO_LINES%ROWTYPE;
        h      RR_PO_HEADERS%ROWTYPE;
        v_txn  NUMBER;
        v_amt  NUMBER;
        v_func NUMBER;
        v_tot_w NUMBER := 0; v_cnt NUMBER := 0; v_i NUMBER := 0;
        v_sq NUMBER := 0; v_sa NUMBER := 0; v_sf NUMBER := 0;
        v_q NUMBER; v_a NUMBER; v_f NUMBER;
        TYPE t_w IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
        TYPE t_ids IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
        w   t_w; ids t_ids;
    BEGIN
        SELECT * INTO s FROM RR_PO_SCHEDULES WHERE SCHEDULE_ID = p_schedule_id FOR UPDATE;
        SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = s.PO_LINE_ID;
        SELECT * INTO h FROM RR_PO_HEADERS WHERE PO_HEADER_ID = s.PO_HEADER_ID;
        v_amt := CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN ROUND(p_qty * l.UNIT_PRICE, 2) ELSE p_amt END;
        v_func := ROUND(v_amt * h.RATE, 2);
        INSERT INTO RR_PO_RCV_TRANSACTIONS (RECEIPT_HEADER_ID, TRANSACTION_TYPE, PARENT_TRANSACTION_ID, TRANSACTION_DATE,
            PO_HEADER_ID, PO_LINE_ID, SCHEDULE_ID, QUANTITY, UOM_CODE, AMOUNT, CURRENCY_CODE, RATE, AMOUNT_FUNC, REASON_CODE,
            COMMENTS, ACCOUNTING_STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
        VALUES (p_receipt_header_id, p_type, p_parent, p_date, s.PO_HEADER_ID, s.PO_LINE_ID, s.SCHEDULE_ID,
            CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN p_qty END, l.UOM_CODE, v_amt, h.CURRENCY_CODE, h.RATE, v_func, p_reason,
            p_comments, CASE WHEN s.ACCRUE_AT_RECEIPT_FLAG = 'Y' THEN 'UNACCOUNTED' ELSE 'NOT_REQUIRED' END,
            p_user, p_user, SYSTIMESTAMP)
        RETURNING RCV_TRANSACTION_ID INTO v_txn;

        -- weights: positive events by open ordered measure; negative events by what the parent delivered (net, unbilled)
        IF p_parent IS NOT NULL AND v_amt < 0 THEN
            FOR d IN (SELECT rd.DISTRIBUTION_ID, SUM(rd.AMOUNT) - SUM(rd.AMOUNT_BILLED) wt
                      FROM RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS t ON t.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
                      WHERE t.RCV_TRANSACTION_ID = p_parent OR t.PARENT_TRANSACTION_ID = p_parent
                      GROUP BY rd.DISTRIBUTION_ID ORDER BY rd.DISTRIBUTION_ID) LOOP
                v_cnt := v_cnt + 1; ids(v_cnt) := d.DISTRIBUTION_ID; w(v_cnt) := GREATEST(d.wt, 0); v_tot_w := v_tot_w + w(v_cnt);
            END LOOP;
        ELSE
            FOR d IN (SELECT DISTRIBUTION_ID, AMOUNT_ORDERED - AMOUNT_CANCELLED - AMOUNT_DELIVERED wt
                      FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = p_schedule_id ORDER BY DIST_NUM) LOOP
                v_cnt := v_cnt + 1; ids(v_cnt) := d.DISTRIBUTION_ID; w(v_cnt) := GREATEST(d.wt, 0); v_tot_w := v_tot_w + w(v_cnt);
            END LOOP;
            IF v_tot_w = 0 THEN   -- over-receipt beyond the open quantity: spread by ordered
                v_cnt := 0;
                FOR d IN (SELECT DISTRIBUTION_ID, AMOUNT_ORDERED wt FROM RR_PO_DISTRIBUTIONS WHERE SCHEDULE_ID = p_schedule_id ORDER BY DIST_NUM) LOOP
                    v_cnt := v_cnt + 1; ids(v_cnt) := d.DISTRIBUTION_ID; w(v_cnt) := d.wt; v_tot_w := v_tot_w + d.wt;
                END LOOP;
            END IF;
        END IF;
        IF v_cnt = 0 OR v_tot_w = 0 THEN RR_PO_UTIL_PKG.err('Nothing to apply this receiving event to'); END IF;

        FOR i IN 1 .. v_cnt LOOP
            IF i = v_cnt THEN
                v_q := CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN p_qty - v_sq END; v_a := v_amt - v_sa; v_f := v_func - v_sf;
            ELSE
                v_q := CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN ROUND(p_qty * w(i) / v_tot_w, 6) END;
                v_a := ROUND(v_amt * w(i) / v_tot_w, 2); v_f := ROUND(v_func * w(i) / v_tot_w, 2);
            END IF;
            v_sq := v_sq + NVL(v_q, 0); v_sa := v_sa + v_a; v_sf := v_sf + v_f;
            INSERT INTO RR_PO_RCV_DISTRIBUTIONS (RCV_TRANSACTION_ID, DISTRIBUTION_ID, QUANTITY, AMOUNT, AMOUNT_FUNC,
                CHARGE_ACCOUNT, ACCRUAL_ACCOUNT, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            SELECT v_txn, DISTRIBUTION_ID, v_q, v_a, v_f, CHARGE_ACCOUNT, ACCRUAL_ACCOUNT, p_user, p_user, SYSTIMESTAMP
            FROM RR_PO_DISTRIBUTIONS WHERE DISTRIBUTION_ID = ids(i);
            UPDATE RR_PO_DISTRIBUTIONS
            SET    QUANTITY_DELIVERED = QUANTITY_DELIVERED + NVL(v_q, 0),
                   AMOUNT_DELIVERED   = AMOUNT_DELIVERED + v_a,
                   ACCRUED_AMOUNT_FUNC = ACCRUED_AMOUNT_FUNC + CASE WHEN s.ACCRUE_AT_RECEIPT_FLAG = 'Y' THEN v_f ELSE 0 END,
                   LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE  DISTRIBUTION_ID = ids(i);
        END LOOP;
        RR_PO_DOC_PKG.rollup_schedule(p_schedule_id);
        RR_PO_DOC_PKG.rollup_header(s.PO_HEADER_ID);
        RETURN v_txn;
    END;

    PROCEDURE check_date (p_bu IN NUMBER, p_date IN DATE) IS
    BEGIN
        IF p_date IS NULL THEN RR_PO_UTIL_PKG.err('Date is required'); END IF;
        IF p_date > TRUNC(SYSDATE) THEN RR_PO_UTIL_PKG.err('Date cannot be in the future'); END IF;
        IF NOT RR_PO_UTIL_PKG.period_open(p_bu, p_date) THEN
            RR_PO_UTIL_PKG.err('The GL period of ' || TO_CHAR(p_date, 'DD-Mon-YYYY') || ' is not open');
        END IF;
    END;

    PROCEDURE RECEIVE (p_json IN CLOB, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        lines  JSON_ARRAY_T := RR_PO_UTIL_PKG.jarr(o, 'lines');
        ln     JSON_OBJECT_T;
        v_date DATE := NVL(RR_PO_UTIL_PKG.jdate(o, 'receiptDate'), TRUNC(SYSDATE));
        v_hdr  NUMBER;
        v_num  VARCHAR2(40);
        v_bu   NUMBER; v_site NUMBER; v_sup NUMBER;
        v_warn VARCHAR2(4000);
        v_qty  NUMBER; v_amt NUMBER; v_meas NUMBER; v_net NUMBER; v_done NUMBER; v_limit NUMBER;
        v_txn  NUMBER;
        v_n    NUMBER := 0;
        s      RR_PO_SCHEDULES%ROWTYPE;
        l      RR_PO_LINES%ROWTYPE;
        h      RR_PO_HEADERS%ROWTYPE;
        op     RR_PO_BU_OPTIONS%ROWTYPE;
    BEGIN
        IF lines.get_size = 0 THEN RR_PO_UTIL_PKG.err('Enter a quantity or amount on at least one line'); END IF;
        FOR i IN 0 .. lines.get_size - 1 LOOP
            ln := TREAT(lines.get(i) AS JSON_OBJECT_T);
            v_qty := RR_PO_UTIL_PKG.jnum(ln, 'quantity');
            v_amt := RR_PO_UTIL_PKG.jnum(ln, 'amount');
            IF NVL(v_qty, 0) = 0 AND NVL(v_amt, 0) = 0 THEN CONTINUE; END IF;
            BEGIN
                DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                    j43 NUMBER := RR_PO_UTIL_PKG.jnum(ln, 'scheduleId');
                BEGIN
                    SELECT * INTO s FROM RR_PO_SCHEDULES WHERE SCHEDULE_ID = j43 FOR UPDATE;
                END;
            EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Schedule ' || RR_PO_UTIL_PKG.jstr(ln, 'scheduleId') || ' not found');
            END;
            SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = s.PO_LINE_ID;
            SELECT * INTO h FROM RR_PO_HEADERS WHERE PO_HEADER_ID = s.PO_HEADER_ID;
            IF v_hdr IS NULL THEN
                v_bu := h.BUSINESS_UNIT_ID; v_site := h.SUPPLIER_SITE_ID; v_sup := h.SUPPLIER_ID;
                op := RR_PO_UTIL_PKG.opt(v_bu);
                check_date(v_bu, v_date);
                v_num := RR_PO_UTIL_PKG.next_number(v_bu, 'RCV');
                DECLARE   -- JSON values read into variables first: SQL cannot take PL/SQL JSON objects (ORA-40573)
                    j44 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'deliveryNote');
                    j45 VARCHAR2(4000) := RR_PO_UTIL_PKG.jstr(o, 'comments');
                BEGIN
                    INSERT INTO RR_PO_RCV_HEADERS (RECEIPT_NUMBER, BUSINESS_UNIT_ID, SUPPLIER_ID, SUPPLIER_SITE_ID, RECEIPT_DATE,
                        DELIVERY_NOTE_NUM, COMMENTS, RECEIVED_BY, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                    VALUES (v_num, v_bu, v_sup, v_site, v_date, j44, j45,
                        p_user, p_user, p_user, SYSTIMESTAMP)
                    RETURNING RECEIPT_HEADER_ID INTO v_hdr;
                END;
            ELSIF h.SUPPLIER_SITE_ID <> v_site OR h.BUSINESS_UNIT_ID <> v_bu THEN
                RR_PO_UTIL_PKG.err('One receipt covers one supplier site — PO ' || h.PO_NUMBER || ' is for another supplier/site');
            END IF;
            IF h.DOCUMENT_STATUS <> 'APPROVED' THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' is not approved'); END IF;
            IF h.HOLD_FLAG = 'Y' THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' is on hold: ' || h.HOLD_REASON); END IF;
            IF s.CANCELLED_FLAG = 'Y' OR s.CLOSURE_STATUS NOT IN ('OPEN', 'CLOSED_FOR_INVOICING') THEN
                RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ' is closed for receiving');
            END IF;
            IF op.SOD_BUYER_RECEIVE = 'N' AND UPPER(h.BUYER_USER) = UPPER(p_user) THEN
                RR_PO_UTIL_PKG.err('The buyer of PO ' || h.PO_NUMBER || ' cannot receive against it');
            END IF;
            IF op.EARLY_RECEIPT_DAYS IS NOT NULL AND v_date < s.NEED_BY_DATE - op.EARLY_RECEIPT_DAYS THEN
                RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ': more than ' || op.EARLY_RECEIPT_DAYS
                                   || ' days before the need-by date');
            END IF;
            IF l.LINE_TYPE = 'QUANTITY' THEN
                IF NVL(v_qty, 0) <= 0 THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ': quantity must be positive'); END IF;
                v_meas := v_qty; v_net := NVL(s.QUANTITY, 0) - s.QUANTITY_CANCELLED; v_done := s.QUANTITY_RECEIVED;
            ELSE
                IF NVL(v_amt, 0) <= 0 THEN RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ': amount must be positive'); END IF;
                v_meas := v_amt; v_net := s.AMOUNT - s.AMOUNT_CANCELLED; v_done := s.AMOUNT_RECEIVED;
            END IF;
            v_limit := v_net * (1 + NVL(s.OVER_RECEIPT_TOL_PCT, 0) / 100);
            IF v_done + v_meas > v_limit + 0.000001 THEN
                IF NVL(s.OVER_RECEIPT_ACTION, 'REJECT') = 'REJECT' THEN
                    RR_PO_UTIL_PKG.err('PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ': receiving ' || v_meas || ' exceeds the open '
                                       || (v_net - v_done) || CASE WHEN NVL(s.OVER_RECEIPT_TOL_PCT, 0) > 0
                                                                  THEN ' (+' || s.OVER_RECEIPT_TOL_PCT || '% tolerance)' END);
                END IF;
                v_warn := SUBSTR(v_warn || 'PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ' over-received; ', 1, 4000);
            END IF;
            v_txn := post_event(v_hdr, 'RECEIVE', NULL, s.SCHEDULE_ID, v_qty, v_amt, v_date, NULL, RR_PO_UTIL_PKG.jstr(ln, 'comments'), p_user);
            v_n := v_n + 1;
        END LOOP;
        IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Enter a quantity or amount on at least one line'); END IF;
        RR_PO_UTIL_PKG.history('RCV', v_hdr, 'RECEIVE', NULL, NULL, p_user, v_n || ' line(s)' || CASE WHEN v_warn IS NOT NULL THEN '; ' || v_warn END);
        p_id := v_hdr; p_number := v_num;
        p_status := CASE WHEN v_warn IS NULL THEN 'S' ELSE 'W' END;
        p_message := 'Receipt ' || v_num || ' created (' || v_n || ' line(s))' || CASE WHEN v_warn IS NOT NULL THEN ' — warning: ' || v_warn END;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE adjust (p_type IN VARCHAR2, p_rcv_transaction_id IN VARCHAR2, p_quantity IN VARCHAR2, p_amount IN VARCHAR2,
                      p_reason IN VARCHAR2, p_txn_date IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        t      RR_PO_RCV_TRANSACTIONS%ROWTYPE;
        s      RR_PO_SCHEDULES%ROWTYPE;
        l      RR_PO_LINES%ROWTYPE;
        h      RR_PO_HEADERS%ROWTYPE;
        v_qty  NUMBER := RR_PO_UTIL_PKG.to_num(p_quantity);
        v_amt  NUMBER := RR_PO_UTIL_PKG.to_num(p_amount);
        v_date DATE := NVL(RR_PO_UTIL_PKG.to_dt(p_txn_date), TRUNC(SYSDATE));
        v_ret_q NUMBER; v_ret_a NUMBER;
        v_meas NUMBER; v_limit NUMBER;
        v_txn  NUMBER;
        v_num  VARCHAR2(40);
    BEGIN
        BEGIN
            SELECT * INTO t FROM RR_PO_RCV_TRANSACTIONS WHERE RCV_TRANSACTION_ID = RR_PO_UTIL_PKG.to_num(p_rcv_transaction_id) FOR UPDATE;
        EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Receipt transaction not found');
        END;
        IF t.TRANSACTION_TYPE <> 'RECEIVE' THEN RR_PO_UTIL_PKG.err('Returns and corrections are made against the original receipt line'); END IF;
        SELECT * INTO s FROM RR_PO_SCHEDULES WHERE SCHEDULE_ID = t.SCHEDULE_ID FOR UPDATE;
        SELECT * INTO l FROM RR_PO_LINES WHERE PO_LINE_ID = t.PO_LINE_ID;
        SELECT * INTO h FROM RR_PO_HEADERS WHERE PO_HEADER_ID = t.PO_HEADER_ID;
        IF s.CLOSURE_STATUS = 'FINALLY_CLOSED' THEN RR_PO_UTIL_PKG.err('The PO line is finally closed'); END IF;
        IF v_date < t.TRANSACTION_DATE THEN RR_PO_UTIL_PKG.err('Date cannot be before the receipt date'); END IF;
        check_date(h.BUSINESS_UNIT_ID, v_date);
        -- what is still returnable from this receipt line
        SELECT NVL(t.QUANTITY, 0) + NVL(SUM(c.QUANTITY), 0), t.AMOUNT + NVL(SUM(c.AMOUNT), 0)
        INTO   v_ret_q, v_ret_a
        FROM   RR_PO_RCV_TRANSACTIONS c WHERE c.PARENT_TRANSACTION_ID = t.RCV_TRANSACTION_ID;
        SELECT v_ret_q - NVL(SUM(rd.QUANTITY_BILLED), 0), v_ret_a - NVL(SUM(rd.AMOUNT_BILLED), 0)
        INTO   v_ret_q, v_ret_a
        FROM   RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS x ON x.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
        WHERE  x.RCV_TRANSACTION_ID = t.RCV_TRANSACTION_ID OR x.PARENT_TRANSACTION_ID = t.RCV_TRANSACTION_ID;
        v_meas := CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN v_qty ELSE v_amt END;
        IF NVL(v_meas, 0) = 0 THEN RR_PO_UTIL_PKG.err('Enter the ' || CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN 'quantity' ELSE 'amount' END); END IF;
        IF p_type = 'RETURN_TO_SUPPLIER' THEN
            IF v_meas < 0 THEN v_meas := -v_meas; END IF;
            IF TRIM(p_reason) IS NULL THEN RR_PO_UTIL_PKG.err('Return reason is required'); END IF;
            IF v_meas > CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN v_ret_q ELSE v_ret_a END + 0.000001 THEN
                RR_PO_UTIL_PKG.err('You can return at most ' || CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN v_ret_q ELSE v_ret_a END
                                   || ' (received, net of earlier returns and billed)');
            END IF;
            v_meas := -v_meas;
        ELSE   -- CORRECT: signed
            IF v_meas < 0 AND -v_meas > CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN v_ret_q ELSE v_ret_a END + 0.000001 THEN
                RR_PO_UTIL_PKG.err('A negative correction cannot exceed what is left of this receipt line');
            END IF;
            IF v_meas > 0 THEN
                v_limit := CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN NVL(s.QUANTITY, 0) - s.QUANTITY_CANCELLED ELSE s.AMOUNT - s.AMOUNT_CANCELLED END
                           * (1 + NVL(s.OVER_RECEIPT_TOL_PCT, 0) / 100);
                IF CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN s.QUANTITY_RECEIVED ELSE s.AMOUNT_RECEIVED END + v_meas > v_limit + 0.000001
                   AND NVL(s.OVER_RECEIPT_ACTION, 'REJECT') = 'REJECT' THEN
                    RR_PO_UTIL_PKG.err('The correction would exceed the ordered quantity');
                END IF;
            END IF;
        END IF;
        v_txn := post_event(t.RECEIPT_HEADER_ID, p_type, t.RCV_TRANSACTION_ID, t.SCHEDULE_ID,
                            CASE WHEN l.LINE_TYPE = 'QUANTITY' THEN v_meas END,
                            CASE WHEN l.LINE_TYPE = 'AMOUNT' THEN v_meas END,
                            v_date, p_reason, p_comments, p_user);
        SELECT RECEIPT_NUMBER INTO v_num FROM RR_PO_RCV_HEADERS WHERE RECEIPT_HEADER_ID = t.RECEIPT_HEADER_ID;
        RR_PO_UTIL_PKG.history('RCV', t.RECEIPT_HEADER_ID, p_type, NULL, NULL, p_user,
                               'PO ' || h.PO_NUMBER || ' line ' || l.LINE_NUM || ': ' || v_meas || CASE WHEN p_reason IS NOT NULL THEN ' (' || p_reason || ')' END);
        p_id := v_txn; p_number := v_num; p_status := 'S';
        p_message := CASE WHEN p_type = 'RETURN_TO_SUPPLIER' THEN 'Returned ' ELSE 'Corrected by ' END || v_meas || ' on receipt ' || v_num;
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE RETURN_TO_SUPPLIER (p_rcv_transaction_id IN VARCHAR2, p_quantity IN VARCHAR2, p_amount IN VARCHAR2,
                                  p_reason IN VARCHAR2, p_txn_date IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
    BEGIN
        adjust('RETURN_TO_SUPPLIER', p_rcv_transaction_id, p_quantity, p_amount, p_reason, p_txn_date, p_comments, p_user,
               p_id, p_number, p_status, p_message);
    END;

    PROCEDURE CORRECT (p_rcv_transaction_id IN VARCHAR2, p_quantity IN VARCHAR2, p_amount IN VARCHAR2,
                       p_txn_date IN VARCHAR2, p_comments IN VARCHAR2, p_user IN VARCHAR2,
                       p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
    BEGIN
        adjust('CORRECT', p_rcv_transaction_id, p_quantity, p_amount, NULL, p_txn_date, p_comments, p_user,
               p_id, p_number, p_status, p_message);
    END;
END RR_PO_RCV_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_ACCT_PKG — accounting stamps, period-end accrual, write-off
--   Journals are created by the page through the existing SLA → GL pipeline
--   (sla/accounting/create, journals/create, gl/journals/:id/post), the same
--   route Petty Cash and AR use; this package records the outcome.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_ACCT_PKG AS

    PROCEDURE MARK_ACCOUNTED (p_entity IN VARCHAR2, p_ids IN VARCHAR2, p_sla_header_id IN VARCHAR2,
                              p_gl_batch_id IN VARCHAR2, p_reversal_gl_batch_id IN VARCHAR2, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_n NUMBER := 0;
    BEGIN
        FOR x IN (SELECT RR_PO_UTIL_PKG.to_num(REGEXP_SUBSTR(p_ids, '[^,]+', 1, LEVEL)) id FROM dual
                  CONNECT BY LEVEL <= REGEXP_COUNT(p_ids, ',') + 1) LOOP
            CASE UPPER(p_entity)
            WHEN 'RCV' THEN
                UPDATE RR_PO_RCV_TRANSACTIONS SET ACCOUNTING_STATUS = 'ACCOUNTED',
                       SLA_HEADER_ID = RR_PO_UTIL_PKG.to_num(p_sla_header_id), GL_BATCH_ID = RR_PO_UTIL_PKG.to_num(p_gl_batch_id),
                       LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  RCV_TRANSACTION_ID = x.id AND ACCOUNTING_STATUS = 'UNACCOUNTED';
            WHEN 'WRITE_OFF' THEN
                UPDATE RR_PO_ACCRUAL_WRITE_OFFS SET ACCOUNTING_STATUS = 'ACCOUNTED',
                       SLA_HEADER_ID = RR_PO_UTIL_PKG.to_num(p_sla_header_id), GL_BATCH_ID = RR_PO_UTIL_PKG.to_num(p_gl_batch_id),
                       LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  WRITE_OFF_ID = x.id AND ACCOUNTING_STATUS = 'UNACCOUNTED';
            WHEN 'ACCRUAL_RUN' THEN
                UPDATE RR_PO_ACCRUAL_RUNS SET STATUS = 'POSTED',
                       SLA_HEADER_ID = RR_PO_UTIL_PKG.to_num(p_sla_header_id), GL_BATCH_ID = RR_PO_UTIL_PKG.to_num(p_gl_batch_id),
                       REVERSAL_GL_BATCH_ID = RR_PO_UTIL_PKG.to_num(p_reversal_gl_batch_id),
                       LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  RUN_ID = x.id AND STATUS = 'DRAFT';
            ELSE RR_PO_UTIL_PKG.err('Unknown entity ' || p_entity);
            END CASE;
            v_n := v_n + SQL%ROWCOUNT;
        END LOOP;
        p_id := v_n; p_status := 'S'; p_message := v_n || ' record(s) marked accounted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE RUN_PERIOD_END_ACCRUAL (p_business_unit_id IN VARCHAR2, p_period_name IN VARCHAR2,
                                      p_accrual_date IN VARCHAR2, p_reversal_date IN VARCHAR2, p_user IN VARCHAR2,
                                      p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_bu   NUMBER := RR_PO_UTIL_PKG.to_num(p_business_unit_id);
        v_acc  DATE := RR_PO_UTIL_PKG.to_dt(p_accrual_date);
        v_rev  DATE := RR_PO_UTIL_PKG.to_dt(p_reversal_date);
        op     RR_PO_BU_OPTIONS%ROWTYPE;
        v_run  NUMBER;
        v_n    NUMBER;
        v_tot  NUMBER := 0;
    BEGIN
        op := RR_PO_UTIL_PKG.opt(v_bu);
        IF v_acc IS NULL OR v_rev IS NULL OR v_rev <= v_acc THEN RR_PO_UTIL_PKG.err('Accrual date and a later reversal date are required'); END IF;
        IF NOT RR_PO_UTIL_PKG.period_open(v_bu, v_acc) THEN RR_PO_UTIL_PKG.err('The GL period of the accrual date is not open'); END IF;
        SELECT COUNT(*) INTO v_n FROM RR_PO_ACCRUAL_RUNS WHERE BUSINESS_UNIT_ID = v_bu AND PERIOD_NAME = p_period_name AND STATUS = 'POSTED';
        IF v_n > 0 THEN RR_PO_UTIL_PKG.err('A posted accrual run already exists for ' || p_period_name); END IF;
        DELETE FROM RR_PO_ACCRUAL_LINES WHERE RUN_ID IN (SELECT RUN_ID FROM RR_PO_ACCRUAL_RUNS
                                                         WHERE BUSINESS_UNIT_ID = v_bu AND PERIOD_NAME = p_period_name AND STATUS = 'DRAFT');
        DELETE FROM RR_PO_ACCRUAL_RUNS WHERE BUSINESS_UNIT_ID = v_bu AND PERIOD_NAME = p_period_name AND STATUS = 'DRAFT';
        INSERT INTO RR_PO_ACCRUAL_RUNS (BUSINESS_UNIT_ID, PERIOD_NAME, ACCRUAL_DATE, REVERSAL_DATE, STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
        VALUES (v_bu, p_period_name, v_acc, v_rev, 'DRAFT', p_user, p_user, SYSTIMESTAMP)
        RETURNING RUN_ID INTO v_run;
        -- received-not-billed as of the accrual date, valued at PO price and PO rate
        FOR d IN (SELECT d.DISTRIBUTION_ID, d.CHARGE_ACCOUNT, NVL(d.ACCRUAL_ACCOUNT, op.RECEIPT_ACCRUAL_ACCOUNT) ACCRUAL_ACCOUNT, d.RATE,
                         NVL((SELECT SUM(rd.QUANTITY) FROM RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS t
                              ON t.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
                              WHERE rd.DISTRIBUTION_ID = d.DISTRIBUTION_ID AND t.TRANSACTION_DATE <= v_acc), 0) - d.QUANTITY_BILLED AS qty,
                         NVL((SELECT SUM(rd.AMOUNT) FROM RR_PO_RCV_DISTRIBUTIONS rd JOIN RR_PO_RCV_TRANSACTIONS t
                              ON t.RCV_TRANSACTION_ID = rd.RCV_TRANSACTION_ID
                              WHERE rd.DISTRIBUTION_ID = d.DISTRIBUTION_ID AND t.TRANSACTION_DATE <= v_acc), 0) - d.AMOUNT_BILLED AS amt
                  FROM   RR_PO_DISTRIBUTIONS d
                  JOIN   RR_PO_SCHEDULES s ON s.SCHEDULE_ID = d.SCHEDULE_ID
                  JOIN   RR_PO_HEADERS h   ON h.PO_HEADER_ID = d.PO_HEADER_ID
                  WHERE  h.BUSINESS_UNIT_ID = v_bu AND NVL(s.ACCRUE_AT_RECEIPT_FLAG, 'N') = 'N'
                  AND    d.AMOUNT_DELIVERED <> 0) LOOP
            IF d.amt > 0 THEN
                IF d.ACCRUAL_ACCOUNT IS NULL THEN RR_PO_UTIL_PKG.err('Set the receipt accrual account in Purchasing Options'); END IF;
                INSERT INTO RR_PO_ACCRUAL_LINES (RUN_ID, DISTRIBUTION_ID, QUANTITY, AMOUNT_FUNC, CHARGE_ACCOUNT, ACCRUAL_ACCOUNT, CREATED_BY)
                VALUES (v_run, d.DISTRIBUTION_ID, CASE WHEN d.qty > 0 THEN d.qty END, ROUND(d.amt * d.RATE, 2), d.CHARGE_ACCOUNT,
                        d.ACCRUAL_ACCOUNT, p_user);
                v_tot := v_tot + ROUND(d.amt * d.RATE, 2);
            END IF;
        END LOOP;
        UPDATE RR_PO_ACCRUAL_RUNS SET TOTAL_AMOUNT_FUNC = v_tot WHERE RUN_ID = v_run;
        RR_PO_UTIL_PKG.history('ACR', v_run, 'RUN', NULL, 'DRAFT', p_user, p_period_name || ': ' || v_tot);
        p_id := v_run; p_number := p_period_name; p_status := 'S';
        p_message := 'Accrual run for ' || p_period_name || ': ' || TO_CHAR(v_tot, 'FM999,999,999,990.00') || ' — review and post';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE CANCEL_ACCRUAL_RUN (p_run_id IN VARCHAR2, p_user IN VARCHAR2,
                                  p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        r RR_PO_ACCRUAL_RUNS%ROWTYPE;
    BEGIN
        SELECT * INTO r FROM RR_PO_ACCRUAL_RUNS WHERE RUN_ID = RR_PO_UTIL_PKG.to_num(p_run_id) FOR UPDATE;
        IF r.STATUS <> 'DRAFT' THEN RR_PO_UTIL_PKG.err('Only draft runs can be cancelled — a posted run is reversed in GL'); END IF;
        UPDATE RR_PO_ACCRUAL_RUNS SET STATUS = 'CANCELLED', LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP WHERE RUN_ID = r.RUN_ID;
        p_id := r.RUN_ID; p_status := 'S'; p_message := 'Run cancelled';
    EXCEPTION WHEN NO_DATA_FOUND THEN p_status := 'E'; p_message := 'Run not found';
              WHEN OTHERS THEN p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE WRITE_OFF (p_json IN CLOB, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        ids    JSON_ARRAY_T := RR_PO_UTIL_PKG.jarr(o, 'distributionIds');
        v_rsn  VARCHAR2(1000) := RR_PO_UTIL_PKG.jstr(o, 'reason');
        v_date DATE := NVL(RR_PO_UTIL_PKG.jdate(o, 'writeOffDate'), TRUNC(SYSDATE));
        v_acct VARCHAR2(200) := RR_PO_UTIL_PKG.jstr(o, 'account');
        op     RR_PO_BU_OPTIONS%ROWTYPE;
        v_n    NUMBER := 0;
        v_tot  NUMBER := 0;
        v_last DATE;
        v_use  VARCHAR2(200);
        v_e    VARCHAR2(400);
        v_did  NUMBER;
    BEGIN
        IF TRIM(v_rsn) IS NULL THEN RR_PO_UTIL_PKG.err('Reason is required'); END IF;
        IF ids.get_size = 0 THEN RR_PO_UTIL_PKG.err('Select at least one line'); END IF;
        FOR i IN 0 .. ids.get_size - 1 LOOP
            v_did := ids.get_number(i);
            FOR d IN (SELECT d.*, s.CLOSURE_STATUS, h.BUSINESS_UNIT_ID, h.PO_NUMBER
                      FROM RR_PO_DISTRIBUTIONS d JOIN RR_PO_SCHEDULES s ON s.SCHEDULE_ID = d.SCHEDULE_ID
                      JOIN RR_PO_HEADERS h ON h.PO_HEADER_ID = d.PO_HEADER_ID
                      WHERE d.DISTRIBUTION_ID = v_did FOR UPDATE OF d.ACCRUED_AMOUNT_FUNC) LOOP
                op := RR_PO_UTIL_PKG.opt(d.BUSINESS_UNIT_ID);
                IF d.ACCRUED_AMOUNT_FUNC <= 0 THEN RR_PO_UTIL_PKG.err('PO ' || d.PO_NUMBER || ': nothing accrued to write off'); END IF;
                SELECT MAX(t.TRANSACTION_DATE) INTO v_last FROM RR_PO_RCV_TRANSACTIONS t WHERE t.SCHEDULE_ID = d.SCHEDULE_ID;
                IF d.CLOSURE_STATUS NOT IN ('CLOSED', 'CLOSED_FOR_RECEIVING', 'FINALLY_CLOSED')
                   AND (op.ACCRUAL_WRITE_OFF_AGE_DAYS IS NULL OR v_last > TRUNC(SYSDATE) - op.ACCRUAL_WRITE_OFF_AGE_DAYS) THEN
                    RR_PO_UTIL_PKG.err('PO ' || d.PO_NUMBER || ': only closed lines'
                        || CASE WHEN op.ACCRUAL_WRITE_OFF_AGE_DAYS IS NOT NULL THEN ' or receipts older than ' || op.ACCRUAL_WRITE_OFF_AGE_DAYS || ' days' END
                        || ' can be written off');
                END IF;
                v_use := NVL(v_acct, NVL(op.ACCRUAL_WRITE_OFF_ACCOUNT, d.CHARGE_ACCOUNT));
                v_e := RR_PO_UTIL_PKG.account_error(v_use, d.BUSINESS_UNIT_ID);
                IF v_e IS NOT NULL THEN RR_PO_UTIL_PKG.err(v_e); END IF;
                INSERT INTO RR_PO_ACCRUAL_WRITE_OFFS (DISTRIBUTION_ID, AMOUNT_FUNC, WRITE_OFF_ACCOUNT, ACCRUAL_ACCOUNT, WRITE_OFF_DATE,
                                                      REASON, ACCOUNTING_STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                VALUES (d.DISTRIBUTION_ID, d.ACCRUED_AMOUNT_FUNC, v_use, d.ACCRUAL_ACCOUNT, v_date, v_rsn, 'UNACCOUNTED',
                        p_user, p_user, SYSTIMESTAMP);
                UPDATE RR_PO_DISTRIBUTIONS SET ACCRUED_AMOUNT_FUNC = 0, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE DISTRIBUTION_ID = d.DISTRIBUTION_ID;
                RR_PO_UTIL_PKG.history('PO', d.PO_HEADER_ID, 'ACCRUAL_WRITE_OFF', NULL, NULL, p_user, d.ACCRUED_AMOUNT_FUNC || ': ' || v_rsn);
                v_n := v_n + 1; v_tot := v_tot + d.ACCRUED_AMOUNT_FUNC;
            END LOOP;
        END LOOP;
        p_id := v_n; p_status := 'S';
        p_message := v_n || ' accrual(s) written off: ' || TO_CHAR(v_tot, 'FM999,999,999,990.00') || ' — create accounting to post them';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_ACCT_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_APPROVAL_PKG — existing approval engine
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE BODY RR_PO_APPROVAL_PKG AS

    -- picks the rule (module PROCUREMENT, type, amount band, BU, category), creates the request
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
        IF v_rule IS NULL THEN RETURN NULL; END IF;
        SELECT MAX(ra.USER_ID) KEEP (DENSE_RANK FIRST ORDER BY ra.SEQUENCE) INTO v_appr
        FROM   RR_APPROVAL_RULE_APPROVERS ra WHERE ra.RULE_ID = v_rule;
        INSERT INTO RR_APPROVAL_REQUESTS (MODULE, TRANSACTION_TYPE, TRANSACTION_ID, TRANSACTION_REF, AMOUNT, CURRENCY,
                                          DESCRIPTION, REQUESTED_BY_NAME, STATUS, RULE_ID, CURRENT_APPROVER_ID)
        VALUES ('PROCUREMENT', p_type, p_doc_id, p_ref, p_amount, p_currency, SUBSTR(p_desc, 1, 1000), p_user, 'PENDING',
                v_rule, v_appr)
        RETURNING REQUEST_ID INTO v_req;
        INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS)
        VALUES (v_req, 'SUBMITTED', p_user, SUBSTR(p_type || ' ' || p_ref, 1, 2000));
        RETURN v_req;
    END;

    PROCEDURE recall (p_request_id IN NUMBER, p_user IN VARCHAR2) IS
    BEGIN
        IF p_request_id IS NULL THEN RETURN; END IF;
        UPDATE RR_APPROVAL_REQUESTS SET STATUS = 'RECALLED' WHERE REQUEST_ID = p_request_id AND STATUS = 'PENDING';
        IF SQL%ROWCOUNT > 0 THEN
            INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS) VALUES (p_request_id, 'RECALLED', p_user, 'Withdrawn');
        END IF;
    END;

    -- called by the trigger on RR_APPROVAL_REQUESTS whenever a PROCUREMENT request changes status
    -- (approval page, notification panel, email links or DECIDE below) — must not read RR_APPROVAL_REQUESTS
    PROCEDURE on_decision (p_request_id IN NUMBER, p_type IN VARCHAR2, p_txn_id IN NUMBER, p_status IN VARCHAR2) IS
        v_cur VARCHAR2(30);
        v_rq  NUMBER;
    BEGIN
        IF p_type = 'REQUISITION' THEN
            SELECT MAX(STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_REQ_HEADERS WHERE REQ_HEADER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_REQ_PKG.approve_internal(p_txn_id, 'APPROVER');
            ELSIF p_status = 'REJECTED' THEN
                UPDATE RR_PO_REQ_HEADERS SET STATUS = 'REJECTED', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE REQ_HEADER_ID = p_txn_id;
                RR_PO_UTIL_PKG.history('REQ', p_txn_id, 'REJECT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVER');
            ELSIF p_status IN ('RECALLED', 'CANCELLED') THEN
                UPDATE RR_PO_REQ_HEADERS SET STATUS = 'INCOMPLETE', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE REQ_HEADER_ID = p_txn_id;
            END IF;
        ELSIF p_type = 'PURCHASE_ORDER' THEN
            SELECT MAX(DOCUMENT_STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_HEADERS WHERE PO_HEADER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_DOC_PKG.approve_internal(p_txn_id, 'APPROVER');
            ELSIF p_status = 'REJECTED' THEN
                UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'REJECTED', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE PO_HEADER_ID = p_txn_id;
                RR_PO_UTIL_PKG.history('PO', p_txn_id, 'REJECT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVER');
            ELSIF p_status IN ('RECALLED', 'CANCELLED') THEN
                UPDATE RR_PO_HEADERS SET DOCUMENT_STATUS = 'INCOMPLETE', LAST_UPDATE_DATE = SYSTIMESTAMP WHERE PO_HEADER_ID = p_txn_id;
            END IF;
        ELSIF p_type = 'PO_CHANGE_ORDER' THEN
            SELECT MAX(STATUS), MAX(APPROVAL_REQUEST_ID) INTO v_cur, v_rq FROM RR_PO_CHANGE_ORDERS WHERE CHANGE_ORDER_ID = p_txn_id;
            IF v_cur <> 'PENDING_APPROVAL' OR NVL(v_rq, -1) <> p_request_id THEN RETURN; END IF;
            IF p_status = 'APPROVED' THEN RR_PO_DOC_PKG.apply_change(p_txn_id, 'APPROVER');
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
        UPDATE RR_APPROVAL_REQUESTS SET STATUS = UPPER(p_decision) WHERE REQUEST_ID = v_id;   -- fires the trigger
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
    RR_PO_APPROVAL_PKG.on_decision(:NEW.REQUEST_ID, :NEW.TRANSACTION_TYPE, :NEW.TRANSACTION_ID, :NEW.STATUS);
END;
/

-- Compile check
SELECT object_name, object_type, status FROM user_objects
WHERE  object_name LIKE 'RR\_PO\_%' ESCAPE '\' AND object_type IN ('PACKAGE', 'PACKAGE BODY', 'TRIGGER')
ORDER  BY object_name, object_type;
SELECT name, type, line, position, text FROM user_errors WHERE name LIKE 'RR\_PO\_%' ESCAPE '\' ORDER BY name, type, sequence;
