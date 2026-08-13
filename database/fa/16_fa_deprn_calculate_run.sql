-- ============================================================
-- 16_FA_DEPRN_CALCULATE.SQL
-- GET  reerp/fa/deprn-calculate/preview  — preview next period depreciation
-- POST reerp/fa/deprn-calculate          — run and post depreciation
-- ============================================================

-- ── Clean up ──────────────────────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/deprn-calculate/preview',p_method=>'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/deprn-calculate/preview'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/deprn-calculate',p_method=>'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/deprn-calculate'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ── Template: fa/deprn-calculate/preview ──────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-calculate/preview',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: preview next period depreciation amounts'
    );
    COMMIT;
END;
/

-- ── GET fa/deprn-calculate/preview ────────────────────────────────────────────
-- Params: bookTypeCode (required), periodName (next period, e.g. Apr-26)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-calculate/preview',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_total_cost   NUMBER := 0;
    v_total_deprn  NUMBER := 0;
    v_total_reserve NUMBER := 0;
    v_total_nbv    NUMBER := 0;

    CURSOR c IS
        SELECT  a.ASSET_ID,
                a.ASSET_NUMBER,
                a.DESCRIPTION,
                b.BOOK_TYPE_CODE,
                NVL(b.ADJUSTED_COST, 0)                                     AS ADJUSTED_COST,
                NVL(b.SALVAGE_VALUE, 0)                                      AS SALVAGE_VALUE,
                m.METHOD_CODE,
                NVL(m.LIFE_IN_MONTHS, 1)                                    AS LIFE_IN_MONTHS,
                ROUND(
                    CASE
                        WHEN NVL(m.LIFE_IN_MONTHS,0) > 0
                        THEN (NVL(b.ADJUSTED_COST,0) - NVL(b.SALVAGE_VALUE,0))
                             / m.LIFE_IN_MONTHS
                        ELSE 0
                    END, 2
                )                                                             AS DEPRN_AMOUNT,
                NVL(ds.DEPRN_RESERVE, 0)                                    AS PRIOR_RESERVE,
                NVL(ds.YTD_DEPRN,    0)                                     AS PRIOR_YTD_DEPRN
        FROM    RR_FA_BOOKS b
        JOIN    RR_FA_ADDITIONS a  ON a.ASSET_ID      = b.ASSET_ID
        LEFT JOIN RR_FA_METHODS m  ON m.METHOD_ID     = b.METHOD_ID
        LEFT JOIN (
            SELECT ASSET_ID, BOOK_TYPE_CODE, DEPRN_RESERVE, YTD_DEPRN
            FROM   RR_FA_DEPRN_SUMMARY ds1
            WHERE  PERIOD_COUNTER = (
                SELECT MAX(ds2.PERIOD_COUNTER)
                FROM   RR_FA_DEPRN_SUMMARY ds2
                WHERE  ds2.ASSET_ID      = ds1.ASSET_ID
                AND    ds2.BOOK_TYPE_CODE = ds1.BOOK_TYPE_CODE
            )
        ) ds ON ds.ASSET_ID = b.ASSET_ID AND ds.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
        WHERE   b.DATE_INEFFECTIVE IS NULL
        AND     (:bookTypeCode IS NULL OR b.BOOK_TYPE_CODE = :bookTypeCode)
        ORDER BY a.ASSET_NUMBER;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('bookTypeCode', :bookTypeCode);
    APEX_JSON.WRITE('periodName',   :periodName);
    APEX_JSON.OPEN_ARRAY('items');

    FOR r IN c LOOP
        v_total_cost    := v_total_cost    + r.ADJUSTED_COST;
        v_total_deprn   := v_total_deprn   + r.DEPRN_AMOUNT;
        v_total_reserve := v_total_reserve + (r.PRIOR_RESERVE + r.DEPRN_AMOUNT);
        v_total_nbv     := v_total_nbv     + (r.ADJUSTED_COST - r.PRIOR_RESERVE - r.DEPRN_AMOUNT);

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('assetId',       r.ASSET_ID);
        APEX_JSON.WRITE('assetNumber',   r.ASSET_NUMBER);
        APEX_JSON.WRITE('description',   r.DESCRIPTION);
        APEX_JSON.WRITE('bookTypeCode',  r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('methodCode',    r.METHOD_CODE);
        APEX_JSON.WRITE('lifeInMonths',  r.LIFE_IN_MONTHS);
        APEX_JSON.WRITE('adjustedCost',  r.ADJUSTED_COST);
        APEX_JSON.WRITE('salvageValue',  r.SALVAGE_VALUE);
        APEX_JSON.WRITE('deprnAmount',   r.DEPRN_AMOUNT);
        APEX_JSON.WRITE('priorReserve',  r.PRIOR_RESERVE);
        APEX_JSON.WRITE('newReserve',    r.PRIOR_RESERVE + r.DEPRN_AMOUNT);
        APEX_JSON.WRITE('nbv',           r.ADJUSTED_COST - r.PRIOR_RESERVE - r.DEPRN_AMOUNT);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_OBJECT('summary');
    APEX_JSON.WRITE('totalCost',        v_total_cost);
    APEX_JSON.WRITE('totalDeprnAmount', v_total_deprn);
    APEX_JSON.WRITE('totalNewReserve',  v_total_reserve);
    APEX_JSON.WRITE('totalNbv',         v_total_nbv);
    APEX_JSON.CLOSE_OBJECT;

    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    HTP.P(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]',
        p_mimes_allowed => NULL
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET fa/deprn-calculate/preview registered OK');
END;
/

-- ── Template: fa/deprn-calculate ──────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-calculate',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: run and post depreciation for next period'
    );
    COMMIT;
