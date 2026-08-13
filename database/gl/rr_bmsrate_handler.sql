-- ============================================================
-- APEX ORDS REST Handler — Currency Rate Lookup
-- Module   : reerp
-- Template : currencies/bmsrate
-- Method   : GET
--
-- Query params:
--   source_cur  VARCHAR2  e.g. USD          (required)
--   target_cur  VARCHAR2  e.g. AED          (required)
--   rate_type   VARCHAR2  e.g. Corporate    (optional; NULL = any)
--
-- Source table: RR_CURRENCY_DAILY_RATES
--   RATE_ID, FROM_CURRENCY, TO_CURRENCY, RATE_DATE,
--   RATE_TYPE, RATE, INVERSE_RATE, SOURCE, CREATED_BY, CREATION_DATE
--
-- Response (200):
--   {
--     "status":      "ok",
--     "sourceCur":   "USD",
--     "targetCur":   "AED",
--     "rate":        3.6725,
--     "inverseRate": 0.272479,
--     "rateType":    "Corporate",
--     "rateDate":    "2024-01-15"
--   }
-- Response (404):
--   { "status":"not_found", "sourceCur", "targetCur", "message" }
-- Response (400 / 500):
--   { "status":"error", "code", "message" }
-- ============================================================

DECLARE
    v_source_cur  VARCHAR2(10);
    v_target_cur  VARCHAR2(10);
    v_rate_type   VARCHAR2(50);
    v_rate        NUMBER;
    v_inverse     NUMBER;
    v_rate_date   VARCHAR2(20);
    v_type_found  VARCHAR2(50);
    v_found       NUMBER := 0;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    v_source_cur := UPPER(TRIM(:source_cur));
    v_target_cur := UPPER(TRIM(:target_cur));
    v_rate_type  := UPPER(TRIM(:rate_type));   -- optional

    -- Validate required params
    IF v_source_cur IS NULL OR v_target_cur IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Parameters source_cur and target_cur are required"}');
        RETURN;
    END IF;

    -- Same-currency shortcut — always 1, no DB hit needed
    IF v_source_cur = v_target_cur THEN
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',      'ok');
        APEX_JSON.WRITE('sourceCur',   v_source_cur);
        APEX_JSON.WRITE('targetCur',   v_target_cur);
        APEX_JSON.WRITE('rate',        1);
        APEX_JSON.WRITE('inverseRate', 1);
        APEX_JSON.WRITE('rateType',    'Corporate');
        APEX_JSON.WRITE('rateDate',    TO_CHAR(SYSDATE, 'YYYY-MM-DD'));
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    -- Primary lookup: FROM_CURRENCY → TO_CURRENCY
    BEGIN
        SELECT RATE, INVERSE_RATE,
               TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
               RATE_TYPE,
               1
        INTO   v_rate, v_inverse, v_rate_date, v_type_found, v_found
        FROM (
            SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
            FROM   RR_CURRENCY_DAILY_RATES
            WHERE  FROM_CURRENCY = v_source_cur
              AND  TO_CURRENCY   = v_target_cur
              AND  (v_rate_type IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
            ORDER BY RATE_DATE DESC
            FETCH FIRST 1 ROW ONLY
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN v_found := 0;
    END;

    -- Fallback: try inverse direction and flip the rate
    IF v_found = 0 THEN
        BEGIN
            SELECT INVERSE_RATE,
                   RATE,
                   TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
                   RATE_TYPE,
                   1
            INTO   v_rate, v_inverse, v_rate_date, v_type_found, v_found
            FROM (
                SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
                FROM   RR_CURRENCY_DAILY_RATES
                WHERE  FROM_CURRENCY = v_target_cur
                  AND  TO_CURRENCY   = v_source_cur
                  AND  (v_rate_type IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
                ORDER BY RATE_DATE DESC
                FETCH FIRST 1 ROW ONLY
            );
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_found := 0;
        END;
    END IF;

    IF v_found = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"not_found","code":404,"sourceCur":"' || v_source_cur
              || '","targetCur":"' || v_target_cur
              || '","message":"No rate found in RR_CURRENCY_DAILY_RATES"}');
        RETURN;
    END IF;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',      'ok');
    APEX_JSON.WRITE('sourceCur',   v_source_cur);
    APEX_JSON.WRITE('targetCur',   v_target_cur);
    APEX_JSON.WRITE('rate',        v_rate);
    APEX_JSON.WRITE('inverseRate', v_inverse);
    APEX_JSON.WRITE('rateType',    v_type_found);
    APEX_JSON.WRITE('rateDate',    v_rate_date);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
