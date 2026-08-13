-- ============================================================
-- 12_FA_DEPRN_CALCULATE.SQL  (v2 — no nested functions)
-- GET reerp/fa/deprn-periods/current
-- Returns last-run period + open (next) period per book
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/current',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/current'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/current',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: current depreciation period status per book'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-periods/current',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_first  BOOLEAN := TRUE;

    -- last run period fields
    v_last_counter  VARCHAR2(400);
    v_last_name     VARCHAR2(400);
    v_last_fy       VARCHAR2(400);
    v_last_pnum     VARCHAR2(400);
    v_last_close    VARCHAR2(400);
    v_last_upd      VARCHAR2(400);

    -- open (next) period fields
    v_open_counter  VARCHAR2(400);
    v_open_name     VARCHAR2(400);
    v_open_fy       VARCHAR2(400);
    v_open_pnum     VARCHAR2(400);
    v_open_open     VARCHAR2(400);
    v_open_close    VARCHAR2(400);
    v_open_run      VARCHAR2(400);

    v_max_run       VARCHAR2(400);

    CURSOR c_books IS
        SELECT DISTINCT BOOK_TYPE_CODE
        FROM   RR_FA_DEPRN_PERIODS
        WHERE  (:bookTypeCode IS NULL OR BOOK_TYPE_CODE = :bookTypeCode)
        ORDER BY BOOK_TYPE_CODE;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');

    FOR b IN c_books LOOP

        -- ── Find max period_counter where DEPRN_RUN = 'Y' ──
        SELECT MAX(PERIOD_COUNTER)
        INTO   v_max_run
        FROM   RR_FA_DEPRN_PERIODS
        WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
        AND    DEPRN_RUN = 'Y';

        -- ── Last run period ──
        v_last_counter := NULL; v_last_name := NULL; v_last_fy := NULL;
        v_last_pnum    := NULL; v_last_close := NULL; v_last_upd := NULL;

        IF v_max_run IS NOT NULL THEN
            BEGIN
                SELECT PERIOD_COUNTER, PERIOD_NAME, FISCAL_YEAR,
                       PERIOD_NUM, PERIOD_CLOSE_DATE, LAST_UPDATE_DATE
                INTO   v_last_counter, v_last_name, v_last_fy,
                       v_last_pnum, v_last_close, v_last_upd
                FROM   RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE  = b.BOOK_TYPE_CODE
                AND    PERIOD_COUNTER  = v_max_run
                AND    ROWNUM = 1;
            EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
            END;
        END IF;

        -- ── Open period (next after last run, or first if never run) ──
        v_open_counter := NULL; v_open_name := NULL; v_open_fy := NULL;
        v_open_pnum    := NULL; v_open_open := NULL;
        v_open_close   := NULL; v_open_run  := NULL;

        BEGIN
            IF v_max_run IS NULL THEN
                -- Never run: take earliest period
                SELECT PERIOD_COUNTER, PERIOD_NAME, FISCAL_YEAR, PERIOD_NUM,
                       PERIOD_OPEN_DATE, PERIOD_CLOSE_DATE, DEPRN_RUN
                INTO   v_open_counter, v_open_name, v_open_fy, v_open_pnum,
                       v_open_open, v_open_close, v_open_run
                FROM   RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
                AND    PERIOD_COUNTER = (
                    SELECT MIN(PERIOD_COUNTER) FROM RR_FA_DEPRN_PERIODS
                    WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE)
                AND    ROWNUM = 1;
            ELSE
                -- Next period after last run
                SELECT PERIOD_COUNTER, PERIOD_NAME, FISCAL_YEAR, PERIOD_NUM,
                       PERIOD_OPEN_DATE, PERIOD_CLOSE_DATE, DEPRN_RUN
                INTO   v_open_counter, v_open_name, v_open_fy, v_open_pnum,
                       v_open_open, v_open_close, v_open_run
                FROM   RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
                AND    TO_NUMBER(PERIOD_COUNTER) = TO_NUMBER(v_max_run) + 1
                AND    ROWNUM = 1;
            END IF;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
        END;

        -- ── Emit JSON ──
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bookTypeCode',         b.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('lastRunPeriodCounter', v_last_counter);
        APEX_JSON.WRITE('lastRunPeriodName',    v_last_name);
        APEX_JSON.WRITE('lastRunFiscalYear',    v_last_fy);
        APEX_JSON.WRITE('lastRunPeriodNum',     v_last_pnum);
        APEX_JSON.WRITE('lastRunCloseDate',     v_last_close);
        APEX_JSON.WRITE('lastDeprnDate',        v_last_upd);
        APEX_JSON.WRITE('openPeriodCounter',    v_open_counter);
        APEX_JSON.WRITE('openPeriodName',       v_open_name);
        APEX_JSON.WRITE('openFiscalYear',       v_open_fy);
        APEX_JSON.WRITE('openPeriodNum',        v_open_pnum);
        APEX_JSON.WRITE('openPeriodOpenDate',   v_open_open);
        APEX_JSON.WRITE('openPeriodCloseDate',  v_open_close);
        APEX_JSON.WRITE('deprnRun',             v_open_run);
        APEX_JSON.CLOSE_OBJECT;

    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
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
    DBMS_OUTPUT.PUT_LINE('fa/deprn-periods/current registered OK');
END;
/
