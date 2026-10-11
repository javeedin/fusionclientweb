-- =============================================================================
-- Purchasing-RR (module PO) — 307: report branding (logo and company details per business unit)
--
--   Table   : RR_REPORT_BRANDING — what a printed document shows at the top: logo, company name,
--             address, TRN, contact details and a brand colour. One row per business unit and set
--             of documents it applies to (APPLIES_TO):
--               ALL  every document of the business unit (the fallback)
--               PO   Purchasing      AP  Payables          AR  Receivables
--               CM   Cash Management GL  General Ledger    FA  Fixed Assets
--             e.g. 'PO,AP' — the same logo on purchase orders and payables documents.
--             A report takes the ACTIVE row of its business unit that names its document type, else
--             the business unit's ALL row, else it prints the business unit name as before.
--             Two active rows of one business unit may not cover the same document type.
--   Package : RR_REPORT_BRANDING_PKG
--               SAVE_BRANDING    create / update                 (p_json)
--               DELETE_BRANDING  delete                          (p_branding_id)
--               LOGO_CHUNK       one 3000-character piece of the logo (for RR_REPORT_V_BRANDING_LOGO)
--   Views   : RR_REPORT_V_BRANDING       the rows without the image (+ LOGO_CHUNKS)
--             RR_REPORT_V_BRANDING_LOGO  the logo as base64 in 3000-character chunks (the read
--                                        gateway returns text columns up to 4000 characters)
--
--   The logo is stored as base64 text (PNG or JPEG). The app trims and scales it before saving,
--   so a logo is usually 20–150 KB.
--
-- Run after 306. Safe to re-run.
-- =============================================================================

DECLARE
    v_n NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM user_tables WHERE table_name = 'RR_REPORT_BRANDING';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE q'[
CREATE TABLE RR_REPORT_BRANDING (
    BRANDING_ID       NUMBER DEFAULT RR_PO_SEQ.NEXTVAL PRIMARY KEY,
    BUSINESS_UNIT_ID  NUMBER         NOT NULL,
    APPLIES_TO        VARCHAR2(100)  DEFAULT 'ALL' NOT NULL,
    DISPLAY_NAME      VARCHAR2(240)  NOT NULL,
    HEADER_STYLE      VARCHAR2(20)   DEFAULT 'LOGO_AND_NAME' NOT NULL,
    ADDRESS_TEXT      VARCHAR2(1000),
    TAX_REGISTRATION  VARCHAR2(60),
    PHONE             VARCHAR2(60),
    EMAIL             VARCHAR2(240),
    WEBSITE           VARCHAR2(240),
    ACCENT_COLOR      VARCHAR2(7),
    LOGO_BASE64       CLOB,
    LOGO_MIME         VARCHAR2(40),
    LOGO_FILE_NAME    VARCHAR2(240),
    LOGO_WIDTH        NUMBER,
    LOGO_HEIGHT       NUMBER,
    LOGO_BYTES        NUMBER,
    STATUS            VARCHAR2(10)   DEFAULT 'ACTIVE' NOT NULL,
    CREATED_BY VARCHAR2(150), CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY VARCHAR2(150), LAST_UPDATE_DATE TIMESTAMP,
    CONSTRAINT RR_REPORT_BRANDING_ST_CK CHECK (STATUS IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT RR_REPORT_BRANDING_HS_CK CHECK (HEADER_STYLE IN ('LOGO_AND_NAME', 'LOGO_ONLY', 'NAME_ONLY'))
)]';
        EXECUTE IMMEDIATE 'CREATE INDEX RR_REPORT_BRANDING_BU_IX ON RR_REPORT_BRANDING (BUSINESS_UNIT_ID, STATUS)';
    END IF;
