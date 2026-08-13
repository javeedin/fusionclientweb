-- ============================================================
-- Period Status Update — Open / Close a period
-- PUT /reerp/gl/periodstatus
--
-- Updates RR_ACCOUNTING_PERIODS_STATUS (local APEX table only).
-- Does NOT call Oracle Fusion.
--
-- Table unique key: (PERIOD_NAME_ID, APPLICATION_ID, LEDGER_ID)
--   PERIOD_NAME_ID  — e.g. '16_Apr-26'  (set_num_PeriodName)
--   APPLICATION_ID  — 101=GL, 200=AP, 222=AR, 401=INV
--   LEDGER_ID       — numeric (matched implicitly via APPLICATION_ID)
--
-- Request body:
--   { "periodName": "Apr-26", "app": "AP", "action": "OPEN" | "CLOSE" }
--
-- Response:
--   { "success": true, "message": "...", "rows": N }
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/periodstatus',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Open or Close an accounting period in RR_ACCOUNTING_PERIODS_STATUS',
        p_source         => q'[
DECLARE
    l_body        CLOB    := :body_text;
    l_period_name VARCHAR2(100);   -- e.g. 'Apr-26'
    l_app         VARCHAR2(20);    -- e.g. 'AP'
    l_action      VARCHAR2(20);    -- 'OPEN' or 'CLOSE'
    l_new_status  VARCHAR2(1);     -- 'O' or 'C'
    l_app_id      NUMBER;
    l_rows        NUMBER  := 0;
BEGIN
    -- Parse request body
    SELECT
        JSON_VALUE(l_body, '$.periodName'),
        UPPER(JSON_VALUE(l_body, '$.app')),
        UPPER(JSON_VALUE(l_body, '$.action'))
    INTO l_period_name, l_app, l_action
    FROM dual;

    -- Validate action
    IF l_action NOT IN ('OPEN', 'CLOSE') THEN
        :status_code := 400;
        HTP.PRN('{"success":false,"message":"action must be OPEN or CLOSE"}');
        RETURN;
    END IF;

    -- Map CLOSING_STATUS single-char code
    l_new_status := CASE l_action WHEN 'OPEN' THEN 'O' ELSE 'C' END;

    -- Map application short name to APPLICATION_ID
    -- RR_ACCOUNTING_PERIODS_STATUS.APPLICATION_ID values:
    --   101 = General Ledger (GL)
    --   200 = Payables       (AP)
    --   222 = Receivables    (AR)
    --   401 = Inventory      (INV)
    l_app_id := CASE l_app
                    WHEN 'GL'  THEN 101
                    WHEN 'AP'  THEN 200
                    WHEN 'AR'  THEN 222
                    WHEN 'INV' THEN 401
                    ELSE NULL
                END;

    IF l_app_id IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"success":false,"message":"Unknown application code: ' || l_app || '"}');
        RETURN;
    END IF;

    -- Update RR_ACCOUNTING_PERIODS_STATUS
    -- PERIOD_NAME_ID stores the period as '<set_num>_<period_name>' e.g. '16_Apr-26'.
    -- We match on APPLICATION_ID + PERIOD_NAME_ID suffix across all ledgers.
    -- ESCAPE '\' ensures the underscore in the pattern is literal, not a wildcard.
    UPDATE rr_accounting_periods_status
    SET    closing_status   = l_new_status,
           last_update_date = SYSTIMESTAMP
    WHERE  application_id  = l_app_id
      AND  (   period_name_id = l_period_name
            OR period_name_id LIKE '%\_' || l_period_name ESCAPE '\');

    l_rows := SQL%ROWCOUNT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"message":"No period found: ' || l_period_name || ' for app ' || l_app || '"}');
        RETURN;
    END IF;

    COMMIT;
    :status_code := 200;
    HTP.PRN('{"success":true'
         || ',"message":"Period ' || l_period_name || ' ' || l_action || 'ED"'
         || ',"rows":' || l_rows
         || '}');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/
