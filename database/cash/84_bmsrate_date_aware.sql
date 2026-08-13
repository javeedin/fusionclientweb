-- ============================================================
-- Patch 84: BMS rate endpoint — honour rate_date parameter
--
-- Problem:
--   GET /currencies/bmsrate ignores the optional rate_date
--   query parameter, always returning today's rate.
--
-- Fix:
--   Redefine the handler so that when rate_date (YYYY-MM-DD)
--   is supplied it returns the most recent rate on or before
--   that date.  When omitted the behaviour is unchanged
--   (returns the most recent rate regardless of date).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste and run as one block.
-- ============================================================

BEGIN
    -- Drop existing handler so we can redefine it cleanly
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'currencies/bmsrate',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Template is idempotent
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'currencies/bmsrate',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'currencies/bmsrate',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'BMS currency rate — optional rate_date (YYYY-MM-DD) returns most recent rate on or before that date',
        p_source         => q'[
DECLARE
    v_source_cur    VARCHAR2(10);
    v_target_cur    VARCHAR2(10);
    v_rate_type     VARCHAR2(50);
    v_rate_date_in  VARCHAR2(20);   -- optional: YYYY-MM-DD upper bound
    v_rate          NUMBER;
    v_inverse       NUMBER;
    v_rate_date_out VARCHAR2(20);
    v_type_found    VARCHAR2(50);
    v_found         NUMBER := 0;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    v_source_cur   := UPPER(TRIM(:source_cur));
    v_target_cur   := UPPER(TRIM(:target_cur));
    v_rate_type    := UPPER(TRIM(:rate_type));
    v_rate_date_in := TRIM(:rate_date);   -- caller passes YYYY-MM-DD or omits it

    IF v_source_cur IS NULL OR v_target_cur IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Parameters source_cur and target_cur are required"}');
        RETURN;
    END IF;

    -- Same-currency shortcut
    IF v_source_cur = v_target_cur THEN
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',      'ok');
        APEX_JSON.WRITE('sourceCur',   v_source_cur);
        APEX_JSON.WRITE('targetCur',   v_target_cur);
        APEX_JSON.WRITE('rate',        1);
        APEX_JSON.WRITE('inverseRate', 1);
        APEX_JSON.WRITE('rateType',    'Corporate');
        APEX_JSON.WRITE('rateDate',    NVL(v_rate_date_in, TO_CHAR(SYSDATE, 'YYYY-MM-DD')));
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    -- Primary lookup: FROM_CURRENCY → TO_CURRENCY
    -- With rate_date: most recent rate on or before that date.
    -- Without rate_date: most recent rate ever.
    BEGIN
        SELECT RATE, INVERSE_RATE,
               TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
               RATE_TYPE, 1
        INTO   v_rate, v_inverse, v_rate_date_out, v_type_found, v_found
        FROM (
            SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
            FROM   RR_CURRENCY_DAILY_RATES
            WHERE  FROM_CURRENCY = v_source_cur
              AND  TO_CURRENCY   = v_target_cur
              AND  (v_rate_type    IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
              AND  (v_rate_date_in IS NULL
                    OR RATE_DATE <= TO_DATE(v_rate_date_in, 'YYYY-MM-DD'))
            ORDER BY RATE_DATE DESC
            FETCH FIRST 1 ROW ONLY
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN v_found := 0;
    END;

    -- Fallback: inverse direction (FROM/TO swapped, rates also swapped)
    IF v_found = 0 THEN
        BEGIN
            SELECT INVERSE_RATE, RATE,
                   TO_CHAR(RATE_DATE, 'YYYY-MM-DD'),
                   RATE_TYPE, 1
            INTO   v_rate, v_inverse, v_rate_date_out, v_type_found, v_found
            FROM (
                SELECT RATE, INVERSE_RATE, RATE_DATE, RATE_TYPE
                FROM   RR_CURRENCY_DAILY_RATES
                WHERE  FROM_CURRENCY = v_target_cur
                  AND  TO_CURRENCY   = v_source_cur
                  AND  (v_rate_type    IS NULL OR UPPER(RATE_TYPE) = v_rate_type)
                  AND  (v_rate_date_in IS NULL
                        OR RATE_DATE <= TO_DATE(v_rate_date_in, 'YYYY-MM-DD'))
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
              || '","rateDate":"'  || NVL(v_rate_date_in, 'any')
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
    APEX_JSON.WRITE('rateDate',    v_rate_date_out);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/
