-- ============================================================
-- APEX ORDS REST Handlers — Currency Module
-- Module  : reerp
-- Package : RR_CURRENCY_PKG
--
-- Endpoints:
--   GET    /currencies              — list currencies from DB
--   POST   /currencies/sync        — upsert currencies (from Oracle Cloud)
--   POST   /currencies/toggle      — enable/disable a currency
--   GET    /currencies/ratetypes   — list rate types
--   POST   /currencies/ratetypes   — bulk save rate types
--   DELETE /currencies/ratetypes/:id — delete rate type
--   GET    /currencies/dailyrates  — search daily rates
--   POST   /currencies/dailyrates  — create/update daily rate
--   POST   /currencies/dailyrates/import — bulk import rates
--   DELETE /currencies/dailyrates/:id — delete daily rate
-- ============================================================


-- ============================================================
-- GET /currencies
-- Query params: search, enabled
-- ============================================================
DECLARE
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    RR_CURRENCY_PKG.GET_CURRENCIES(
        p_search      => :search,
        p_enabled     => :enabled,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- POST /currencies/sync
-- Body: { "items": [{CurrencyCode, Name, ...},...] }
-- ============================================================
DECLARE
    v_body        CLOB;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';
    v_body := :body_text;

    IF v_body IS NULL OR DBMS_LOB.GETLENGTH(v_body) = 0 THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Request body is empty"}');
        RETURN;
    END IF;

    RR_CURRENCY_PKG.SYNC_CURRENCIES(
        p_body        => v_body,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- POST /currencies/toggle
-- Body: { "code": "USD", "enabled": "Y"|"N" }
-- ============================================================
DECLARE
    v_body        CLOB;
    v_code        VARCHAR2(10);
    v_enabled     VARCHAR2(1);
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';
    v_body    := :body_text;
    v_code    := JSON_VALUE(v_body, '$.code');
    v_enabled := JSON_VALUE(v_body, '$.enabled');

    IF v_code IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Field ''code'' is required"}');
        RETURN;
    END IF;

    IF v_enabled NOT IN ('Y','N') THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Field ''enabled'' must be Y or N"}');
        RETURN;
    END IF;

    RR_CURRENCY_PKG.TOGGLE_CURRENCY(
        p_code        => v_code,
        p_enabled     => v_enabled,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- GET /currencies/ratetypes
-- ============================================================
DECLARE
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    RR_CURRENCY_PKG.GET_RATE_TYPES(
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- POST /currencies/ratetypes
-- Body: { "items": [{id?, name, description, ...},...], "updatedBy": "..." }
-- ============================================================
DECLARE
    v_body        CLOB;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';
    v_body := :body_text;

    IF v_body IS NULL OR DBMS_LOB.GETLENGTH(v_body) = 0 THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Request body is empty"}');
        RETURN;
    END IF;

    RR_CURRENCY_PKG.SAVE_RATE_TYPES(
        p_body        => v_body,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- DELETE /currencies/ratetypes/:id
-- ============================================================
DECLARE
    v_id          NUMBER;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    BEGIN
        v_id := TO_NUMBER(:id);
    EXCEPTION
        WHEN VALUE_ERROR THEN
            :status_code := 400;
            HTP.P('{"status":"error","code":400,"message":"Invalid ID"}');
            RETURN;
    END;

    RR_CURRENCY_PKG.DELETE_RATE_TYPE(
        p_id          => v_id,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- GET /currencies/dailyrates
-- Query params: from_currency, to_currency, rate_type,
--               date_from, date_to, row_limit, offset
-- ============================================================
DECLARE
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    RR_CURRENCY_PKG.GET_DAILY_RATES(
        p_from_currency => :from_currency,
        p_to_currency   => :to_currency,
        p_rate_type     => :rate_type,
        p_date_from     => :date_from,
        p_date_to       => :date_to,
        p_limit         => NVL(TO_NUMBER(:row_limit), 200),
        p_offset        => NVL(TO_NUMBER(:offset),    0),
        p_status_code   => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- POST /currencies/dailyrates
-- Body: { rateId?, fromCurrency, toCurrency, rateDate,
--         rateType, rate, source?, createdBy? }
-- ============================================================
DECLARE
    v_body        CLOB;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';
    v_body := :body_text;

    IF v_body IS NULL OR DBMS_LOB.GETLENGTH(v_body) = 0 THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Request body is empty"}');
        RETURN;
    END IF;

    IF JSON_VALUE(v_body, '$.fromCurrency') IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Field ''fromCurrency'' is required"}');
        RETURN;
    END IF;

    IF JSON_VALUE(v_body, '$.toCurrency') IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Field ''toCurrency'' is required"}');
        RETURN;
    END IF;

    IF JSON_VALUE(v_body, '$.rate' RETURNING NUMBER) IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Field ''rate'' is required"}');
        RETURN;
    END IF;

    RR_CURRENCY_PKG.SAVE_DAILY_RATE(
        p_body        => v_body,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- POST /currencies/dailyrates/import
-- Body: { "rates": [{fromCurrency, toCurrency, rateDate, rateType, rate},...],
--         "source": "API"|"SPREADSHEET", "createdBy": "..." }
-- ============================================================
DECLARE
    v_body        CLOB;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';
    v_body := :body_text;

    IF v_body IS NULL OR DBMS_LOB.GETLENGTH(v_body) = 0 THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Request body is empty"}');
        RETURN;
    END IF;

    RR_CURRENCY_PKG.IMPORT_DAILY_RATES(
        p_body        => v_body,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- DELETE /currencies/dailyrates/:id
-- ============================================================
DECLARE
    v_id          NUMBER;
    v_status_code NUMBER := 500;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    BEGIN
        v_id := TO_NUMBER(:id);
    EXCEPTION
        WHEN VALUE_ERROR THEN
            :status_code := 400;
            HTP.P('{"status":"error","code":400,"message":"Invalid ID"}');
            RETURN;
    END;

    RR_CURRENCY_PKG.DELETE_DAILY_RATE(
        p_id          => v_id,
        p_status_code => v_status_code
    );

    :status_code := v_status_code;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;


-- ============================================================
-- GET /currencies/bmsrate
-- Query params: source_cur, target_cur
-- Returns the most recent rate row from BMSEXERATE_DAILY.
-- If today has no rate the latest available date is returned.
-- ============================================================
DECLARE
    v_source_cur  VARCHAR2(10);
    v_target_cur  VARCHAR2(10);
    v_rate        NUMBER;
    v_buy         NUMBER;
    v_open        NUMBER;
    v_close       NUMBER;
    v_date        VARCHAR2(20);
    v_found       NUMBER := 0;
BEGIN
    :content_type := 'application/json; charset=utf-8';

    v_source_cur := UPPER(TRIM(:source_cur));
    v_target_cur := UPPER(TRIM(:target_cur));

    IF v_source_cur IS NULL OR v_target_cur IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","code":400,"message":"Parameters source_cur and target_cur are required"}');
        RETURN;
    END IF;

    BEGIN
        SELECT RATE, BUY, OPEN, CLOSE,
               TO_CHAR(REFRESH_DATE, 'YYYY-MM-DD'),
               1
        INTO   v_rate, v_buy, v_open, v_close, v_date, v_found
        FROM (
            SELECT RATE, BUY, OPEN, CLOSE, REFRESH_DATE
            FROM   BMSEXERATE_DAILY
            WHERE  SOURCE_CUR = v_source_cur
              AND  TARGET_CUR = v_target_cur
            ORDER BY REFRESH_DATE DESC
            FETCH FIRST 1 ROW ONLY
        );
    EXCEPTION
        WHEN NO_DATA_FOUND THEN v_found := 0;
    END;

    IF v_found = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"not_found","code":404,"sourceCur":"' || v_source_cur
              || '","targetCur":"' || v_target_cur
              || '","message":"No rate found"}');
        RETURN;
    END IF;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',      'ok');
    APEX_JSON.WRITE('sourceCur',   v_source_cur);
    APEX_JSON.WRITE('targetCur',   v_target_cur);
    APEX_JSON.WRITE('rate',        v_rate);
    APEX_JSON.WRITE('buy',         v_buy);
    APEX_JSON.WRITE('open',        v_open);
    APEX_JSON.WRITE('close',       v_close);
    APEX_JSON.WRITE('refreshDate', v_date);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","code":500,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
