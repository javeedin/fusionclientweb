-- =============================================================================
-- Approval Management Engine — Oracle Database Setup
-- Project: REERP (Bumeric Business Solutions)
-- Schema: BCLDIFC / REERP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 1: TABLE DEFINITIONS
-- -----------------------------------------------------------------------------

-- ── Approval Users ────────────────────────────────────────────────────────────
CREATE TABLE RR_APPROVAL_USERS (
  USER_ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  FULL_NAME         VARCHAR2(200)  NOT NULL,
  EMAIL             VARCHAR2(300)  NOT NULL UNIQUE,
  PHONE_NUMBER      VARCHAR2(50),
  DEPARTMENT        VARCHAR2(200),
  JOB_TITLE         VARCHAR2(200),
  MAX_APPROVAL_AMT  NUMBER,                          -- NULL = unlimited
  CURRENCY          VARCHAR2(10)   DEFAULT 'AED',
  MODULES           VARCHAR2(500),                  -- comma-separated: AP,AR,CASH,GL
  ACTIVE            VARCHAR2(1)    DEFAULT 'Y',
  CREATED_BY        VARCHAR2(200),
  CREATION_DATE     DATE           DEFAULT SYSDATE,
  LAST_UPDATE_DATE  DATE           DEFAULT SYSDATE,
  CONSTRAINT chk_approval_user_active CHECK (ACTIVE IN ('Y', 'N'))
);

COMMENT ON TABLE  RR_APPROVAL_USERS IS 'ERP Approval Engine — registered approvers';
COMMENT ON COLUMN RR_APPROVAL_USERS.MAX_APPROVAL_AMT IS 'NULL means unlimited approval authority';
COMMENT ON COLUMN RR_APPROVAL_USERS.MODULES IS 'Comma-separated list of modules: AP,AR,CASH,GL,FA,PROCUREMENT';

-- ── Approval Rules ────────────────────────────────────────────────────────────
CREATE TABLE RR_APPROVAL_RULES (
  RULE_ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  RULE_NAME         VARCHAR2(300)  NOT NULL,
  MODULE            VARCHAR2(50)   NOT NULL,         -- AP, AR, CASH, GL, FA, PROCUREMENT
  TRANSACTION_TYPE  VARCHAR2(100)  NOT NULL,
  DESCRIPTION       VARCHAR2(1000),
  MIN_AMOUNT        NUMBER         DEFAULT 0,
  MAX_AMOUNT        NUMBER,                          -- NULL = unlimited
  CURRENCY          VARCHAR2(10)   DEFAULT 'AED',
  APPROVAL_TYPE     VARCHAR2(20)   DEFAULT 'SEQUENTIAL', -- SEQUENTIAL, PARALLEL, ANY_ONE
  PRIORITY          NUMBER         DEFAULT 10,
  ACTIVE            VARCHAR2(1)    DEFAULT 'Y',
  CREATED_BY        VARCHAR2(200),
  CREATION_DATE     DATE           DEFAULT SYSDATE,
  LAST_UPDATE_DATE  DATE           DEFAULT SYSDATE,
  CONSTRAINT chk_approval_rule_active   CHECK (ACTIVE IN ('Y', 'N')),
  CONSTRAINT chk_approval_type          CHECK (APPROVAL_TYPE IN ('SEQUENTIAL', 'PARALLEL', 'ANY_ONE')),
  CONSTRAINT chk_approval_rule_module   CHECK (MODULE IN ('AP', 'AR', 'CASH', 'GL', 'FA', 'PROCUREMENT'))
);

COMMENT ON TABLE  RR_APPROVAL_RULES IS 'ERP Approval Engine — approval routing rules';
COMMENT ON COLUMN RR_APPROVAL_RULES.PRIORITY IS 'Lower number = higher priority; rules evaluated in ascending priority order';

