-- ============================================================
-- 95: Retained Earnings table, ORDS handlers, view UNION ALL
-- ============================================================

-- 1. TABLE
CREATE TABLE RR_GL_RETAINED_EARNINGS (
  ID                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  LEDGER_NAME         VARCHAR2(200)  NOT NULL,
  FISCAL_YEAR         NUMBER(4)      NOT NULL,
  PERIOD_NAME         VARCHAR2(30)   NOT NULL,   -- last period of that fiscal year
  ACCOUNT_COMBINATION VARCHAR2(300),             -- RE account full combo (e.g. 01-00-00-3112100-...)
  COMPANY             VARCHAR2(30),
  ACCOUNT             VARCHAR2(30),              -- RE account segment (e.g. 3112100)
  ACCOUNT_DESC        VARCHAR2(500),
  ACCOUNT_TYPE        VARCHAR2(10)  DEFAULT 'OE',
  CURRENCY_CODE       VARCHAR2(15)  DEFAULT 'AED',
  REVENUE             NUMBER        DEFAULT 0,
  EXPENSES            NUMBER        DEFAULT 0,
  NET_PL              NUMBER        DEFAULT 0,
  RE_CURRENT          NUMBER        DEFAULT 0,   -- RE account balance before closing
  CUMULATIVE_RE       NUMBER        DEFAULT 0,   -- cumulative net P&L across years
  -- Trial balance columns so we can UNION ALL into RR_V_TRIALBALANCE
  OPENING             NUMBER        DEFAULT 0,
  PTD_DR              NUMBER        DEFAULT 0,
  PTD_CR              NUMBER        DEFAULT 0,
  CLOSING             NUMBER        DEFAULT 0,
  ENTERED_OPENING     NUMBER        DEFAULT 0,
  ENTERED_CLOSING     NUMBER        DEFAULT 0,
  -- Audit
  CALCULATED_DATE     DATE          DEFAULT SYSDATE,
  CREATED_BY          VARCHAR2(200),
  CONSTRAINT RR_GL_RE_UQ UNIQUE (LEDGER_NAME, FISCAL_YEAR, COMPANY)
);

