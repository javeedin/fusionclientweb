-- =====================================================
-- PATCH 06: Add ACCOUNTING_STATUS to RR_AR_ADJUSTMENTS
--           + ORDS handler: PUT /ar/adjustments/:id/accounting-status
-- =====================================================

-- Step 1: Add columns (safe — skip if already exist)
BEGIN
    EXECUTE IMMEDIATE '
        ALTER TABLE RR_AR_ADJUSTMENTS
        ADD (
            ACCOUNTING_STATUS   VARCHAR2(30)   DEFAULT ''Unaccounted'',
            ACCOUNTING_DATE     DATE,
            ACCOUNTED_BY        VARCHAR2(240),
            APPLICATION_ID      NUMBER
        )';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN NULL; -- column already exists
        ELSE RAISE;
        END IF;
END;
/

COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ACCOUNTING_STATUS IS 'Unaccounted | Accounted';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ACCOUNTING_DATE   IS 'Date GL journal was posted for this adjustment';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ACCOUNTED_BY      IS 'User who ran Create Accounting';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.APPLICATION_ID    IS 'RR_AR_RECEIPT_APPLICATIONS.APPLICATION_ID this adjustment belongs to';
/

-- Step 2: Register ORDS handler
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'adjustments/:id/accounting-status');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'adjustments/:id/accounting-status',
        p_comments    => 'Update AR adjustment accounting status after GL posting'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'adjustments/:id/accounting-status',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Set ACCOUNTING_STATUS=Accounted on RR_AR_ADJUSTMENTS after GL post',
        p_source         => '
DECLARE
    l_rows          NUMBER;
    l_accounted_by  VARCHAR2(240);
BEGIN
    -- Read optional accountedBy from JSON body (falls back to DB user)
    BEGIN
        l_accounted_by := JSON_VALUE(:body_text, ''$.accountedBy'');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF l_accounted_by IS NULL OR TRIM(l_accounted_by) IS NULL THEN
        l_accounted_by := USER;
    END IF;

    UPDATE RR_AR_ADJUSTMENTS
    SET    ACCOUNTING_STATUS = ''Accounted'',
           ACCOUNTING_DATE   = SYSDATE,
           ACCOUNTED_BY      = l_accounted_by
    WHERE  ADJUSTMENT_ID = :id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    :status_code := CASE WHEN l_rows > 0 THEN 200 ELSE 404 END;
    HTP.P(''{"status":"'' || CASE WHEN l_rows > 0 THEN ''SUCCESS'' ELSE ''NOT_FOUND'' END ||
          ''","accountingStatus":"Accounted","adjustmentId":'' || :id ||
          '',"updated":'' || l_rows || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P(''{"status":"ERROR","message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- PUT {base}/ar/adjustments/:id/accounting-status
--   Body (optional): {"accountedBy": "username"}
--   Sets ACCOUNTING_STATUS='Accounted', ACCOUNTING_DATE=SYSDATE
--   Returns: {"status":"SUCCESS","accountingStatus":"Accounted","adjustmentId":198013,"updated":1}
-- =====================================================
