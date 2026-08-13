-- =============================================================================
-- Manage Subledger Journals — Package + ORDS handlers
-- =============================================================================
-- Step 1: Create RR_SLA_JOURNALS_PKG (spec + body)
-- Step 2: Register two thin ORDS GET handlers that call the package
--
-- Run in: SQL Workshop > SQL Commands (as schema owner)
-- Run each block separately (one per SQL Commands execution)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1a.  Package spec
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE RR_SLA_JOURNALS_PKG AS

    -- Returns JSON {"items":[...]} for SLA accounting headers
    FUNCTION get_headers(
        p_accounting_status  VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT NULL,
        p_source_table       VARCHAR2 DEFAULT NULL,
        p_event_type_code    VARCHAR2 DEFAULT NULL,
        p_period_name        VARCHAR2 DEFAULT NULL,
        p_source_number      VARCHAR2 DEFAULT NULL,
        p_date_from          VARCHAR2 DEFAULT NULL,   -- YYYY-MM-DD
        p_date_to            VARCHAR2 DEFAULT NULL,   -- YYYY-MM-DD
        p_limit              NUMBER   DEFAULT 500
    ) RETURN CLOB;

    -- Returns JSON {"items":[...]} for SLA accounting lines (joined to headers)
    FUNCTION get_lines(
        p_header_id           NUMBER   DEFAULT NULL,
        p_source_id           NUMBER   DEFAULT NULL,
        p_accounting_status  VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT NULL,
        p_source_table       VARCHAR2 DEFAULT NULL,
        p_line_type          VARCHAR2 DEFAULT NULL,
        p_accounting_class   VARCHAR2 DEFAULT NULL,
        p_account_combination VARCHAR2 DEFAULT NULL,
        p_source_number      VARCHAR2 DEFAULT NULL,
        p_date_from          VARCHAR2 DEFAULT NULL,   -- YYYY-MM-DD
        p_date_to            VARCHAR2 DEFAULT NULL,   -- YYYY-MM-DD
        p_limit              NUMBER   DEFAULT 500
    ) RETURN CLOB;

END RR_SLA_JOURNALS_PKG;
/


