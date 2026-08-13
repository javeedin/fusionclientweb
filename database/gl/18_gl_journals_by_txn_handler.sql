-- =============================================================================
-- GL Journal lookup by transaction ID
-- Package: RR_GL_JOURNALS_PKG
-- Handler: GET reerp/gl/journals/by-txn?txn_id=:txn_id
-- =============================================================================
-- Tables used:
--   RR_GL_JE_LINES_ALL      -- journal lines  (REFERENCE1 = txnId, REFERENCE3 = 'EXPENSE')
--   RR_GL_JE_HEADERS        -- journal headers
--   RR_GL_JOURNAL_BATCHES   -- journal batches (JE_BATCH_ID)
--
-- Run each block separately in SQL Workshop > SQL Commands (as schema owner)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1a.  Package spec
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE RR_GL_JOURNALS_PKG AS

    FUNCTION get_journal_by_txn (
        p_txn_id  IN VARCHAR2
    ) RETURN CLOB;

END RR_GL_JOURNALS_PKG;
/


-- ---------------------------------------------------------------------------
-- 1b.  Package body
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY RR_GL_JOURNALS_PKG AS

    -- -----------------------------------------------------------------------
    -- Private helpers
    -- -----------------------------------------------------------------------
    FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"');
    END esc;

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || esc(p) || '"' END;
    END jstr;

    FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(p) END;
    END jnum;

    FUNCTION not_found_json RETURN CLOB IS
    BEGIN
        RETURN '{"found":false,"headerId":null,"glHeaderId":null,'
            || '"accountingStatus":null,"postingStatus":null,'
            || '"accountingDate":null,"periodName":null,"description":null,'
            || '"glBatchName":null,"postedBy":null,"postedDate":null,"lines":[]}';
    END not_found_json;

    -- -----------------------------------------------------------------------
    -- find_je_header_id
    --   Resolves JE_HEADER_ID + JE_BATCH_ID from RR_GL_JE_LINES_ALL
    --   using REFERENCE1 = txnId, REFERENCE3 = 'EXPENSE'.
    -- -----------------------------------------------------------------------
    PROCEDURE find_je_header_id (
        p_txn_id       IN  VARCHAR2,
        p_je_header_id OUT NUMBER,
        p_je_batch_id  OUT NUMBER
    ) IS
    BEGIN
        SELECT JE_HEADER_ID, BATCH_ID
          INTO p_je_header_id, p_je_batch_id
          FROM RR_GL_JE_LINES_ALL
         WHERE (REFERENCE1 = p_txn_id OR REFERENCE2 = p_txn_id)
           AND ROWNUM     = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_je_header_id := NULL;
            p_je_batch_id  := NULL;
    END find_je_header_id;

    -- -----------------------------------------------------------------------
    -- build_lines_json
    --   Returns a JSON array of all lines for a given JE_HEADER_ID
    --   from RR_GL_JE_LINES_ALL.
    -- -----------------------------------------------------------------------
    FUNCTION build_lines_json (
        p_je_header_id IN NUMBER
    ) RETURN CLOB IS
        v_buf   CLOB    := '[';
        v_first BOOLEAN := TRUE;
    BEGIN
        FOR r IN (
            SELECT LINE_ID,
                   JE_LINE_NUMBER,
                   NVL(ENTERED_DR,   0) AS ENTERED_DR,
                   NVL(ENTERED_CR,   0) AS ENTERED_CR,
                   NVL(ACCOUNTED_DR, 0) AS ACCOUNTED_DR,
                   NVL(ACCOUNTED_CR, 0) AS ACCOUNTED_CR,
                   ACCOUNT_COMBINATION,
                   DESCRIPTION,
                   CURRENCY_CODE,
                   REFERENCE3
              FROM RR_GL_JE_LINES_ALL
             WHERE JE_HEADER_ID = p_je_header_id
             ORDER BY JE_LINE_NUMBER
        ) LOOP
            IF NOT v_first THEN v_buf := v_buf || ','; END IF;
            v_first := FALSE;
            v_buf   := v_buf || '{'
                || '"lineId":'             || jnum(r.LINE_ID)       || ','
                || '"lineNumber":'         || jnum(r.JE_LINE_NUMBER) || ','
                || '"lineType":'           || jstr(CASE WHEN r.ENTERED_DR > 0 THEN 'DR' ELSE 'CR' END) || ','
                || '"accountingClass":'    || jstr(NVL(r.REFERENCE3, '—')) || ','
                || '"accountCombination":' || jstr(r.ACCOUNT_COMBINATION)  || ','
                || '"enteredDr":'          || jnum(r.ENTERED_DR)    || ','
                || '"enteredCr":'          || jnum(r.ENTERED_CR)    || ','
                || '"accountedDr":'        || jnum(r.ACCOUNTED_DR)  || ','
                || '"accountedCr":'        || jnum(r.ACCOUNTED_CR)  || ','
                || '"currencyCode":'       || jstr(r.CURRENCY_CODE)  || ','
                || '"description":'        || jstr(r.DESCRIPTION)
            || '}';
        END LOOP;

        RETURN v_buf || ']';
    END build_lines_json;

    -- -----------------------------------------------------------------------
    -- get_journal_by_txn  (public)
    -- -----------------------------------------------------------------------
    FUNCTION get_journal_by_txn (
        p_txn_id  IN VARCHAR2
    ) RETURN CLOB IS
        v_je_header_id  NUMBER;
        v_je_batch_id   NUMBER;

        v_journal_name  VARCHAR2(240);
        v_period_name   VARCHAR2(15);
        v_acct_date     VARCHAR2(20);
        v_batch_name    VARCHAR2(500);
        v_batch_status  VARCHAR2(30);
        v_created_by    VARCHAR2(200);
        v_creation_date VARCHAR2(30);
    BEGIN
        -- 1. Locate the header via lines
        find_je_header_id(p_txn_id, v_je_header_id, v_je_batch_id);

        IF v_je_header_id IS NULL THEN
            RETURN not_found_json;
        END IF;

        -- 2. Load header details from RR_GL_JE_HEADERS
        BEGIN
            SELECT h.JOURNAL_NAME,
                   h.PERIOD_NAME,
                   TO_CHAR(h.DEFAULT_EFFECTIVE_DATE, 'YYYY-MM-DD'),
                   h.CREATED_BY,
                   TO_CHAR(CAST(h.CREATION_DATE AS DATE), 'YYYY-MM-DD"T"HH24:MI:SS')
              INTO v_journal_name, v_period_name, v_acct_date,
                   v_created_by, v_creation_date
              FROM RR_GL_JE_HEADERS h
             WHERE h.JE_HEADER_ID = v_je_header_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- 3. Load batch name + status from RR_GL_JOURNAL_BATCHES
        BEGIN
            SELECT b.BATCH_NAME, b.STATUS
              INTO v_batch_name, v_batch_status
              FROM RR_GL_JOURNAL_BATCHES b
             WHERE b.JE_BATCH_ID = v_je_batch_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- 4. Assemble and return JSON
        RETURN '{"found":true'
            || ',"headerId":'         || jnum(v_je_header_id)
            || ',"glHeaderId":'       || jnum(v_je_header_id)
            || ',"batchId":'          || jnum(v_je_batch_id)
            || ',"batchStatus":'      || jstr(v_batch_status)
            || ',"accountingDate":'   || jstr(v_acct_date)
            || ',"periodName":'       || jstr(v_period_name)
            || ',"description":'      || jstr(v_journal_name)
            || ',"glBatchName":'      || jstr(v_batch_name)
            || ',"postedBy":'         || jstr(v_created_by)
            || ',"postedDate":'       || jstr(v_creation_date)
            || ',"lines":'            || build_lines_json(v_je_header_id)
            || '}';

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"found":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_journal_by_txn;

END RR_GL_JOURNALS_PKG;
/


-- ---------------------------------------------------------------------------
-- 2.  ORDS handler — thin wrapper that calls the package
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/by-txn',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'reerp',
        p_pattern       => 'gl/journals/by-txn',
        p_method        => 'GET',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => '',
        p_comments      => 'Get GL journal header + lines for a source transaction (via REFERENCE1)',
        p_source        => q'[
DECLARE
    v_result CLOB;
BEGIN
    v_result     := RR_GL_JOURNALS_PKG.get_journal_by_txn(p_txn_id => :txn_id);
    :status_code := 200;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN(v_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        OWA_UTIL.MIME_HEADER('application/json', TRUE);
        HTP.PRN('{"found":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/
