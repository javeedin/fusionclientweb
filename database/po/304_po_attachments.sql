-- =============================================================================
-- Purchasing-RR (module PO) — 304: document attachments
--   Table   : RR_PO_ATTACHMENTS (ENTITY_TYPE PO / REQ / RCV, ENTITY_ID)
--   Package : RR_PO_ATTACH_PKG
--   Handlers (module reerp, same contract as ap/payments/:check_id/attachments):
--     GET    po/attachments/:entity_type/:entity_id                  list
--     POST   po/attachments/:entity_type/:entity_id                  upload (JSON, base64)
--     GET    po/attachments/:entity_type/:entity_id/:attachment_id   download (binary)
--     DELETE po/attachments/:entity_type/:entity_id/:attachment_id   soft delete
-- Run after 303. Safe to re-run.
-- =============================================================================

BEGIN EXECUTE IMMEDIATE q'[
CREATE TABLE RR_PO_ATTACHMENTS (
    ATTACHMENT_ID NUMBER DEFAULT RR_PO_SEQ.NEXTVAL PRIMARY KEY,
    ENTITY_TYPE   VARCHAR2(10)   NOT NULL,
    ENTITY_ID     NUMBER         NOT NULL,
    FILE_NAME     VARCHAR2(500)  NOT NULL,
    FILE_SIZE     NUMBER,
    MIME_TYPE     VARCHAR2(200),
    FILE_CONTENT  BLOB,
    DESCRIPTION   VARCHAR2(1000),
    STATUS        VARCHAR2(10) DEFAULT 'ACTIVE' NOT NULL,
    UPLOADED_BY   VARCHAR2(200),
    UPLOAD_DATE   TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    DELETED_BY    VARCHAR2(200),
    DELETED_DATE  TIMESTAMP,
    CONSTRAINT RR_PO_ATT_ST_CK CHECK (STATUS IN ('ACTIVE','DELETED')),
    CONSTRAINT RR_PO_ATT_ET_CK CHECK (ENTITY_TYPE IN ('PO','REQ','RCV'))
)]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'CREATE INDEX RR_PO_ATT_ENT_IX ON RR_PO_ATTACHMENTS (ENTITY_TYPE, ENTITY_ID, STATUS)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF; END;
/

CREATE OR REPLACE PACKAGE RR_PO_ATTACH_PKG AS
    FUNCTION  list_json (p_type IN VARCHAR2, p_id IN NUMBER) RETURN CLOB;
    PROCEDURE upload (p_type IN VARCHAR2, p_id IN NUMBER, p_body IN CLOB, p_attach_id OUT NUMBER);
    PROCEDURE get_file (p_type IN VARCHAR2, p_id IN NUMBER, p_attach_id IN NUMBER,
                        p_file_name OUT VARCHAR2, p_mime OUT VARCHAR2, p_content OUT BLOB);
    PROCEDURE remove (p_type IN VARCHAR2, p_id IN NUMBER, p_attach_id IN NUMBER, p_by IN VARCHAR2);
