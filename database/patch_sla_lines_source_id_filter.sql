-- ============================================================
-- Patch: Add SOURCE_ID filter to RR_SLA_JOURNALS_PKG.get_lines
--        and expose it via the sla/journals/lines ORDS handler.
-- Without this, getAccountingLinesBySourceId() ignores sourceId
-- and returns all lines for the module.
-- ============================================================

-- ── Step 1: Replace the package body with sourceId filter added ──
CREATE OR REPLACE PACKAGE BODY RR_SLA_JOURNALS_PKG AS

    -- -----------------------------------------------------------------------
    -- jstr / jnum helpers
    -- -----------------------------------------------------------------------
    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p;
    BEGIN
        IF v IS NULL THEN RETURN 'null'; END IF;
        v := REPLACE(v, '\',  '\\');
        v := REPLACE(v, '"',  '\"');
        v := REPLACE(v, CHR(10), '\n');
        v := REPLACE(v, CHR(13), '\r');
        v := REPLACE(v, CHR(9),  '\t');
        RETURN '"' || v || '"';
    END jstr;

    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        RETURN TO_CHAR(p);
    END jnum;

    -- -----------------------------------------------------------------------
    -- get_headers  (unchanged from original)
    -- -----------------------------------------------------------------------
    FUNCTION get_headers(
        p_accounting_status   VARCHAR2 DEFAULT NULL,
        p_module_name         VARCHAR2 DEFAULT NULL,
        p_source_table        VARCHAR2 DEFAULT NULL,
        p_event_type_code     VARCHAR2 DEFAULT NULL,
        p_period_name         VARCHAR2 DEFAULT NULL,
        p_source_number       VARCHAR2 DEFAULT NULL,
        p_date_from           VARCHAR2 DEFAULT NULL,
        p_date_to             VARCHAR2 DEFAULT NULL,
        p_limit               NUMBER   DEFAULT 500
    ) RETURN CLOB IS

        v_sql    CLOB;
        v_cur    SYS_REFCURSOR;
        v_result CLOB := '{"items":[';
        v_sep    VARCHAR2(1) := '';

        v_header_id   NUMBER;  v_module      VARCHAR2(60);  v_src_table   VARCHAR2(60);
        v_src_id      NUMBER;  v_src_number  VARCHAR2(100); v_src_type    VARCHAR2(60);
        v_event_type  VARCHAR2(60); v_acct_date VARCHAR2(20); v_period    VARCHAR2(20);
        v_ledger_id   NUMBER;  v_ledger_name VARCHAR2(200); v_currency    VARCHAR2(15);
        v_bu          VARCHAR2(100); v_le         VARCHAR2(100); v_desc   VARCHAR2(500);
        v_acct_status VARCHAR2(20); v_post_status VARCHAR2(20);
        v_gl_batch_id NUMBER; v_gl_batch_name VARCHAR2(200); v_gl_header_id NUMBER;
        v_created_by  VARCHAR2(100); v_creation_date VARCHAR2(30);
        v_posted_by   VARCHAR2(100); v_posted_date   VARCHAR2(30);
        v_line_count  NUMBER;

    BEGIN
        v_sql :=
            'SELECT h.header_id, h.module_name, h.source_table, h.source_id,' ||
            '       h.source_number, h.source_type, h.event_type_code,' ||
            '       TO_CHAR(h.accounting_date,''YYYY-MM-DD'') accounting_date,' ||
            '       h.period_name, h.ledger_id, h.ledger_name, h.currency_code,' ||
            '       h.business_unit, h.legal_entity, h.description,' ||
            '       h.accounting_status, h.posting_status,' ||
            '       h.gl_batch_id, h.gl_batch_name, h.gl_header_id,' ||
            '       h.created_by,' ||
            '       TO_CHAR(h.creation_date,''YYYY-MM-DD HH24:MI:SS'') creation_date,' ||
            '       h.posted_by,' ||
            '       TO_CHAR(h.posted_date,''YYYY-MM-DD HH24:MI:SS'') posted_date,' ||
            '       (SELECT COUNT(*) FROM RR_SLA_ACCOUNTING_LINES l WHERE l.header_id = h.header_id) line_count' ||
            '  FROM RR_SLA_ACCOUNTING_HEADERS h' ||
            ' WHERE 1=1';

        IF p_accounting_status IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_status = ''' || p_accounting_status || '''';
        END IF;
        IF p_module_name IS NOT NULL THEN
            v_sql := v_sql || ' AND h.module_name = ''' || p_module_name || '''';
        END IF;
        IF p_source_table IS NOT NULL THEN
            v_sql := v_sql || ' AND h.source_table = ''' || p_source_table || '''';
        END IF;
        IF p_event_type_code IS NOT NULL THEN
            v_sql := v_sql || ' AND h.event_type_code = ''' || p_event_type_code || '''';
        END IF;
        IF p_period_name IS NOT NULL THEN
            v_sql := v_sql || ' AND h.period_name = ''' || p_period_name || '''';
        END IF;
        IF p_source_number IS NOT NULL THEN
            v_sql := v_sql || ' AND UPPER(h.source_number) LIKE ''%' || UPPER(p_source_number) || '%''';
        END IF;
        IF p_date_from IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_date >= TO_DATE(''' || p_date_from || ''',''YYYY-MM-DD'')';
        END IF;
        IF p_date_to IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_date <= TO_DATE(''' || p_date_to || ''',''YYYY-MM-DD'')';
        END IF;

        v_sql := v_sql || ' ORDER BY h.accounting_date DESC, h.header_id DESC';
        v_sql := v_sql || ' FETCH FIRST ' || NVL(p_limit, 500) || ' ROWS ONLY';

        OPEN v_cur FOR v_sql;
        LOOP
            FETCH v_cur INTO
                v_header_id, v_module, v_src_table, v_src_id, v_src_number, v_src_type, v_event_type,
                v_acct_date, v_period, v_ledger_id, v_ledger_name, v_currency,
                v_bu, v_le, v_desc, v_acct_status, v_post_status,
                v_gl_batch_id, v_gl_batch_name, v_gl_header_id,
                v_created_by, v_creation_date, v_posted_by, v_posted_date, v_line_count;
            EXIT WHEN v_cur%NOTFOUND;

            v_result := v_result || v_sep ||
                '{"headerId":'     || jnum(v_header_id)     ||
                ',"moduleName":'   || jstr(v_module)         ||
                ',"sourceTable":'  || jstr(v_src_table)      ||
                ',"sourceId":'     || jnum(v_src_id)         ||
                ',"sourceNumber":' || jstr(v_src_number)     ||
                ',"sourceType":'   || jstr(v_src_type)       ||
                ',"eventTypeCode":'|| jstr(v_event_type)     ||
                ',"accountingDate":'|| jstr(v_acct_date)     ||
                ',"periodName":'   || jstr(v_period)         ||
                ',"ledgerId":'     || jnum(v_ledger_id)      ||
                ',"ledgerName":'   || jstr(v_ledger_name)    ||
                ',"currencyCode":' || jstr(v_currency)       ||
                ',"businessUnit":' || jstr(v_bu)             ||
                ',"legalEntity":'  || jstr(v_le)             ||
                ',"description":'  || jstr(v_desc)           ||
                ',"accountingStatus":'|| jstr(v_acct_status) ||
                ',"postingStatus":' || jstr(v_post_status)   ||
                ',"glBatchId":'    || jnum(v_gl_batch_id)    ||
                ',"glBatchName":'  || jstr(v_gl_batch_name)  ||
                ',"glHeaderId":'   || jnum(v_gl_header_id)   ||
                ',"createdBy":'    || jstr(v_created_by)     ||
                ',"creationDate":' || jstr(v_creation_date)  ||
                ',"postedBy":'     || jstr(v_posted_by)      ||
                ',"postedDate":'   || jstr(v_posted_date)    ||
                ',"lineCount":'    || jnum(v_line_count)      ||
                '}';
            v_sep := ',';
        END LOOP;
        CLOSE v_cur;

        RETURN v_result || ']}';
    END get_headers;

    -- -----------------------------------------------------------------------
    -- get_lines  — now accepts p_source_id for precise filtering
    -- -----------------------------------------------------------------------
    FUNCTION get_lines(
        p_header_id           NUMBER   DEFAULT NULL,
        p_accounting_status   VARCHAR2 DEFAULT NULL,
        p_module_name         VARCHAR2 DEFAULT NULL,
        p_line_type           VARCHAR2 DEFAULT NULL,
        p_accounting_class    VARCHAR2 DEFAULT NULL,
        p_account_combination VARCHAR2 DEFAULT NULL,
        p_source_number       VARCHAR2 DEFAULT NULL,
        p_source_id           NUMBER   DEFAULT NULL,   -- NEW
        p_source_table        VARCHAR2 DEFAULT NULL,   -- NEW
        p_date_from           VARCHAR2 DEFAULT NULL,
        p_date_to             VARCHAR2 DEFAULT NULL,
        p_limit               NUMBER   DEFAULT 500
    ) RETURN CLOB IS

        v_sql    CLOB;
        v_cur    SYS_REFCURSOR;
        v_result CLOB := '{"items":[';
        v_sep    VARCHAR2(1) := '';

        v_line_id     NUMBER;  v_header_id   NUMBER;  v_line_num  NUMBER;
        v_line_type   VARCHAR2(2);   v_acct_class  VARCHAR2(60);
        v_account     VARCHAR2(200); v_ent_dr      NUMBER;
        v_ent_cr      NUMBER;        v_acc_dr      NUMBER;
        v_acc_cr      NUMBER;        v_currency    VARCHAR2(15);
        v_desc        VARCHAR2(500); v_src_number  VARCHAR2(100);
        v_src_table   VARCHAR2(60);  v_acct_date   VARCHAR2(20);
        v_acct_status VARCHAR2(20);  v_bu          VARCHAR2(100);
        v_le          VARCHAR2(100); v_module      VARCHAR2(60);
        v_party_type  VARCHAR2(30);  v_acct_desc   VARCHAR2(200);
        v_event_type  VARCHAR2(60);

    BEGIN
        v_sql :=
            'SELECT l.line_id, l.header_id, l.line_number, l.line_type, l.accounting_class,' ||
            '       l.account_combination, l.entered_dr, l.entered_cr, l.accounted_dr, l.accounted_cr,' ||
            '       NVL(l.currency_code, h.currency_code) currency_code, l.description,' ||
            '       h.source_number, h.source_table,' ||
            '       TO_CHAR(h.accounting_date,''YYYY-MM-DD'') accounting_date,' ||
            '       h.accounting_status, h.business_unit, h.legal_entity,' ||
            '       h.module_name, NULL party_type,' ||
            '       vsv.description account_description,' ||
            '       h.event_type_code' ||
            '  FROM RR_SLA_ACCOUNTING_LINES l' ||
            '  JOIN RR_SLA_ACCOUNTING_HEADERS h ON l.header_id = h.header_id' ||
            '  LEFT JOIN RR_VALUE_SET_VALUES vsv' ||
            '    ON  vsv.value_set_code = ''BUIMERC_FIN_GLB_COA_ACCOUNT''' ||
            '    AND vsv.value = TRIM(REGEXP_SUBSTR(l.account_combination, ''[^-]+'', 1, 4))' ||
            ' WHERE 1=1';

        IF p_header_id IS NOT NULL THEN
            v_sql := v_sql || ' AND l.header_id = ' || p_header_id;
        END IF;
        IF p_source_id IS NOT NULL THEN
            v_sql := v_sql || ' AND h.source_id = ' || p_source_id;
        END IF;
        IF p_source_table IS NOT NULL THEN
            v_sql := v_sql || ' AND h.source_table = ''' || p_source_table || '''';
        END IF;
        IF p_accounting_status IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_status = ''' || p_accounting_status || '''';
        END IF;
        IF p_module_name IS NOT NULL THEN
            v_sql := v_sql || ' AND h.module_name = ''' || p_module_name || '''';
        END IF;
        IF p_line_type IS NOT NULL THEN
            v_sql := v_sql || ' AND l.line_type = ''' || p_line_type || '''';
        END IF;
        IF p_accounting_class IS NOT NULL THEN
            v_sql := v_sql || ' AND l.accounting_class = ''' || p_accounting_class || '''';
        END IF;
        IF p_account_combination IS NOT NULL THEN
            v_sql := v_sql || ' AND UPPER(l.account_combination) LIKE ''%' || UPPER(p_account_combination) || '%''';
        END IF;
        IF p_source_number IS NOT NULL THEN
            v_sql := v_sql || ' AND UPPER(h.source_number) LIKE ''%' || UPPER(p_source_number) || '%''';
        END IF;
        IF p_date_from IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_date >= TO_DATE(''' || p_date_from || ''',''YYYY-MM-DD'')';
        END IF;
        IF p_date_to IS NOT NULL THEN
            v_sql := v_sql || ' AND h.accounting_date <= TO_DATE(''' || p_date_to || ''',''YYYY-MM-DD'')';
        END IF;

        v_sql := v_sql || ' ORDER BY h.accounting_date DESC, l.header_id DESC, l.line_number ASC';
        v_sql := v_sql || ' FETCH FIRST ' || NVL(p_limit, 500) || ' ROWS ONLY';

        OPEN v_cur FOR v_sql;
        LOOP
            FETCH v_cur INTO
                v_line_id, v_header_id, v_line_num, v_line_type, v_acct_class,
                v_account, v_ent_dr, v_ent_cr, v_acc_dr, v_acc_cr,
                v_currency, v_desc, v_src_number, v_src_table,
                v_acct_date, v_acct_status, v_bu, v_le, v_module, v_party_type, v_acct_desc,
                v_event_type;
            EXIT WHEN v_cur%NOTFOUND;

            v_result := v_result || v_sep ||
                '{"lineId":'           || jnum(v_line_id)    ||
                ',"headerId":'         || jnum(v_header_id)  ||
                ',"lineNumber":'       || jnum(v_line_num)   ||
                ',"lineType":'         || jstr(v_line_type)  ||
                ',"accountingClass":'  || jstr(v_acct_class) ||
                ',"accountCombination":'|| jstr(v_account)   ||
                ',"enteredDr":'        || jnum(v_ent_dr)     ||
                ',"enteredCr":'        || jnum(v_ent_cr)     ||
                ',"accountedDr":'      || jnum(v_acc_dr)     ||
                ',"accountedCr":'      || jnum(v_acc_cr)     ||
                ',"currencyCode":'     || jstr(v_currency)   ||
                ',"description":'      || jstr(v_desc)       ||
                ',"sourceNumber":'     || jstr(v_src_number) ||
                ',"sourceTable":'      || jstr(v_src_table)  ||
                ',"accountingDate":'   || jstr(v_acct_date)  ||
                ',"accountingStatus":' || jstr(v_acct_status)||
                ',"businessUnit":'     || jstr(v_bu)         ||
                ',"legalEntity":'      || jstr(v_le)         ||
                ',"moduleName":'       || jstr(v_module)     ||
                ',"accountDescription":'|| jstr(v_acct_desc) ||
                ',"eventTypeCode":'    || jstr(v_event_type) ||
                '}';
            v_sep := ',';
        END LOOP;
        CLOSE v_cur;

        RETURN v_result || ']}';
    END get_lines;

END RR_SLA_JOURNALS_PKG;
/

-- ── Step 2: Rebuild sla/journals/lines GET handler with sourceId + sourceTable params ──
BEGIN
  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'reerp',
      p_pattern     => 'sla/journals/lines',
      p_method      => 'GET'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name => 'reerp',
    p_pattern     => 'sla/journals/lines',
    p_method      => 'GET',
    p_source_type => 'plsql/block',
    p_comments    => 'Query SLA lines — delegates to RR_SLA_JOURNALS_PKG.get_lines',
    p_source      =>
'DECLARE
  v_result CLOB;
BEGIN
  v_result := RR_SLA_JOURNALS_PKG.get_lines(
    p_header_id           => TO_NUMBER(:headerId),
    p_accounting_status   => :accountingStatus,
    p_module_name         => :moduleName,
    p_line_type           => :lineType,
    p_accounting_class    => :accountingClass,
    p_account_combination => :accountCombination,
    p_source_number       => :sourceNumber,
    p_source_id           => TO_NUMBER(:sourceId),
    p_source_table        => :sourceTable,
    p_date_from           => :dateFrom,
    p_date_to             => :dateTo,
    p_limit               => TO_NUMBER(:limit)
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  HTP.PRN(v_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
  );
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('sla/journals/lines handler rebuilt with sourceId + sourceTable filters');
END;
/