END;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- RR_REPORT_BRANDING_PKG
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE PACKAGE RR_REPORT_BRANDING_PKG AS
    PROCEDURE SAVE_BRANDING (p_json IN CLOB, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    PROCEDURE DELETE_BRANDING (p_branding_id IN VARCHAR2, p_user IN VARCHAR2,
                               p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2);
    /** base64 piece p_chunk_no (1-based, 3000 characters) of the logo */
    FUNCTION LOGO_CHUNK (p_branding_id IN NUMBER, p_chunk_no IN NUMBER) RETURN VARCHAR2;
    /** 'Y' when APPLIES_TO covers the document type (ALL covers every type) */
    FUNCTION APPLIES (p_applies_to IN VARCHAR2, p_doc IN VARCHAR2) RETURN VARCHAR2;
END RR_REPORT_BRANDING_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_REPORT_BRANDING_PKG AS

    C_CHUNK    CONSTANT PLS_INTEGER := 3000;
    C_MAX_LOGO CONSTANT PLS_INTEGER := 1400000;     -- base64 characters (about 1 MB of image)
    TYPE t_codes IS TABLE OF VARCHAR2(3);

    FUNCTION doc_label (p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE p WHEN 'PO' THEN 'Purchasing' WHEN 'AP' THEN 'Payables' WHEN 'AR' THEN 'Receivables'
                      WHEN 'CM' THEN 'Cash Management' WHEN 'GL' THEN 'General Ledger' WHEN 'FA' THEN 'Fixed Assets'
                      ELSE 'All documents' END;
    END;

    -- ' po, AP ' → 'PO,AP' (known codes only, fixed order, no repeats); ALL wins over the others
    FUNCTION norm_docs (p IN VARCHAR2) RETURN VARCHAR2 IS
        c_all t_codes := t_codes('PO', 'AP', 'AR', 'CM', 'GL', 'FA');
        v_in  VARCHAR2(4000) := ',' || REPLACE(UPPER(p), ' ', '') || ',';
        v_tok VARCHAR2(4000);
        v_out VARCHAR2(200);
    BEGIN
        FOR i IN 1 .. NVL(REGEXP_COUNT(v_in, '[^,]+'), 0) LOOP
            v_tok := REGEXP_SUBSTR(v_in, '[^,]+', 1, i);
            IF v_tok NOT IN ('ALL', 'PO', 'AP', 'AR', 'CM', 'GL', 'FA') THEN
                RR_PO_UTIL_PKG.err('Unknown document type "' || SUBSTR(v_tok, 1, 30) || '" (use ALL, PO, AP, AR, CM, GL or FA)');
            END IF;
        END LOOP;
        IF INSTR(v_in, ',ALL,') > 0 THEN RETURN 'ALL'; END IF;
        FOR i IN 1 .. c_all.COUNT LOOP
            IF INSTR(v_in, ',' || c_all(i) || ',') > 0 THEN
                v_out := v_out || CASE WHEN v_out IS NOT NULL THEN ',' END || c_all(i);
            END IF;
        END LOOP;
        IF v_out IS NULL THEN RR_PO_UTIL_PKG.err('Choose the documents this branding is printed on'); END IF;
        RETURN v_out;
    END;

    FUNCTION APPLIES (p_applies_to IN VARCHAR2, p_doc IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p_applies_to = 'ALL' OR INSTR(',' || p_applies_to || ',', ',' || UPPER(p_doc) || ',') > 0
                    THEN 'Y' ELSE 'N' END;
    END;

    FUNCTION txt (p_o IN JSON_OBJECT_T, p_k IN VARCHAR2, p_max IN PLS_INTEGER, p_what IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(4000) := TRIM(RR_PO_UTIL_PKG.jstr(p_o, p_k));
    BEGIN
        IF LENGTHB(v) > p_max THEN RR_PO_UTIL_PKG.err(p_what || ' is too long (at most ' || p_max || ' characters)'); END IF;
        RETURN v;
    END;

    PROCEDURE SAVE_BRANDING (p_json IN CLOB, p_user IN VARCHAR2,
                             p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        o        JSON_OBJECT_T  := JSON_OBJECT_T.parse(p_json);
        v_id     NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'brandingId');
        v_bu     NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'businessUnitId');
        v_docs   VARCHAR2(200);
        v_name   VARCHAR2(4000);
        v_style  VARCHAR2(4000) := NVL(UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'headerStyle'))), 'LOGO_AND_NAME');
        v_addr   VARCHAR2(4000);
        v_trn    VARCHAR2(4000);
        v_phone  VARCHAR2(4000);
        v_email  VARCHAR2(4000);
        v_web    VARCHAR2(4000);
        v_color  VARCHAR2(4000) := UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'accentColor')));
        v_st     VARCHAR2(4000) := NVL(UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'status'))), 'ACTIVE');
        v_action VARCHAR2(4000) := NVL(UPPER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'logoAction'))), 'KEEP');
        v_logo   CLOB;
        v_mime   VARCHAR2(4000);
        v_file   VARCHAR2(4000);
        v_w      NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'logoWidth');
        v_h      NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'logoHeight');
        v_bytes  NUMBER         := RR_PO_UTIL_PKG.jnum(o, 'logoBytes');
        v_n      NUMBER;
        v_doc    VARCHAR2(10);
    BEGIN
        IF v_bu IS NULL THEN RR_PO_UTIL_PKG.err('Business unit is required'); END IF;
        SELECT COUNT(*) INTO v_n FROM RR_GL_BUSINESS_UNITS WHERE BUSINESS_UNIT_ID = v_bu;
        IF v_n = 0 THEN RR_PO_UTIL_PKG.err('Business unit ' || v_bu || ' does not exist'); END IF;
        v_docs  := norm_docs(RR_PO_UTIL_PKG.jstr(o, 'appliesTo'));
        v_name  := txt(o, 'displayName', 240, 'Company name');
        IF v_name IS NULL THEN RR_PO_UTIL_PKG.err('Company name is required (it is printed on the documents)'); END IF;
        v_addr  := txt(o, 'address', 1000, 'Address');
        v_trn   := txt(o, 'taxRegistration', 60, 'TRN');
        v_phone := txt(o, 'phone', 60, 'Phone');
        v_email := txt(o, 'email', 240, 'E-mail');
        v_web   := txt(o, 'website', 240, 'Website');
        IF v_style NOT IN ('LOGO_AND_NAME', 'LOGO_ONLY', 'NAME_ONLY') THEN
            RR_PO_UTIL_PKG.err('Header style must be LOGO_AND_NAME, LOGO_ONLY or NAME_ONLY');
        END IF;
        IF v_st NOT IN ('ACTIVE', 'INACTIVE') THEN RR_PO_UTIL_PKG.err('Status must be ACTIVE or INACTIVE'); END IF;
        IF v_color IS NOT NULL AND NOT REGEXP_LIKE(v_color, '^#[0-9A-F]{6}$') THEN
            RR_PO_UTIL_PKG.err('Brand colour must look like #C74634');
        END IF;
        IF v_action NOT IN ('KEEP', 'REPLACE', 'REMOVE') THEN RR_PO_UTIL_PKG.err('logoAction must be KEEP, REPLACE or REMOVE'); END IF;

        IF v_action = 'REPLACE' THEN
            v_logo := RR_PO_UTIL_PKG.jclob(o, 'logoBase64');
            v_mime := LOWER(TRIM(RR_PO_UTIL_PKG.jstr(o, 'logoMime')));
            v_file := SUBSTR(TRIM(RR_PO_UTIL_PKG.jstr(o, 'logoFileName')), 1, 240);
            IF v_logo IS NULL OR DBMS_LOB.GETLENGTH(v_logo) = 0 THEN RR_PO_UTIL_PKG.err('The logo image is empty'); END IF;
            IF DBMS_LOB.GETLENGTH(v_logo) > C_MAX_LOGO THEN
                RR_PO_UTIL_PKG.err('The logo is too large (' || ROUND(DBMS_LOB.GETLENGTH(v_logo) * 3 / 4 / 1024) || ' KB, at most about 1 MB)');
            END IF;
            IF NVL(v_mime, '-') NOT IN ('image/png', 'image/jpeg') THEN RR_PO_UTIL_PKG.err('The logo must be a PNG or JPEG image'); END IF;
        END IF;

        -- one active branding per business unit and document type
        IF v_st = 'ACTIVE' THEN
            FOR r IN (SELECT BRANDING_ID, APPLIES_TO, DISPLAY_NAME FROM RR_REPORT_BRANDING
                      WHERE  BUSINESS_UNIT_ID = v_bu AND STATUS = 'ACTIVE' AND BRANDING_ID <> NVL(v_id, -1)) LOOP
                IF v_docs = 'ALL' AND r.APPLIES_TO = 'ALL' THEN
                    RR_PO_UTIL_PKG.err('This business unit already has branding for all documents ("' || r.DISPLAY_NAME
                                       || '"). Edit that one, or set it inactive first.');
                END IF;
                IF v_docs <> 'ALL' AND r.APPLIES_TO <> 'ALL' THEN
                    FOR i IN 1 .. REGEXP_COUNT(v_docs, '[^,]+') LOOP
                        v_doc := REGEXP_SUBSTR(v_docs, '[^,]+', 1, i);
                        IF APPLIES(r.APPLIES_TO, v_doc) = 'Y' THEN
                            RR_PO_UTIL_PKG.err(doc_label(v_doc) || ' documents of this business unit already use "' || r.DISPLAY_NAME
                                               || '". Remove ' || doc_label(v_doc) || ' from one of them.');
                        END IF;
                    END LOOP;
                END IF;
            END LOOP;
        END IF;

        IF v_id IS NULL THEN
            INSERT INTO RR_REPORT_BRANDING (BUSINESS_UNIT_ID, APPLIES_TO, DISPLAY_NAME, HEADER_STYLE, ADDRESS_TEXT, TAX_REGISTRATION,
                                            PHONE, EMAIL, WEBSITE, ACCENT_COLOR, STATUS, CREATED_BY, LAST_UPDATED_BY, LAST_UPDATE_DATE)
            VALUES (v_bu, v_docs, v_name, v_style, v_addr, v_trn, v_phone, v_email, v_web, v_color, v_st, p_user, p_user, SYSTIMESTAMP)
            RETURNING BRANDING_ID INTO v_id;
        ELSE
            UPDATE RR_REPORT_BRANDING
            SET    BUSINESS_UNIT_ID = v_bu, APPLIES_TO = v_docs, DISPLAY_NAME = v_name, HEADER_STYLE = v_style,
                   ADDRESS_TEXT = v_addr, TAX_REGISTRATION = v_trn, PHONE = v_phone, EMAIL = v_email, WEBSITE = v_web,
                   ACCENT_COLOR = v_color, STATUS = v_st, LAST_UPDATED_BY = p_user, LAST_UPDATE_DATE = SYSTIMESTAMP
            WHERE  BRANDING_ID = v_id;
            IF SQL%ROWCOUNT = 0 THEN RR_PO_UTIL_PKG.err('Branding ' || v_id || ' not found'); END IF;
        END IF;

        IF v_action = 'REPLACE' THEN
            UPDATE RR_REPORT_BRANDING
            SET    LOGO_BASE64 = v_logo, LOGO_MIME = v_mime, LOGO_FILE_NAME = v_file,
                   LOGO_WIDTH = v_w, LOGO_HEIGHT = v_h, LOGO_BYTES = NVL(v_bytes, ROUND(DBMS_LOB.GETLENGTH(v_logo) * 3 / 4))
            WHERE  BRANDING_ID = v_id;
        ELSIF v_action = 'REMOVE' THEN
            UPDATE RR_REPORT_BRANDING
            SET    LOGO_BASE64 = NULL, LOGO_MIME = NULL, LOGO_FILE_NAME = NULL, LOGO_WIDTH = NULL, LOGO_HEIGHT = NULL, LOGO_BYTES = NULL
            WHERE  BRANDING_ID = v_id;
        END IF;

        p_message := NULL;
        FOR i IN 1 .. REGEXP_COUNT(v_docs, '[^,]+') LOOP
            p_message := p_message || CASE WHEN i > 1 THEN ', ' END || doc_label(REGEXP_SUBSTR(v_docs, '[^,]+', 1, i));
        END LOOP;
        p_id := v_id; p_number := SUBSTR(v_name, 1, 100); p_status := 'S';
        p_message := 'Branding "' || v_name || '" saved — printed on '
                     || CASE WHEN v_docs = 'ALL' THEN 'all' ELSE LOWER(p_message) END || ' documents';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    PROCEDURE DELETE_BRANDING (p_branding_id IN VARCHAR2, p_user IN VARCHAR2,
                               p_id OUT NUMBER, p_number OUT VARCHAR2, p_status OUT VARCHAR2, p_message OUT VARCHAR2) IS
        v_id   NUMBER := RR_PO_UTIL_PKG.to_num(p_branding_id);
        v_name VARCHAR2(240);
    BEGIN
        DELETE FROM RR_REPORT_BRANDING WHERE BRANDING_ID = v_id RETURNING DISPLAY_NAME INTO v_name;
        IF SQL%ROWCOUNT = 0 THEN RR_PO_UTIL_PKG.err('Branding not found'); END IF;
        p_id := v_id; p_number := SUBSTR(v_name, 1, 100); p_status := 'S'; p_message := 'Branding "' || v_name || '" deleted';
    EXCEPTION WHEN OTHERS THEN
        p_status := 'E'; p_message := RR_PO_UTIL_PKG.err_text(SQLERRM);
    END;

    FUNCTION LOGO_CHUNK (p_branding_id IN NUMBER, p_chunk_no IN NUMBER) RETURN VARCHAR2 IS
        v_logo CLOB;
    BEGIN
        SELECT LOGO_BASE64 INTO v_logo FROM RR_REPORT_BRANDING WHERE BRANDING_ID = p_branding_id;
        IF v_logo IS NULL THEN RETURN NULL; END IF;
        RETURN DBMS_LOB.SUBSTR(v_logo, C_CHUNK, (p_chunk_no - 1) * C_CHUNK + 1);
    EXCEPTION WHEN NO_DATA_FOUND THEN RETURN NULL;
    END;

