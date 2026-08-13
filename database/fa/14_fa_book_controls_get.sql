-- ============================================================
-- 14_FA_BOOK_CONTROLS_GET.SQL
-- Safely registers GET reerp/fa/book-controls
-- Run this if the GET handler is missing (POST exists but not GET)
-- ============================================================

-- Drop existing GET handler only (leaves POST intact)
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'fa/book-controls',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Register GET handler on the existing template (POST template already exists)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/book-controls',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT BOOK_TYPE_CODE, BOOK_TYPE_NAME, SET_OF_BOOKS_ID,
               BOOK_CLASS, DEPRN_CALENDAR, FISCAL_YEAR_NAME,
               CURRENT_FISCAL_YEAR, GL_POSTING_ALLOWED_FLAG,
               AMORTIZE_FLAG, ALLOW_MASS_CHANGES, ALLOW_REVAL_FLAG,
               ALLOW_CIP_ASSETS_FLAG, LAST_DEPRN_RUN_DATE,
               PRORATE_CALENDAR, DEPRN_STATUS, BOOK_CONTROL_ID
        FROM   RR_FA_BOOK_CONTROLS
        ORDER BY BOOK_TYPE_CODE;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bookTypeCode',         r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('bookTypeName',         r.BOOK_TYPE_NAME);
        APEX_JSON.WRITE('setOfBooksId',         r.SET_OF_BOOKS_ID);
        APEX_JSON.WRITE('bookClass',            r.BOOK_CLASS);
        APEX_JSON.WRITE('deprnCalendar',        r.DEPRN_CALENDAR);
        APEX_JSON.WRITE('fiscalYearName',       r.FISCAL_YEAR_NAME);
        APEX_JSON.WRITE('currentFiscalYear',    r.CURRENT_FISCAL_YEAR);
        APEX_JSON.WRITE('glPostingAllowedFlag', r.GL_POSTING_ALLOWED_FLAG);
        APEX_JSON.WRITE('amortizeFlag',         r.AMORTIZE_FLAG);
        APEX_JSON.WRITE('allowMassChanges',     r.ALLOW_MASS_CHANGES);
        APEX_JSON.WRITE('allowRevalFlag',       r.ALLOW_REVAL_FLAG);
        APEX_JSON.WRITE('allowCipAssetsFlag',   r.ALLOW_CIP_ASSETS_FLAG);
        APEX_JSON.WRITE('lastDeprnRunDate',     r.LAST_DEPRN_RUN_DATE);
        APEX_JSON.WRITE('prorateCalendar',      r.PRORATE_CALENDAR);
        APEX_JSON.WRITE('deprnStatus',          r.DEPRN_STATUS);
        APEX_JSON.WRITE('bookControlId',        r.BOOK_CONTROL_ID);
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
    DBMS_OUTPUT.PUT_LINE('GET fa/book-controls registered OK');
END;
/
