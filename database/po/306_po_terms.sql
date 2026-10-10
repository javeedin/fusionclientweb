-- =============================================================================
-- Purchasing-RR (module PO) — 306: terms and conditions
--
--   Tables  : RR_PO_TERMS        clause library (one business unit, or all when blank)
--             RR_PO_ORDER_TERMS  the clauses of each purchase order: a copy of the wording
--                                taken when the clause was added, so later library edits never
--                                change an order that was already sent. Editable while the PO
--                                is a draft (INCOMPLETE) or REJECTED.
--   Trigger : RR_PO_ORDER_TERMS_DEFAULT_TRG — every new PO (manual, autocreate, copy) gets the
--             active default and mandatory clauses of its business unit.
--   Package : RR_PO_TERMS_PKG
--               SAVE_TERM      create / update a library clause          (p_json)
--               DELETE_TERM    delete an unused library clause           (p_term_id)
--               SET_TERM_ORDER renumber library clauses                  (p_json: [{termId, displayOrder}])
--               SET_PO_TERMS   replace the clauses of one PO             (p_po_header_id, p_json: [{termId, title, text}])
--   Views   : RR_PO_V_TERMS, RR_PO_V_ORDER_TERMS
--
--   Clause text may contain merge fields such as {PO_NUMBER} or {SUPPLIER_NAME}; the app
--   fills them in on screen and in the printed PO (the stored text keeps the placeholders).
--
-- First install only (when RR_PO_TERMS is created by this run):
--   * each business unit's old free-text "Terms and conditions" (Purchasing Options,
--     RR_PO_BU_OPTIONS.PO_TERMS_TEXT) becomes a default library clause of that business unit,
--     so new POs keep printing the same terms;
--   * every existing PO of that business unit gets the same text, so reprints do not change.
--
-- Run after 305. Safe to re-run.
-- =============================================================================

DECLARE
    v_n        NUMBER;
    v_new      BOOLEAN := FALSE;
    v_legacy   CLOB;
    v_len      NUMBER;
    v_pos      NUMBER;
    v_piece    VARCHAR2(32767);
    v_cut      NUMBER;
    v_part     NUMBER;
    v_more     BOOLEAN;
    v_title    VARCHAR2(240);
    v_term_id  NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM user_tables WHERE table_name = 'RR_PO_TERMS';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE q'[
CREATE TABLE RR_PO_TERMS (
    TERM_ID          NUMBER DEFAULT RR_PO_SEQ.NEXTVAL PRIMARY KEY,
    TERM_CODE        VARCHAR2(40)   NOT NULL,
    TITLE            VARCHAR2(240)  NOT NULL,
    TERM_TEXT        VARCHAR2(4000) NOT NULL,
    TERM_CATEGORY    VARCHAR2(30)   DEFAULT 'GENERAL' NOT NULL,
    BUSINESS_UNIT_ID NUMBER,
    DISPLAY_ORDER    NUMBER         DEFAULT 100 NOT NULL,
    DEFAULT_FLAG     VARCHAR2(1)    DEFAULT 'Y' NOT NULL,
    MANDATORY_FLAG   VARCHAR2(1)    DEFAULT 'N' NOT NULL,
    STATUS           VARCHAR2(10)   DEFAULT 'ACTIVE' NOT NULL,
    CREATED_BY VARCHAR2(150), CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY VARCHAR2(150), LAST_UPDATE_DATE TIMESTAMP,
    CONSTRAINT RR_PO_TERMS_UK    UNIQUE (TERM_CODE),
    CONSTRAINT RR_PO_TERMS_DF_CK CHECK (DEFAULT_FLAG IN ('Y','N')),
    CONSTRAINT RR_PO_TERMS_MF_CK CHECK (MANDATORY_FLAG IN ('Y','N')),
    CONSTRAINT RR_PO_TERMS_ST_CK CHECK (STATUS IN ('ACTIVE','INACTIVE'))
)]';
        v_new := TRUE;
    END IF;

    SELECT COUNT(*) INTO v_n FROM user_tables WHERE table_name = 'RR_PO_ORDER_TERMS';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE q'[