-- ---------------------------------------------------------------------------
-- 1b.  Package body
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY RR_SLA_JOURNALS_PKG AS

    -- -----------------------------------------------------------------------
    -- get_headers
    -- -----------------------------------------------------------------------
    FUNCTION get_headers(
        p_accounting_status  VARCHAR2 DEFAULT NULL,
        p_module_name        VARCHAR2 DEFAULT NULL,
        p_source_table       VARCHAR2 DEFAULT NULL,
        p_event_type_code    VARCHAR2 DEFAULT NULL,
        p_period_name        VARCHAR2 DEFAULT NULL,
        p_source_number      VARCHAR2 DEFAULT NULL,
        p_date_from          VARCHAR2 DEFAULT NULL,
        p_date_to            VARCHAR2 DEFAULT NULL,
        p_limit              NUMBER   DEFAULT 500
    ) RETURN CLOB IS

        v_items CLOB;

    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'headerId'         VALUE t.header_id,
                'moduleName'       VALUE t.module_name,
                'sourceTable'      VALUE t.source_table,
                'sourceId'         VALUE t.source_id,
                'sourceNumber'     VALUE t.source_number,
                'sourceType'       VALUE t.source_type,
                'eventTypeCode'    VALUE t.event_type_code,
                'accountingDate'   VALUE t.acct_date,
                'periodName'       VALUE t.period_name,
                'ledgerId'         VALUE t.ledger_id,
                'ledgerName'       VALUE t.ledger_name,
                'currencyCode'     VALUE t.currency_code,
                'businessUnit'     VALUE t.business_unit,
                'legalEntity'      VALUE t.legal_entity,
                'description'      VALUE t.description,
                'accountingStatus' VALUE t.accounting_status,
                'postingStatus'    VALUE t.posting_status,
                'glBatchId'        VALUE t.gl_batch_id,
                'glBatchName'      VALUE t.gl_batch_name,
                'glHeaderId'       VALUE t.gl_header_id,
                'createdBy'        VALUE t.created_by,
                'creationDate'     VALUE t.creation_date,
                'postedBy'         VALUE t.posted_by,
                'postedDate'       VALUE t.posted_date,
                'lineCount'        VALUE t.line_count
                NULL ON NULL
            )
            ORDER BY t.acct_date DESC, t.header_id DESC
            RETURNING CLOB
        )
        INTO v_items
        FROM (
            SELECT h.header_id, h.module_name, h.source_table, h.source_id,
                   h.source_number, h.source_type, h.event_type_code,
                   TO_CHAR(h.accounting_date, 'YYYY-MM-DD') acct_date,
                   h.period_name, h.ledger_id, h.ledger_name, h.currency_code,
                   h.business_unit, h.legal_entity, h.description,
                   h.accounting_status, h.posting_status,
                   h.gl_batch_id, h.gl_batch_name, h.gl_header_id,
                   h.created_by,
                   TO_CHAR(h.creation_date, 'YYYY-MM-DD HH24:MI:SS') creation_date,
                   h.posted_by,
                   TO_CHAR(h.posted_date, 'YYYY-MM-DD HH24:MI:SS') posted_date,
                   (SELECT COUNT(*) FROM RR_SLA_ACCOUNTING_LINES l WHERE l.header_id = h.header_id) line_count
            FROM RR_SLA_ACCOUNTING_HEADERS h
            WHERE 1=1
              AND (p_accounting_status IS NULL OR h.accounting_status = p_accounting_status)
              AND (p_module_name       IS NULL OR h.module_name       = p_module_name)
              AND (p_source_table      IS NULL OR h.source_table      = p_source_table)
              AND (p_event_type_code   IS NULL OR h.event_type_code   = p_event_type_code)
              AND (p_period_name       IS NULL OR h.period_name       = p_period_name)
              AND (p_source_number     IS NULL OR UPPER(h.source_number) LIKE '%'||UPPER(p_source_number)||'%')
              AND (p_date_from         IS NULL OR h.accounting_date >= TO_DATE(p_date_from, 'YYYY-MM-DD'))
              AND (p_date_to           IS NULL OR h.accounting_date <= TO_DATE(p_date_to,   'YYYY-MM-DD'))
            ORDER BY h.accounting_date DESC, h.header_id DESC
            FETCH FIRST NVL(p_limit, 500) ROWS ONLY
        ) t;

        RETURN '{"items":' || NVL(v_items, '[]') || '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"error":true,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_headers;


    -- -----------------------------------------------------------------------
    -- get_lines
    -- -----------------------------------------------------------------------
    FUNCTION get_lines(
        p_header_id           NUMBER   DEFAULT NULL,
        p_accounting_status   VARCHAR2 DEFAULT NULL,
        p_module_name         VARCHAR2 DEFAULT NULL,
        p_line_type           VARCHAR2 DEFAULT NULL,
        p_accounting_class    VARCHAR2 DEFAULT NULL,
        p_account_combination VARCHAR2 DEFAULT NULL,
        p_source_number       VARCHAR2 DEFAULT NULL,
        p_date_from           VARCHAR2 DEFAULT NULL,
        p_date_to             VARCHAR2 DEFAULT NULL,
        p_limit               NUMBER   DEFAULT 500
    ) RETURN CLOB IS

        v_items CLOB;

    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'lineId'              VALUE t.line_id,
                'headerId'            VALUE t.header_id,
                'lineNumber'          VALUE t.line_number,
                'lineType'            VALUE t.line_type,
                'accountingClass'     VALUE t.accounting_class,
                'accountCombination'  VALUE t.account_combination,
                'enteredDr'           VALUE t.entered_dr,
                'enteredCr'           VALUE t.entered_cr,
                'accountedDr'         VALUE t.accounted_dr,
                'accountedCr'         VALUE t.accounted_cr,
                'currencyCode'        VALUE t.currency_code,
                'description'         VALUE t.description,
                'sourceNumber'        VALUE t.source_number,
                'sourceTable'         VALUE t.source_table,
                'accountingDate'      VALUE t.acct_date,
                'accountingStatus'    VALUE t.accounting_status,
                'businessUnit'        VALUE t.business_unit,
                'legalEntity'         VALUE t.legal_entity,
                'moduleName'          VALUE t.module_name,
                'partyType'           VALUE t.party_type,
                'accountDescription'  VALUE t.account_description
                NULL ON NULL
            )
            ORDER BY t.acct_date DESC, t.header_id DESC, t.line_number ASC
            RETURNING CLOB
        )
        INTO v_items
        FROM (
            SELECT l.line_id, l.header_id, l.line_number, l.line_type, l.accounting_class,
                   l.account_combination, l.entered_dr, l.entered_cr, l.accounted_dr, l.accounted_cr,
                   NVL(l.currency_code, h.currency_code) currency_code,
                   l.description, h.source_number, h.source_table,
                   TO_CHAR(h.accounting_date, 'YYYY-MM-DD') acct_date,
                   h.accounting_status, h.business_unit, h.legal_entity, h.module_name,
                   CAST(NULL AS VARCHAR2(30)) party_type,
                   vsv.description account_description
            FROM RR_SLA_ACCOUNTING_LINES l
            JOIN RR_SLA_ACCOUNTING_HEADERS h ON l.header_id = h.header_id
            LEFT JOIN RR_VALUE_SET_VALUES vsv
                ON  vsv.value_set_code = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
                AND vsv.value = TRIM(REGEXP_SUBSTR(l.account_combination, '[^-]+', 1, 4))
            WHERE 1=1
              AND (p_header_id           IS NULL OR l.header_id          = p_header_id)
              AND (p_accounting_status   IS NULL OR h.accounting_status  = p_accounting_status)
              AND (p_module_name         IS NULL OR h.module_name        = p_module_name)
              AND (p_line_type           IS NULL OR l.line_type          = p_line_type)
              AND (p_accounting_class    IS NULL OR l.accounting_class   = p_accounting_class)
              AND (p_account_combination IS NULL OR UPPER(l.account_combination) LIKE '%'||UPPER(p_account_combination)||'%')
              AND (p_source_number       IS NULL OR UPPER(h.source_number) LIKE '%'||UPPER(p_source_number)||'%')
              AND (p_date_from           IS NULL OR h.accounting_date >= TO_DATE(p_date_from, 'YYYY-MM-DD'))
              AND (p_date_to             IS NULL OR h.accounting_date <= TO_DATE(p_date_to,   'YYYY-MM-DD'))
            ORDER BY h.accounting_date DESC, l.header_id DESC, l.line_number ASC
            FETCH FIRST NVL(p_limit, 500) ROWS ONLY
        ) t;

        RETURN '{"items":' || NVL(v_items, '[]') || '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"error":true,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_lines;