END RR_PO_ATTACH_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_PO_ATTACH_PKG AS

    FUNCTION list_json (p_type IN VARCHAR2, p_id IN NUMBER) RETURN CLOB IS
        a JSON_ARRAY_T := JSON_ARRAY_T();
        o JSON_OBJECT_T;
        r JSON_OBJECT_T := JSON_OBJECT_T();
    BEGIN
        FOR x IN (SELECT ATTACHMENT_ID, FILE_NAME, FILE_SIZE, MIME_TYPE, DESCRIPTION, UPLOADED_BY,
                         TO_CHAR(UPLOAD_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS UPLOAD_DATE
                  FROM RR_PO_ATTACHMENTS
                  WHERE ENTITY_TYPE = UPPER(p_type) AND ENTITY_ID = p_id AND STATUS = 'ACTIVE'
                  ORDER BY ATTACHMENT_ID DESC) LOOP
            o := JSON_OBJECT_T();
            o.put('attachmentId', x.ATTACHMENT_ID);
            o.put('fileName', x.FILE_NAME);
            o.put('fileSize', x.FILE_SIZE);
            o.put('mimeType', x.MIME_TYPE);
            o.put('description', x.DESCRIPTION);
            o.put('uploadedBy', x.UPLOADED_BY);
            o.put('uploadDate', x.UPLOAD_DATE);
            a.append(o);
        END LOOP;
        r.put('attachments', a);
        RETURN r.to_clob;
    END;

    PROCEDURE upload (p_type IN VARCHAR2, p_id IN NUMBER, p_body IN CLOB, p_attach_id OUT NUMBER) IS
        j      JSON_OBJECT_T := JSON_OBJECT_T.parse(p_body);
        v_b64  CLOB := j.get_clob('fileContent');
        v_blob BLOB;
        v_raw  RAW(24576);
        v_pos  PLS_INTEGER := 1;
        v_len  PLS_INTEGER;
        c_amt  CONSTANT PLS_INTEGER := 24576;   -- multiple of 4: clean base64 chunks
        v_name VARCHAR2(500) := j.get_string('fileName');
        v_mime VARCHAR2(200) := NVL(j.get_string('mimeType'), 'application/octet-stream');
        v_size NUMBER := j.get_number('fileSize');
        v_desc VARCHAR2(1000) := j.get_string('description');
        v_by   VARCHAR2(200) := j.get_string('uploadedBy');
    BEGIN
        IF v_name IS NULL OR v_b64 IS NULL THEN RAISE_APPLICATION_ERROR(-20001, 'fileName and fileContent are required'); END IF;
        IF UPPER(p_type) NOT IN ('PO', 'REQ', 'RCV') THEN RAISE_APPLICATION_ERROR(-20001, 'Unknown document type ' || p_type); END IF;
        DBMS_LOB.CREATETEMPORARY(v_blob, TRUE, DBMS_LOB.SESSION);
        v_len := DBMS_LOB.GETLENGTH(v_b64);
        WHILE v_pos <= v_len LOOP
            v_raw := UTL_ENCODE.BASE64_DECODE(UTL_RAW.CAST_TO_RAW(DBMS_LOB.SUBSTR(v_b64, c_amt, v_pos)));
            DBMS_LOB.WRITEAPPEND(v_blob, UTL_RAW.LENGTH(v_raw), v_raw);
            v_pos := v_pos + c_amt;
        END LOOP;
        INSERT INTO RR_PO_ATTACHMENTS (ENTITY_TYPE, ENTITY_ID, FILE_NAME, FILE_SIZE, MIME_TYPE, FILE_CONTENT, DESCRIPTION, UPLOADED_BY)
        VALUES (UPPER(p_type), p_id, v_name, NVL(v_size, DBMS_LOB.GETLENGTH(v_blob)), v_mime, v_blob, v_desc, v_by)
        RETURNING ATTACHMENT_ID INTO p_attach_id;
        IF UPPER(p_type) IN ('PO', 'REQ') THEN
            RR_PO_UTIL_PKG.history(UPPER(p_type), p_id, 'ATTACH', NULL, NULL, v_by, v_name);
        END IF;
        COMMIT;
    END;

    PROCEDURE get_file (p_type IN VARCHAR2, p_id IN NUMBER, p_attach_id IN NUMBER,
                        p_file_name OUT VARCHAR2, p_mime OUT VARCHAR2, p_content OUT BLOB) IS
    BEGIN
        SELECT FILE_NAME, MIME_TYPE, FILE_CONTENT INTO p_file_name, p_mime, p_content
        FROM RR_PO_ATTACHMENTS
        WHERE ATTACHMENT_ID = p_attach_id AND ENTITY_TYPE = UPPER(p_type) AND ENTITY_ID = p_id AND STATUS = 'ACTIVE';
    EXCEPTION WHEN NO_DATA_FOUND THEN p_file_name := NULL;
    END;

    PROCEDURE remove (p_type IN VARCHAR2, p_id IN NUMBER, p_attach_id IN NUMBER, p_by IN VARCHAR2) IS
        v_name VARCHAR2(500);
    BEGIN
        UPDATE RR_PO_ATTACHMENTS SET STATUS = 'DELETED', DELETED_BY = p_by, DELETED_DATE = SYSTIMESTAMP
        WHERE ATTACHMENT_ID = p_attach_id AND ENTITY_TYPE = UPPER(p_type) AND ENTITY_ID = p_id AND STATUS = 'ACTIVE'
        RETURNING FILE_NAME INTO v_name;
        IF v_name IS NOT NULL AND UPPER(p_type) IN ('PO', 'REQ') THEN
            RR_PO_UTIL_PKG.history(UPPER(p_type), p_id, 'DELETE_ATTACHMENT', NULL, NULL, p_by, v_name);
        END IF;
        COMMIT;
    END;
END RR_PO_ATTACH_PKG;
/

-- ── ORDS handlers ────────────────────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id/:attachment_id'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id');
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id/:attachment_id');

    ORDS.DEFINE_HANDLER(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id',
        p_method => 'GET', p_source_type => 'plsql/block', p_mimes_allowed => '',
        p_comments => 'List Purchasing attachments', p_source => q'[
DECLARE
    v CLOB;
    p PLS_INTEGER := 1;
BEGIN
    v := RR_PO_ATTACH_PKG.list_json(:entity_type, TO_NUMBER(:entity_id));
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    WHILE p <= DBMS_LOB.GETLENGTH(v) LOOP HTP.PRN(DBMS_LOB.SUBSTR(v, 8000, p)); p := p + 8000; END LOOP;
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;]');

    ORDS.DEFINE_HANDLER(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id',
        p_method => 'POST', p_source_type => 'plsql/block', p_mimes_allowed => 'application/json',
        p_comments => 'Upload a Purchasing attachment (JSON, base64 fileContent)', p_source => q'[
DECLARE
    v_id NUMBER;
BEGIN
    RR_PO_ATTACH_PKG.upload(:entity_type, TO_NUMBER(:entity_id), :body_text, v_id);
    :status_code := 201;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":true,"attachmentId":' || v_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(REGEXP_REPLACE(SQLERRM, '^ORA-20001: ', ''), '"', '''') || '"}');
END;]');

    ORDS.DEFINE_HANDLER(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id/:attachment_id',
        p_method => 'GET', p_source_type => 'plsql/block', p_mimes_allowed => '',
        p_comments => 'Download a Purchasing attachment', p_source => q'[
DECLARE
    v_name VARCHAR2(500);
    v_mime VARCHAR2(200);
    v_blob BLOB;
BEGIN
    RR_PO_ATTACH_PKG.get_file(:entity_type, TO_NUMBER(:entity_id), TO_NUMBER(:attachment_id), v_name, v_mime, v_blob);
    IF v_name IS NULL THEN
        :status_code := 404;
        OWA_UTIL.MIME_HEADER('application/json', TRUE);
        HTP.PRN('{"error":"Attachment not found"}');
        RETURN;
    END IF;
    OWA_UTIL.MIME_HEADER(NVL(v_mime, 'application/octet-stream'), FALSE);
    HTP.P('Content-Disposition: attachment; filename="' || REPLACE(v_name, '"', '') || '"');
    HTP.P('Content-Length: ' || DBMS_LOB.GETLENGTH(v_blob));
    OWA_UTIL.HTTP_HEADER_CLOSE;
    WPG_DOCLOAD.DOWNLOAD_FILE(v_blob);
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;]');

    ORDS.DEFINE_HANDLER(p_module_name => 'reerp', p_pattern => 'po/attachments/:entity_type/:entity_id/:attachment_id',
        p_method => 'DELETE', p_source_type => 'plsql/block', p_mimes_allowed => '',
        p_comments => 'Soft-delete a Purchasing attachment', p_source => q'[
BEGIN
    RR_PO_ATTACH_PKG.remove(:entity_type, TO_NUMBER(:entity_id), TO_NUMBER(:attachment_id), :deleted_by);
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;]');
    COMMIT;
END;
/

SELECT object_name, object_type, status FROM user_objects WHERE object_name IN ('RR_PO_ATTACHMENTS', 'RR_PO_ATTACH_PKG');