CREATE TABLE RR_PO_ORDER_TERMS (
    PO_TERM_ID     NUMBER DEFAULT RR_PO_SEQ.NEXTVAL PRIMARY KEY,
    PO_HEADER_ID   NUMBER         NOT NULL,
    TERM_ID        NUMBER,                       -- library clause it came from; NULL = written for this PO only
    SEQ_NUM        NUMBER         NOT NULL,
    TITLE          VARCHAR2(240)  NOT NULL,
    TERM_TEXT      VARCHAR2(4000) NOT NULL,
    MANDATORY_FLAG VARCHAR2(1)    DEFAULT 'N' NOT NULL,
    CREATED_BY VARCHAR2(150), CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY VARCHAR2(150), LAST_UPDATE_DATE TIMESTAMP,
    CONSTRAINT RR_PO_OT_PO_FK FOREIGN KEY (PO_HEADER_ID) REFERENCES RR_PO_HEADERS (PO_HEADER_ID) ON DELETE CASCADE,
    CONSTRAINT RR_PO_OT_MF_CK CHECK (MANDATORY_FLAG IN ('Y','N'))
)]';
    END IF;

    -- ── first install: carry the old free-text terms over ─────────────────────
    IF v_new THEN
        FOR b IN (SELECT o.BUSINESS_UNIT_ID, o.PO_TERMS_TEXT
                  FROM   RR_PO_BU_OPTIONS o
                  WHERE  o.PO_TERMS_TEXT IS NOT NULL AND DBMS_LOB.GETLENGTH(o.PO_TERMS_TEXT) > 0) LOOP
            v_legacy := b.PO_TERMS_TEXT;
            v_len := DBMS_LOB.GETLENGTH(v_legacy);
            v_pos := 1; v_part := 0;
            WHILE v_pos <= v_len LOOP
                -- at most 4000 bytes per clause: 3900 characters, or 1000 when the text is multi-byte
                v_piece := DBMS_LOB.SUBSTR(v_legacy, 3900, v_pos);
                IF LENGTHB(v_piece) > 4000 THEN v_piece := DBMS_LOB.SUBSTR(v_legacy, 1000, v_pos); END IF;
                v_more := v_pos + LENGTH(v_piece) <= v_len;
                IF v_more THEN   -- cut at the last line break so a sentence is not split
                    v_cut := INSTR(v_piece, CHR(10), -1);
                    IF v_cut > 200 THEN v_piece := SUBSTR(v_piece, 1, v_cut); END IF;
                END IF;
                v_pos := v_pos + LENGTH(v_piece);
                v_piece := RTRIM(LTRIM(v_piece, CHR(10) || CHR(13)), CHR(10) || CHR(13) || ' ');
                IF v_piece IS NOT NULL THEN
                    v_part := v_part + 1;
                    v_title := CASE WHEN v_part = 1 THEN 'Terms and conditions' ELSE 'Terms and conditions (continued)' END;
                    EXECUTE IMMEDIATE
                        'INSERT INTO RR_PO_TERMS (TERM_CODE, TITLE, TERM_TEXT, TERM_CATEGORY, BUSINESS_UNIT_ID, DISPLAY_ORDER,
                                                  DEFAULT_FLAG, MANDATORY_FLAG, STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
                         VALUES (:c, :t, :x, ''GENERAL'', :bu, :o, ''Y'', ''N'', ''ACTIVE'', ''PATCH306'', ''PATCH306'', SYSTIMESTAMP)
                         RETURNING TERM_ID INTO :id'
                        USING 'LEGACY-' || b.BUSINESS_UNIT_ID || CASE WHEN v_part > 1 THEN '-' || v_part END,
                              v_title, v_piece, b.BUSINESS_UNIT_ID, v_part * 10
                        RETURNING INTO v_term_id;
                    -- existing orders of the business unit keep printing the same text
                    EXECUTE IMMEDIATE
                        'INSERT INTO RR_PO_ORDER_TERMS (PO_HEADER_ID, TERM_ID, SEQ_NUM, TITLE, TERM_TEXT, MANDATORY_FLAG, CREATED_BY)
                         SELECT h.PO_HEADER_ID, :id, :s, :t, :x, ''N'', ''PATCH306''
                         FROM   RR_PO_HEADERS h WHERE h.BUSINESS_UNIT_ID = :bu'
                        USING v_term_id, v_part * 10, v_title, v_piece, b.BUSINESS_UNIT_ID;
                END IF;
            END LOOP;
        END LOOP;
        COMMIT;
    END IF;
END;
/

BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_OT_PO_IX ON RR_PO_ORDER_TERMS (PO_HEADER_ID, SEQ_NUM)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_OT_TERM_IX ON RR_PO_ORDER_TERMS (TERM_ID)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_TERMS_BU_IX ON RR_PO_TERMS (BUSINESS_UNIT_ID, STATUS)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/

