-- ============================================================
-- RR_GL_RETAINED_EARNINGS
-- Table + APEX REST Handlers
-- ============================================================


-- ------------------------------------------------------------
-- 1. CREATE TABLE
-- ------------------------------------------------------------

CREATE TABLE RR_GL_RETAINED_EARNINGS (
    ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    LEDGER_NAME     VARCHAR2(100)  NOT NULL,
    YEAR            NUMBER(4)      NOT NULL,
    LAST_PERIOD     VARCHAR2(20),
    COMPANY         VARCHAR2(20),
    RE_ACCOUNT      VARCHAR2(30),
    REVENUE         NUMBER(20,2),
    EXPENSES        NUMBER(20,2),
    NET_PL          NUMBER(20,2),
    RE_BALANCE      NUMBER(20,2),
    CUMULATIVE_RE   NUMBER(20,2),
    CREATED_DATE    DATE  DEFAULT SYSDATE,
    UPDATED_DATE    DATE  DEFAULT SYSDATE,
    CONSTRAINT UQ_RE_LEDGER_YEAR_CO UNIQUE (LEDGER_NAME, YEAR, COMPANY)
);

COMMENT ON TABLE  RR_GL_RETAINED_EARNINGS               IS 'Retained Earnings calculation results by ledger / year / company';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.LEDGER_NAME   IS 'Oracle Fusion ledger name';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.YEAR          IS 'Fiscal year (e.g. 2024)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.LAST_PERIOD   IS 'Last period of the year used for calculation (e.g. Dec-24)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.COMPANY       IS 'Company segment filter (NULL = all companies)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_ACCOUNT    IS 'Retained Earnings account code (e.g. 3112100)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.REVENUE       IS 'Total revenue closing balance (credit-nature, stored as negative)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.EXPENSES      IS 'Total expenses closing balance';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.NET_PL        IS 'Net profit / loss for the year (revenue + expenses negated)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_BALANCE    IS 'Closing balance of the RE account itself';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CUMULATIVE_RE IS 'Cumulative retained earnings across all years up to this year';


-- ------------------------------------------------------------
-- 2. APEX REST HANDLER — POST  /gl/retained-earnings/save
--    Body : JSON array of row objects (not wrapped in "items")
--    Response : { "status": "ok", "saved": N }
-- ------------------------------------------------------------

DECLARE
    l_body  CLOB   := :body;
    l_rows  APEX_JSON.t_values;
    l_count NUMBER := 0;
BEGIN
    APEX_JSON.parse(l_rows, l_body);

    FOR i IN 1 .. APEX_JSON.get_count(p_values => l_rows, p_path => '.') LOOP

        MERGE INTO RR_GL_RETAINED_EARNINGS t
        USING (
            SELECT
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].ledgerName',  p0 => i) AS ledger_name,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].year',         p0 => i) AS yr,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].lastPeriod',  p0 => i) AS last_period,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].company',     p0 => i) AS company,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].reAccount',   p0 => i) AS re_account,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].revenue',     p0 => i) AS revenue,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].expenses',    p0 => i) AS expenses,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].netPL',       p0 => i) AS net_pl,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].reBalance',   p0 => i) AS re_balance,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].cumulativeRE',p0 => i) AS cumulative_re
            FROM DUAL
        ) s
        ON (
            t.LEDGER_NAME = s.ledger_name
            AND t.YEAR    = s.yr
            AND NVL(t.COMPANY, '~') = NVL(s.company, '~')
        )
        WHEN MATCHED THEN
            UPDATE SET
                t.LAST_PERIOD   = s.last_period,
                t.RE_ACCOUNT    = s.re_account,
                t.REVENUE       = s.revenue,
                t.EXPENSES      = s.expenses,
                t.NET_PL        = s.net_pl,
                t.RE_BALANCE    = s.re_balance,
                t.CUMULATIVE_RE = s.cumulative_re,
                t.UPDATED_DATE  = SYSDATE
        WHEN NOT MATCHED THEN
            INSERT (
                LEDGER_NAME, YEAR, LAST_PERIOD, COMPANY, RE_ACCOUNT,
                REVENUE, EXPENSES, NET_PL, RE_BALANCE, CUMULATIVE_RE
            )
            VALUES (
                s.ledger_name, s.yr, s.last_period, s.company, s.re_account,
                s.revenue, s.expenses, s.net_pl, s.re_balance, s.cumulative_re
            );

        l_count := l_count + 1;
    END LOOP;

    COMMIT;

    APEX_JSON.open_object;
    APEX_JSON.write('status', 'ok');
    APEX_JSON.write('saved',  l_count);
    APEX_JSON.close_object;

EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    APEX_JSON.open_object;
    APEX_JSON.write('status',  'error');
    APEX_JSON.write('message', SQLERRM);
    APEX_JSON.close_object;
END;


-- ------------------------------------------------------------
-- 3. APEX REST HANDLER — GET  /gl/retained-earnings
--    Query params : ledger_name (optional), company (optional)
--    Response     : standard APEX JSON collection
-- ------------------------------------------------------------

SELECT
    ID,
    LEDGER_NAME,
    YEAR,
    LAST_PERIOD,
    COMPANY,
    RE_ACCOUNT,
    REVENUE,
    EXPENSES,
    NET_PL,
    RE_BALANCE,
    CUMULATIVE_RE,
    TO_CHAR(CREATED_DATE, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_DATE,
    TO_CHAR(UPDATED_DATE, 'YYYY-MM-DD HH24:MI:SS') AS UPDATED_DATE
FROM RR_GL_RETAINED_EARNINGS
WHERE (:ledger_name IS NULL OR LEDGER_NAME = :ledger_name)
  AND (:company     IS NULL OR NVL(COMPANY,'~') = NVL(:company,'~'))
ORDER BY LEDGER_NAME, YEAR;


-- ------------------------------------------------------------
-- 4. APEX REST HANDLER — DELETE  /gl/retained-earnings/:id
--    Deletes a single row by primary key
-- ------------------------------------------------------------

BEGIN
    DELETE FROM RR_GL_RETAINED_EARNINGS
    WHERE ID = :id;

    COMMIT;

    APEX_JSON.open_object;
    APEX_JSON.write('status',  'ok');
    APEX_JSON.write('deleted', SQL%ROWCOUNT);
    APEX_JSON.close_object;

EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    APEX_JSON.open_object;
    APEX_JSON.write('status',  'error');
    APEX_JSON.write('message', SQLERRM);
    APEX_JSON.close_object;
END;
