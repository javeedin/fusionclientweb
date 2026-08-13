-- ============================================================================
-- APEX REST Data Source: GL Period Status
-- Module: reerp
-- Path: gl/periodstatus
-- ============================================================================

-- ============================================================================
-- OPTION 1: Using ORDS (Oracle REST Data Services) - PL/SQL Handler
-- ============================================================================

-- First, ensure the ORDS module exists
-- This assumes module 'reerp' already exists from previous setup

-- Create REST Handler for POST /gl/periodstatus
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/periodstatus',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync accounting period status data',
        p_source         => '
DECLARE
    l_json_data CLOB;
    l_count NUMBER := 0;
    l_result VARCHAR2(4000);
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
            CASE WHEN jt.adjustment_period_flag = ''true'' THEN ''Y'' ELSE ''N'' END AS adjustment_period_flag
        FROM JSON_TABLE(
            l_json_data,
            ''$.items[*]''
            COLUMNS (
                period_name_id          VARCHAR2(100) PATH ''$.PeriodNameId'',
                application_id          NUMBER PATH ''$.ApplicationId'',
                ledger_id               NUMBER PATH ''$.LedgerId'',
                closing_status          VARCHAR2(10) PATH ''$.ClosingStatus'',
                end_date                VARCHAR2(20) PATH ''$.EndDate'',
                start_date              VARCHAR2(20) PATH ''$.StartDate'',
                effective_period_number NUMBER PATH ''$.EffectivePeriodNumber'',
                period_year             NUMBER PATH ''$.PeriodYear'',
                period_number           NUMBER PATH ''$.PeriodNumber'',
                adjustment_period_flag  VARCHAR2(10) PATH ''$.AdjustmentPeriodFlag''
            )
        ) jt
    ) LOOP
        -- Merge (upsert) each record
        MERGE INTO rr_accounting_periods_status tgt
        USING (
            SELECT
                rec.period_name_id AS period_name_id,
                rec.application_id AS application_id,
                rec.ledger_id AS ledger_id
            FROM dual
        ) src
        ON (
            tgt.period_name_id = src.period_name_id
            AND tgt.application_id = src.application_id
            AND tgt.ledger_id = src.ledger_id
        )
        WHEN MATCHED THEN
            UPDATE SET
                tgt.closing_status = rec.closing_status,
                tgt.end_date = TO_DATE(rec.end_date, ''YYYY-MM-DD''),
                tgt.start_date = TO_DATE(rec.start_date, ''YYYY-MM-DD''),
                tgt.effective_period_number = rec.effective_period_number,
                tgt.period_year = rec.period_year,
                tgt.period_number = rec.period_number,
                tgt.adjustment_period_flag = rec.adjustment_period_flag,
                tgt.last_updated_by = USER,
                tgt.last_update_date = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                period_name_id, application_id, ledger_id, closing_status,
                end_date, start_date, effective_period_number,
                period_year, period_number, adjustment_period_flag
            ) VALUES (
                rec.period_name_id, rec.application_id, rec.ledger_id, rec.closing_status,
                TO_DATE(rec.end_date, ''YYYY-MM-DD''), TO_DATE(rec.start_date, ''YYYY-MM-DD''),
                rec.effective_period_number, rec.period_year, rec.period_number,
                rec.adjustment_period_flag
            );

        l_count := l_count + 1;
    END LOOP;

    COMMIT;

    -- Return success response
    :status_code := 200;
    HTP.P(''{"success": true, "message": "Synced '' || l_count || '' period status records", "count": '' || l_count || ''}'');

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P(''{"success": false, "error": "'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
        ROLLBACK;
END;
'
    );
    COMMIT;
END;
/

-- ============================================================================
-- OPTION 2: Simple REST Handler using AutoREST
-- ============================================================================

-- If you prefer to use AutoREST for simple CRUD operations:
-- This creates GET endpoint automatically
/*
BEGIN
    ORDS.ENABLE_OBJECT(
        p_enabled        => TRUE,
        p_schema         => USER,
        p_object         => 'RR_ACCOUNTING_PERIODS_STATUS',
        p_object_type    => 'TABLE',
        p_object_alias   => 'gl/periodstatus'
    );
    COMMIT;
END;
/
*/

-- ============================================================================
-- GET Handler - Retrieve period statuses with filters
-- ============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/periodstatus',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Get accounting period status data',
        p_source         => '
            SELECT
                id,
                period_name_id AS "PeriodNameId",
                application_id AS "ApplicationId",
                ledger_id AS "LedgerId",
                closing_status AS "ClosingStatus",
                TO_CHAR(end_date, ''YYYY-MM-DD'') AS "EndDate",
                TO_CHAR(start_date, ''YYYY-MM-DD'') AS "StartDate",
                effective_period_number AS "EffectivePeriodNumber",
                period_year AS "PeriodYear",
                period_number AS "PeriodNumber",
                CASE adjustment_period_flag WHEN ''Y'' THEN ''true'' ELSE ''false'' END AS "AdjustmentPeriodFlag",
                creation_date,
                last_update_date
            FROM rr_accounting_periods_status
            WHERE (:ledger_id IS NULL OR ledger_id = :ledger_id)
              AND (:application_id IS NULL OR application_id = :application_id)
              AND (:closing_status IS NULL OR closing_status = :closing_status)
            ORDER BY ledger_id, effective_period_number DESC
        '
    );
    COMMIT;
END;
/

-- ============================================================================
-- Define Parameters for GET Handler
-- ============================================================================

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/periodstatus',
        p_method             => 'GET',
        p_name               => 'ledger_id',
        p_bind_variable_name => 'ledger_id',
        p_source_type        => 'URI',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Filter by Ledger ID'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/periodstatus',
        p_method             => 'GET',
        p_name               => 'application_id',
        p_bind_variable_name => 'application_id',
        p_source_type        => 'URI',
        p_param_type         => 'INT',
        p_access_method      => 'IN',
        p_comments           => 'Filter by Application ID'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'gl/periodstatus',
        p_method             => 'GET',
        p_name               => 'closing_status',
        p_bind_variable_name => 'closing_status',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by Closing Status (O, C, F, N, P)'
    );

    COMMIT;
END;
/

-- ============================================================================
-- Test the endpoints:
-- ============================================================================

/*
-- POST: Sync period status data
curl -X POST "https://your-apex-url/ords/bcldifc/reerp/gl/periodstatus" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
        {
            "PeriodNameId": "16_Mar-30",
            "ApplicationId": 101,
            "LedgerId": 300000083375901,
            "ClosingStatus": "N",
            "EndDate": "2030-03-31",
            "StartDate": "2030-03-31",
            "EffectivePeriodNumber": 20300016,
            "PeriodYear": 2030,
            "PeriodNumber": 16,
            "AdjustmentPeriodFlag": true
        }
    ]
}'

-- GET: Retrieve all period statuses
curl "https://your-apex-url/ords/bcldifc/reerp/gl/periodstatus"

-- GET: Filter by ledger
curl "https://your-apex-url/ords/bcldifc/reerp/gl/periodstatus?ledger_id=300000083375901"

-- GET: Filter by application and status
curl "https://your-apex-url/ords/bcldifc/reerp/gl/periodstatus?application_id=101&closing_status=O"
*/

-- ============================================================================
-- Proxy URL for React App:
-- POST /api/apex/gl/periodstatus
-- GET  /api/apex/gl/periodstatus
-- GET  /api/apex/gl/periodstatus?ledger_id=xxx&application_id=xxx
-- ============================================================================
