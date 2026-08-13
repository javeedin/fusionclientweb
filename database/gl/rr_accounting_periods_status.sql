-- ============================================================================
-- Table: RR_ACCOUNTING_PERIODS_STATUS
-- Description: Stores accounting period status data synced from Oracle Fusion
-- ============================================================================

-- Drop table if exists (comment out in production)
-- DROP TABLE rr_accounting_periods_status;

CREATE TABLE rr_accounting_periods_status (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_name_id          VARCHAR2(100) NOT NULL,
    application_id          NUMBER NOT NULL,
    ledger_id               NUMBER NOT NULL,
    closing_status          VARCHAR2(10) NOT NULL,  -- O=Open, C=Closed, F=Future, N=Never Opened, P=Permanently Closed
    end_date                DATE,
    start_date              DATE,
    effective_period_number NUMBER,
    period_year             NUMBER,
    period_number           NUMBER,
    adjustment_period_flag  VARCHAR2(1) DEFAULT 'N', -- Y/N
    -- Audit columns
    created_by              VARCHAR2(100) DEFAULT USER,
    creation_date           TIMESTAMP DEFAULT SYSTIMESTAMP,
    last_updated_by         VARCHAR2(100) DEFAULT USER,
    last_update_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    -- Unique constraint on business key
    CONSTRAINT rr_acct_period_status_uk UNIQUE (period_name_id, application_id, ledger_id)
);

-- Create indexes for common queries
CREATE INDEX rr_acct_period_status_ledger_idx ON rr_accounting_periods_status(ledger_id);
CREATE INDEX rr_acct_period_status_app_idx ON rr_accounting_periods_status(application_id);
CREATE INDEX rr_acct_period_status_year_idx ON rr_accounting_periods_status(period_year);
CREATE INDEX rr_acct_period_status_closing_idx ON rr_accounting_periods_status(closing_status);

-- Add comments
COMMENT ON TABLE rr_accounting_periods_status IS 'Accounting period status data synced from Oracle Fusion';
COMMENT ON COLUMN rr_accounting_periods_status.period_name_id IS 'Period name identifier (e.g., 16_Mar-30)';
COMMENT ON COLUMN rr_accounting_periods_status.application_id IS 'Application ID (101=GL, 200=AP, 222=AR, 401=INV)';
COMMENT ON COLUMN rr_accounting_periods_status.ledger_id IS 'Ledger ID from Oracle Fusion';
COMMENT ON COLUMN rr_accounting_periods_status.closing_status IS 'Period status: O=Open, C=Closed, F=Future, N=Never Opened, P=Permanently Closed';
COMMENT ON COLUMN rr_accounting_periods_status.effective_period_number IS 'Effective period number for sorting (YYYYMMPP format)';
COMMENT ON COLUMN rr_accounting_periods_status.adjustment_period_flag IS 'Y if adjustment period, N otherwise';

-- ============================================================================
-- Procedure: RR_SYNC_PERIOD_STATUS
-- Description: Upsert (merge) period status data - insert or update
-- ============================================================================

CREATE OR REPLACE PROCEDURE rr_sync_period_status (
    p_period_name_id          IN VARCHAR2,
    p_application_id          IN NUMBER,
    p_ledger_id               IN NUMBER,
    p_closing_status          IN VARCHAR2,
    p_end_date                IN VARCHAR2,
    p_start_date              IN VARCHAR2,
    p_effective_period_number IN NUMBER,
    p_period_year             IN NUMBER,
    p_period_number           IN NUMBER,
    p_adjustment_period_flag  IN VARCHAR2 DEFAULT 'N'
) AS
BEGIN
    MERGE INTO rr_accounting_periods_status tgt
    USING (
        SELECT
            p_period_name_id AS period_name_id,
            p_application_id AS application_id,
            p_ledger_id AS ledger_id
        FROM dual
    ) src
    ON (
        tgt.period_name_id = src.period_name_id
        AND tgt.application_id = src.application_id
        AND tgt.ledger_id = src.ledger_id
    )
    WHEN MATCHED THEN
        UPDATE SET
            tgt.closing_status = p_closing_status,
            tgt.end_date = TO_DATE(p_end_date, 'YYYY-MM-DD'),
            tgt.start_date = TO_DATE(p_start_date, 'YYYY-MM-DD'),
            tgt.effective_period_number = p_effective_period_number,
            tgt.period_year = p_period_year,
            tgt.period_number = p_period_number,
            tgt.adjustment_period_flag = p_adjustment_period_flag,
            tgt.last_updated_by = USER,
            tgt.last_update_date = SYSTIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            period_name_id,
            application_id,
            ledger_id,
            closing_status,
            end_date,
            start_date,
            effective_period_number,
            period_year,
            period_number,
            adjustment_period_flag
        ) VALUES (
            p_period_name_id,
            p_application_id,
            p_ledger_id,
            p_closing_status,
            TO_DATE(p_end_date, 'YYYY-MM-DD'),
            TO_DATE(p_start_date, 'YYYY-MM-DD'),
            p_effective_period_number,
            p_period_year,
            p_period_number,
            p_adjustment_period_flag
        );

    COMMIT;
END rr_sync_period_status;
/

-- ============================================================================
-- Procedure: RR_SYNC_PERIOD_STATUS_BATCH
-- Description: Batch upsert period status data from JSON array
-- ============================================================================

CREATE OR REPLACE PROCEDURE rr_sync_period_status_batch (
    p_json_data IN CLOB
) AS
    l_count NUMBER := 0;
BEGIN
    -- Parse JSON array and process each item
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
            CASE WHEN jt.adjustment_period_flag = 'true' THEN 'Y' ELSE 'N' END AS adjustment_period_flag
        FROM JSON_TABLE(
            p_json_data,
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
        rr_sync_period_status(
            p_period_name_id          => rec.period_name_id,
            p_application_id          => rec.application_id,
            p_ledger_id               => rec.ledger_id,
            p_closing_status          => rec.closing_status,
            p_end_date                => rec.end_date,
            p_start_date              => rec.start_date,
            p_effective_period_number => rec.effective_period_number,
            p_period_year             => rec.period_year,
            p_period_number           => rec.period_number,
            p_adjustment_period_flag  => rec.adjustment_period_flag
        );
        l_count := l_count + 1;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('Processed ' || l_count || ' period status records.');
END rr_sync_period_status_batch;
/

-- ============================================================================
-- Grant permissions (adjust schema/user as needed)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON rr_accounting_periods_status TO your_app_user;
-- GRANT EXECUTE ON rr_sync_period_status TO your_app_user;
-- GRANT EXECUTE ON rr_sync_period_status_batch TO your_app_user;