END RR_REPORT_BRANDING_PKG;
/

-- ═════════════════════════════════════════════════════════════════════════════
-- Read views (app reads through the guarded SELECT gateway)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW RR_REPORT_V_BRANDING AS
SELECT b.BRANDING_ID, b.BUSINESS_UNIT_ID, bu.BUSINESS_UNIT_NAME, b.APPLIES_TO, b.DISPLAY_NAME, b.HEADER_STYLE,
       b.ADDRESS_TEXT, b.TAX_REGISTRATION, b.PHONE, b.EMAIL, b.WEBSITE, b.ACCENT_COLOR,
       b.LOGO_MIME, b.LOGO_FILE_NAME, b.LOGO_WIDTH, b.LOGO_HEIGHT, b.LOGO_BYTES,
       CEIL(NVL(DBMS_LOB.GETLENGTH(b.LOGO_BASE64), 0) / 3000) AS LOGO_CHUNKS,
       b.STATUS, b.CREATED_BY, b.CREATION_DATE, b.LAST_UPDATED_BY, b.LAST_UPDATE_DATE
FROM   RR_REPORT_BRANDING b
LEFT   JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = b.BUSINESS_UNIT_ID;

CREATE OR REPLACE VIEW RR_REPORT_V_BRANDING_LOGO AS
SELECT b.BRANDING_ID, c.CHUNK_NO, RR_REPORT_BRANDING_PKG.LOGO_CHUNK(b.BRANDING_ID, c.CHUNK_NO) AS CHUNK_DATA
FROM   RR_REPORT_BRANDING b
JOIN  (SELECT LEVEL AS CHUNK_NO FROM dual CONNECT BY LEVEL <= 1000) c
       ON c.CHUNK_NO <= CEIL(NVL(DBMS_LOB.GETLENGTH(b.LOGO_BASE64), 0) / 3000);

