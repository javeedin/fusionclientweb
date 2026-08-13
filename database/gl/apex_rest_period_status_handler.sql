-- ============================================================================
-- APEX REST Handler for POST /gl/periodstatus
-- Copy this code directly into APEX REST Handler (Source section)
-- Use this version when entering code directly in APEX UI (single quotes)
-- ============================================================================

DECLARE
    l_json_data CLOB;
    l_count NUMBER := 0;

    -- Variables to hold each record's data
    v_period_name_id          VARCHAR2(100);
    v_application_id          NUMBER;
    v_ledger_id               NUMBER;
    v_closing_status          VARCHAR2(10);
    v_end_date                VARCHAR2(20);
    v_start_date              VARCHAR2(20);
    v_effective_period_number NUMBER;
    v_period_year             NUMBER;
    v_period_number           NUMBER;
    v_adjustment_period_flag  VARCHAR2(1);
BEGIN
    -- Get the JSON body
    l_json_data := :body_text;

    -- Process each item in the JSON array
    FOR rec IN (
        SELECT
            jt.period_name_id,
            jt.application_id,
            jt.ledger_id,
            jt.closing_status,
            jt.end_date,
            jt.start_date,
            jt.effective_period_number,
            jt.period_year,
            jt.period_number,
            CASE
                WHEN LOWER(jt.adjustment_period_flag) = 'true' THEN 'Y'
                ELSE 'N'
            END AS adjustment_period_flag
        FROM JSON_TABLE(
            l_json_data,
            '$.items[*]'
            COLUMNS (
                period_name_id          VARCHAR2(100) PATH '$.PeriodNameId',
                application_id          NUMBER PATH '$.ApplicationId',
                ledger_id               NUMBER PATH '$.LedgerId',
                closing_status          VARCHAR2(10) PATH '$.ClosingStatus',
                end_date                VARCHAR2(20) PATH '$.EndDate',
                start_date              VARCHAR2(20) PATH '$.StartDate',
                effective_period_number NUMBER PATH '$.EffectivePeriodNumber',
                period_year             NUMBER PATH '$.PeriodYear',
                period_number           NUMBER PATH '$.PeriodNumber',
                adjustment_period_flag  VARCHAR2(10) PATH '$.AdjustmentPeriodFlag'
            )
        ) jt
    ) LOOP
        -- Store values in local variables
        v_period_name_id := rec.period_name_id;
        v_application_id := rec.application_id;
        v_ledger_id := rec.ledger_id;
        v_closing_status := rec.closing_status;
        v_end_date := rec.end_date;
        v_start_date := rec.start_date;
        v_effective_period_number := rec.effective_period_number;
        v_period_year := rec.period_year;
        v_period_number := rec.period_number;
        v_adjustment_period_flag := rec.adjustment_period_flag;

        -- Merge (upsert) each record
        MERGE INTO rr_accounting_periods_status tgt
        USING (
            SELECT
                v_period_name_id AS period_name_id,
                v_application_id AS application_id,
                v_ledger_id AS ledger_id
            FROM dual
        ) src
        ON (
            tgt.period_name_id = src.period_name_id
            AND tgt.application_id = src.application_id
            AND tgt.ledger_id = src.ledger_id
        )
        WHEN MATCHED THEN
            UPDATE SET
                tgt.closing_status = v_closing_status,
                tgt.end_date = TO_DATE(v_end_date, 'YYYY-MM-DD'),
                tgt.start_date = TO_DATE(v_start_date, 'YYYY-MM-DD'),
                tgt.effective_period_number = v_effective_period_number,
                tgt.period_year = v_period_year,
                tgt.period_number = v_period_number,
                tgt.adjustment_period_flag = v_adjustment_period_flag,
                tgt.last_updated_by = USER,
                tgt.last_update_date = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                period_name_id, application_id, ledger_id, closing_status,
                end_date, start_date, effective_period_number,
                period_year, period_number, adjustment_period_flag
            ) VALUES (
                v_period_name_id, v_application_id, v_ledger_id, v_closing_status,
                TO_DATE(v_end_date, 'YYYY-MM-DD'), TO_DATE(v_start_date, 'YYYY-MM-DD'),
                v_effective_period_number, v_period_year, v_period_number,
                v_adjustment_period_flag
            );

        l_count := l_count + 1;
    END LOOP;

    COMMIT;

    -- Return success response
    :status_code := 200;
    HTP.P('{"success": true, "message": "Synced ' || l_count || ' period status records", "count": ' || l_count || '}');

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}');
        ROLLBACK;
END;
