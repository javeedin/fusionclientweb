-- =====================================================
-- APEX REST Handler for GL Balances
-- Module: reerp, Pattern: gl/balances
-- =====================================================

-- =====================================================
-- 1. CREATE OR UPDATE MODULE (if not exists)
-- =====================================================
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => 'BCLDIFC',
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => 'bcldifc',
        p_auto_rest_auth      => FALSE
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. CREATE REST MODULE
-- =====================================================
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'reerp',
        p_base_path      => '/reerp/',
        p_items_per_page => 1000,
        p_status         => 'PUBLISHED',
        p_comments       => 'ReactERP REST API Module'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN
            NULL; -- Module already exists
        ELSE
            RAISE;
        END IF;
END;
/

-- =====================================================
-- 3. CREATE TEMPLATE FOR GL BALANCES
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'GL Balances / Trial Balance endpoint'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN
            NULL; -- Template already exists
        ELSE
            RAISE;
        END IF;
END;
/

-- =====================================================
-- 4. POST HANDLER - Insert/Update GL Balances
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Insert or update GL balance records',
        p_source         => q'[
DECLARE
    v_json_data     CLOB;
    v_inserted      NUMBER := 0;
    v_updated       NUMBER := 0;
    v_errors        NUMBER := 0;
    v_error_msg     VARCHAR2(4000);
BEGIN
    -- Get the JSON body
    v_json_data := :body_text;

    -- Process the balances
    rr_gl_balances_pkg.process_balances_json(
        p_json_data     => v_json_data,
        p_inserted      => v_inserted,
        p_updated       => v_updated,
        p_errors        => v_errors,
        p_error_msg     => v_error_msg
    );

    -- Return response
    :status_code := 200;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('inserted', v_inserted);
    APEX_JSON.WRITE('updated', v_updated);
    APEX_JSON.WRITE('errors', v_errors);
    APEX_JSON.WRITE('lastError', v_error_msg);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.WRITE('inserted', 0);
        APEX_JSON.WRITE('updated', 0);
        APEX_JSON.WRITE('errors', 1);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET HANDLER - Retrieve GL Balances
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get GL balance records with optional filters',
        p_source         => q'[
SELECT
    balance_id,
    ledger_id,
    period_name,
    period_year,
    period_num,
    period_type,
    actual_flag,
    company,
    lob,
    department,
    account,
    account_desc,
    sub_account,
    analysis,
    intercompany,
    future1,
    future2,
    account_type,
    currency,
    opening_balance,
    period_activity,
    closing_balance,
    debit,
    credit,
    currency_code,
    creation_date,
    last_update_date
FROM rr_gl_balances
WHERE (:ledger_id IS NULL OR ledger_id = TO_NUMBER(:ledger_id))
  AND (:period_name IS NULL OR period_name = :period_name)
  AND (:period_year IS NULL OR period_year = TO_NUMBER(:period_year))
  AND (:company IS NULL OR company = :company)
  AND (:account IS NULL OR account = :account)
  AND (:account_type IS NULL OR account_type = :account_type)
ORDER BY account_type, account, company, department
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. DELETE HANDLER - Delete balances for a period
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances/period',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'GL Balances period operations'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN
            NULL;
        ELSE
            RAISE;
        END IF;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances/period',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Delete GL balances for a specific period',
        p_source         => q'[
DECLARE
    v_deleted   NUMBER := 0;
    v_ledger_id NUMBER;
    v_period_year NUMBER;
BEGIN
    v_ledger_id := TO_NUMBER(:ledger_id);
    v_period_year := TO_NUMBER(:period_year);

    rr_gl_balances_pkg.delete_period_balances(
        p_ledger_id     => v_ledger_id,
        p_period_name   => :period_name,
        p_period_year   => v_period_year,
        p_deleted       => v_deleted
    );

    :status_code := 200;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('deleted', v_deleted);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.WRITE('deleted', 0);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 7. GET SUMMARY - Get Trial Balance Summary
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances/summary',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'GL Balances summary endpoint'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN
            NULL;
        ELSE
            RAISE;
        END IF;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/balances/summary',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get GL balances summary by account type',
        p_source         => q'[
SELECT
    account_type,
    CASE account_type
        WHEN 'A' THEN 'Assets'
        WHEN 'L' THEN 'Liabilities'
        WHEN 'E' THEN 'Equity'
        WHEN 'R' THEN 'Revenue'
        WHEN 'X' THEN 'Expenses'
        ELSE 'Other'
    END as account_type_name,
    COUNT(*) as account_count,
    SUM(opening_balance) as total_opening,
    SUM(debit) as total_debit,
    SUM(credit) as total_credit,
    SUM(closing_balance) as total_closing,
    SUM(period_activity) as total_activity
FROM rr_gl_balances
WHERE ledger_id = TO_NUMBER(:ledger_id)
  AND period_name = :period_name
  AND period_year = TO_NUMBER(:period_year)
GROUP BY account_type
ORDER BY
    CASE account_type
        WHEN 'A' THEN 1
        WHEN 'L' THEN 2
        WHEN 'E' THEN 3
        WHEN 'R' THEN 4
        WHEN 'X' THEN 5
        ELSE 6
    END
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 8. GRANT PERMISSIONS (if needed)
-- =====================================================
-- GRANT EXECUTE ON rr_gl_balances_pkg TO APEX_PUBLIC_USER;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON rr_gl_balances TO APEX_PUBLIC_USER;

COMMIT;
/

-- =====================================================
-- Verification
-- =====================================================
SELECT 'GL Balances REST endpoints created successfully' as status FROM DUAL;

-- List the handlers
SELECT
    t.uri_template,
    h.source_type,
    h.method
FROM user_ords_templates t
JOIN user_ords_handlers h ON t.id = h.template_id
WHERE t.uri_template LIKE '%balances%'
ORDER BY t.uri_template, h.method;
