-- ============================================================
-- 13_FA_DEPRN_LAST_PERIOD.SQL
-- GET reerp/fa/deprn-periods/last
-- Returns last run period (by MAX PERIOD_OPEN_DATE) and next period
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/last',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/last'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods/last',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: last depreciation period and next period per book using MAX(PERIOD_OPEN_DATE)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-periods/last',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_first           BOOLEAN := TRUE;
    v_book            VARCHAR2(400);
    v_fiscal_year     VARCHAR2(400);
    v_last_period     VARCHAR2(400);
    v_last_open_date  VARCHAR2(400);
    v_next_period     VARCHAR2(400);
    v_deprn_run       VARCHAR2(10);
    v_period_counter  VARCHAR2(400);

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

        -- Last period = the one with MAX(PERIOD_OPEN_DATE)
        BEGIN
            SELECT BOOK_TYPE_CODE,
                   FISCAL_YEAR,
                   PERIOD_NAME,
                   TO_CHAR(PERIOD_OPEN_DATE),
                   DEPRN_RUN,
                   TO_CHAR(PERIOD_COUNTER)
            INTO   v_book,
                   v_fiscal_year,
                   v_last_period,
                   v_last_open_date,
                   v_deprn_run,
                   v_period_counter
            FROM   RR_FA_DEPRN_PERIODS
            WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
            AND    PERIOD_OPEN_DATE = (
                SELECT MAX(PERIOD_OPEN_DATE)
                FROM   RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
            )
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_book := b.BOOK_TYPE_CODE;
            v_fiscal_year := NULL;
            v_last_period := NULL;
            v_last_open_date := NULL;
            v_deprn_run := NULL;
        END;

        -- Next period = ADD_MONTHS on last period name
        IF v_last_period IS NOT NULL THEN
            v_next_period := TO_CHAR(
                ADD_MONTHS(TO_DATE(v_last_period, 'Mon-RR'), 1),
                'Mon-RR'
            );
        ELSE
            v_next_period := NULL;
        END IF;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bookTypeCode',       v_book);
        APEX_JSON.WRITE('fiscalYear',         v_fiscal_year);
        APEX_JSON.WRITE('lastPeriodName',     v_last_period);
        APEX_JSON.WRITE('lastPeriodCounter',  v_period_counter);
        APEX_JSON.WRITE('lastPeriodOpenDate', v_last_open_date);
        APEX_JSON.WRITE('deprnRun',           v_deprn_run);
        APEX_JSON.WRITE('nextPeriodName',     v_next_period);
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
    DBMS_OUTPUT.PUT_LINE('fa/deprn-periods/last registered OK');
END;
/
