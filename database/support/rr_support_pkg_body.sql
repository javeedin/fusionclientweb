-- ============================================================
-- RR_SUPPORT_PKG  — Package Body
-- ============================================================
CREATE OR REPLACE PACKAGE BODY RR_SUPPORT_PKG AS

    -- ──────────────────────────────────────────────────────────
    -- Private helpers
    -- ──────────────────────────────────────────────────────────

    -- Escape a VARCHAR2 value as a JSON string literal
    FUNCTION js(p_val IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p_val;
    BEGIN
        IF v IS NULL THEN RETURN '""'; END IF;
        v := REPLACE(v, '\',    '\\');
        v := REPLACE(v, '"',    '\"');
        v := REPLACE(v, CHR(9), '\t');
        v := REPLACE(v, CHR(10),'\n');
        v := REPLACE(v, CHR(13),'\r');
        v := REGEXP_REPLACE(v, '[[:cntrl:]]', '');
        RETURN '"' || v || '"';
    END js;

    -- Write a CLOB to HTP output in 32 KB chunks
    PROCEDURE flush_clob(p_clob IN CLOB) IS
        l_len INTEGER := DBMS_LOB.GETLENGTH(p_clob);
        l_pos INTEGER := 1;
    BEGIN
        WHILE l_pos <= l_len LOOP
            HTP.PRN(DBMS_LOB.SUBSTR(p_clob, 32767, l_pos));
            l_pos := l_pos + 32767;
        END LOOP;
    END flush_clob;

    -- Emit a standard error response
    PROCEDURE err(p_code IN NUMBER, p_msg IN VARCHAR2, p_status_code OUT NUMBER) IS
    BEGIN
        p_status_code := p_code;
        HTP.P('{"status":"error","code":' || p_code || ',"message":"' || REPLACE(p_msg, '"', '\"') || '"}');
    END err;

    -- ──────────────────────────────────────────────────────────
    -- GET_TICKETS  — list with optional filters
    -- ──────────────────────────────────────────────────────────
    PROCEDURE get_tickets(
        p_status      IN  VARCHAR2 DEFAULT NULL,
        p_module      IN  VARCHAR2 DEFAULT NULL,
        p_priority    IN  VARCHAR2 DEFAULT NULL,
        p_date_from   IN  VARCHAR2 DEFAULT NULL,
        p_date_to     IN  VARCHAR2 DEFAULT NULL,
        p_search      IN  VARCHAR2 DEFAULT NULL,
        p_created_by  IN  VARCHAR2 DEFAULT NULL,
        p_assigned_to IN  VARCHAR2 DEFAULT NULL,
        p_limit       IN  NUMBER   DEFAULT 200,
        p_offset      IN  NUMBER   DEFAULT 0,
        p_status_code OUT NUMBER
    ) IS
        v_total NUMBER := 0;
        v_clob  CLOB;
        v_first BOOLEAN := TRUE;
    BEGIN
        SELECT COUNT(*)
        INTO   v_total
        FROM   RR_SUPPORT_TICKETS t
        WHERE  (p_status      IS NULL OR t.STATUS      = p_status)
        AND    (p_module      IS NULL OR t.MODULE       = p_module)
        AND    (p_priority    IS NULL OR t.PRIORITY     = p_priority)
        AND    (p_created_by  IS NULL OR UPPER(t.CREATED_BY)  LIKE '%' || UPPER(p_created_by)  || '%')
        AND    (p_assigned_to IS NULL OR UPPER(t.ASSIGNED_TO) LIKE '%' || UPPER(p_assigned_to) || '%')
        AND    (p_date_from   IS NULL OR t.CREATION_DATE >= p_date_from)
        AND    (p_date_to     IS NULL OR t.CREATION_DATE <= p_date_to || ' 23:59:59')
        AND    (p_search IS NULL
                OR UPPER(t.TITLE)         LIKE '%' || UPPER(p_search) || '%'
                OR UPPER(t.TICKET_NUMBER) LIKE '%' || UPPER(p_search) || '%');

        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
        DBMS_LOB.APPEND(v_clob, TO_CLOB(
            '{"status":"success","total":' || v_total || ',"items":['
        ));

        FOR r IN (
            SELECT t.TICKET_ID, t.TICKET_NUMBER, t.TITLE,
                   t.MODULE, t.PAGE_NAME, t.PAGE_URL, t.FEATURE,
                   t.PRIORITY, t.STATUS, t.ASSIGNED_TO,
                   t.CREATED_BY, t.CREATION_DATE,
                   t.LAST_UPDATED_BY, t.LAST_UPDATE_DATE,
                   t.RESOLVED_BY, t.RESOLUTION_DATE,
                   (SELECT COUNT(*) FROM RR_SUPPORT_TICKET_LINES      WHERE TICKET_ID = t.TICKET_ID) AS LINE_COUNT,
                   (SELECT COUNT(*) FROM RR_SUPPORT_TICKET_ATTACHMENTS WHERE TICKET_ID = t.TICKET_ID) AS ATTACH_COUNT,
                   (SELECT COUNT(*) FROM RR_SUPPORT_TICKET_LINES
                    WHERE  TICKET_ID = t.TICKET_ID
                    AND    REPLY_TYPE = 'SUPPORT'
                    AND    LINE_TYPE  = 'COMMENT') AS UNREAD_REPLIES
            FROM   RR_SUPPORT_TICKETS t
            WHERE  (p_status      IS NULL OR t.STATUS      = p_status)
            AND    (p_module      IS NULL OR t.MODULE       = p_module)
            AND    (p_priority    IS NULL OR t.PRIORITY     = p_priority)
            AND    (p_created_by  IS NULL OR UPPER(t.CREATED_BY)  LIKE '%' || UPPER(p_created_by)  || '%')
            AND    (p_assigned_to IS NULL OR UPPER(t.ASSIGNED_TO) LIKE '%' || UPPER(p_assigned_to) || '%')
            AND    (p_date_from   IS NULL OR t.CREATION_DATE >= p_date_from)
            AND    (p_date_to     IS NULL OR t.CREATION_DATE <= p_date_to || ' 23:59:59')
            AND    (p_search IS NULL
                    OR UPPER(t.TITLE)         LIKE '%' || UPPER(p_search) || '%'
                    OR UPPER(t.TICKET_NUMBER) LIKE '%' || UPPER(p_search) || '%')
            ORDER  BY t.TICKET_ID DESC
            OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"ticketId":'      || r.TICKET_ID     || ','
             || '"ticketNumber":'   || js(r.TICKET_NUMBER) || ','
             || '"title":'          || js(r.TITLE)         || ','
             || '"module":'         || js(r.MODULE)        || ','
             || '"pageName":'       || js(r.PAGE_NAME)     || ','
             || '"pageUrl":'        || js(r.PAGE_URL)      || ','
             || '"feature":'        || js(r.FEATURE)       || ','
             || '"priority":'       || js(r.PRIORITY)      || ','
             || '"status":'         || js(r.STATUS)        || ','
             || '"assignedTo":'     || js(r.ASSIGNED_TO)   || ','
             || '"createdBy":'      || js(r.CREATED_BY)    || ','
             || '"creationDate":'   || js(r.CREATION_DATE) || ','
             || '"lastUpdatedBy":'  || js(r.LAST_UPDATED_BY)  || ','
             || '"lastUpdateDate":' || js(r.LAST_UPDATE_DATE) || ','
             || '"resolvedBy":'     || js(r.RESOLVED_BY)   || ','
             || '"resolutionDate":' || js(r.RESOLUTION_DATE)|| ','
             || '"lineCount":'      || NVL(r.LINE_COUNT, 0)   || ','
             || '"attachCount":'    || NVL(r.ATTACH_COUNT, 0) || ','
             || '"unreadReplies":'  || NVL(r.UNREAD_REPLIES, 0) || '}'
            ));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_tickets;

    -- ──────────────────────────────────────────────────────────
    -- CREATE_TICKET  — parse body with JSON_VALUE / JSON_TABLE
    -- ──────────────────────────────────────────────────────────
    PROCEDURE create_ticket(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_ticket_id NUMBER;
        v_created   VARCHAR2(100);
        v_priority  VARCHAR2(20);
        v_desc      VARCHAR2(4000);
    BEGIN
        v_created  := NVL(JSON_VALUE(p_body, '$.createdBy'),  'ERP_USER');
        v_priority := NVL(JSON_VALUE(p_body, '$.priority'),   'MEDIUM');
        v_desc     := JSON_VALUE(p_body, '$.description');

        INSERT INTO RR_SUPPORT_TICKETS (
            TITLE, DESCRIPTION, MODULE, PAGE_NAME, PAGE_URL, FEATURE,
            PRIORITY, STATUS, CREATED_BY, LAST_UPDATED_BY
        ) VALUES (
            JSON_VALUE(p_body, '$.title'),
            v_desc,
            JSON_VALUE(p_body, '$.module'),
            JSON_VALUE(p_body, '$.pageName'),
            JSON_VALUE(p_body, '$.pageUrl'),
            JSON_VALUE(p_body, '$.feature'),
            v_priority, 'OPEN', v_created, v_created
        )
        RETURNING TICKET_ID INTO v_ticket_id;

        -- Issue lines are always from the user
        INSERT INTO RR_SUPPORT_TICKET_LINES (TICKET_ID, LINE_TYPE, DESCRIPTION, CREATED_BY, REPLY_TYPE)
        SELECT v_ticket_id,
               NVL(LINE_TYPE, 'ISSUE'),
               DESCRIPTION,
               v_created,
               'USER'
        FROM   JSON_TABLE(p_body, '$.lines[*]'
                   COLUMNS (
                       LINE_TYPE   VARCHAR2(20)   PATH '$.lineType',
                       DESCRIPTION VARCHAR2(4000) PATH '$.description'
                   )
               )
        WHERE  DESCRIPTION IS NOT NULL;

        -- Insert attachments.
        -- JSON_TABLE handles VARCHAR2 metadata fields (no truncation risk).
        -- EXECUTE IMMEDIATE builds a literal path at runtime so RETURNING CLOB
        -- returns the full base64 without the 32767-char VARCHAR2 limit.
        -- (Oracle requires JSON path to be a string literal, not a concatenation.)
        DECLARE
            v_data CLOB;
        BEGIN
            FOR r IN (
                SELECT jt.rn, jt.fname, jt.ftype, jt.fsize
                FROM   JSON_TABLE(p_body, '$.attachments[*]'
                           COLUMNS (
                               rn    FOR ORDINALITY,
                               fname VARCHAR2(500) PATH '$.fileName',
                               ftype VARCHAR2(100) PATH '$.fileType',
                               fsize NUMBER        PATH '$.fileSize'
                           )) jt
                WHERE  jt.fname IS NOT NULL
            ) LOOP
                EXECUTE IMMEDIATE
                    'SELECT JSON_VALUE(:b, ''$.attachments[' || (r.rn - 1) || '].data'' RETURNING CLOB) FROM DUAL'
                    INTO v_data USING p_body;

                INSERT INTO RR_SUPPORT_TICKET_ATTACHMENTS (
                    TICKET_ID, FILE_NAME, FILE_TYPE, FILE_SIZE, ATTACHMENT_DATA, CREATED_BY
                ) VALUES (
                    v_ticket_id, r.fname, r.ftype, r.fsize, v_data, v_created
                );
            END LOOP;
        END;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","ticketId":' || v_ticket_id || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END create_ticket;

    -- ──────────────────────────────────────────────────────────
    -- GET_TICKET_DETAIL  — header + lines + attachments
    -- ──────────────────────────────────────────────────────────
    PROCEDURE get_ticket_detail(
        p_ticket_id   IN  NUMBER,
        p_status_code OUT NUMBER
    ) IS
        v_clob  CLOB;
        v_first BOOLEAN;
        v_hdr   RR_SUPPORT_TICKETS%ROWTYPE;
    BEGIN
        SELECT * INTO v_hdr
        FROM   RR_SUPPORT_TICKETS
        WHERE  TICKET_ID = p_ticket_id;

        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);

        -- Header
        DBMS_LOB.APPEND(v_clob, TO_CLOB(
            '{"status":"success","ticket":{'
         || '"ticketId":'       || v_hdr.TICKET_ID     || ','
         || '"ticketNumber":'   || js(v_hdr.TICKET_NUMBER)  || ','
         || '"title":'          || js(v_hdr.TITLE)          || ','
         || '"module":'         || js(v_hdr.MODULE)         || ','
         || '"pageName":'       || js(v_hdr.PAGE_NAME)      || ','
         || '"pageUrl":'        || js(v_hdr.PAGE_URL)       || ','
         || '"feature":'        || js(v_hdr.FEATURE)        || ','
         || '"priority":'       || js(v_hdr.PRIORITY)       || ','
         || '"status":'         || js(v_hdr.STATUS)         || ','
         || '"assignedTo":'     || js(v_hdr.ASSIGNED_TO)    || ','
         || '"resolvedBy":'     || js(v_hdr.RESOLVED_BY)    || ','
         || '"resolutionDate":' || js(v_hdr.RESOLUTION_DATE)|| ','
         || '"createdBy":'      || js(v_hdr.CREATED_BY)     || ','
         || '"creationDate":'   || js(v_hdr.CREATION_DATE)  || ','
         || '"lastUpdatedBy":'  || js(v_hdr.LAST_UPDATED_BY)|| ','
         || '"lastUpdateDate":' || js(v_hdr.LAST_UPDATE_DATE)|| ','
         || '"description":'    || js(DBMS_LOB.SUBSTR(v_hdr.DESCRIPTION,     4000, 1)) || ','
         || '"resolutionNotes":'|| js(DBMS_LOB.SUBSTR(v_hdr.RESOLUTION_NOTES,4000, 1))
        ));

        -- Lines array — includes replyType for UI color-coding
        DBMS_LOB.APPEND(v_clob, TO_CLOB('},"lines":['));
        v_first := TRUE;
        FOR r IN (
            SELECT * FROM RR_SUPPORT_TICKET_LINES
            WHERE  TICKET_ID = p_ticket_id
            ORDER  BY LINE_NUMBER
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"lineId":'      || r.LINE_ID     || ','
             || '"lineNumber":'   || r.LINE_NUMBER  || ','
             || '"lineType":'     || js(r.LINE_TYPE)|| ','
             || '"replyType":'    || js(NVL(r.REPLY_TYPE, 'SUPPORT')) || ','
             || '"description":'  || js(DBMS_LOB.SUBSTR(r.DESCRIPTION, 4000, 1)) || ','
             || '"createdBy":'    || js(r.CREATED_BY)    || ','
             || '"creationDate":' || js(r.CREATION_DATE) || '}'
            ));
        END LOOP;

        -- Attachments array — append ATTACHMENT_DATA CLOB directly so the
        -- full base64 string is returned without the 32767-char truncation.
        -- Base64 chars (A-Z a-z 0-9 + / =) need no JSON escaping.
        DBMS_LOB.APPEND(v_clob, TO_CLOB('],"attachments":['));
        v_first := TRUE;
        FOR r IN (
            SELECT ATTACHMENT_ID, FILE_NAME, FILE_TYPE, FILE_SIZE,
                   CREATED_BY, CREATION_DATE, ATTACHMENT_DATA
            FROM   RR_SUPPORT_TICKET_ATTACHMENTS
            WHERE  TICKET_ID = p_ticket_id
            ORDER  BY ATTACHMENT_ID
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            -- Write all scalar fields, then open the "data" string value
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"attachmentId":' || r.ATTACHMENT_ID || ','
             || '"fileName":'      || js(r.FILE_NAME)     || ','
             || '"fileType":'      || js(r.FILE_TYPE)     || ','
             || '"fileSize":'      || NVL(r.FILE_SIZE, 0) || ','
             || '"createdBy":'     || js(r.CREATED_BY)    || ','
             || '"creationDate":'  || js(r.CREATION_DATE) || ','
             || '"data":"'
            ));
            -- Append the full base64 CLOB without any size limit
            IF r.ATTACHMENT_DATA IS NOT NULL THEN
                DBMS_LOB.APPEND(v_clob, r.ATTACHMENT_DATA);
            END IF;
            -- Close the data string and the object
            DBMS_LOB.APPEND(v_clob, TO_CLOB('"}'));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status_code := 404;
            HTP.P('{"status":"error","code":404,"message":"Ticket not found"}');
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_ticket_detail;

    -- ──────────────────────────────────────────────────────────
    -- UPDATE_TICKET  — add comment / resolve / close / reopen / assign
    -- ──────────────────────────────────────────────────────────
    PROCEDURE update_ticket(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_id         NUMBER       := JSON_VALUE(p_body, '$.ticketId'  RETURNING NUMBER);
        v_action     VARCHAR2(20) := JSON_VALUE(p_body, '$.action');
        v_user       VARCHAR2(100):= NVL(JSON_VALUE(p_body, '$.updatedBy'),    'ERP_USER');
        v_comment    VARCHAR2(4000):= JSON_VALUE(p_body, '$.comment');
        v_notes      VARCHAR2(4000):= JSON_VALUE(p_body, '$.resolutionNotes');
        v_assign     VARCHAR2(100) := JSON_VALUE(p_body, '$.assignedTo');
        v_status     VARCHAR2(20)  := JSON_VALUE(p_body, '$.status');
        v_reply_type VARCHAR2(10)  := NVL(JSON_VALUE(p_body, '$.replyType'), 'SUPPORT');
        v_now        VARCHAR2(30)  := TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS');
    BEGIN
        CASE v_action

            WHEN 'comment' THEN
                INSERT INTO RR_SUPPORT_TICKET_LINES (TICKET_ID, LINE_TYPE, DESCRIPTION, CREATED_BY, REPLY_TYPE)
                VALUES (v_id, 'COMMENT', v_comment, v_user, v_reply_type);
                UPDATE RR_SUPPORT_TICKETS
                SET    LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            WHEN 'resolve' THEN
                INSERT INTO RR_SUPPORT_TICKET_LINES (TICKET_ID, LINE_TYPE, DESCRIPTION, CREATED_BY, REPLY_TYPE)
                VALUES (v_id, 'RESOLUTION', NVL(v_notes, 'Issue resolved.'), v_user, 'SUPPORT');
                UPDATE RR_SUPPORT_TICKETS
                SET    STATUS = 'RESOLVED', RESOLVED_BY = v_user,
                       RESOLUTION_DATE = v_now, RESOLUTION_NOTES = v_notes,
                       LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            WHEN 'close' THEN
                UPDATE RR_SUPPORT_TICKETS
                SET    STATUS = 'CLOSED',
                       LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            WHEN 'reopen' THEN
                UPDATE RR_SUPPORT_TICKETS
                SET    STATUS = 'OPEN',
                       LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            WHEN 'assign' THEN
                UPDATE RR_SUPPORT_TICKETS
                SET    ASSIGNED_TO = v_assign, STATUS = 'IN_PROGRESS',
                       LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            WHEN 'status' THEN
                UPDATE RR_SUPPORT_TICKETS
                SET    STATUS = v_status,
                       LAST_UPDATED_BY = v_user, LAST_UPDATE_DATE = v_now
                WHERE  TICKET_ID = v_id;

            ELSE
                p_status_code := 400;
                HTP.P('{"status":"error","code":400,"message":"Unknown action: ' || v_action || '"}');
                RETURN;
        END CASE;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","ticketId":' || v_id || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END update_ticket;

    -- ──────────────────────────────────────────────────────────
    -- GET_DASHBOARD  — summary counts + breakdowns + recent open
    -- ──────────────────────────────────────────────────────────
    PROCEDURE get_dashboard(
        p_status_code OUT NUMBER
    ) IS
        v_clob  CLOB;
        v_first BOOLEAN;
        v_open  NUMBER; v_inprog NUMBER; v_res NUMBER; v_closed NUMBER;
    BEGIN
        SELECT SUM(CASE WHEN STATUS = 'OPEN'        THEN 1 ELSE 0 END),
               SUM(CASE WHEN STATUS = 'IN_PROGRESS' THEN 1 ELSE 0 END),
               SUM(CASE WHEN STATUS = 'RESOLVED'    THEN 1 ELSE 0 END),
               SUM(CASE WHEN STATUS = 'CLOSED'      THEN 1 ELSE 0 END)
        INTO   v_open, v_inprog, v_res, v_closed
        FROM   RR_SUPPORT_TICKETS;

        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
        DBMS_LOB.APPEND(v_clob, TO_CLOB(
            '{"status":"success","summary":{'
         || '"open":'       || NVL(v_open,   0) || ','
         || '"inProgress":' || NVL(v_inprog, 0) || ','
         || '"resolved":'   || NVL(v_res,    0) || ','
         || '"closed":'     || NVL(v_closed, 0) || '}'
        ));

        -- By module
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"byModule":['));
        v_first := TRUE;
        FOR r IN (SELECT MODULE, COUNT(*) AS CNT FROM RR_SUPPORT_TICKETS
                  WHERE MODULE IS NOT NULL GROUP BY MODULE ORDER BY CNT DESC) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB('{"module":' || js(r.MODULE) || ',"count":' || r.CNT || '}'));
        END LOOP;

        -- By priority
        DBMS_LOB.APPEND(v_clob, TO_CLOB('],"byPriority":['));
        v_first := TRUE;
        FOR r IN (SELECT PRIORITY, COUNT(*) AS CNT FROM RR_SUPPORT_TICKETS
                  GROUP BY PRIORITY ORDER BY CNT DESC) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB('{"priority":' || js(r.PRIORITY) || ',"count":' || r.CNT || '}'));
        END LOOP;

        -- Recent 10 open / in-progress tickets
        DBMS_LOB.APPEND(v_clob, TO_CLOB('],"recentOpen":['));
        v_first := TRUE;
        FOR r IN (
            SELECT TICKET_ID, TICKET_NUMBER, TITLE, MODULE, PRIORITY, STATUS, CREATED_BY, CREATION_DATE
            FROM   RR_SUPPORT_TICKETS
            WHERE  STATUS IN ('OPEN','IN_PROGRESS')
            ORDER  BY TICKET_ID DESC
            FETCH FIRST 10 ROWS ONLY
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"ticketId":'    || r.TICKET_ID     || ','
             || '"ticketNumber":' || js(r.TICKET_NUMBER) || ','
             || '"title":'        || js(r.TITLE)         || ','
             || '"module":'       || js(r.MODULE)        || ','
             || '"priority":'     || js(r.PRIORITY)      || ','
             || '"status":'       || js(r.STATUS)        || ','
             || '"createdBy":'    || js(r.CREATED_BY)    || ','
             || '"creationDate":' || js(r.CREATION_DATE) || '}'
            ));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_dashboard;

END RR_SUPPORT_PKG;
/