-- AI gateway access (same rule as 301: only when the ACL is in whitelist mode)
DECLARE
    v_whitelist NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_whitelist FROM RR_AI_OBJECT_ACL WHERE ALLOWED_FLAG = 'Y';
    IF v_whitelist > 0 THEN
        FOR v IN (SELECT 'RR_REPORT_V_BRANDING' n FROM dual UNION ALL SELECT 'RR_REPORT_V_BRANDING_LOGO' FROM dual) LOOP
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
    SELECT 'RR_REPORT_BRANDING_PKG.SAVE_BRANDING' n, 'p_json' p, 'p_json' c, 'Create / update report branding (logo and company details)' d FROM dual UNION ALL
    SELECT 'RR_REPORT_BRANDING_PKG.DELETE_BRANDING', 'p_branding_id', NULL, 'Delete report branding' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d, t.ENABLED_FLAG = 'Y'
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH307');
COMMIT;

-- ── Smoke checks ─────────────────────────────────────────────────────────────
SELECT OBJECT_NAME, OBJECT_TYPE, STATUS FROM USER_OBJECTS
 WHERE OBJECT_NAME IN ('RR_REPORT_BRANDING', 'RR_REPORT_BRANDING_PKG', 'RR_REPORT_V_BRANDING', 'RR_REPORT_V_BRANDING_LOGO')
 ORDER BY OBJECT_TYPE, OBJECT_NAME;
SELECT NAME, TYPE, LINE, TEXT FROM USER_ERRORS WHERE NAME = 'RR_REPORT_BRANDING_PKG' ORDER BY TYPE, LINE;
SELECT BUSINESS_UNIT_NAME, APPLIES_TO, DISPLAY_NAME, HEADER_STYLE, LOGO_MIME, LOGO_BYTES, STATUS FROM RR_REPORT_V_BRANDING
 ORDER BY BUSINESS_UNIT_NAME, APPLIES_TO;