-- ── new purchase orders start with the default + mandatory clauses ──────────────
CREATE OR REPLACE TRIGGER RR_PO_ORDER_TERMS_DEFAULT_TRG
AFTER INSERT ON RR_PO_HEADERS
FOR EACH ROW
BEGIN
    INSERT INTO RR_PO_ORDER_TERMS (PO_HEADER_ID, TERM_ID, SEQ_NUM, TITLE, TERM_TEXT, MANDATORY_FLAG, CREATED_BY)
    SELECT :NEW.PO_HEADER_ID, t.TERM_ID,
           ROW_NUMBER() OVER (ORDER BY t.DISPLAY_ORDER, t.TERM_CODE) * 10,
           t.TITLE, t.TERM_TEXT, t.MANDATORY_FLAG, :NEW.CREATED_BY
    FROM   RR_PO_TERMS t
    WHERE  t.STATUS = 'ACTIVE'
    AND    (t.DEFAULT_FLAG = 'Y' OR t.MANDATORY_FLAG = 'Y')
    AND    (t.BUSINESS_UNIT_ID IS NULL OR t.BUSINESS_UNIT_ID = :NEW.BUSINESS_UNIT_ID);
EXCEPTION WHEN OTHERS THEN
    NULL;   -- never block creating a purchase order; the buyer can add the clauses on the PO