END RR_SLA_JOURNALS_PKG;
/


-- ---------------------------------------------------------------------------
-- 2.  ORDS templates (drop + recreate)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'sla/journals');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'sla/journals/lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals',
        p_comments    => 'SLA Journal Entries (headers)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals/lines',
        p_comments    => 'SLA Journal Entry Lines'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 3a.  GET sla/journals  — thin handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Query SLA headers — delegates to RR_SLA_JOURNALS_PKG.get_headers',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_offset INTEGER;
  v_len    INTEGER;
BEGIN
  v_result := RR_SLA_JOURNALS_PKG.get_headers(
    p_accounting_status => :accountingStatus,
    p_module_name       => :moduleName,
    p_source_table      => :sourceTable,
    p_event_type_code   => :eventTypeCode,
    p_period_name       => :periodName,
    p_source_number     => :sourceNumber,
    p_date_from         => :dateFrom,
    p_date_to           => :dateTo,
    p_limit             => TO_NUMBER(:limit)
  );
  :status_code := 200;
  v_len    := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
  v_offset := 1;
  WHILE v_offset <= v_len LOOP
    HTP.PRN(DBMS_LOB.SUBSTR(v_result, 4000, v_offset));
    v_offset := v_offset + 4000;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 3b.  GET sla/journals/lines  — thin handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals/lines',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Query SLA lines — delegates to RR_SLA_JOURNALS_PKG.get_lines',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_offset INTEGER;
  v_len    INTEGER;
BEGIN
  v_result := RR_SLA_JOURNALS_PKG.get_lines(
    p_header_id           => TO_NUMBER(:headerId),
    p_accounting_status   => :accountingStatus,
    p_module_name         => :moduleName,
    p_line_type           => :lineType,
    p_accounting_class    => :accountingClass,
    p_account_combination => :accountCombination,
    p_source_number       => :sourceNumber,
    p_date_from           => :dateFrom,
    p_date_to             => :dateTo,
    p_limit               => TO_NUMBER(:limit)
  );
  :status_code := 200;
  v_len    := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
  v_offset := 1;
  WHILE v_offset <= v_len LOOP
    HTP.PRN(DBMS_LOB.SUBSTR(v_result, 4000, v_offset));
    v_offset := v_offset + 4000;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 4.  Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 80) source_preview
FROM   user_ords_modules m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template LIKE 'sla/journals%'
ORDER BY t.uri_template, h.method;