-- ── Rule Approvers (ordered) ──────────────────────────────────────────────────
CREATE TABLE RR_APPROVAL_RULE_APPROVERS (
  ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  RULE_ID    NUMBER NOT NULL REFERENCES RR_APPROVAL_RULES(RULE_ID) ON DELETE CASCADE,
  USER_ID    NUMBER NOT NULL REFERENCES RR_APPROVAL_USERS(USER_ID),
  SEQUENCE   NUMBER NOT NULL,
  CONSTRAINT uq_rule_user UNIQUE (RULE_ID, USER_ID)
);

COMMENT ON TABLE  RR_APPROVAL_RULE_APPROVERS IS 'Ordered list of approvers assigned to each rule';
COMMENT ON COLUMN RR_APPROVAL_RULE_APPROVERS.SEQUENCE IS 'Processing order (1 = first notified for SEQUENTIAL type)';

-- ── Approval Requests ─────────────────────────────────────────────────────────
CREATE TABLE RR_APPROVAL_REQUESTS (
  REQUEST_ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  MODULE                VARCHAR2(50),
  TRANSACTION_TYPE      VARCHAR2(100),
  TRANSACTION_ID        NUMBER,
  TRANSACTION_REF       VARCHAR2(300),
  AMOUNT                NUMBER,
  CURRENCY              VARCHAR2(10)  DEFAULT 'AED',
  DESCRIPTION           VARCHAR2(1000),
  REQUESTED_BY_NAME     VARCHAR2(200),
  REQUESTED_DATE        DATE          DEFAULT SYSDATE,
  STATUS                VARCHAR2(30)  DEFAULT 'PENDING',
  RULE_ID               NUMBER        REFERENCES RR_APPROVAL_RULES(RULE_ID),
  CURRENT_APPROVER_ID   NUMBER        REFERENCES RR_APPROVAL_USERS(USER_ID),
  CONSTRAINT chk_approval_request_status CHECK (
    STATUS IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECALLED')
  )
);

COMMENT ON TABLE  RR_APPROVAL_REQUESTS IS 'ERP Approval Engine — pending/historical approval requests';
COMMENT ON COLUMN RR_APPROVAL_REQUESTS.CURRENT_APPROVER_ID IS 'The approver currently holding the ball (for sequential flow)';

-- ── Approval History ──────────────────────────────────────────────────────────
CREATE TABLE RR_APPROVAL_HISTORY (
  HISTORY_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  REQUEST_ID         NUMBER      NOT NULL REFERENCES RR_APPROVAL_REQUESTS(REQUEST_ID) ON DELETE CASCADE,
  ACTION             VARCHAR2(30) NOT NULL,
  ACTOR_NAME         VARCHAR2(200),
  COMMENTS           VARCHAR2(2000),
  ACTION_DATE        DATE         DEFAULT SYSDATE,
  NOTIFICATION_SENT  VARCHAR2(1)  DEFAULT 'N',
  CONSTRAINT chk_approval_history_action CHECK (
    ACTION IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'FORWARDED', 'RECALLED', 'NOTIFIED', 'CANCELLED')
  ),
  CONSTRAINT chk_approval_history_notif CHECK (NOTIFICATION_SENT IN ('Y', 'N'))
);

COMMENT ON TABLE  RR_APPROVAL_HISTORY IS 'Full audit trail of all actions taken on approval requests';

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_approval_users_email   ON RR_APPROVAL_USERS(EMAIL);
CREATE INDEX idx_approval_users_active  ON RR_APPROVAL_USERS(ACTIVE);
CREATE INDEX idx_approval_rules_module  ON RR_APPROVAL_RULES(MODULE, ACTIVE);
CREATE INDEX idx_approval_req_status    ON RR_APPROVAL_REQUESTS(STATUS, MODULE);
CREATE INDEX idx_approval_req_ruleid    ON RR_APPROVAL_REQUESTS(RULE_ID);
CREATE INDEX idx_approval_hist_reqid    ON RR_APPROVAL_HISTORY(REQUEST_ID, ACTION_DATE);