-- 2. ORDS HANDLER: Save retained earnings rows
-- Endpoint: POST /gl/retained-earnings/save
-- Body: JSON array of year rows
BEGIN
  ORDS.DEFINE_SERVICE(
    P_MODULE_NAME    => 'reerp.gl',
    P_BASE_PATH      => 'gl/',
    P_PATTERN        => 'retained-earnings/save',
    P_METHOD         => 'POST',
    P_SOURCE_TYPE    => ORDS.SOURCE_TYPE_PLSQL,
    P_SOURCE         => q'[
DECLARE
  l_blob    BLOB;
  l_body    CLOB;
  l_arr     APEX_JSON.T_VALUES;
  l_count   PLS_INTEGER  := 0;
  l_ledger  VARCHAR2(200);
  l_year    NUMBER;
  l_period  VARCHAR2(30);
  l_company VARCHAR2(30);
  l_acct    VARCHAR2(30);
  l_rev     NUMBER;
  l_exp     NUMBER;
  l_netpl   NUMBER;
  l_recur   NUMBER;
  l_cumre   NUMBER;
  l_close   NUMBER;
  l_doff    INTEGER := 1;
  l_soff    INTEGER := 1;
  l_lctx    INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
  l_warn    INTEGER;
BEGIN
  -- Convert BLOB :body to CLOB (ORDS delivers :body as BLOB)
  l_blob := :body;
  IF l_blob IS NOT NULL AND DBMS_LOB.GETLENGTH(l_blob) > 0 THEN
      DBMS_LOB.CREATETEMPORARY(l_body, TRUE);
      DBMS_LOB.CONVERTTOCLOB(l_body, l_blob, DBMS_LOB.LOBMAXSIZE, l_doff, l_soff,
                             NLS_CHARSET_ID('AL32UTF8'), l_lctx, l_warn);
  END IF;
  APEX_JSON.PARSE(l_arr, l_body);
  l_count := APEX_JSON.GET_COUNT(p_values => l_arr, p_path => '.');

  FOR i IN 1 .. l_count LOOP
    l_ledger  := APEX_JSON.GET_VARCHAR2(p_values => l_arr, p_path => '[%d].ledgerName',  p0 => i);
    l_year    := APEX_JSON.GET_NUMBER (p_values => l_arr, p_path => '[%d].year',         p0 => i);
    l_period  := APEX_JSON.GET_VARCHAR2(p_values => l_arr, p_path => '[%d].lastPeriod',  p0 => i);
    l_company := APEX_JSON.GET_VARCHAR2(p_values => l_arr, p_path => '[%d].company',     p0 => i);
    l_acct    := APEX_JSON.GET_VARCHAR2(p_values => l_arr, p_path => '[%d].reAccount',   p0 => i);
    l_rev     := NVL(APEX_JSON.GET_NUMBER(p_values => l_arr, p_path => '[%d].revenue',   p0 => i), 0);
    l_exp     := NVL(APEX_JSON.GET_NUMBER(p_values => l_arr, p_path => '[%d].expenses',  p0 => i), 0);
    l_netpl   := NVL(APEX_JSON.GET_NUMBER(p_values => l_arr, p_path => '[%d].netPL',     p0 => i), 0);
    l_recur   := NVL(APEX_JSON.GET_NUMBER(p_values => l_arr, p_path => '[%d].reBalance', p0 => i), 0);
    l_cumre   := NVL(APEX_JSON.GET_NUMBER(p_values => l_arr, p_path => '[%d].cumulativeRE', p0 => i), 0);
    -- Closing RE = current RE balance + net P&L transferred in
    l_close   := l_recur - l_netpl;  -- RE is Cr (negative), profit increases Cr

    MERGE INTO RR_GL_RETAINED_EARNINGS t
    USING (SELECT l_ledger AS ledger_name, l_year AS fiscal_year,
                  NVL(l_company,'ALL') AS company FROM DUAL) s
    ON (t.LEDGER_NAME = s.ledger_name AND t.FISCAL_YEAR = s.fiscal_year AND t.COMPANY = s.company)
    WHEN MATCHED THEN
      UPDATE SET
        PERIOD_NAME     = l_period,
        ACCOUNT         = l_acct,
        REVENUE         = l_rev,
        EXPENSES        = l_exp,
        NET_PL          = l_netpl,
        RE_CURRENT      = l_recur,
        CUMULATIVE_RE   = l_cumre,
        OPENING         = l_recur,
        PTD_DR          = CASE WHEN l_netpl < 0 THEN ABS(l_netpl) ELSE 0 END,
        PTD_CR          = CASE WHEN l_netpl > 0 THEN l_netpl     ELSE 0 END,
        CLOSING         = l_close,
        CALCULATED_DATE = SYSDATE,
        CREATED_BY      = 'WEB'
    WHEN NOT MATCHED THEN
      INSERT (LEDGER_NAME, FISCAL_YEAR, PERIOD_NAME, COMPANY, ACCOUNT,
              ACCOUNT_TYPE, REVENUE, EXPENSES, NET_PL, RE_CURRENT, CUMULATIVE_RE,
              OPENING, PTD_DR, PTD_CR, CLOSING, CALCULATED_DATE, CREATED_BY)
      VALUES (l_ledger, l_year, l_period, NVL(l_company,'ALL'), l_acct,
              'OE', l_rev, l_exp, l_netpl, l_recur, l_cumre,
              l_recur,
              CASE WHEN l_netpl < 0 THEN ABS(l_netpl) ELSE 0 END,
              CASE WHEN l_netpl > 0 THEN l_netpl     ELSE 0 END,
              l_close, SYSDATE, 'WEB');
  END LOOP;
  COMMIT;
  :status := 200;
  HTP.P('{"status":"ok","saved":' || l_count || '}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status := 500;
    HTP.P('{"status":"error","message":"' || SQLERRM || '"}');
END;
]',
    P_ACCESS_CONTROL_ALLOW_ORIGIN => '*'
  );
