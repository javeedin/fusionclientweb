-- ============================================================
-- PATCH 91: Add per-statement line counts to bankstatements GET
--
-- Adds totalLines, reconLines, unreconLines to each item returned
-- by cash/bankstatements so the UI can show reconciliation progress
-- without a separate fetch per statement.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/bankstatements',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/bankstatements',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_stmt_num  VARCHAR2(200) := :statement_number;
    v_bank_acct VARCHAR2(360) := :bank_account;
    v_bus_unit  VARCHAR2(360) := :business_unit;
    v_status    VARCHAR2(30)  := :status;
    v_date_from VARCHAR2(20)  := :date_from;
    v_date_to   VARCHAR2(20)  := :date_to;
    v_limit     NUMBER        := NVL(TO_NUMBER(:row_limit), 200);
    v_clob      CLOB;
    v_buf       VARCHAR2(32767);
    v_first     BOOLEAN := TRUE;
    l_pos       INTEGER;
    l_len       INTEGER;
    l_chunk     VARCHAR2(32767);

    CURSOR c_stmt IS
        SELECT
            h.STATEMENT_ID,
            h.STATEMENT_NUMBER,
            h.BANK_ACCOUNT_NUMBER,
            h.BANK_ACCOUNT_NAME,
            TO_CHAR(h.STATEMENT_DATE, 'YYYY-MM-DD')          AS STATEMENT_DATE,
            h.CURRENCY_CODE,
            REGEXP_REPLACE(TO_CHAR(NVL(h.OPENING_BALANCE,0),'FM99999999999999990.9999999999'),'\.$','') AS OPENING_BALANCE,
            REGEXP_REPLACE(TO_CHAR(NVL(h.CLOSING_BALANCE,0),'FM99999999999999990.9999999999'),'\.$','') AS CLOSING_BALANCE,
            REGEXP_REPLACE(TO_CHAR(NVL(h.TOTAL_CREDITS,0),  'FM99999999999999990.9999999999'),'\.$','') AS TOTAL_CREDITS,
            REGEXP_REPLACE(TO_CHAR(NVL(h.TOTAL_DEBITS,0),   'FM99999999999999990.9999999999'),'\.$','') AS TOTAL_DEBITS,
            h.STATUS,
            h.BUSINESS_UNIT_NAME,
            h.DESCRIPTION,
            h.CREATED_BY,
            TO_CHAR(h.CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
            h.LAST_UPDATED_BY,
            TO_CHAR(h.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
            -- Line counts per statement
            NVL((SELECT COUNT(*) FROM RR_BANK_STATEMENT_LINES l
                 WHERE l.STATEMENT_ID = h.STATEMENT_ID), 0)   AS TOTAL_LINES,
            NVL((SELECT COUNT(*) FROM RR_BANK_STATEMENT_LINES l
                 WHERE l.STATEMENT_ID = h.STATEMENT_ID
                   AND NVL(l.RECON_STATUS,'UNRECONCILED') = 'RECONCILED'), 0) AS RECON_LINES,
            NVL((SELECT COUNT(*) FROM RR_BANK_STATEMENT_LINES l
                 WHERE l.STATEMENT_ID = h.STATEMENT_ID
                   AND NVL(l.RECON_STATUS,'UNRECONCILED') != 'RECONCILED'), 0) AS UNRECON_LINES
        FROM   RR_BANK_STATEMENT_HEADER h
        WHERE  (v_stmt_num   IS NULL OR UPPER(h.STATEMENT_NUMBER)   LIKE '%' || UPPER(v_stmt_num)   || '%')
        AND    (v_bank_acct  IS NULL OR UPPER(h.BANK_ACCOUNT_NUMBER) LIKE '%' || UPPER(v_bank_acct) || '%'
                                     OR UPPER(h.BANK_ACCOUNT_NAME)  LIKE '%' || UPPER(v_bank_acct) || '%')
        AND    (v_bus_unit   IS NULL OR UPPER(h.BUSINESS_UNIT_NAME) LIKE '%' || UPPER(v_bus_unit)   || '%')
        AND    (v_status     IS NULL OR h.STATUS = v_status)
        AND    (v_date_from  IS NULL OR h.STATEMENT_DATE >= TO_DATE(v_date_from, 'YYYY-MM-DD'))
        AND    (v_date_to    IS NULL OR h.STATEMENT_DATE <= TO_DATE(v_date_to,   'YYYY-MM-DD'))
        ORDER  BY h.STATEMENT_DATE DESC, h.STATEMENT_ID DESC
        FETCH  FIRST v_limit ROWS ONLY;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"status":"success","items":[');

    FOR r IN c_stmt LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;

        v_buf :=
            '{"statementId":'          || r.STATEMENT_ID                                       ||
            ',"statementNumber":'      || APEX_JSON.STRINGIFY(r.STATEMENT_NUMBER)              ||
            ',"bankAccountNumber":'    || APEX_JSON.STRINGIFY(NVL(r.BANK_ACCOUNT_NUMBER,''))   ||
            ',"bankAccountName":'      || APEX_JSON.STRINGIFY(NVL(r.BANK_ACCOUNT_NAME,''))     ||
            ',"statementDate":'        || APEX_JSON.STRINGIFY(NVL(r.STATEMENT_DATE,''))        ||
            ',"currencyCode":'         || APEX_JSON.STRINGIFY(NVL(r.CURRENCY_CODE,''))         ||
            ',"openingBalance":'       || r.OPENING_BALANCE                                    ||
            ',"closingBalance":'       || r.CLOSING_BALANCE                                    ||
            ',"totalCredits":'         || r.TOTAL_CREDITS                                      ||
            ',"totalDebits":'          || r.TOTAL_DEBITS                                       ||
            ',"status":'               || APEX_JSON.STRINGIFY(NVL(r.STATUS,''))                ||
            ',"businessUnitName":'     || APEX_JSON.STRINGIFY(NVL(r.BUSINESS_UNIT_NAME,''))    ||
            ',"description":'          || APEX_JSON.STRINGIFY(NVL(r.DESCRIPTION,''))           ||
            ',"createdBy":'            || APEX_JSON.STRINGIFY(NVL(r.CREATED_BY,''))            ||
            ',"creationDate":'         || APEX_JSON.STRINGIFY(NVL(r.CREATION_DATE,''))         ||
            ',"lastUpdatedBy":'        || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATED_BY,''))       ||
            ',"lastUpdateDate":'       || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,''))      ||
            ',"totalLines":'           || r.TOTAL_LINES                                        ||
            ',"reconLines":'           || r.RECON_LINES                                        ||
            ',"unreconLines":'         || r.UNRECON_LINES                                      ||
            '}';
        DBMS_LOB.APPEND(v_clob, v_buf);
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(v_clob);
    l_pos := 1;
    LOOP
        EXIT WHEN l_pos > l_len;
        l_chunk := DBMS_LOB.SUBSTR(v_clob, 32767, l_pos);
        HTP.PRN(l_chunk);
        l_pos := l_pos + 32767;
    END LOOP;
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/
