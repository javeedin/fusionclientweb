-- ============================================================
-- APEX REST Handler for GL Journal Lines with Segments
-- GET endpoint to query V_GL_JOURNAL_LINES_SEGMENTS
-- For Account Analysis feature
-- Uses: REERP_ACCOUNT_ANALYSIS_PKG (05_create_account_analysis_pkg.sql)
-- ============================================================

-- NOTE: Run this in APEX SQL Workshop or via ORDS REST Service setup
-- Endpoint: GET /ords/bcldifc/reerp/gl/journallinesegments

BEGIN
    -- Create Template for GL Journal Lines Segments
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'GL Journal Lines with Segments endpoint for Account Analysis'
    );

    -- Create GET Handler - calls package procedure
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get GL Journal Lines with Segments - supports period and ledger filtering',
        p_source         => q'[
BEGIN
    REERP_ACCOUNT_ANALYSIS_PKG.get_journal_lines_segments(
        p_ledger_name   => :ledger_name,
        p_period_names  => :period_names,
        p_company       => :company,
        p_lob           => :lob,
        p_department    => :department,
        p_account       => :account,
        p_sub_account   => :sub_account,
        p_analysis      => :analysis,
        p_intercompany  => :intercompany,
        p_je_source     => :je_source,
        p_je_category   => :je_category,
        p_page_size     => NVL(:page_size, 500),
        p_page_number   => NVL(:page_number, 1)
    );
    :status_code := 200;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );

    -- Create GET Handler for distinct periods
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/periods',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get distinct periods for filter dropdown'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/periods',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct periods',
        p_source         => q'[
BEGIN
    REERP_ACCOUNT_ANALYSIS_PKG.get_distinct_periods;
    :status_code := 200;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );

    -- Create GET Handler for distinct ledgers
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/ledgers',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get distinct ledgers for filter dropdown'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/ledgers',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct ledgers',
        p_source         => q'[
BEGIN
    REERP_ACCOUNT_ANALYSIS_PKG.get_distinct_ledgers;
    :status_code := 200;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );

    -- Create GET Handler for distinct segment values
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/segments',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get distinct segment values for filter dropdowns'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journallinesegments/segments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get distinct segment values',
        p_source         => q'[
BEGIN
    REERP_ACCOUNT_ANALYSIS_PKG.get_distinct_segments;
    :status_code := 200;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );

    -- Create GET Handler for Account Analysis Pivot Data
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/accountanalysis/pivot',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get pivot data for account analysis'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/accountanalysis/pivot',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get account analysis pivot data by periods',
        p_source         => q'[
BEGIN
    REERP_ACCOUNT_ANALYSIS_PKG.get_pivot_data(
        p_ledger_name   => :ledger_name,
        p_period_names  => :period_names,
        p_company       => :company,
        p_lob           => :lob,
        p_department    => :department,
        p_account       => :account,
        p_sub_account   => :sub_account,
        p_analysis      => :analysis,
        p_intercompany  => :intercompany
    );
    :status_code := 200;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );

    COMMIT;
END;
/

-- ============================================================
-- Grant privileges (run as admin if needed)
-- ============================================================
-- GRANT SELECT ON V_GL_JOURNAL_LINES_SEGMENTS TO ORDS_PUBLIC_USER;
-- GRANT EXECUTE ON REERP_ACCOUNT_ANALYSIS_PKG TO ORDS_PUBLIC_USER;
