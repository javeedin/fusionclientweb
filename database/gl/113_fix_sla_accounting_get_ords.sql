-- ============================================================
-- 113_fix_sla_accounting_get_ords.sql
-- Fix ORA-40478 in RR_SLA_PKG.
--
-- Root cause: JSON_OBJECT in SQL context limits string values to
-- 4000 chars. Two places pass DESCRIPTION directly:
--   1. get_accounting   → v_desc VARCHAR2(5000) → JSON_OBJECT
--   2. get_lines_json   → DESCRIPTION column   → JSON_OBJECT in JSON_ARRAYAGG
--
-- Fix: SUBSTR(x, 1, 4000) on both description fields.
-- Everything else is identical to the existing package body.
-- ============================================================

CREATE OR REPLACE PACKAGE BODY RR_SLA_PKG AS

  -- ── Private helper: error JSON shorthand ──────────────────────────────────
  FUNCTION p_err(p_msg IN VARCHAR2) RETURN CLOB IS
  BEGIN
    RETURN JSON_OBJECT('error' VALUE 'true' FORMAT JSON, 'message' VALUE p_msg);
  END p_err;


  -- ===========================================================================
  -- create_accounting
  -- ===========================================================================
  PROCEDURE create_accounting(
    p_body_json IN  CLOB,
    p_status    OUT NUMBER,
    p_response  OUT CLOB
  ) IS
    v_header_id   NUMBER;
    v_existing_id NUMBER;
    v_module      VARCHAR2(60);
    v_src_table   VARCHAR2(60);
    v_src_id      NUMBER;
    v_src_number  VARCHAR2(100);
    v_src_type    VARCHAR2(60);
    v_event_type  VARCHAR2(60);
    v_event_date  DATE;
    v_acct_date   DATE;
    v_period      VARCHAR2(15);
    v_ledger_id   NUMBER;
    v_ledger_name VARCHAR2(100);
    v_currency    VARCHAR2(15);
    v_ledger_ccy  VARCHAR2(15);
    v_exch_rate   NUMBER;
    v_exch_type   VARCHAR2(30);
    v_bu          VARCHAR2(1000);
    v_le          VARCHAR2(1000);
    v_desc        VARCHAR2(5000);
    v_created_by  VARCHAR2(100);
    j_header      CLOB;
    j_lines       CLOB;
    v_line_count  NUMBER := 0;
  BEGIN
    j_header := JSON_QUERY(p_body_json, '$.header');
    j_lines  := JSON_QUERY(p_body_json, '$.lines');

    v_module      := JSON_VALUE(j_header, '$.moduleName');
    v_src_table   := JSON_VALUE(j_header, '$.sourceTable');
    v_src_id      := TO_NUMBER(JSON_VALUE(j_header, '$.sourceId'));
    v_src_number  := JSON_VALUE(j_header, '$.sourceNumber');
    v_src_type    := JSON_VALUE(j_header, '$.sourceType');
    v_event_type  := JSON_VALUE(j_header, '$.eventTypeCode');
    v_event_date  := TO_DATE(JSON_VALUE(j_header, '$.eventDate'),      'YYYY-MM-DD');
    v_acct_date   := TO_DATE(JSON_VALUE(j_header, '$.accountingDate'), 'YYYY-MM-DD');
    v_period      := JSON_VALUE(j_header, '$.periodName');
    v_ledger_id   := TO_NUMBER(JSON_VALUE(j_header, '$.ledgerId'));
    v_ledger_name := JSON_VALUE(j_header, '$.ledgerName');
    v_currency    := JSON_VALUE(j_header, '$.currencyCode');
    v_ledger_ccy  := NVL(JSON_VALUE(j_header, '$.ledgerCurrency'), 'AED');
    v_exch_rate   := NVL(TO_NUMBER(JSON_VALUE(j_header, '$.exchangeRate')), 1);
    v_exch_type   := NVL(JSON_VALUE(j_header, '$.exchangeRateType'), 'Corporate');
    v_bu          := JSON_VALUE(j_header, '$.businessUnit');
    v_le          := JSON_VALUE(j_header, '$.legalEntity');
    v_desc        := JSON_VALUE(j_header, '$.description');
    v_created_by  := NVL(JSON_VALUE(j_header, '$.createdBy'), 'SYSTEM');

    IF v_src_table IS NULL OR v_src_id IS NULL THEN
      p_status := 400; p_response := p_err('sourceTable and sourceId are required.'); RETURN;
    END IF;
    IF v_event_type IS NULL THEN
      p_status := 400; p_response := p_err('eventTypeCode is required.');            RETURN;
    END IF;
    IF v_module IS NULL THEN
      p_status := 400; p_response := p_err('moduleName is required.');               RETURN;
    END IF;
    IF v_ledger_id IS NULL THEN
      p_status := 400; p_response := p_err('ledgerId is required.');                 RETURN;
    END IF;
    IF v_acct_date IS NULL THEN
      p_status := 400; p_response := p_err('accountingDate is required.');           RETURN;
    END IF;
    IF j_lines IS NULL OR j_lines = '[]' THEN
      p_status := 400; p_response := p_err('lines array must not be empty.');        RETURN;
    END IF;

    DECLARE v_posted_id NUMBER;
    BEGIN
      SELECT HEADER_ID INTO v_posted_id
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  SOURCE_TABLE      = v_src_table
      AND    SOURCE_ID         = v_src_id
      AND    EVENT_TYPE_CODE   = v_event_type
      AND    ACCOUNTING_STATUS = 'POSTED'
      AND    ROWNUM = 1;

      p_status   := 409;
      p_response := p_err(
        'A POSTED accounting entry (headerId=' || v_posted_id ||
        ') already exists for this transaction and event type. ' ||
        'POSTED records are locked and cannot be replaced. Reverse the existing entry first.'
      );
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;

    BEGIN
      SELECT HEADER_ID INTO v_existing_id
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  SOURCE_TABLE      = v_src_table
      AND    SOURCE_ID         = v_src_id
      AND    EVENT_TYPE_CODE   = v_event_type
      AND    ACCOUNTING_STATUS = 'DRAFT'
      AND    ROWNUM = 1;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN v_existing_id := NULL;
    END;

    IF v_existing_id IS NOT NULL THEN
      DELETE FROM RR_SLA_ACCOUNTING_LINES   WHERE HEADER_ID = v_existing_id;
      DELETE FROM RR_SLA_ACCOUNTING_HEADERS WHERE HEADER_ID = v_existing_id;
    END IF;

    INSERT INTO RR_SLA_ACCOUNTING_HEADERS (
      MODULE_NAME,    SOURCE_TABLE,   SOURCE_ID,      SOURCE_NUMBER,   SOURCE_TYPE,
      EVENT_TYPE_CODE, EVENT_DATE,    ACCOUNTING_DATE, PERIOD_NAME,
      LEDGER_ID,      LEDGER_NAME,    CURRENCY_CODE,   LEDGER_CURRENCY,
      EXCHANGE_RATE,  EXCHANGE_RATE_TYPE,
      BUSINESS_UNIT,  LEGAL_ENTITY,   DESCRIPTION,
      ACCOUNTING_STATUS, POSTING_STATUS,
      CREATED_BY,     CREATION_DATE,  LAST_UPDATED_BY, LAST_UPDATE_DATE
    ) VALUES (
      v_module,    v_src_table,  v_src_id,    v_src_number,  v_src_type,
      v_event_type, v_event_date, v_acct_date, v_period,
      v_ledger_id, v_ledger_name, v_currency,  v_ledger_ccy,
      v_exch_rate, v_exch_type,
      v_bu,        v_le,         v_desc,
      'DRAFT',     'UNPOSTED',
      v_created_by, SYSDATE,     v_created_by, SYSDATE
    ) RETURNING HEADER_ID INTO v_header_id;

    FOR r IN (
      SELECT jt.line_number,     jt.line_type,       jt.acct_class,
             jt.account_combo,   jt.entered_dr,      jt.entered_cr,
             jt.accounted_dr,    jt.accounted_cr,    jt.currency_code,
             jt.exchange_rate,   jt.description,
             jt.source_line_id,  jt.source_line_num,
             jt.party_id,        jt.party_type
      FROM JSON_TABLE(j_lines, '$[*]'
        COLUMNS (
          line_number      NUMBER         PATH '$.lineNumber',
          line_type        VARCHAR2(2)    PATH '$.lineType',
          acct_class       VARCHAR2(60)   PATH '$.accountingClass',
          account_combo    VARCHAR2(200)  PATH '$.accountCombination',
          entered_dr       NUMBER         PATH '$.enteredDr'       DEFAULT 0 ON ERROR,
          entered_cr       NUMBER         PATH '$.enteredCr'       DEFAULT 0 ON ERROR,
          accounted_dr     NUMBER         PATH '$.accountedDr'     DEFAULT 0 ON ERROR,
          accounted_cr     NUMBER         PATH '$.accountedCr'     DEFAULT 0 ON ERROR,
          currency_code    VARCHAR2(15)   PATH '$.currencyCode',
          exchange_rate    NUMBER         PATH '$.exchangeRate'     DEFAULT 1 ON ERROR,
          description      VARCHAR2(500)  PATH '$.description',
          source_line_id   NUMBER         PATH '$.sourceLineId',
          source_line_num  NUMBER         PATH '$.sourceLineNumber',
          party_id         NUMBER         PATH '$.partyId',
          party_type       VARCHAR2(30)   PATH '$.partyType'
        )
      ) jt
    ) LOOP
      INSERT INTO RR_SLA_ACCOUNTING_LINES (
        HEADER_ID,        LINE_NUMBER,        LINE_TYPE,          ACCOUNTING_CLASS,
        ACCOUNT_COMBINATION,
        ENTERED_DR,       ENTERED_CR,         ACCOUNTED_DR,       ACCOUNTED_CR,
        CURRENCY_CODE,    EXCHANGE_RATE,      DESCRIPTION,
        SOURCE_LINE_ID,   SOURCE_LINE_NUMBER,
        PARTY_ID,         PARTY_TYPE,
        CREATED_BY,       CREATION_DATE
      ) VALUES (
        v_header_id,
        r.line_number,                         r.line_type,        r.acct_class,
        r.account_combo,
        NVL(r.entered_dr,   0),                NVL(r.entered_cr,   0),
        NVL(r.accounted_dr, 0),                NVL(r.accounted_cr, 0),
        NVL(r.currency_code, v_currency),      NVL(r.exchange_rate, v_exch_rate),
        r.description,
        r.source_line_id,                      r.source_line_num,
        r.party_id,                            r.party_type,
        v_created_by, SYSDATE
      );
      v_line_count := v_line_count + 1;
    END LOOP;

    IF v_line_count = 0 THEN
      ROLLBACK;
      p_status   := 400;
      p_response := p_err('lines array contained no valid rows after parsing.');
      RETURN;
    END IF;

    DECLARE
      v_total_dr NUMBER;
      v_total_cr NUMBER;
    BEGIN
      SELECT NVL(SUM(ACCOUNTED_DR), 0),
             NVL(SUM(ACCOUNTED_CR), 0)
      INTO   v_total_dr, v_total_cr
      FROM   RR_SLA_ACCOUNTING_LINES
      WHERE  HEADER_ID = v_header_id;

      IF v_total_dr <> v_total_cr THEN
        ROLLBACK;
        p_status   := 400;
        p_response := p_err(
          'Journal is not balanced: accountedDr=' || v_total_dr ||
          ', accountedCr=' || v_total_cr ||
          '. Difference=' || (v_total_dr - v_total_cr)
        );
        RETURN;
      END IF;
    END;

    COMMIT;

    p_status   := 200;
    p_response := JSON_OBJECT(
      'headerId'  VALUE v_header_id,
      'lineCount' VALUE v_line_count,
      'status'    VALUE 'DRAFT',
      'message'   VALUE 'Accounting created successfully'
    );

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status   := 500;
      p_response := p_err(SQLERRM);
  END create_accounting;


  -- ===========================================================================
  -- post_to_ledger
  -- ===========================================================================
  PROCEDURE post_to_ledger(
    p_body_json IN  CLOB,
    p_status    OUT NUMBER,
    p_response  OUT CLOB
  ) IS
    v_header_id      NUMBER;
    v_posted_by      VARCHAR2(100);
    v_gl_batch_id    NUMBER;
    v_gl_batch_name  VARCHAR2(2400);
    v_gl_header_id   NUMBER;
    v_current_status VARCHAR2(20);
  BEGIN
    v_header_id     := TO_NUMBER(JSON_VALUE(p_body_json, '$.headerId'));
    v_posted_by     := NVL(JSON_VALUE(p_body_json, '$.postedBy'), 'SYSTEM');
    v_gl_batch_id   := TO_NUMBER(JSON_VALUE(p_body_json, '$.glBatchId'));
    v_gl_batch_name := JSON_VALUE(p_body_json, '$.glBatchName');
    v_gl_header_id  := TO_NUMBER(JSON_VALUE(p_body_json, '$.glHeaderId'));

    IF v_header_id IS NULL THEN
      p_status := 400; p_response := p_err('headerId is required.');     RETURN;
    END IF;
    IF v_gl_batch_id IS NULL THEN
      p_status := 400; p_response := p_err('glBatchId is required.');    RETURN;
    END IF;
    IF v_gl_header_id IS NULL THEN
      p_status := 400; p_response := p_err('glHeaderId is required.');   RETURN;
    END IF;

    BEGIN
      SELECT ACCOUNTING_STATUS INTO v_current_status
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  HEADER_ID = v_header_id
      FOR UPDATE NOWAIT;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status   := 404;
        p_response := p_err('SLA Header not found: ' || v_header_id);
        RETURN;
    END;

    IF v_current_status = 'POSTED' THEN
      p_status   := 409;
      p_response := p_err('Header ' || v_header_id || ' is already POSTED and locked. Cannot post twice.');
      RETURN;
    END IF;

    IF v_current_status = 'ERROR' THEN
      p_status   := 409;
      p_response := p_err('Header ' || v_header_id || ' is in ERROR status. Recreate accounting before posting.');
      RETURN;
    END IF;

    UPDATE RR_SLA_ACCOUNTING_HEADERS
    SET    ACCOUNTING_STATUS = 'POSTED',
           POSTING_STATUS    = 'POSTED',
           GL_BATCH_ID       = v_gl_batch_id,
           GL_BATCH_NAME     = v_gl_batch_name,
           GL_HEADER_ID      = v_gl_header_id,
           GL_TRANSFER_DATE  = SYSDATE,
           POSTED_BY         = v_posted_by,
           POSTED_DATE       = SYSDATE,
           LAST_UPDATE_DATE  = SYSDATE,
           LAST_UPDATED_BY   = v_posted_by
    WHERE  HEADER_ID = v_header_id;

    COMMIT;

    p_status   := 200;
    p_response := JSON_OBJECT(
      'headerId'   VALUE v_header_id,
      'glBatchId'  VALUE v_gl_batch_id,
      'glHeaderId' VALUE v_gl_header_id,
      'status'     VALUE 'POSTED',
      'message'    VALUE 'Posted to GL successfully. Record is now locked.'
    );

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status   := 500;
      p_response := p_err(SQLERRM);
  END post_to_ledger;


  -- ===========================================================================
  -- mark_error
  -- ===========================================================================
  PROCEDURE mark_error(
    p_body_json IN  CLOB,
    p_status    OUT NUMBER,
    p_response  OUT CLOB
  ) IS
    v_header_id NUMBER;
    v_error_msg VARCHAR2(500);
    v_posted_by VARCHAR2(100);
  BEGIN
    v_header_id := TO_NUMBER(JSON_VALUE(p_body_json, '$.headerId'));
    v_error_msg := JSON_VALUE(p_body_json, '$.errorMessage');
    v_posted_by := NVL(JSON_VALUE(p_body_json, '$.postedBy'), 'SYSTEM');

    IF v_header_id IS NULL THEN
      p_status := 400; p_response := p_err('headerId is required.'); RETURN;
    END IF;

    DECLARE v_cur_status VARCHAR2(20);
    BEGIN
      SELECT ACCOUNTING_STATUS INTO v_cur_status
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  HEADER_ID = v_header_id;

      IF v_cur_status = 'POSTED' THEN
        p_status   := 409;
        p_response := p_err('Header ' || v_header_id || ' is POSTED and locked. Cannot mark as error.');
        RETURN;
      END IF;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status   := 404;
        p_response := p_err('SLA Header not found: ' || v_header_id);
        RETURN;
    END;

    UPDATE RR_SLA_ACCOUNTING_HEADERS
    SET    ACCOUNTING_STATUS = 'ERROR',
           POSTING_STATUS    = 'REJECTED',
           DESCRIPTION       = DESCRIPTION || ' | POST ERROR: ' || SUBSTR(v_error_msg, 1, 200),
           LAST_UPDATE_DATE  = SYSDATE,
           LAST_UPDATED_BY   = v_posted_by
    WHERE  HEADER_ID = v_header_id;

    COMMIT;

    p_status   := 200;
    p_response := JSON_OBJECT(
      'headerId' VALUE v_header_id,
      'status'   VALUE 'ERROR',
      'message'  VALUE 'Header marked as ERROR'
    );

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status   := 500;
      p_response := p_err(SQLERRM);
  END mark_error;


  -- ===========================================================================
  -- check_accounting_exists
  -- ===========================================================================
  PROCEDURE check_accounting_exists(
    p_source_table IN  VARCHAR2,
    p_source_id    IN  NUMBER,
    p_event_type   IN  VARCHAR2 DEFAULT NULL,
    p_status       OUT NUMBER,
    p_response     OUT CLOB
  ) IS
    v_header_id  NUMBER;
    v_acct_stat  VARCHAR2(20);
    v_post_stat  VARCHAR2(20);
    v_event      VARCHAR2(60);
    v_acct_date  DATE;
    v_created    DATE;
    v_posted     DATE;
  BEGIN
    IF p_source_table IS NULL OR p_source_id IS NULL THEN
      p_status := 400; p_response := p_err('sourceTable and sourceId are required.'); RETURN;
    END IF;

    BEGIN
      SELECT HEADER_ID,       ACCOUNTING_STATUS, POSTING_STATUS,
             EVENT_TYPE_CODE, ACCOUNTING_DATE,   CREATION_DATE,   POSTED_DATE
      INTO   v_header_id,  v_acct_stat,  v_post_stat,
             v_event,      v_acct_date,  v_created,    v_posted
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  SOURCE_TABLE = p_source_table
      AND    SOURCE_ID    = p_source_id
      AND    (p_event_type IS NULL OR EVENT_TYPE_CODE = p_event_type)
      ORDER BY HEADER_ID DESC
      FETCH FIRST 1 ROWS ONLY;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status   := 200;
        p_response := JSON_OBJECT(
          'exists'           VALUE 'false' FORMAT JSON,
          'headerId'         VALUE NULL,
          'accountingStatus' VALUE NULL,
          'postingStatus'    VALUE NULL,
          'canCreate'        VALUE 'true' FORMAT JSON,
          'message'          VALUE 'No accounting entry found. Safe to create.'
        );
        RETURN;
    END;

    p_status   := 200;
    p_response := JSON_OBJECT(
      'exists'           VALUE 'true' FORMAT JSON,
      'headerId'         VALUE v_header_id,
      'eventTypeCode'    VALUE v_event,
      'accountingStatus' VALUE v_acct_stat,
      'postingStatus'    VALUE v_post_stat,
      'accountingDate'   VALUE TO_CHAR(v_acct_date, 'YYYY-MM-DD'),
      'creationDate'     VALUE TO_CHAR(v_created, 'YYYY-MM-DD HH24:MI:SS'),
      'postedDate'       VALUE TO_CHAR(v_posted, 'YYYY-MM-DD HH24:MI:SS'),
      'canCreate'        VALUE CASE WHEN v_acct_stat IN ('DRAFT','ERROR') THEN 'true' ELSE 'false' END FORMAT JSON,
      'message'          VALUE CASE v_acct_stat
                                 WHEN 'POSTED' THEN 'A POSTED entry exists. Cannot create without reversing.'
                                 WHEN 'DRAFT'  THEN 'A DRAFT entry exists and will be replaced on create.'
                                 WHEN 'ERROR'  THEN 'An ERROR entry exists and will be replaced on create.'
                                 ELSE 'Accounting exists with status: ' || v_acct_stat
                               END
      ABSENT ON NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      p_status   := 500;
      p_response := p_err(SQLERRM);
  END check_accounting_exists;


  -- ===========================================================================
  -- get_lines_json  (public helper, reusable)
  -- *** FIX: SUBSTR(DESCRIPTION, 1, 4000) to avoid ORA-40478 ***
  -- ===========================================================================
  FUNCTION get_lines_json(p_header_id IN NUMBER) RETURN CLOB IS
    v_result CLOB;
  BEGIN
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'lineId'             VALUE LINE_ID,
        'lineNumber'         VALUE LINE_NUMBER,
        'lineType'           VALUE LINE_TYPE,
        'accountingClass'    VALUE ACCOUNTING_CLASS,
        'accountCombination' VALUE ACCOUNT_COMBINATION,
        'segment1'           VALUE SEGMENT1,
        'segment2'           VALUE SEGMENT2,
        'segment3'           VALUE SEGMENT3,
        'segment4'           VALUE SEGMENT4,
        'segment5'           VALUE SEGMENT5,
        'segment6'           VALUE SEGMENT6,
        'segment7'           VALUE SEGMENT7,
        'segment8'           VALUE SEGMENT8,
        'segment9'           VALUE SEGMENT9,
        'enteredDr'          VALUE ENTERED_DR,
        'enteredCr'          VALUE ENTERED_CR,
        'accountedDr'        VALUE ACCOUNTED_DR,
        'accountedCr'        VALUE ACCOUNTED_CR,
        'currencyCode'       VALUE CURRENCY_CODE,
        'description'        VALUE SUBSTR(DESCRIPTION, 1, 4000),
        'sourceLineNumber'   VALUE SOURCE_LINE_NUMBER
        ABSENT ON NULL
        RETURNING CLOB
      )
      ORDER BY LINE_NUMBER
      RETURNING CLOB
    )
    INTO v_result
    FROM RR_SLA_ACCOUNTING_LINES
    WHERE HEADER_ID = p_header_id;

    RETURN NVL(v_result, '[]');
  END get_lines_json;


  -- ===========================================================================
  -- get_accounting
  -- *** FIX: SUBSTR(v_desc, 1, 4000) to avoid ORA-40478 ***
  -- ===========================================================================
  PROCEDURE get_accounting(
    p_source_table IN  VARCHAR2,
    p_source_id    IN  NUMBER,
    p_status       OUT NUMBER,
    p_response     OUT CLOB
  ) IS
    v_header_id  NUMBER;
    v_acct_stat  VARCHAR2(20);
    v_post_stat  VARCHAR2(20);
    v_acct_date  DATE;
    v_period     VARCHAR2(15);
    v_created    DATE;
    v_posted     DATE;
    v_posted_by  VARCHAR2(100);
    v_gl_batch   NUMBER;
    v_gl_hdr     NUMBER;
    v_gl_bname   VARCHAR2(240);
    v_module     VARCHAR2(60);
    v_event      VARCHAR2(60);
    v_desc       VARCHAR2(5000);
  BEGIN
    BEGIN
      SELECT HEADER_ID,       ACCOUNTING_STATUS, POSTING_STATUS,
             ACCOUNTING_DATE, PERIOD_NAME,       CREATION_DATE,
             POSTED_DATE,     POSTED_BY,
             GL_BATCH_ID,     GL_HEADER_ID,      GL_BATCH_NAME,
             MODULE_NAME,     EVENT_TYPE_CODE,   DESCRIPTION
      INTO   v_header_id,  v_acct_stat,  v_post_stat,
             v_acct_date,  v_period,     v_created,
             v_posted,     v_posted_by,
             v_gl_batch,   v_gl_hdr,     v_gl_bname,
             v_module,     v_event,      v_desc
      FROM   RR_SLA_ACCOUNTING_HEADERS
      WHERE  SOURCE_TABLE = p_source_table
      AND    SOURCE_ID    = p_source_id
      ORDER BY HEADER_ID DESC
      FETCH FIRST 1 ROWS ONLY;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_status   := 200;
        SELECT JSON_OBJECT(
          'found'            VALUE 'false' FORMAT JSON,
          'headerId'         VALUE NULL,
          'accountingStatus' VALUE NULL,
          'lines'            VALUE '[]' FORMAT JSON
          RETURNING CLOB
        ) INTO p_response FROM DUAL;
        RETURN;
    END;

    p_status   := 200;
    SELECT JSON_OBJECT(
      'found'            VALUE 'true' FORMAT JSON,
      'headerId'         VALUE v_header_id,
      'moduleName'       VALUE v_module,
      'eventTypeCode'    VALUE v_event,
      'accountingStatus' VALUE v_acct_stat,
      'postingStatus'    VALUE v_post_stat,
      'accountingDate'   VALUE TO_CHAR(v_acct_date, 'YYYY-MM-DD'),
      'periodName'       VALUE v_period,
      'description'      VALUE SUBSTR(v_desc, 1, 4000),
      'creationDate'     VALUE TO_CHAR(v_created, 'YYYY-MM-DD HH24:MI:SS'),
      'postedDate'       VALUE TO_CHAR(v_posted,  'YYYY-MM-DD HH24:MI:SS'),
      'postedBy'         VALUE v_posted_by,
      'glBatchId'        VALUE v_gl_batch,
      'glBatchName'      VALUE v_gl_bname,
      'glHeaderId'       VALUE v_gl_hdr,
      'lines'            VALUE get_lines_json(v_header_id) FORMAT JSON
      ABSENT ON NULL
      RETURNING CLOB
    ) INTO p_response FROM DUAL;

  EXCEPTION
    WHEN OTHERS THEN
      p_status   := 500;
      p_response := p_err(SQLERRM);
  END get_accounting;

END RR_SLA_PKG;
/