END;
/

-- ── POST fa/deprn-calculate ───────────────────────────────────────────────────
-- Body JSON: { "bookTypeCode": "...", "periodName": "Apr-26", "periodCounter": 24325 }
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-calculate',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body          CLOB := :body_text;
    v_book          VARCHAR2(200);
    v_period_name   VARCHAR2(100);
    v_period_ctr    NUMBER;
    v_inserted      NUMBER := 0;
    v_run_date      DATE   := SYSDATE;
    v_fiscal_year   NUMBER;
    v_period_num    NUMBER;

    CURSOR c_assets IS
        SELECT  a.ASSET_ID,
                b.BOOK_TYPE_CODE,
                NVL(b.ADJUSTED_COST, 0)   AS ADJUSTED_COST,
                NVL(b.SALVAGE_VALUE, 0)   AS SALVAGE_VALUE,
                ROUND(
                    CASE
                        WHEN NVL(m.LIFE_IN_MONTHS,0) > 0
                        THEN (NVL(b.ADJUSTED_COST,0) - NVL(b.SALVAGE_VALUE,0))
                             / m.LIFE_IN_MONTHS
                        ELSE 0
                    END, 2
                )                          AS DEPRN_AMOUNT,
                NVL(ds.DEPRN_RESERVE, 0)  AS PRIOR_RESERVE,
                NVL(ds.YTD_DEPRN, 0)      AS PRIOR_YTD_DEPRN
        FROM    RR_FA_BOOKS b
        JOIN    RR_FA_ADDITIONS a  ON a.ASSET_ID  = b.ASSET_ID
        LEFT JOIN RR_FA_METHODS m  ON m.METHOD_ID = b.METHOD_ID
        LEFT JOIN (
            SELECT ASSET_ID, BOOK_TYPE_CODE, DEPRN_RESERVE, YTD_DEPRN
            FROM   RR_FA_DEPRN_SUMMARY ds1
            WHERE  PERIOD_COUNTER = (
                SELECT MAX(ds2.PERIOD_COUNTER)
                FROM   RR_FA_DEPRN_SUMMARY ds2
                WHERE  ds2.ASSET_ID       = ds1.ASSET_ID
                AND    ds2.BOOK_TYPE_CODE  = ds1.BOOK_TYPE_CODE
            )
        ) ds ON ds.ASSET_ID = b.ASSET_ID AND ds.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
        WHERE   b.DATE_INEFFECTIVE IS NULL
        AND     b.BOOK_TYPE_CODE   = v_book;
