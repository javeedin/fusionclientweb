-- =============================================================================
-- PATCH 103: Fix GET /cash/reconciliation/systxns — CLOB concatenation bug
--
-- PROBLEM (in patch 65 / current handler):
--
--   DBMS_LOB.APPEND(v_clob, TO_CLOB(
--       '{"source":' || jstr(r.SOURCE) || ... || '}'   ← entire row as one VARCHAR2
--   ));
--
--   TO_CLOB() takes a VARCHAR2 argument.  The entire || chain is evaluated as
--   a VARCHAR2 expression first.  Oracle VARCHAR2 in PL/SQL is limited to
--   32767 BYTES.  If any single row's concatenated JSON (e.g. a transaction
--   with a very long description that gets character-escaped) exceeds 32767
--   bytes, Oracle raises ORA-06502.  The EXCEPTION handler then writes an
--   error payload to HTP — appended to the partial valid JSON already buffered
--   → the response is not valid JSON.
--
--   Secondary issues:
--   • jnum() uses TO_CHAR without explicit NLS_NUMERIC_CHARACTERS; if the DB
--     session uses comma as decimal separator, amounts become "3830000,04"
--     which is invalid JSON.
--   • Chunk reads 32767 chars into VARCHAR2(32767 BYTE); unsafe for multibyte
--     character sets (AL32UTF8: 1 char can be up to 4 bytes).
--
-- FIX:
--   • Replace the single TO_CLOB(big_concatenation) with individual
--     DBMS_LOB.APPEND calls per field — each piece is a small VARCHAR2,
--     never near 32767 bytes.
--   • jnum() uses explicit 'NLS_NUMERIC_CHARACTERS=''.,''' to force dot
--     as decimal separator regardless of session NLS.
--   • Chunk size reduced to 8000 chars (8000 × 4 bytes = 32000 bytes,
--     safely fits in VARCHAR2(32767 BYTE) even for multibyte data).
--   • Use q'#...#' delimiter (# never appears in PL/SQL source here).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the single BEGIN...END; block
-- =============================================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/reconciliation/systxns',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/systxns',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'System transactions for bank recon (patch 103: per-field CLOB append, NLS fix)',
        p_source         => q'#
DECLARE
    l_bank_acct    VARCHAR2(360) := :bank_account;
    l_bus_unit     VARCHAR2(360) := :business_unit;
    l_source       VARCHAR2(30)  := :source;
    l_recon_status VARCHAR2(30)  := NVL(:recon_status, 'UNRECONCILED');
    l_date_from    VARCHAR2(30)  := :date_from;
    l_date_to      VARCHAR2(30)  := :date_to;
    l_amt_min      VARCHAR2(30)  := :amount_min;
    l_amt_max      VARCHAR2(30)  := :amount_max;
    l_reference    VARCHAR2(360) := :reference;
    l_limit        NUMBER        := NVL(TO_NUMBER(:row_limit), 500);

    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
    l_pos   INTEGER;
    l_len   INTEGER;
    l_chunk VARCHAR2(32767);

    CURSOR c_data IS
        SELECT
            SOURCE,
            TXN_ID,
            TXN_NUMBER,
            REFERENCE,
            TO_CHAR(TXN_DATE, 'YYYY-MM-DD')         AS TXN_DATE,
            NVL(AMOUNT, 0)                           AS AMOUNT,
            CURRENCY_CODE,
            STATUS,
            BANK_ACCOUNT_NAME,
            BUSINESS_UNIT,
            COUNTERPARTY_NAME,
            COUNTERPARTY_NUMBER,
            PAYMENT_METHOD,
            TO_CHAR(CLEARING_DATE, 'YYYY-MM-DD')    AS CLEARING_DATE,
            RECONCILED_FLAG,
            DESCRIPTION,
            ACCOUNTING_CLASS,
            JE_HEADER_ID,
            JE_LINE_NUMBER,
            ACCOUNT_COMBINATION,
            TRANSFER_ID,
            CREATED_BY,
            TO_CHAR(CREATION_DATE, 'YYYY-MM-DD')    AS CREATION_DATE
        FROM RR_V_BANK_RECON_SYSTXNS
        WHERE l_bank_acct IS NOT NULL
          AND UPPER(BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_bank_acct) || '%'
          AND (l_bus_unit     IS NULL OR UPPER(BUSINESS_UNIT) LIKE '%' || UPPER(l_bus_unit) || '%')
          AND (l_source       IS NULL OR SOURCE = l_source)
          AND (l_recon_status = 'ALL'
               OR (l_recon_status = 'RECONCILED'   AND RECONCILED_FLAG = 'Y')
               OR (l_recon_status = 'UNRECONCILED' AND NVL(RECONCILED_FLAG,'N') != 'Y'))
          AND (l_date_from    IS NULL OR TXN_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
          AND (l_date_to      IS NULL OR TXN_DATE <  TO_DATE(l_date_to,   'YYYY-MM-DD') + 1)
          AND (l_amt_min      IS NULL OR AMOUNT >= TO_NUMBER(l_amt_min))
          AND (l_amt_max      IS NULL OR AMOUNT <= TO_NUMBER(l_amt_max))
          AND (l_reference    IS NULL OR UPPER(TXN_NUMBER) LIKE '%' || UPPER(l_reference) || '%'
                                      OR UPPER(REFERENCE)  LIKE '%' || UPPER(l_reference) || '%')
        ORDER BY TXN_DATE DESC, TXN_ID DESC
        FETCH FIRST l_limit ROWS ONLY;

    r c_data%ROWTYPE;

    -- Escape VARCHAR2 for JSON; handles NULL, control chars, quotes, backslash
    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767);
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        v := p;
        v := REPLACE(v, '\',  '\\');
        v := REPLACE(v, '"',  '\"');
        v := REPLACE(v, CHR(8),  '\b');
        v := REPLACE(v, CHR(9),  '\t');
        v := REPLACE(v, CHR(10), '\n');
        v := REPLACE(v, CHR(12), '\f');
        v := REPLACE(v, CHR(13), '\r');
        FOR i IN 0..7  LOOP v := REPLACE(v, CHR(i), ''); END LOOP;
        v := REPLACE(v, CHR(11), '');
        FOR i IN 14..31 LOOP v := REPLACE(v, CHR(i), ''); END LOOP;
        RETURN '"' || v || '"';
    END jstr;

    -- Format NUMBER as JSON decimal with explicit dot separator
    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(50);
    BEGIN
        IF p IS NULL THEN RETURN 'null'; END IF;
        v := TO_CHAR(p, 'FM99999999999999990.9999999999', 'NLS_NUMERIC_CHARACTERS=''.,''');
        IF SUBSTR(v, -1) = '.' THEN v := SUBSTR(v, 1, LENGTH(v) - 1); END IF;
        RETURN v;
    END jnum;

BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, TO_CLOB('{"status":"success","items":['));

    OPEN c_data;
    LOOP
        FETCH c_data INTO r;
        EXIT WHEN c_data%NOTFOUND;

        IF NOT v_first THEN
            DBMS_LOB.APPEND(v_clob, TO_CLOB(','));
        END IF;
        v_first := FALSE;

        -- Append each field separately — avoids single large VARCHAR2 concatenation
        DBMS_LOB.APPEND(v_clob, TO_CLOB('{"source":'             )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.SOURCE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"txnId":'              )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TXN_ID)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"txnNumber":'          )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TXN_NUMBER)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"reference":'          )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.REFERENCE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"txnDate":'            )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.TXN_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"amount":'             || jnum(r.AMOUNT)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"currencyCode":'       )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CURRENCY_CODE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"status":'             )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.STATUS)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"bankAccountName":'    )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BANK_ACCOUNT_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"businessUnit":'       )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.BUSINESS_UNIT)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"counterpartyName":'   )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.COUNTERPARTY_NAME)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"counterpartyNumber":' )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.COUNTERPARTY_NUMBER)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"paymentMethod":'      )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.PAYMENT_METHOD)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"clearingDate":'       )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CLEARING_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"reconciledFlag":'     )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.RECONCILED_FLAG)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"description":'        )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.DESCRIPTION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"accountingClass":'    )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ACCOUNTING_CLASS)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"jeHeaderId":'         || NVL(TO_CHAR(r.JE_HEADER_ID),  'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"jeLineNumber":'       || NVL(TO_CHAR(r.JE_LINE_NUMBER),'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"accountCombination":' )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.ACCOUNT_COMBINATION)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"transferId":'         || NVL(TO_CHAR(r.TRANSFER_ID),   'null')));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"createdBy":'          )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CREATED_BY)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB(',"creationDate":'       )); DBMS_LOB.APPEND(v_clob, TO_CLOB(jstr(r.CREATION_DATE)));
        DBMS_LOB.APPEND(v_clob, TO_CLOB('}'));
    END LOOP;
    CLOSE c_data;

    DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));

    -- Stream in 8000-char chunks via HTP.PRN (no trailing newline per chunk)
    -- 8000 chars x max 4 bytes/char (AL32UTF8) = 32000 bytes < VARCHAR2(32767)
    :status_code := 200;
    l_len := DBMS_LOB.GETLENGTH(v_clob);
    l_pos := 1;
    LOOP
        EXIT WHEN l_pos > l_len;
        l_chunk := DBMS_LOB.SUBSTR(v_clob, 8000, l_pos);
        HTP.PRN(l_chunk);
        l_pos := l_pos + 8000;
    END LOOP;
    DBMS_LOB.FREETEMPORARY(v_clob);

EXCEPTION
    WHEN OTHERS THEN
        IF v_clob IS NOT NULL THEN
            BEGIN DBMS_LOB.FREETEMPORARY(v_clob); EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
        :status_code := 500;
        HTP.PRN('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
#'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET /cash/reconciliation/systxns redeployed (patch 103: per-field CLOB append).');
END;
/