END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_PO_TERMS_PKG
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE RR_PO_TERMS_PKG AS
    PROCEDURE SAVE_TERM (p_json IN CLOB, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DELETE_TERM (p_term_id IN VARCHAR2, p_user IN VARCHAR2,
                           p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SET_TERM_ORDER (p_json IN CLOB, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE SET_PO_TERMS (p_po_header_id IN VARCHAR2, p_json IN CLOB, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
END RR_PO_TERMS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_PO_TERMS_PKG AS

    -- clause wording: required, at most 4000 bytes (one VARCHAR2 column)
    FUNCTION clause_text (p_text IN CLOB, p_what IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767);
    BEGIN
        IF p_text IS NULL OR DBMS_LOB.GETLENGTH(p_text) = 0 THEN RR_PO_UTIL_PKG.err(p_what || ': the clause text is required'); END IF;
        IF DBMS_LOB.GETLENGTH(p_text) > 4000 THEN
            RR_PO_UTIL_PKG.err(p_what || ': the clause text is too long (' || DBMS_LOB.GETLENGTH(p_text)
                               || ' characters, at most 4000). Split it into two clauses.');
        END IF;
        v := TRIM(DBMS_LOB.SUBSTR(p_text, 4000, 1));
        IF v IS NULL THEN RR_PO_UTIL_PKG.err(p_what || ': the clause text is required'); END IF;
        IF LENGTHB(v) > 4000 THEN
            RR_PO_UTIL_PKG.err(p_what || ': the clause text is too long (' || LENGTHB(v)
                               || ' bytes, at most 4000 — about 2000 Arabic characters). Split it into two clauses.');
        END IF;
        RETURN v;
    END;

    FUNCTION yn (p IN VARCHAR2, p_default IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN UPPER(SUBSTR(p, 1, 1)) IN ('Y', 'N') THEN UPPER(SUBSTR(p, 1, 1)) ELSE p_default END;
    END;

    PROCEDURE SAVE_TERM (p_json IN CLOB, p_user IN VARCHAR2,
                         p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o       JSON_OBJECT_T := JSON_OBJECT_T.parse(p_json);
        v_id    NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'termId');
        v_code  VARCHAR2(4000) := UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'termCode')));
        v_title VARCHAR2(4000) := TRIM(RR_PO_UTIL_PKG.jstr(o, 'title'));
        v_cat   VARCHAR2(4000) := NVL(UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'category'))), 'GENERAL');
        v_bu    NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'businessUnitId');
        v_ord   NUMBER         := NVL(RR_PO_UTIL_PKG.jnum(o, 'displayOrder'), 100);
        v_man   VARCHAR2(1)    := yn(RR_PO_UTIL_PKG.jstr(o, 'mandatoryFlag'), 'N');
        v_def   VARCHAR2(1)    := yn(RR_PO_UTIL_PKG.jstr(o, 'defaultFlag'), 'Y');
        v_st    VARCHAR2(4000) := NVL(UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'status'))), 'ACTIVE');
        v_text  VARCHAR2(4000);
        v_n     NUMBER;
    BEGIN
        IF v_code IS NULL THEN RR_PO_UTIL_PKG.err('Code is required'); END IF;
        IF LENGTH(v_code) > 40 THEN RR_PO_UTIL_PKG.err('Code is too long (at most 40 characters)'); END IF;
        IF v_title IS NULL THEN RR_PO_UTIL_PKG.err('Title is required'); END IF;
        IF LENGTHB(v_title) > 240 THEN RR_PO_UTIL_PKG.err('Title is too long (at most 240 characters)'); END IF;
        IF LENGTH(v_cat) > 30 THEN RR_PO_UTIL_PKG.err('Category is too long (at most 30 characters)'); END IF;
        IF v_st NOT IN ('ACTIVE', 'INACTIVE') THEN RR_PO_UTIL_PKG.err('Status must be ACTIVE or INACTIVE'); END IF;
        v_text := clause_text(RR_PO_UTIL_PKG.jclob(o, 'termText'), v_code);
        IF v_man = 'Y' THEN v_def := 'Y'; END IF;   -- a mandatory clause is always on new orders
        IF v_bu IS NOT NULL THEN
            SELECT COUNT(*) INTO v_n FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = v_bu;
            IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Business unit ' || v_bu || ' does not exist'); END IF;
        END IF;

        IF v_id IS NULL THEN
            INSERT INTO RR_PO_TERMS (TERM_CODE, TITLE, TERM_TEXT, TERM_CATEGORY, BUSINESS_UNIT_ID, DISPLAY_ORDER,
                                     DEFAULT_FLAG, MANDATORY_FLAG, STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            VALUES (v_code, v_title, v_text, v_cat, v_bu, v_ord, v_def, v_man, v_st, p_user, p_user, SYSTIMESTAMP)
            RETURNING TERM_ID INTO v_id;
        ELSE
            UPDATE RR_PO_TERMS
            SET    TERM_CODE = v_code, TITLE = v_title, TERM_TEXT = v_text, TERM_CATEGORY = v_cat,
                   BUSINESS_UNIT_ID = v_bu, DISPLAY_ORDER = v_ord, DEFAULT_FLAG = v_def, MANDATORY_FLAG = v_man,
                   STATUS = v_st, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE  TERM_ID = v_id;
            IF SQL%ROWCOUNT = 0 THEN RR_PO_UTIL_PKG.err('Clause ' || v_id || ' not found'); END IF;
        END IF;
        p_id := v_id; p_number := v_code; p_status := 'S'; p_message := 'Clause ' || v_code || ' saved';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE DELETE_TERM (p_term_id IN VARCHAR2, p_user IN VARCHAR2,
                           p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id   NUMBER := RR_PO_UTIL_PKG.to_num(p_term_id);
        v_n    NUMBER;
        v_code VARCHAR2(40);
    BEGIN
        SELECT COUNT(DISTINCT PO_HEADER_ID) INTO v_n FROM RR_PO_ORDER_TERMS WHERE TERM_ID = v_id;
        IF v_n > 0 THEN
            RR_PO_UTIL_PKG.err('This clause is on ' || v_n || ' purchase order(s). Set it to INACTIVE instead — '
                               || 'those orders keep their wording and new orders no longer get it.');
        END IF;
        DELETE FROM RR_PO_TERMS WHERE TERM_ID = v_id RETURNING TERM_CODE INTO v_code;
        IF SQL%ROWCOUNT = 0 THEN RR_PO_UTIL_PKG.err('Clause not found'); END IF;
        p_id := v_id; p_number := v_code; p_status := 'S'; p_message := 'Clause ' || v_code || ' deleted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE SET_TERM_ORDER (p_json IN CLOB, p_user IN VARCHAR2,
                              p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        a    JSON_ARRAY_T := JSON_ARRAY_T.parse(p_json);
        o    JSON_OBJECT_T;
        v_id NUMBER;
        v_or NUMBER;
        v_n  NUMBER := 0;
    BEGIN
        FOR i IN 0 .. a.get_size - 1 LOOP
            o := TREAT(a.get(i) AS JSON_OBJECT_T);
            v_id := RR_PO_UTIL_PKG.jnum(o, 'termId');
            v_or := RR_PO_UTIL_PKG.jnum(o, 'displayOrder');
            IF v_id IS NOT NULL AND v_or IS NOT NULL THEN
                UPDATE RR_PO_TERMS SET DISPLAY_ORDER = v_or, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
                WHERE  TERM_ID = v_id AND DISPLAY_ORDER <> v_or;
                v_n := v_n + SQL%ROWCOUNT;
            END IF;
        END LOOP;
        p_status := 'S'; p_message := 'Order saved (' || v_n || ' clause(s) moved)';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE SET_PO_TERMS (p_po_header_id IN VARCHAR2, p_json IN CLOB, p_user IN VARCHAR2,
                            p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_po    NUMBER := RR_PO_UTIL_PKG.to_num(p_po_header_id);
        v_st    VARCHAR2(20);
        v_bu    NUMBER;
        v_num   VARCHAR2(40);
        a       JSON_ARRAY_T;
        o       JSON_OBJECT_T;
        v_tid   NUMBER;
        v_title VARCHAR2(4000);
        v_text  VARCHAR2(4000);
        v_man   VARCHAR2(1);
        v_cnt   NUMBER := 0;
    BEGIN
        BEGIN
            SELECT DOCUMENT_STATUS, BUSINESS_UNIT_ID, PO_NUMBER INTO v_st, v_bu, v_num
            FROM   RR_PO_HEADERS WHERE PO_HEADER_ID = v_po FOR UPDATE;
        EXCEPTION WHEN NO_DATA_FOUND THEN RR_PO_UTIL_PKG.err('Purchase order ' || p_po_header_id || ' not found');
        END;
        IF v_st NOT IN ('INCOMPLETE', 'REJECTED') THEN
            RR_PO_UTIL_PKG.err('Terms can be changed only while the purchase order is a draft or rejected (it is ' || v_st || ')');
        END IF;
        IF p_json IS NULL OR DBMS_LOB.GETLENGTH(p_json) = 0 THEN a := JSON_ARRAY_T();
        ELSE a := JSON_ARRAY_T.parse(p_json);
        END IF;

        DELETE FROM RR_PO_ORDER_TERMS WHERE PO_HEADER_ID = v_po;
        FOR i IN 0 .. a.get_size - 1 LOOP
            o := TREAT(a.get(i) AS JSON_OBJECT_T);
            v_tid := RR_PO_UTIL_PKG.jnum(o, 'termId');
            v_title := TRIM(RR_PO_UTIL_PKG.jstr(o, 'title'));
            IF v_title IS NULL THEN RR_PO_UTIL_PKG.err('Clause ' || (i + 1) || ': the title is required'); END IF;
            IF LENGTHB(v_title) > 240 THEN RR_PO_UTIL_PKG.err('Clause ' || (i + 1) || ': the title is too long (at most 240 characters)'); END IF;
            v_text := clause_text(RR_PO_UTIL_PKG.jclob(o, 'text'), 'Clause ' || (i + 1));
            v_man := 'N';
            IF v_tid IS NOT NULL THEN
                SELECT MAX(MANDATORY_FLAG) INTO v_man FROM RR_PO_TERMS WHERE TERM_ID = v_tid;
                IF v_man IS NULL THEN v_tid := NULL; v_man := 'N'; END IF;   -- library clause gone: keep it as a one-off
            END IF;
            INSERT INTO RR_PO_ORDER_TERMS (PO_HEADER_ID, TERM_ID, SEQ_NUM, TITLE, TERM_TEXT, MANDATORY_FLAG,
                                           CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            VALUES (v_po, v_tid, (i + 1) * 10, v_title, v_text, v_man, p_user, p_user, SYSTIMESTAMP);
            v_cnt := v_cnt + 1;
        END LOOP;

        -- every active mandatory clause of the business unit must stay on the order
        FOR m IN (SELECT t.TERM_CODE, t.TITLE FROM RR_PO_TERMS t
                  WHERE  t.STATUS = 'ACTIVE' AND t.MANDATORY_FLAG = 'Y'
                  AND    (t.BUSINESS_UNIT_ID IS NULL OR t.BUSINESS_UNIT_ID = v_bu)
                  AND    NOT EXISTS (SELECT 1 FROM RR_PO_ORDER_TERMS x WHERE x.PO_HEADER_ID = v_po AND x.TERM_ID = t.TERM_ID)
                  ORDER  BY t.DISPLAY_ORDER) LOOP
            RR_PO_UTIL_PKG.err('Mandatory clause ' || m.TERM_CODE || ' (' || m.TITLE || ') cannot be removed from the order');
        END LOOP;

        RR_PO_UTIL_PKG.history('PO', v_po, 'TERMS_UPDATED', v_st, v_st, p_user, v_cnt || ' clause(s)');
        p_id := v_po; p_number := v_num; p_status := 'S';
        p_message := 'Terms and conditions saved (' || v_cnt || ' clause' || CASE WHEN v_cnt = 1 THEN '' ELSE 's' END || ')';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;
END RR_PO_TERMS_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- Read views (app reads through the guarded SELECT gateway)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW RR_PO_V_TERMS AS
SELECT t.TERM_ID, t.TERM_CODE, t.TITLE, t.TERM_TEXT, t.TERM_CATEGORY, t.BUSINESS_UNIT_ID, bu.BUSINESS_UNIT_NAME,
       t.DISPLAY_ORDER, t.DEFAULT_FLAG, t.MANDATORY_FLAG, t.STATUS,
       (SELECT COUNT(DISTINCT ot.PO_HEADER_ID) FROM RR_PO_ORDER_TERMS ot WHERE ot.TERM_ID = t.TERM_ID) AS PO_COUNT,
       t.CREATED_BY, t.CREATION_DATE, t.LAST_UPDATED_BY, t.LAST_UPDATE_DATE
FROM   RR_PO_TERMS t
LEFT   JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = t.BUSINESS_UNIT_ID;

-- LIBRARY_CHANGED_FLAG = the library wording differs from the order's copy (edited on the
-- order, or the library clause was changed after it was added)
CREATE OR REPLACE VIEW RR_PO_V_ORDER_TERMS AS
SELECT ot.PO_TERM_ID, ot.PO_HEADER_ID, ot.TERM_ID, ot.SEQ_NUM, ot.TITLE, ot.TERM_TEXT, ot.MANDATORY_FLAG,
       t.TERM_CODE, t.TERM_CATEGORY,
       t.TITLE AS LIBRARY_TITLE, t.TERM_TEXT AS LIBRARY_TEXT,
       CASE WHEN t.TERM_ID IS NULL THEN 'Y' ELSE 'N' END AS CUSTOM_FLAG,
       CASE WHEN t.TERM_ID IS NOT NULL AND (t.TITLE <> ot.TITLE OR t.TERM_TEXT <> ot.TERM_TEXT) THEN 'Y' ELSE 'N' END AS LIBRARY_CHANGED_FLAG,
       ot.CREATED_BY, ot.CREATION_DATE, ot.LAST_UPDATED_BY, ot.LAST_UPDATE_DATE
FROM   RR_PO_ORDER_TERMS ot
LEFT   JOIN RR_PO_TERMS t ON t.TERM_ID = ot.TERM_ID;

-- AI gateway access (same rule as 301: only when the ACL is in whitelist mode)
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR v IN (SELECT 'RR_PO_V_TERMS' n FROM dual UNION ALL SELECT 'RR_PO_V_ORDER_TERMS' FROM dual) LOOP
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
    SELECT 'RR_PO_TERMS_PKG.SAVE_TERM' n, 'p_json' p, 'p_json' c, 'Create / update a terms and conditions clause' d FROM dual UNION ALL
    SELECT 'RR_PO_TERMS_PKG.DELETE_TERM', 'p_term_id', NULL, 'Delete an unused terms and conditions clause' FROM dual UNION ALL
    SELECT 'RR_PO_TERMS_PKG.SET_TERM_ORDER', 'p_json', 'p_json', 'Renumber terms and conditions clauses' FROM dual UNION ALL
    SELECT 'RR_PO_TERMS_PKG.SET_PO_TERMS', 'p_po_header_id,p_json', 'p_json', 'Replace the terms and conditions of a purchase order' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d, t.ENABLED_FLAG = 'Y'
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH306');
COMMIT;

-- ── Smoke checks ─────────────────────────────────────────────────────────────
SELECT OBJECT_NAME, OBJECT_TYPE, STATUS FROM USER_OBJECTS
 WHERE OBJECT_NAME IN ('RR_PO_TERMS', 'RR_PO_ORDER_TERMS', 'RR_PO_TERMS_PKG', 'RR_PO_ORDER_TERMS_DEFAULT_TRG',
                       'RR_PO_V_TERMS', 'RR_PO_V_ORDER_TERMS')
 ORDER BY OBJECT_TYPE, OBJECT_NAME;
SELECT NAME, TYPE, LINE, TEXT FROM USER_ERRORS WHERE NAME IN ('RR_PO_TERMS_PKG', 'RR_PO_ORDER_TERMS_DEFAULT_TRG') ORDER BY NAME, LINE;
SELECT TERM_CODE, TITLE, BUSINESS_UNIT_NAME, DEFAULT_FLAG, MANDATORY_FLAG, STATUS, PO_COUNT FROM RR_PO_V_TERMS ORDER BY DISPLAY_ORDER;
