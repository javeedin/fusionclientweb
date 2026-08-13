-- ============================================================
-- RR_CURRENCY_PKG  — Package Body
-- ============================================================
CREATE OR REPLACE PACKAGE BODY RR_CURRENCY_PKG AS

    -- ── Private helpers ───────────────────────────────────────
    FUNCTION js(p_val IN VARCHAR2) RETURN VARCHAR2 IS
        v VARCHAR2(32767) := p_val;
    BEGIN
        IF v IS NULL THEN RETURN '""'; END IF;
        v := REPLACE(v, '\',    '\\');
        v := REPLACE(v, '"',    '\"');
        v := REPLACE(v, CHR(9), '\t');
        v := REPLACE(v, CHR(10),'\n');
        v := REPLACE(v, CHR(13),'\r');
        v := REGEXP_REPLACE(v, '[[:cntrl:]]', '');
        RETURN '"' || v || '"';
    END js;

    FUNCTION jn(p_val IN NUMBER) RETURN VARCHAR2 IS
        v_str VARCHAR2(100);
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        v_str := TO_CHAR(p_val, 'TM9');          -- minimal text, no trailing zeros
        -- JSON requires leading zero: .695 → 0.695, -.695 → -0.695
        IF v_str LIKE '.%'  THEN v_str := '0'  || v_str; END IF;
        IF v_str LIKE '-.%' THEN v_str := '-0.' || SUBSTR(v_str, 3); END IF;
        RETURN v_str;
    END jn;

    FUNCTION jd(p_val IN DATE) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        RETURN '"' || TO_CHAR(p_val, 'YYYY-MM-DD') || '"';
    END jd;

    PROCEDURE flush_clob(p_clob IN CLOB) IS
        l_len INTEGER := DBMS_LOB.GETLENGTH(p_clob);
        l_pos INTEGER := 1;
    BEGIN
        WHILE l_pos <= l_len LOOP
            HTP.PRN(DBMS_LOB.SUBSTR(p_clob, 32767, l_pos));
            l_pos := l_pos + 32767;
        END LOOP;
    END flush_clob;

    PROCEDURE err(p_code IN NUMBER, p_msg IN VARCHAR2, p_status_code OUT NUMBER) IS
    BEGIN
        p_status_code := p_code;
        HTP.P('{"status":"error","code":' || p_code || ',"message":"'
              || REPLACE(p_msg, '"', '\"') || '"}');
    END err;

    -- ── SYNC_CURRENCIES ───────────────────────────────────────
    -- Body: { "items": [{CurrencyCode, Name, Description,
    --          EnabledFlag, Symbol, Precision, ExtendedPrecision,
    --          CurrencyFormat, CurrencyFormatWithSymbol,
    --          CurrencyFormatWithCode, IssuingTerritoryCode, CurrencyFlag},...] }
    PROCEDURE sync_currencies(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_count  NUMBER := 0;
        v_today  DATE   := SYSDATE;
    BEGIN
        FOR r IN (
            SELECT jt.code, jt.name, jt.descr, jt.enabled,
                   jt.symbol, jt.prec, jt.ext_prec,
                   jt.fmt, jt.fmt_sym, jt.fmt_code,
                   jt.terr, jt.curr_flag
            FROM   JSON_TABLE(p_body, '$.items[*]'
                   COLUMNS (
                       code      VARCHAR2(10)  PATH '$.CurrencyCode',
                       name      VARCHAR2(100) PATH '$.Name',
                       descr     VARCHAR2(200) PATH '$.Description',
                       enabled   VARCHAR2(1)   PATH '$.EnabledFlag',
                       symbol    VARCHAR2(20)  PATH '$.Symbol',
                       prec      NUMBER        PATH '$.Precision',
                       ext_prec  NUMBER        PATH '$.ExtendedPrecision',
                       fmt       VARCHAR2(200) PATH '$.CurrencyFormat',
                       fmt_sym   VARCHAR2(400) PATH '$.CurrencyFormatWithSymbol',
                       fmt_code  VARCHAR2(400) PATH '$.CurrencyFormatWithCode',
                       terr      VARCHAR2(10)  PATH '$.IssuingTerritoryCode',
                       curr_flag VARCHAR2(1)   PATH '$.CurrencyFlag'
                   )) jt
            WHERE  jt.code IS NOT NULL
        ) LOOP
            BEGIN
                MERGE INTO RR_CURRENCY_LIST t
                USING (SELECT r.code AS code FROM DUAL) s ON (t.CURRENCY_CODE = s.code)
                WHEN MATCHED THEN UPDATE SET
                    NAME                   = r.name,
                    DESCRIPTION            = r.descr,
                    ENABLED_FLAG           = NVL(r.enabled, 'Y'),
                    SYMBOL                 = r.symbol,
                    PRECISION              = r.prec,
                    EXTENDED_PRECISION     = r.ext_prec,
                    CURRENCY_FORMAT        = r.fmt,
                    CURRENCY_FORMAT_SYMBOL = r.fmt_sym,
                    CURRENCY_FORMAT_CODE   = r.fmt_code,
                    ISSUING_TERRITORY_CODE = r.terr,
                    CURRENCY_FLAG          = r.curr_flag,
                    LAST_SYNC_DATE         = v_today
                WHEN NOT MATCHED THEN INSERT (
                    CURRENCY_CODE, NAME, DESCRIPTION, ENABLED_FLAG,
                    SYMBOL, PRECISION, EXTENDED_PRECISION,
                    CURRENCY_FORMAT, CURRENCY_FORMAT_SYMBOL, CURRENCY_FORMAT_CODE,
                    ISSUING_TERRITORY_CODE, CURRENCY_FLAG, LAST_SYNC_DATE
                ) VALUES (
                    r.code, r.name, r.descr, NVL(r.enabled, 'Y'),
                    r.symbol, r.prec, r.ext_prec,
                    r.fmt, r.fmt_sym, r.fmt_code,
                    r.terr, r.curr_flag, v_today
                );
                v_count := v_count + 1;
            EXCEPTION
                WHEN OTHERS THEN NULL; -- skip individual errors
            END;
        END LOOP;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","synced":' || v_count || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END sync_currencies;

    -- ── GET_CURRENCIES ────────────────────────────────────────
    PROCEDURE get_currencies(
        p_search      IN  VARCHAR2 DEFAULT NULL,
        p_enabled     IN  VARCHAR2 DEFAULT NULL,
        p_status_code OUT NUMBER
    ) IS
        v_clob  CLOB;
        v_first BOOLEAN := TRUE;
        v_total NUMBER;
    BEGIN
        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);

        SELECT COUNT(*) INTO v_total FROM RR_CURRENCY_LIST
        WHERE  (p_search  IS NULL OR UPPER(CURRENCY_CODE) LIKE '%' || UPPER(p_search) || '%'
                                  OR UPPER(NAME)          LIKE '%' || UPPER(p_search) || '%')
        AND    (p_enabled IS NULL OR ENABLED_FLAG = p_enabled);

        DBMS_LOB.APPEND(v_clob, TO_CLOB('{"status":"success","total":' || v_total || ',"items":['));

        FOR r IN (
            SELECT CURRENCY_CODE, NAME, DESCRIPTION, ENABLED_FLAG,
                   SYMBOL, PRECISION, EXTENDED_PRECISION,
                   ISSUING_TERRITORY_CODE, CURRENCY_FLAG,
                   TO_CHAR(LAST_SYNC_DATE, 'YYYY-MM-DD') AS SYNC_DATE
            FROM   RR_CURRENCY_LIST
            WHERE  (p_search  IS NULL OR UPPER(CURRENCY_CODE) LIKE '%' || UPPER(p_search) || '%'
                                      OR UPPER(NAME)          LIKE '%' || UPPER(p_search) || '%')
            AND    (p_enabled IS NULL OR ENABLED_FLAG = p_enabled)
            ORDER  BY CURRENCY_CODE
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"code":'         || js(r.CURRENCY_CODE)          || ','
             || '"name":'          || js(r.NAME)                    || ','
             || '"description":'   || js(r.DESCRIPTION)             || ','
             || '"enabled":'       || js(r.ENABLED_FLAG)            || ','
             || '"symbol":'        || js(r.SYMBOL)                  || ','
             || '"precision":'     || jn(r.PRECISION)               || ','
             || '"extPrecision":'  || jn(r.EXTENDED_PRECISION)      || ','
             || '"territory":'     || js(r.ISSUING_TERRITORY_CODE)  || ','
             || '"currencyFlag":'  || js(r.CURRENCY_FLAG)           || ','
             || '"lastSyncDate":'  || js(r.SYNC_DATE)               || '}'
            ));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_currencies;

    -- ── TOGGLE_CURRENCY ───────────────────────────────────────
    PROCEDURE toggle_currency(
        p_code        IN  VARCHAR2,
        p_enabled     IN  VARCHAR2,
        p_status_code OUT NUMBER
    ) IS
    BEGIN
        UPDATE RR_CURRENCY_LIST
        SET    ENABLED_FLAG = p_enabled
        WHERE  CURRENCY_CODE = p_code;

        IF SQL%ROWCOUNT = 0 THEN
            err(404, 'Currency not found: ' || p_code, p_status_code);
            RETURN;
        END IF;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","code":"' || p_code || '","enabled":"' || p_enabled || '"}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END toggle_currency;

    -- ── GET_RATE_TYPES ────────────────────────────────────────
    PROCEDURE get_rate_types(
        p_status_code OUT NUMBER
    ) IS
        v_clob  CLOB;
        v_first BOOLEAN := TRUE;
    BEGIN
        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
        DBMS_LOB.APPEND(v_clob, TO_CLOB('{"status":"success","items":['));

        FOR r IN (
            SELECT RATE_TYPE_ID, NAME, DESCRIPTION,
                   DEFAULT_RATE_TYPE, ENFORCE_INVERSE_RELATIONSHIP,
                   ENABLE_CROSS_RATES, ALLOW_CROSS_RATES_OVERRIDE,
                   CROSS_RATE_PIVOT_CURRENCY
            FROM   RR_CURRENCY_RATE_TYPES
            ORDER  BY RATE_TYPE_ID
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"id":'                  || r.RATE_TYPE_ID                      || ','
             || '"name":'                 || js(r.NAME)                           || ','
             || '"description":'          || js(r.DESCRIPTION)                    || ','
             || '"defaultRateType":'      || js(r.DEFAULT_RATE_TYPE)              || ','
             || '"enforceInverse":'       || js(r.ENFORCE_INVERSE_RELATIONSHIP)   || ','
             || '"enableCrossRates":'     || js(r.ENABLE_CROSS_RATES)             || ','
             || '"allowOverride":'        || js(r.ALLOW_CROSS_RATES_OVERRIDE)     || ','
             || '"pivotCurrency":'        || js(r.CROSS_RATE_PIVOT_CURRENCY)      || '}'
            ));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_rate_types;

    -- ── SAVE_RATE_TYPES ───────────────────────────────────────
    -- Body: { "items": [{id?, name, description, defaultRateType,
    --          enforceInverse, enableCrossRates, allowOverride, pivotCurrency},...],
    --         "updatedBy": "USERNAME" }
    PROCEDURE save_rate_types(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_user      VARCHAR2(100) := NVL(JSON_VALUE(p_body, '$.updatedBy'), USER);
        v_now       DATE          := SYSDATE;
        v_id        NUMBER;
        v_saved     NUMBER := 0;
    BEGIN
        -- Clear default flag on all before re-setting
        UPDATE RR_CURRENCY_RATE_TYPES SET DEFAULT_RATE_TYPE = 'N';

        FOR r IN (
            SELECT jt.id, jt.name, jt.descr, jt.is_default,
                   jt.enforce_inv, jt.enable_cross, jt.allow_ovr, jt.pivot
            FROM   JSON_TABLE(p_body, '$.items[*]'
                   COLUMNS (
                       id          NUMBER        PATH '$.id',
                       name        VARCHAR2(50)  PATH '$.name',
                       descr       VARCHAR2(200) PATH '$.description',
                       is_default  VARCHAR2(1)   PATH '$.defaultRateType',
                       enforce_inv VARCHAR2(1)   PATH '$.enforceInverse',
                       enable_cross VARCHAR2(1)  PATH '$.enableCrossRates',
                       allow_ovr   VARCHAR2(1)   PATH '$.allowOverride',
                       pivot       VARCHAR2(10)  PATH '$.pivotCurrency'
                   )) jt
            WHERE  jt.name IS NOT NULL
        ) LOOP
            IF r.id IS NOT NULL THEN
                UPDATE RR_CURRENCY_RATE_TYPES SET
                    NAME                         = r.name,
                    DESCRIPTION                  = r.descr,
                    DEFAULT_RATE_TYPE            = NVL(r.is_default, 'N'),
                    ENFORCE_INVERSE_RELATIONSHIP = NVL(r.enforce_inv, 'N'),
                    ENABLE_CROSS_RATES           = NVL(r.enable_cross, 'N'),
                    ALLOW_CROSS_RATES_OVERRIDE   = NVL(r.allow_ovr, 'N'),
                    CROSS_RATE_PIVOT_CURRENCY    = r.pivot,
                    LAST_UPDATED_BY              = v_user,
                    LAST_UPDATE_DATE             = v_now
                WHERE RATE_TYPE_ID = r.id;
            ELSE
                INSERT INTO RR_CURRENCY_RATE_TYPES (
                    NAME, DESCRIPTION, DEFAULT_RATE_TYPE,
                    ENFORCE_INVERSE_RELATIONSHIP, ENABLE_CROSS_RATES,
                    ALLOW_CROSS_RATES_OVERRIDE, CROSS_RATE_PIVOT_CURRENCY,
                    CREATED_BY, LAST_UPDATED_BY
                ) VALUES (
                    r.name, r.descr, NVL(r.is_default, 'N'),
                    NVL(r.enforce_inv, 'N'), NVL(r.enable_cross, 'N'),
                    NVL(r.allow_ovr, 'N'), r.pivot,
                    v_user, v_user
                );
            END IF;
            v_saved := v_saved + 1;
        END LOOP;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","saved":' || v_saved || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END save_rate_types;

    -- ── DELETE_RATE_TYPE ──────────────────────────────────────
    PROCEDURE delete_rate_type(
        p_id          IN  NUMBER,
        p_status_code OUT NUMBER
    ) IS
    BEGIN
        DELETE FROM RR_CURRENCY_RATE_TYPES WHERE RATE_TYPE_ID = p_id;

        IF SQL%ROWCOUNT = 0 THEN
            err(404, 'Rate type not found: ' || p_id, p_status_code);
            RETURN;
        END IF;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","deleted":' || p_id || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END delete_rate_type;

    -- ── GET_DAILY_RATES ───────────────────────────────────────
    PROCEDURE get_daily_rates(
        p_from_currency IN  VARCHAR2 DEFAULT NULL,
        p_to_currency   IN  VARCHAR2 DEFAULT NULL,
        p_rate_type     IN  VARCHAR2 DEFAULT NULL,
        p_date_from     IN  VARCHAR2 DEFAULT NULL,
        p_date_to       IN  VARCHAR2 DEFAULT NULL,
        p_limit         IN  NUMBER   DEFAULT 200,
        p_offset        IN  NUMBER   DEFAULT 0,
        p_status_code   OUT NUMBER
    ) IS
        v_clob    CLOB;
        v_first   BOOLEAN := TRUE;
        v_total   NUMBER;
        v_df      DATE := CASE WHEN p_date_from IS NOT NULL
                               THEN TO_DATE(p_date_from, 'YYYY-MM-DD') ELSE NULL END;
        v_dt      DATE := CASE WHEN p_date_to IS NOT NULL
                               THEN TO_DATE(p_date_to,   'YYYY-MM-DD') ELSE NULL END;
    BEGIN
        DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);

        SELECT COUNT(*) INTO v_total
        FROM   RR_CURRENCY_DAILY_RATES
        WHERE  (p_from_currency IS NULL OR FROM_CURRENCY = UPPER(p_from_currency))
        AND    (p_to_currency   IS NULL OR TO_CURRENCY   = UPPER(p_to_currency))
        AND    (p_rate_type     IS NULL OR RATE_TYPE      = p_rate_type)
        AND    (v_df            IS NULL OR RATE_DATE     >= v_df)
        AND    (v_dt            IS NULL OR RATE_DATE     <= v_dt);

        DBMS_LOB.APPEND(v_clob, TO_CLOB('{"status":"success","total":' || v_total || ',"items":['));

        FOR r IN (
            SELECT RATE_ID, FROM_CURRENCY, TO_CURRENCY,
                   TO_CHAR(RATE_DATE, 'YYYY-MM-DD') AS RATE_DATE,
                   RATE_TYPE, RATE, INVERSE_RATE, SOURCE,
                   TO_CHAR(CREATION_DATE, 'YYYY-MM-DD HH24:MI') AS CREATED_AT,
                   CREATED_BY
            FROM   RR_CURRENCY_DAILY_RATES
            WHERE  (p_from_currency IS NULL OR FROM_CURRENCY = UPPER(p_from_currency))
            AND    (p_to_currency   IS NULL OR TO_CURRENCY   = UPPER(p_to_currency))
            AND    (p_rate_type     IS NULL OR RATE_TYPE      = p_rate_type)
            AND    (v_df            IS NULL OR RATE_DATE     >= v_df)
            AND    (v_dt            IS NULL OR RATE_DATE     <= v_dt)
            ORDER  BY RATE_DATE DESC, FROM_CURRENCY, TO_CURRENCY
            OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY
        ) LOOP
            IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, TO_CLOB(',')); END IF;
            v_first := FALSE;
            DBMS_LOB.APPEND(v_clob, TO_CLOB(
                '{"rateId":'       || r.RATE_ID       || ','
             || '"fromCurrency":'  || js(r.FROM_CURRENCY) || ','
             || '"toCurrency":'    || js(r.TO_CURRENCY)   || ','
             || '"rateDate":'      || js(r.RATE_DATE)     || ','
             || '"rateType":'      || js(r.RATE_TYPE)     || ','
             || '"rate":'          || jn(r.RATE)          || ','
             || '"inverseRate":'   || jn(r.INVERSE_RATE)  || ','
             || '"source":'        || js(r.SOURCE)        || ','
             || '"createdAt":'     || js(r.CREATED_AT)    || ','
             || '"createdBy":'     || js(r.CREATED_BY)    || '}'
            ));
        END LOOP;

        DBMS_LOB.APPEND(v_clob, TO_CLOB(']}'));
        p_status_code := 200;
        flush_clob(v_clob);
        DBMS_LOB.FREETEMPORARY(v_clob);
    EXCEPTION
        WHEN OTHERS THEN err(500, SQLERRM, p_status_code);
    END get_daily_rates;

    -- ── SAVE_DAILY_RATE ───────────────────────────────────────
    -- Body: { rateId?, fromCurrency, toCurrency, rateDate,
    --         rateType, rate, source?, createdBy? }
    PROCEDURE save_daily_rate(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_id        NUMBER       := JSON_VALUE(p_body, '$.rateId'       RETURNING NUMBER);
        v_from      VARCHAR2(10) := UPPER(JSON_VALUE(p_body, '$.fromCurrency'));
        v_to        VARCHAR2(10) := UPPER(JSON_VALUE(p_body, '$.toCurrency'));
        v_date      DATE         := TO_DATE(JSON_VALUE(p_body, '$.rateDate'), 'YYYY-MM-DD');
        v_type      VARCHAR2(50) := JSON_VALUE(p_body, '$.rateType');
        v_rate      NUMBER       := JSON_VALUE(p_body, '$.rate'         RETURNING NUMBER);
        v_source    VARCHAR2(20) := NVL(JSON_VALUE(p_body, '$.source'), 'MANUAL');
        v_user      VARCHAR2(100):= NVL(JSON_VALUE(p_body, '$.createdBy'), USER);
        v_inv_rate  NUMBER;
    BEGIN
        IF v_rate IS NOT NULL AND v_rate != 0 THEN
            v_inv_rate := ROUND(1 / v_rate, 10);
        END IF;

        IF v_id IS NOT NULL THEN
            -- Update existing
            UPDATE RR_CURRENCY_DAILY_RATES SET
                FROM_CURRENCY = v_from,
                TO_CURRENCY   = v_to,
                RATE_DATE     = v_date,
                RATE_TYPE     = v_type,
                RATE          = v_rate,
                INVERSE_RATE  = v_inv_rate,
                SOURCE        = v_source
            WHERE RATE_ID = v_id;

            IF SQL%ROWCOUNT = 0 THEN
                err(404, 'Daily rate not found: ' || v_id, p_status_code);
                RETURN;
            END IF;
        ELSE
            -- Insert — let trigger assign ID and handle inverse
            INSERT INTO RR_CURRENCY_DAILY_RATES (
                FROM_CURRENCY, TO_CURRENCY, RATE_DATE,
                RATE_TYPE, RATE, INVERSE_RATE, SOURCE, CREATED_BY
            ) VALUES (
                v_from, v_to, v_date,
                v_type, v_rate, v_inv_rate, v_source, v_user
            )
            RETURNING RATE_ID INTO v_id;
        END IF;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","rateId":' || v_id || '}');
    EXCEPTION
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK;
            err(409, 'A rate already exists for ' || v_from || '→' || v_to
                || ' on ' || TO_CHAR(v_date,'YYYY-MM-DD') || ' (' || v_type || ')', p_status_code);
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END save_daily_rate;

    -- ── IMPORT_DAILY_RATES ────────────────────────────────────
    -- Body: { "rates": [{fromCurrency, toCurrency, rateDate,
    --          rateType, rate},...], "source": "API"|"SPREADSHEET",
    --         "createdBy": "USERNAME" }
    PROCEDURE import_daily_rates(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    ) IS
        v_source  VARCHAR2(20)  := NVL(JSON_VALUE(p_body, '$.source'), 'API');
        v_user    VARCHAR2(100) := NVL(JSON_VALUE(p_body, '$.createdBy'), USER);
        v_saved   NUMBER := 0;
        v_skipped NUMBER := 0;
    BEGIN
        FOR r IN (
            SELECT jt.from_cur, jt.to_cur, jt.rdate, jt.rtype, jt.rate
            FROM   JSON_TABLE(p_body, '$.rates[*]'
                   COLUMNS (
                       from_cur  VARCHAR2(10)  PATH '$.fromCurrency',
                       to_cur    VARCHAR2(10)  PATH '$.toCurrency',
                       rdate     VARCHAR2(20)  PATH '$.rateDate',
                       rtype     VARCHAR2(50)  PATH '$.rateType',
                       rate      NUMBER        PATH '$.rate'
                   )) jt
            WHERE  jt.from_cur IS NOT NULL
            AND    jt.to_cur   IS NOT NULL
            AND    jt.rate     IS NOT NULL
        ) LOOP
            BEGIN
                INSERT INTO RR_CURRENCY_DAILY_RATES (
                    FROM_CURRENCY, TO_CURRENCY, RATE_DATE,
                    RATE_TYPE, RATE, SOURCE, CREATED_BY
                ) VALUES (
                    UPPER(r.from_cur),
                    UPPER(r.to_cur),
                    TO_DATE(r.rdate, 'YYYY-MM-DD'),
                    r.rtype,
                    r.rate,
                    v_source,
                    v_user
                );
                v_saved := v_saved + 1;
            EXCEPTION
                WHEN DUP_VAL_ON_INDEX THEN
                    -- Update existing on conflict
                    UPDATE RR_CURRENCY_DAILY_RATES SET
                        RATE         = r.rate,
                        INVERSE_RATE = CASE WHEN r.rate != 0 THEN ROUND(1/r.rate,10) ELSE NULL END,
                        SOURCE       = v_source
                    WHERE FROM_CURRENCY = UPPER(r.from_cur)
                    AND   TO_CURRENCY   = UPPER(r.to_cur)
                    AND   RATE_DATE     = TO_DATE(r.rdate, 'YYYY-MM-DD')
                    AND   RATE_TYPE     = r.rtype;
                    v_saved := v_saved + 1;
                WHEN OTHERS THEN
                    v_skipped := v_skipped + 1;
            END;
        END LOOP;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","saved":' || v_saved || ',"skipped":' || v_skipped || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END import_daily_rates;

    -- ── DELETE_DAILY_RATE ─────────────────────────────────────
    PROCEDURE delete_daily_rate(
        p_id          IN  NUMBER,
        p_status_code OUT NUMBER
    ) IS
    BEGIN
        DELETE FROM RR_CURRENCY_DAILY_RATES WHERE RATE_ID = p_id;

        IF SQL%ROWCOUNT = 0 THEN
            err(404, 'Daily rate not found: ' || p_id, p_status_code);
            RETURN;
        END IF;

        COMMIT;
        p_status_code := 200;
        HTP.P('{"status":"success","deleted":' || p_id || '}');
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK; err(500, SQLERRM, p_status_code);
    END delete_daily_rate;

END RR_CURRENCY_PKG;
/