BEGIN
    -- Parse JSON body
    v_book        := JSON_VALUE(v_body, '$.bookTypeCode');
    v_period_name := JSON_VALUE(v_body, '$.periodName');
    v_period_ctr  := TO_NUMBER(JSON_VALUE(v_body, '$.periodCounter'));

    IF v_book IS NULL OR v_period_name IS NULL OR v_period_ctr IS NULL THEN
        :status := 400;
        HTP.P('{"success":false,"error":"bookTypeCode, periodName and periodCounter are required"}');
        RETURN;
    END IF;

    -- Get fiscal year + period num from calendar
    BEGIN
        SELECT FISCAL_YEAR, PERIOD_NUM
        INTO   v_fiscal_year, v_period_num
        FROM   RR_FA_CALENDAR_PERIODS
        WHERE  PERIOD_NAME = v_period_name
        AND    ROWNUM = 1;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        v_fiscal_year := EXTRACT(YEAR FROM SYSDATE);
        v_period_num  := TO_NUMBER(TO_CHAR(SYSDATE,'MM'));
    END;

    -- Insert into DEPRN_SUMMARY for each asset
    FOR r IN c_assets LOOP
        -- Skip if already exists for this period
        DECLARE v_exists NUMBER := 0; BEGIN
            SELECT COUNT(*) INTO v_exists
            FROM RR_FA_DEPRN_SUMMARY
            WHERE ASSET_ID = r.ASSET_ID AND BOOK_TYPE_CODE = v_book AND PERIOD_COUNTER = v_period_ctr;
            IF v_exists = 0 THEN
                INSERT INTO RR_FA_DEPRN_SUMMARY (
                    ASSET_ID, BOOK_TYPE_CODE, PERIOD_COUNTER,
                    DEPRN_AMOUNT, YTD_DEPRN, DEPRN_RESERVE,
                    ADJUSTED_COST, DEPRN_RUN_DATE
                ) VALUES (
                    r.ASSET_ID, v_book, v_period_ctr,
                    r.DEPRN_AMOUNT,
                    r.PRIOR_YTD_DEPRN + r.DEPRN_AMOUNT,
                    r.PRIOR_RESERVE   + r.DEPRN_AMOUNT,
                    r.ADJUSTED_COST,
                    v_run_date
                );
                v_inserted := v_inserted + 1;
            END IF;
        END;
    END LOOP;

    -- Insert or update DEPRN_PERIODS for this new period
    DECLARE v_exists NUMBER := 0; BEGIN
        SELECT COUNT(*) INTO v_exists
        FROM RR_FA_DEPRN_PERIODS
        WHERE BOOK_TYPE_CODE = v_book AND PERIOD_COUNTER = v_period_ctr;

        IF v_exists = 0 THEN
            INSERT INTO RR_FA_DEPRN_PERIODS (
                BOOK_TYPE_CODE, PERIOD_COUNTER, PERIOD_NAME,
                FISCAL_YEAR, PERIOD_NUM, PERIOD_OPEN_DATE, DEPRN_RUN
            ) VALUES (
                v_book, v_period_ctr, v_period_name,
                v_fiscal_year, v_period_num,
                TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS".000+00:00"'),
                'Y'
            );
        ELSE
            UPDATE RR_FA_DEPRN_PERIODS
            SET    DEPRN_RUN        = 'Y',
                   PERIOD_CLOSE_DATE = TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS".000+00:00"')
            WHERE  BOOK_TYPE_CODE  = v_book
            AND    PERIOD_COUNTER  = v_period_ctr;
        END IF;
    END;

    COMMIT;

    :status := 200;
    HTP.P('{"success":true,"bookTypeCode":"' || v_book || '","periodName":"' || v_period_name
        || '","periodCounter":' || v_period_ctr
        || ',"assetsProcessed":' || v_inserted || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]',
        p_mimes_allowed => NULL
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST fa/deprn-calculate registered OK');
END;
/