END;
/

-- 3. ORDS HANDLER: Fetch saved retained earnings
-- Endpoint: GET /gl/retained-earnings?ledger_name=X
BEGIN
  ORDS.DEFINE_SERVICE(
    P_MODULE_NAME    => 'reerp.gl',
    P_BASE_PATH      => 'gl/',
    P_PATTERN        => 'retained-earnings',
    P_METHOD         => 'GET',
    P_SOURCE_TYPE    => ORDS.SOURCE_TYPE_COLLECTION_QUERY,
    P_SOURCE         => q'[
SELECT
  ID, LEDGER_NAME, FISCAL_YEAR, PERIOD_NAME, COMPANY, ACCOUNT,
  REVENUE, EXPENSES, NET_PL, RE_CURRENT, CUMULATIVE_RE,
  OPENING, PTD_DR, PTD_CR, CLOSING, CALCULATED_DATE, CREATED_BY
FROM RR_GL_RETAINED_EARNINGS
WHERE LEDGER_NAME = :ledger_name
ORDER BY FISCAL_YEAR, COMPANY
]',
    P_ACCESS_CONTROL_ALLOW_ORIGIN => '*'
  );
END;
/

-- 4. VIEW PATCH: Add UNION ALL to RR_V_TRIALBALANCE (or the standard view)
-- Patch the existing rr-trialbalance/standard query to include RE rows
-- NOTE: This creates/replaces a VIEW that wraps the existing view with RE data.
-- The actual view name depends on your environment — replace RR_V_STANDARD_TB below
-- with the view used by the rrTrialBalanceStandard endpoint.
CREATE OR REPLACE VIEW RR_V_STANDARD_TB_WITH_RE AS
SELECT
  LEDGER_NAME,
  PERIOD_NAME,
  FISCAL_YEAR,
  FISCAL_PERIOD,
  CURRENCY_CODE,
  ACCOUNT_COMBINATION,
  COMPANY,
  ACCOUNT,
  ACCOUNT_TYPE,
  ACCOUNT_DESC,
  OPENING,
  DEBIT,
  CREDIT,
  CLOSING,
  ENTERED_OPENING,
  ENTERED_DEBIT,
  ENTERED_CREDIT,
  ENTERED_CLOSING,
  YTD_OPENING,
  YTD_DEBIT,
  YTD_CREDIT,
  YTD_ENTERED_OPENING,
  YTD_ENTERED_DEBIT,
  YTD_ENTERED_CREDIT,
  'TB'  AS SOURCE_FLAG
FROM RR_V_STANDARD_TB
UNION ALL
SELECT
  re.LEDGER_NAME,
  re.LAST_PERIOD                                              AS PERIOD_NAME,
  re.YEAR                                                     AS FISCAL_YEAR,
  12                                                          AS FISCAL_PERIOD,
  'AED'                                                       AS CURRENCY_CODE,
  re.RE_ACCOUNT                                               AS ACCOUNT_COMBINATION,
  re.COMPANY,
  re.RE_ACCOUNT                                               AS ACCOUNT,
  'OE'                                                        AS ACCOUNT_TYPE,
  'Retained Earnings'                                         AS ACCOUNT_DESC,
  re.OPENING_RE                                               AS OPENING,
  CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END         AS DEBIT,
  CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END         AS CREDIT,
  re.CLOSING_RE                                               AS CLOSING,
  re.OPENING_RE                                               AS ENTERED_OPENING,
  CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END         AS ENTERED_DEBIT,
  CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END         AS ENTERED_CREDIT,
  re.CLOSING_RE                                               AS ENTERED_CLOSING,
  re.OPENING_RE                                               AS YTD_OPENING,
  CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END         AS YTD_DEBIT,
  CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END         AS YTD_CREDIT,
  re.OPENING_RE                                               AS YTD_ENTERED_OPENING,
  CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END         AS YTD_ENTERED_DEBIT,
  CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END         AS YTD_ENTERED_CREDIT,
  'RE'                                                        AS SOURCE_FLAG
FROM RR_GL_RETAINED_EARNINGS re;
