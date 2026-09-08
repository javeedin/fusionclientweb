-- ============================================================
-- PATCH 133: Accounting Calendar generator for RR_ACCOUNTING_PERIODS_STATUS
--
--   GET  reerp/accountingcalendar               -> summary per ledger
--   GET  reerp/accountingcalendar/:ledgerId     -> one ledger (exists check)
--   POST reerp/accountingcalendar               -> generate & insert periods
--
-- Why:
--   When a new ledger is created we must seed its accounting periods into
--   RR_ACCOUNTING_PERIODS_STATUS (one row per period x application). This
--   patch generates them for a chosen calendar type and year range.
--
-- Calendar structure (matches the Fusion sample data):
--   16 periods per year = 12 monthly + 4 quarter-end adjustment periods.
--     FISCAL   : year Y spans Apr(Y-1) .. Mar(Y)   (period_year = Y)
--                Apr=1 May=2 Jun=3 [Q1-Adj=4] Jul=5 Aug=6 Sep=7 [Q2-Adj=8]
--                Oct=9 Nov=10 Dec=11 [Q3-Adj=12] Jan=13 Feb=14 Mar=15 [Q4-Adj=16]
--     CALENDAR : year Y spans Jan(Y) .. Dec(Y)     (period_year = Y)
--                Jan=1 Feb=2 Mar=3 [Q1-Adj=4] Apr=5 ... Dec=15 [Q4-Adj=16]
--   Month period name  : Mon-YY           (e.g. Apr-00, Mar-01)
--   Adjustment name     : Qn-Adj-YY-YY    (fiscal, spans two years, e.g. Q1-Adj-00-01)
--                         Qn-Adj-YY       (calendar, single year)
--   EFFECTIVE_PERIOD_NUMBER = PERIOD_YEAR*10000 + PERIOD_NUMBER
--   New periods get CLOSING_STATUS = 'N' (Never Opened).
--   Adjustment periods start_date = end_date = quarter-end, ADJUSTMENT_PERIOD_FLAG='Y'.
--   One row is written per (period, application). Default applications:
--     101 (GL), 200 (AP), 222 (AR), 10037, 10455.
--
-- POST body:
--   {
--     "ledgerId": 300000012345678,      -- required
--     "calendarType": "FISCAL"|"CALENDAR",  -- default FISCAL
--     "startYear": 2020,                 -- required (first PERIOD_YEAR)
--     "numberOfYears": 10,               -- default 10
--     "includeAdjustment": "Y"|"N",      -- default Y
--     "applicationIds": [101,200,222,10037,10455],  -- optional
--     "createdBy": "user"
--   }
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run this whole script.
-- ============================================================

BEGIN
  -- ===== Template: collection (summary + POST) =====
  BEGIN
    ORDS.DEFINE_TEMPLATE(
      p_module_name => 'reerp',
      p_pattern     => 'accountingcalendar',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_comments    => 'Accounting calendar summary and generator'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ---- GET summary (one row per ledger) ----
  BEGIN
    ORDS.DELETE_HANDLER(p_module_name=>'reerp', p_pattern=>'accountingcalendar', p_method=>'GET');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'accountingcalendar',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_mimes_allowed  => NULL,
    p_comments       => 'Accounting calendar summary per ledger',
    p_source         => q'[
SELECT
    LEDGER_ID                          AS "ledgerId",
    COUNT(*)                           AS "periodCount",
    COUNT(DISTINCT PERIOD_YEAR)        AS "yearCount",
    MIN(PERIOD_YEAR)                   AS "minYear",
    MAX(PERIOD_YEAR)                   AS "maxYear",
    MIN(START_DATE)                    AS "minDate",
    MAX(END_DATE)                      AS "maxDate"
FROM RR_ACCOUNTING_PERIODS_STATUS
GROUP BY LEDGER_ID
ORDER BY LEDGER_ID
]'
  );

  -- ---- POST generate ----
  BEGIN
    ORDS.DELETE_HANDLER(p_module_name=>'reerp', p_pattern=>'accountingcalendar', p_method=>'POST');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'accountingcalendar',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Generate accounting periods for a ledger',
    p_source         => q'[