-- -----------------------------------------------------------------------------
-- SECTION 2: ORDS REST HANDLERS
-- Run each BEGIN...END block individually in SQL Developer / APEX SQL Workshop
-- -----------------------------------------------------------------------------

-- ── Register the ORDS module (run once) ───────────────────────────────────────
BEGIN
  ORDS.DEFINE_MODULE(
    p_module_name    => 'reerp',
    p_base_path      => '/reerp/',
    p_is_published   => TRUE
  );
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN NULL; -- module already exists
END;
/

-- ── GET approvals/users ───────────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/users',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_source         => q'[
      SELECT
        u.USER_ID        AS "userId",
        u.FULL_NAME      AS "fullName",
        u.EMAIL          AS "email",
        u.PHONE_NUMBER   AS "phoneNumber",
        u.DEPARTMENT     AS "department",
        u.JOB_TITLE      AS "jobTitle",
        u.MAX_APPROVAL_AMT AS "maxApprovalAmount",
        u.CURRENCY       AS "currency",
        u.MODULES        AS "modules",
        u.ACTIVE         AS "active",
        u.CREATED_BY     AS "createdBy",
        TO_CHAR(u.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "creationDate",
        TO_CHAR(u.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "lastUpdateDate"
      FROM RR_APPROVAL_USERS u
      ORDER BY u.FULL_NAME
    ]'
  );
  COMMIT;
END;
/

-- ── POST approvals/users ──────────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/users',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_id   NUMBER;
        v_body CLOB := :body_text;
        v_json JSON_OBJECT_T := JSON_OBJECT_T(v_body);
      BEGIN
        INSERT INTO RR_APPROVAL_USERS (
          FULL_NAME, EMAIL, PHONE_NUMBER, DEPARTMENT, JOB_TITLE,
          MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
        ) VALUES (
          v_json.get_string('fullName'),
          v_json.get_string('email'),
          v_json.get_string('phoneNumber'),
          v_json.get_string('department'),
          v_json.get_string('jobTitle'),
          CASE WHEN v_json.get('maxApprovalAmount') IS NULL THEN NULL
               ELSE v_json.get_number('maxApprovalAmount') END,
          NVL(v_json.get_string('currency'), 'AED'),
          v_json.get_string('modules'),
          NVL(v_json.get_string('active'), 'Y'),
          v_json.get_string('createdBy'),
          SYSDATE, SYSDATE
        ) RETURNING USER_ID INTO v_id;
        :status := 201;
        :body   := '{"userId":' || v_id || '}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── PUT approvals/users/:id ───────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/users/:id',
    p_method         => 'PUT',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_body CLOB := :body_text;
        v_json JSON_OBJECT_T := JSON_OBJECT_T(v_body);
      BEGIN
        UPDATE RR_APPROVAL_USERS SET
          FULL_NAME        = NVL(v_json.get_string('fullName'),    FULL_NAME),
          EMAIL            = NVL(v_json.get_string('email'),       EMAIL),
          PHONE_NUMBER     = v_json.get_string('phoneNumber'),
          DEPARTMENT       = v_json.get_string('department'),
          JOB_TITLE        = v_json.get_string('jobTitle'),
          MAX_APPROVAL_AMT = CASE WHEN v_json.get('maxApprovalAmount') IS NULL THEN NULL
                                  ELSE v_json.get_number('maxApprovalAmount') END,
          CURRENCY         = NVL(v_json.get_string('currency'),    CURRENCY),
          MODULES          = NVL(v_json.get_string('modules'),     MODULES),
          ACTIVE           = NVL(v_json.get_string('active'),      ACTIVE),
          LAST_UPDATE_DATE = SYSDATE
        WHERE USER_ID = :id;
        :status := 200;
        :body   := '{"success":true}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── DELETE approvals/users/:id ────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/users/:id',
    p_method         => 'DELETE',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      BEGIN
        DELETE FROM RR_APPROVAL_USERS WHERE USER_ID = :id;
        :status := 204;
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── GET approvals/rules ───────────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/rules',
    p_method         => 'GET',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_cursor SYS_REFCURSOR;
        v_module VARCHAR2(50) := :module;
      BEGIN
        -- Build JSON manually to include nested approvers array
        DECLARE
          v_result CLOB := '{"items":[';
          v_first_rule BOOLEAN := TRUE;
        BEGIN
          FOR r IN (
            SELECT r.RULE_ID, r.RULE_NAME, r.MODULE, r.TRANSACTION_TYPE,
                   r.DESCRIPTION, r.MIN_AMOUNT, r.MAX_AMOUNT, r.CURRENCY,
                   r.APPROVAL_TYPE, r.PRIORITY, r.ACTIVE,
                   TO_CHAR(r.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
                   r.CREATED_BY
            FROM   RR_APPROVAL_RULES r
            WHERE  (v_module IS NULL OR r.MODULE = v_module)
            ORDER BY r.PRIORITY, r.RULE_ID
          ) LOOP
            IF NOT v_first_rule THEN v_result := v_result || ','; END IF;
            v_first_rule := FALSE;

            v_result := v_result || '{'
              || '"ruleId":'          || r.RULE_ID
              || ',"ruleName":"'      || REPLACE(r.RULE_NAME,       '"', '''') || '"'
              || ',"module":"'        || r.MODULE                               || '"'
              || ',"transactionType":"' || r.TRANSACTION_TYPE                   || '"'
              || ',"description":'    || CASE WHEN r.DESCRIPTION IS NULL THEN 'null'
                                              ELSE '"' || REPLACE(r.DESCRIPTION, '"', '''') || '"' END
              || ',"minAmount":'      || NVL(r.MIN_AMOUNT, 0)
              || ',"maxAmount":'      || NVL(TO_CHAR(r.MAX_AMOUNT), 'null')
              || ',"currency":"'      || r.CURRENCY                             || '"'
              || ',"approvalType":"'  || r.APPROVAL_TYPE                        || '"'
              || ',"priority":'       || r.PRIORITY
              || ',"active":"'        || r.ACTIVE                               || '"'
              || ',"createdBy":'      || CASE WHEN r.CREATED_BY IS NULL THEN 'null'
                                              ELSE '"' || r.CREATED_BY || '"' END
              || ',"creationDate":'   || CASE WHEN r.CREATION_DATE IS NULL THEN 'null'
                                              ELSE '"' || r.CREATION_DATE || '"' END
              || ',"approvers":[';

            -- Nested approvers
            DECLARE
              v_first_approver BOOLEAN := TRUE;
            BEGIN
              FOR a IN (
                SELECT ra.SEQUENCE, u.USER_ID, u.FULL_NAME, u.EMAIL, u.DEPARTMENT
                FROM   RR_APPROVAL_RULE_APPROVERS ra
                JOIN   RR_APPROVAL_USERS u ON u.USER_ID = ra.USER_ID
                WHERE  ra.RULE_ID = r.RULE_ID
                ORDER BY ra.SEQUENCE
              ) LOOP
                IF NOT v_first_approver THEN v_result := v_result || ','; END IF;
                v_first_approver := FALSE;
                v_result := v_result || '{'
                  || '"sequence":'  || a.SEQUENCE
                  || ',"userId":'   || a.USER_ID
                  || ',"fullName":"' || REPLACE(a.FULL_NAME, '"', '''') || '"'
                  || ',"email":"'   || a.EMAIL || '"'
                  || ',"department":' || CASE WHEN a.DEPARTMENT IS NULL THEN 'null'
                                              ELSE '"' || a.DEPARTMENT || '"' END
                  || '}';
              END LOOP;
            END;

            v_result := v_result || ']}';
          END LOOP;

          v_result := v_result || ']}';
          :status := 200;
          :body   := v_result;
        END;
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── POST approvals/rules ──────────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/rules',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_rule_id  NUMBER;
        v_body     CLOB := :body_text;
        v_json     JSON_OBJECT_T := JSON_OBJECT_T(v_body);
        v_approvers JSON_ARRAY_T;
        v_approver  JSON_OBJECT_T;
      BEGIN
        INSERT INTO RR_APPROVAL_RULES (
          RULE_NAME, MODULE, TRANSACTION_TYPE, DESCRIPTION,
          MIN_AMOUNT, MAX_AMOUNT, CURRENCY, APPROVAL_TYPE,
          PRIORITY, ACTIVE, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
        ) VALUES (
          v_json.get_string('ruleName'),
          v_json.get_string('module'),
          v_json.get_string('transactionType'),
          v_json.get_string('description'),
          NVL(v_json.get_number('minAmount'), 0),
          CASE WHEN v_json.get('maxAmount') IS NULL THEN NULL
               ELSE v_json.get_number('maxAmount') END,
          NVL(v_json.get_string('currency'), 'AED'),
          NVL(v_json.get_string('approvalType'), 'SEQUENTIAL'),
          NVL(v_json.get_number('priority'), 10),
          NVL(v_json.get_string('active'), 'Y'),
          v_json.get_string('createdBy'),
          SYSDATE, SYSDATE
        ) RETURNING RULE_ID INTO v_rule_id;

        -- Insert approvers
        v_approvers := v_json.get_array('approvers');
        IF v_approvers IS NOT NULL THEN
          FOR i IN 0 .. v_approvers.get_size - 1 LOOP
            v_approver := TREAT(v_approvers.get(i) AS JSON_OBJECT_T);
            INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
            VALUES (v_rule_id, v_approver.get_number('userId'), v_approver.get_number('sequence'));
          END LOOP;
        END IF;

        :status := 201;
        :body   := '{"ruleId":' || v_rule_id || '}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── PUT approvals/rules/:id ───────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/rules/:id',
    p_method         => 'PUT',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_body     CLOB := :body_text;
        v_json     JSON_OBJECT_T := JSON_OBJECT_T(v_body);
        v_approvers JSON_ARRAY_T;
        v_approver  JSON_OBJECT_T;
      BEGIN
        UPDATE RR_APPROVAL_RULES SET
          RULE_NAME        = NVL(v_json.get_string('ruleName'),        RULE_NAME),
          MODULE           = NVL(v_json.get_string('module'),          MODULE),
          TRANSACTION_TYPE = NVL(v_json.get_string('transactionType'), TRANSACTION_TYPE),
          DESCRIPTION      = v_json.get_string('description'),
          MIN_AMOUNT       = NVL(v_json.get_number('minAmount'),       MIN_AMOUNT),
          MAX_AMOUNT       = CASE WHEN v_json.get('maxAmount') IS NULL THEN NULL
                                  ELSE v_json.get_number('maxAmount') END,
          CURRENCY         = NVL(v_json.get_string('currency'),        CURRENCY),
          APPROVAL_TYPE    = NVL(v_json.get_string('approvalType'),    APPROVAL_TYPE),
          PRIORITY         = NVL(v_json.get_number('priority'),        PRIORITY),
          ACTIVE           = NVL(v_json.get_string('active'),          ACTIVE),
          LAST_UPDATE_DATE = SYSDATE
        WHERE RULE_ID = :id;

        -- Replace approvers
        DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
        v_approvers := v_json.get_array('approvers');
        IF v_approvers IS NOT NULL THEN
          FOR i IN 0 .. v_approvers.get_size - 1 LOOP
            v_approver := TREAT(v_approvers.get(i) AS JSON_OBJECT_T);
            INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
            VALUES (:id, v_approver.get_number('userId'), v_approver.get_number('sequence'));
          END LOOP;
        END IF;

        :status := 200;
        :body   := '{"success":true}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── DELETE approvals/rules/:id ────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/rules/:id',
    p_method         => 'DELETE',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      BEGIN
        -- Child rows in RR_APPROVAL_RULE_APPROVERS cascade automatically
        DELETE FROM RR_APPROVAL_RULES WHERE RULE_ID = :id;
        :status := 204;
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── GET approvals/requests ────────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/requests',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_source         => q'[
      SELECT
        r.REQUEST_ID            AS "requestId",
        r.MODULE                AS "module",
        r.TRANSACTION_TYPE      AS "transactionType",
        r.TRANSACTION_ID        AS "transactionId",
        r.TRANSACTION_REF       AS "transactionRef",
        r.AMOUNT                AS "amount",
        r.CURRENCY              AS "currency",
        r.DESCRIPTION           AS "description",
        r.REQUESTED_BY_NAME     AS "requestedByName",
        TO_CHAR(r.REQUESTED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "requestedDate",
        r.STATUS                AS "status",
        r.RULE_ID               AS "ruleId",
        rl.RULE_NAME            AS "ruleName",
        u.FULL_NAME             AS "currentApproverName"
      FROM   RR_APPROVAL_REQUESTS r
      LEFT   JOIN RR_APPROVAL_RULES ru ON ru.RULE_ID = r.RULE_ID
      LEFT   JOIN RR_APPROVAL_RULES rl ON rl.RULE_ID = r.RULE_ID
      LEFT   JOIN RR_APPROVAL_USERS u  ON u.USER_ID  = r.CURRENT_APPROVER_ID
      WHERE  (:module IS NULL OR r.MODULE = :module)
        AND  (:status IS NULL OR r.STATUS = :status)
        AND  (:from   IS NULL OR r.REQUESTED_DATE >= TO_DATE(:from, 'YYYY-MM-DD'))
        AND  (:to     IS NULL OR r.REQUESTED_DATE <= TO_DATE(:to,   'YYYY-MM-DD'))
      ORDER BY r.REQUESTED_DATE DESC
    ]'
  );
  COMMIT;
END;
/

-- ── POST approvals/requests/:id/action ────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/requests/:id/action',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_body      CLOB := :body_text;
        v_json      JSON_OBJECT_T := JSON_OBJECT_T(v_body);
        v_action    VARCHAR2(30)  := v_json.get_string('action');
        v_actor     VARCHAR2(200) := v_json.get_string('actorName');
        v_comments  VARCHAR2(2000) := v_json.get_string('comments');
        v_new_status VARCHAR2(30);
      BEGIN
        -- Map action to status
        v_new_status := CASE v_action
          WHEN 'APPROVED'   THEN 'APPROVED'
          WHEN 'REJECTED'   THEN 'REJECTED'
          WHEN 'RECALLED'   THEN 'RECALLED'
          WHEN 'CANCELLED'  THEN 'CANCELLED'
          ELSE NULL  -- SUBMITTED / FORWARDED / NOTIFIED do not change overall status
        END;

        -- Insert history entry
        INSERT INTO RR_APPROVAL_HISTORY (REQUEST_ID, ACTION, ACTOR_NAME, COMMENTS, ACTION_DATE, NOTIFICATION_SENT)
        VALUES (:id, v_action, v_actor, v_comments, SYSDATE, 'N');

        -- Update request status if applicable
        IF v_new_status IS NOT NULL THEN
          UPDATE RR_APPROVAL_REQUESTS
          SET STATUS = v_new_status
          WHERE REQUEST_ID = :id;
        END IF;

        :status := 200;
        :body   := '{"success":true}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- ── GET approvals/requests/:id/history ───────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/requests/:id/history',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_source         => q'[
      SELECT
        h.HISTORY_ID          AS "historyId",
        h.REQUEST_ID          AS "requestId",
        h.ACTION              AS "action",
        h.ACTOR_NAME          AS "actorName",
        h.COMMENTS            AS "comments",
        TO_CHAR(h.ACTION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "actionDate",
        h.NOTIFICATION_SENT   AS "notificationSent"
      FROM   RR_APPROVAL_HISTORY h
      WHERE  h.REQUEST_ID = :id
      ORDER BY h.ACTION_DATE ASC
    ]'
  );
  COMMIT;
END;
/

-- ── POST approvals/notify/test ────────────────────────────────────────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/notify/test',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_body    CLOB := :body_text;
        v_json    JSON_OBJECT_T := JSON_OBJECT_T(v_body);
        v_user_id NUMBER := v_json.get_number('user_id');
        v_email   VARCHAR2(300);
        v_name    VARCHAR2(200);
      BEGIN
        SELECT EMAIL, FULL_NAME INTO v_email, v_name
        FROM   RR_APPROVAL_USERS
        WHERE  USER_ID = v_user_id;

        APEX_MAIL.SEND(
          p_to        => v_email,
          p_from      => 'noreply@bumeric.ae',
          p_subj      => '[TEST] ERP Approval Notification — System Check',
          p_body      => 'Dear ' || v_name || ',' || CHR(10) || CHR(10)
                      || 'This is a test notification from the ERP Approval System.' || CHR(10)
                      || 'Your email address is correctly configured for approval notifications.' || CHR(10) || CHR(10)
                      || 'Bumeric Business Solutions — ERP Team',
          p_body_html => '<html><body style="font-family:Arial,sans-serif;color:#1a1a1a;">'
                      || '<div style="background:#C74634;padding:20px;text-align:center;">'
                      || '<h2 style="color:#fff;margin:0;">Test Notification</h2></div>'
                      || '<div style="padding:24px;">'
                      || '<p>Dear <strong>' || v_name || '</strong>,</p>'
                      || '<p>This is a test notification from the ERP Approval System.</p>'
                      || '<p>Your email address is correctly configured for approval notifications.</p>'
                      || '<hr/><p style="font-size:12px;color:#6b6b6b;">Bumeric Business Solutions — noreply@bumeric.ae</p>'
                      || '</div></body></html>'
        );
        APEX_MAIL.PUSH_QUEUE;

        :status := 200;
        :body   := '{"success":true,"message":"Test email sent to ' || v_email || '"}';
      EXCEPTION WHEN OTHERS THEN
        :status := 500;
        :body   := '{"success":false,"message":"' || REPLACE(SQLERRM, '"', '''') || '"}';
      END;
    ]'
  );
  COMMIT;
END;
/

-- =============================================================================
-- SECTION 3: SAMPLE DATA (optional — remove before production deployment)
-- =============================================================================

-- Sample approvers
INSERT INTO RR_APPROVAL_USERS (FULL_NAME, EMAIL, DEPARTMENT, JOB_TITLE, MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE, CREATED_BY)
VALUES ('Ahmed Al Rashid', 'ahmed.rashid@bumeric.ae', 'Finance', 'Finance Manager', 50000, 'AED', 'AP,AR,GL', 'Y', 'SYSTEM');

INSERT INTO RR_APPROVAL_USERS (FULL_NAME, EMAIL, DEPARTMENT, JOB_TITLE, MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE, CREATED_BY)
VALUES ('Fatima Al Zaabi', 'fatima.zaabi@bumeric.ae', 'Finance', 'CFO', NULL, 'AED', 'AP,AR,CASH,GL,FA,PROCUREMENT', 'Y', 'SYSTEM');

INSERT INTO RR_APPROVAL_USERS (FULL_NAME, EMAIL, DEPARTMENT, JOB_TITLE, MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE, CREATED_BY)
VALUES ('Mohammed Hassan', 'm.hassan@bumeric.ae', 'Procurement', 'Procurement Manager', 100000, 'AED', 'PROCUREMENT,AP', 'Y', 'SYSTEM');

COMMIT;

-- =============================================================================
-- END OF SCRIPT
-- =============================================================================