DECLARE
    v_obj        JSON_OBJECT_T;
    v_ledger     NUMBER;
    v_type       VARCHAR2(20);
    v_start_year NUMBER;
    v_num_years  NUMBER;
    v_inc_adj    VARCHAR2(1);
    v_created_by VARCHAR2(100);
    v_apps       SYS.ODCINUMBERLIST := SYS.ODCINUMBERLIST();
    v_arr        JSON_ARRAY_T;

    v_period_year NUMBER;
    v_cal_month   PLS_INTEGER;
    v_cal_year    NUMBER;
    v_start       DATE;
    v_end         DATE;
    v_pnum        PLS_INTEGER;
    v_name        VARCHAR2(100);
    v_qtr         PLS_INTEGER;

    v_inserted   NUMBER := 0;
    v_skipped    NUMBER := 0;

    FUNCTION sstr(p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF NOT v_obj.has(p_key) OR v_obj.get(p_key).is_null THEN RETURN NULL; END IF;
        RETURN v_obj.get_string(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL; END;

    FUNCTION snum(p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF NOT v_obj.has(p_key) OR v_obj.get(p_key).is_null THEN RETURN NULL; END IF;
        RETURN v_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL; END;

    -- insert one period for every application (idempotent on the unique key)
    PROCEDURE ins(p_name VARCHAR2, p_pnum PLS_INTEGER, p_start DATE, p_end DATE, p_adj VARCHAR2) IS
    BEGIN
        FOR i IN 1 .. v_apps.COUNT LOOP
            INSERT INTO RR_ACCOUNTING_PERIODS_STATUS
                (PERIOD_NAME_ID, APPLICATION_ID, LEDGER_ID, CLOSING_STATUS,
                 END_DATE, START_DATE, EFFECTIVE_PERIOD_NUMBER, PERIOD_YEAR,
                 PERIOD_NUMBER, ADJUSTMENT_PERIOD_FLAG, CREATED_BY, CREATION_DATE,
                 LAST_UPDATED_BY, LAST_UPDATE_DATE)
            SELECT p_name, v_apps(i), v_ledger, 'N',
                   p_end, p_start, v_period_year*10000 + p_pnum, v_period_year,
                   p_pnum, p_adj, v_created_by, SYSTIMESTAMP,
                   v_created_by, SYSTIMESTAMP
              FROM DUAL
             WHERE NOT EXISTS (
                   SELECT 1 FROM RR_ACCOUNTING_PERIODS_STATUS x
                    WHERE x.PERIOD_NAME_ID = p_name
                      AND x.APPLICATION_ID = v_apps(i)
                      AND x.LEDGER_ID      = v_ledger);
            IF SQL%ROWCOUNT > 0 THEN v_inserted := v_inserted + 1;
            ELSE v_skipped := v_skipped + 1; END IF;
        END LOOP;
    END;
BEGIN
    v_obj        := JSON_OBJECT_T.parse(:body_text);
    v_ledger     := snum('ledgerId');
    v_type       := UPPER(NVL(sstr('calendarType'), 'FISCAL'));
    v_start_year := snum('startYear');
    v_num_years  := NVL(snum('numberOfYears'), 10);
    v_inc_adj    := UPPER(NVL(sstr('includeAdjustment'), 'Y'));
    v_created_by := NVL(sstr('createdBy'), USER);

    IF v_obj.has('applicationIds') AND NOT v_obj.get('applicationIds').is_null THEN
        v_arr := v_obj.get_array('applicationIds');
        FOR i IN 0 .. v_arr.get_size - 1 LOOP
            v_apps.EXTEND; v_apps(v_apps.COUNT) := v_arr.get_number(i);
        END LOOP;
    END IF;
    IF v_apps.COUNT = 0 THEN
        v_apps := SYS.ODCINUMBERLIST(101, 200, 222, 10037, 10455);
    END IF;

    IF v_ledger IS NULL OR v_start_year IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"ledgerId and startYear are required"}');
        RETURN;
    END IF;
    IF v_type NOT IN ('FISCAL', 'CALENDAR') THEN v_type := 'FISCAL'; END IF;
    IF v_num_years < 1 THEN v_num_years := 1; END IF;
    IF v_num_years > 50 THEN v_num_years := 50; END IF;

    FOR yr IN 0 .. v_num_years - 1 LOOP
        v_period_year := v_start_year + yr;
        FOR k IN 1 .. 12 LOOP
            -- resolve calendar month/year for the k-th period of the year
            IF v_type = 'FISCAL' THEN
                v_cal_month := MOD(3 + k - 1, 12) + 1;               -- k=1 -> Apr(4)
                v_cal_year  := v_period_year - 1 + CASE WHEN k >= 10 THEN 1 ELSE 0 END;
            ELSE
                v_cal_month := k;                                     -- k=1 -> Jan(1)
                v_cal_year  := v_period_year;
            END IF;

            v_start := TO_DATE(v_cal_year || '-' || v_cal_month || '-01', 'YYYY-MM-DD');
            v_end   := LAST_DAY(v_start);
            v_pnum  := CASE WHEN v_inc_adj = 'Y' THEN k + FLOOR((k - 1) / 3) ELSE k END;
            v_name  := TO_CHAR(v_start, 'Mon', 'NLS_DATE_LANGUAGE=ENGLISH')
                       || '-' || TO_CHAR(v_start, 'YY');

            ins(v_name, v_pnum, v_start, v_end, 'N');

            -- quarter-end adjustment period after every 3rd month
            IF v_inc_adj = 'Y' AND MOD(k, 3) = 0 THEN
                v_qtr := k / 3;
                IF v_type = 'FISCAL' THEN
                    v_name := 'Q' || v_qtr || '-Adj-'
                              || LPAD(MOD(v_period_year - 1, 100), 2, '0') || '-'
                              || LPAD(MOD(v_period_year,     100), 2, '0');
                ELSE
                    v_name := 'Q' || v_qtr || '-Adj-'
                              || LPAD(MOD(v_period_year, 100), 2, '0');
                END IF;
                ins(v_name, v_pnum + 1, v_end, v_end, 'Y');
            END IF;
        END LOOP;
    END LOOP;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success"'
        || ',"ledgerId":'      || v_ledger
        || ',"calendarType":"' || v_type || '"'
        || ',"startYear":'     || v_start_year
        || ',"numberOfYears":' || v_num_years
        || ',"inserted":'      || v_inserted
        || ',"skipped":'       || v_skipped
        || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
  );

  -- ===== Template: single ledger check =====
  BEGIN
    ORDS.DEFINE_TEMPLATE(
      p_module_name => 'reerp',
      p_pattern     => 'accountingcalendar/:ledgerId',
      p_priority    => 0,
      p_etag_type   => 'HASH',
      p_comments    => 'Accounting calendar existence check for one ledger'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ORDS.DELETE_HANDLER(p_module_name=>'reerp', p_pattern=>'accountingcalendar/:ledgerId', p_method=>'GET');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'accountingcalendar/:ledgerId',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_mimes_allowed  => NULL,
    p_comments       => 'Accounting calendar existence/summary for one ledger',
    p_source         => q'[
SELECT
    TO_NUMBER(:ledgerId)               AS "ledgerId",
    COUNT(*)                           AS "periodCount",
    COUNT(DISTINCT PERIOD_YEAR)        AS "yearCount",
    MIN(PERIOD_YEAR)                   AS "minYear",
    MAX(PERIOD_YEAR)                   AS "maxYear",
    CASE WHEN COUNT(*) > 0 THEN 'Y' ELSE 'N' END AS "exists"
FROM RR_ACCOUNTING_PERIODS_STATUS
WHERE LEDGER_ID = TO_NUMBER(:ledgerId)
]'
  );

  COMMIT;
END;
/

-- VERIFY:
--   GET  {base}/accountingcalendar
--   GET  {base}/accountingcalendar/300000002713605
--   POST {base}/accountingcalendar
--        {"ledgerId":300000002713605,"calendarType":"FISCAL","startYear":2025,"numberOfYears":5}
--   -> {"status":"success","inserted":400,"skipped":0,...}
