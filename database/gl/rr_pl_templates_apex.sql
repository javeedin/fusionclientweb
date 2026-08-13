-- ============================================================================
-- APEX REST Handlers for P&L Template Management
-- ============================================================================
-- Module: pl
-- Base Path: /pl/
-- ============================================================================

-- Create the module
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'pl',
        p_base_path      => '/pl/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'P&L Template Management APIs'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 1. GET /pl/templates - Get all templates
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'templates',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get all P&L templates'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'templates',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_clob CLOB;
BEGIN
    v_clob := rr_pl_template_pkg.get_templates;
    owa_util.mime_header('application/json', FALSE);
    owa_util.http_header_close;
    htp.p(v_clob);
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get list of all P&L templates'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 2. GET /pl/templates/:id - Get template structure
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'templates/:template_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get P&L template structure by ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'templates/:template_id',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_clob CLOB;
BEGIN
    v_clob := rr_pl_template_pkg.get_template_structure(TO_NUMBER(:template_id));
    owa_util.mime_header('application/json', FALSE);
    owa_util.http_header_close;
    htp.p(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        owa_util.mime_header('application/json', FALSE);
        owa_util.http_header_close;
        htp.p('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get template structure with groups, sections, accounts, and totals'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 3. POST /pl/template/create - Create new template
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'template/create',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Create new P&L template'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'template/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_template_id NUMBER;
    v_template_code VARCHAR2(50);
    v_template_name VARCHAR2(200);
    v_description VARCHAR2(1000);
    v_template_type VARCHAR2(50);
BEGIN
    SELECT JSON_VALUE(:body, '$.template_code'),
           JSON_VALUE(:body, '$.template_name'),
           JSON_VALUE(:body, '$.description'),
           NVL(JSON_VALUE(:body, '$.template_type'), 'CUSTOM')
    INTO v_template_code, v_template_name, v_description, v_template_type
    FROM DUAL;

    rr_pl_template_pkg.create_template(
        p_template_code => v_template_code,
        p_template_name => v_template_name,
        p_description   => v_description,
        p_template_type => v_template_type,
        p_template_id   => v_template_id
    );

    :result := '{"success":true,"template_id":' || v_template_id || '}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create a new P&L template'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'template/create',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 4. POST /pl/group/create - Add group to template
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'group/create',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Add group to P&L template'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'group/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_group_id NUMBER;
    v_template_id NUMBER;
    v_group_code VARCHAR2(50);
    v_group_name VARCHAR2(200);
    v_group_label VARCHAR2(200);
    v_group_type VARCHAR2(50);
    v_display_order NUMBER;
    v_sign_convention NUMBER;
BEGIN
    v_template_id := JSON_VALUE(:body, '$.template_id' RETURNING NUMBER);
    v_group_code := JSON_VALUE(:body, '$.group_code');
    v_group_name := JSON_VALUE(:body, '$.group_name');
    v_group_label := JSON_VALUE(:body, '$.group_label');
    v_group_type := JSON_VALUE(:body, '$.group_type');
    v_display_order := JSON_VALUE(:body, '$.display_order' RETURNING NUMBER);
    v_sign_convention := NVL(JSON_VALUE(:body, '$.sign_convention' RETURNING NUMBER), 1);

    rr_pl_template_pkg.add_group(
        p_template_id     => v_template_id,
        p_group_code      => v_group_code,
        p_group_name      => v_group_name,
        p_group_label     => v_group_label,
        p_group_type      => v_group_type,
        p_display_order   => v_display_order,
        p_sign_convention => v_sign_convention,
        p_group_id        => v_group_id
    );

    :result := '{"success":true,"group_id":' || v_group_id || '}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Add a group to a P&L template'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'group/create',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 5. POST /pl/section/create - Add section to group
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'section/create',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Add section to P&L group'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'section/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_section_id NUMBER;
    v_group_id NUMBER;
    v_section_code VARCHAR2(50);
    v_section_name VARCHAR2(200);
    v_section_label VARCHAR2(200);
    v_display_order NUMBER;
BEGIN
    v_group_id := JSON_VALUE(:body, '$.group_id' RETURNING NUMBER);
    v_section_code := JSON_VALUE(:body, '$.section_code');
    v_section_name := JSON_VALUE(:body, '$.section_name');
    v_section_label := JSON_VALUE(:body, '$.section_label');
    v_display_order := JSON_VALUE(:body, '$.display_order' RETURNING NUMBER);

    rr_pl_template_pkg.add_section(
        p_group_id      => v_group_id,
        p_section_code  => v_section_code,
        p_section_name  => v_section_name,
        p_section_label => v_section_label,
        p_display_order => v_display_order,
        p_section_id    => v_section_id
    );

    :result := '{"success":true,"section_id":' || v_section_id || '}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Add a section to a P&L group'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'section/create',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 6. POST /pl/account/assign - Assign account to section
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'account/assign',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Assign account to P&L section'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'account/assign',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_section_id NUMBER;
    v_account_code VARCHAR2(50);
    v_account_from VARCHAR2(50);
    v_account_to VARCHAR2(50);
BEGIN
    v_section_id := JSON_VALUE(:body, '$.section_id' RETURNING NUMBER);
    v_account_code := JSON_VALUE(:body, '$.account_code');
    v_account_from := JSON_VALUE(:body, '$.account_from');
    v_account_to := JSON_VALUE(:body, '$.account_to');

    rr_pl_template_pkg.assign_account(
        p_section_id   => v_section_id,
        p_account_code => v_account_code,
        p_account_from => v_account_from,
        p_account_to   => v_account_to
    );

    :result := '{"success":true}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Assign an account or account range to a section'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'account/assign',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 7. POST /pl/total/create - Add total/calculated row
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'total/create',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Add total to P&L template'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'total/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_template_id NUMBER;
    v_total_code VARCHAR2(50);
    v_total_name VARCHAR2(200);
    v_calculation_formula VARCHAR2(500);
    v_display_order NUMBER;
    v_after_group_code VARCHAR2(50);
BEGIN
    v_template_id := JSON_VALUE(:body, '$.template_id' RETURNING NUMBER);
    v_total_code := JSON_VALUE(:body, '$.total_code');
    v_total_name := JSON_VALUE(:body, '$.total_name');
    v_calculation_formula := JSON_VALUE(:body, '$.calculation_formula');
    v_display_order := JSON_VALUE(:body, '$.display_order' RETURNING NUMBER);
    v_after_group_code := JSON_VALUE(:body, '$.after_group_code');

    rr_pl_template_pkg.add_total(
        p_template_id         => v_template_id,
        p_total_code          => v_total_code,
        p_total_name          => v_total_name,
        p_calculation_formula => v_calculation_formula,
        p_display_order       => v_display_order,
        p_after_group_code    => v_after_group_code
    );

    :result := '{"success":true}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Add a calculated total row to a template'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'total/create',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 8. POST /pl/template/clone - Clone template
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'template/clone',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Clone P&L template'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'template/clone',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_new_template_id NUMBER;
    v_source_template_id NUMBER;
    v_new_template_code VARCHAR2(50);
    v_new_template_name VARCHAR2(200);
BEGIN
    v_source_template_id := JSON_VALUE(:body, '$.source_template_id' RETURNING NUMBER);
    v_new_template_code := JSON_VALUE(:body, '$.new_template_code');
    v_new_template_name := JSON_VALUE(:body, '$.new_template_name');

    rr_pl_template_pkg.clone_template(
        p_source_template_id => v_source_template_id,
        p_new_template_code  => v_new_template_code,
        p_new_template_name  => v_new_template_name,
        p_new_template_id    => v_new_template_id
    );

    :result := '{"success":true,"template_id":' || v_new_template_id || '}';
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Clone an existing template'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'template/clone',
        p_method             => 'POST',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 9. DELETE /pl/template/:id - Delete template
-- ============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'template/:template_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_templates
    SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE template_id = :template_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Template not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Soft delete a template'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'template/:template_id',
        p_method             => 'DELETE',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 10. PUT /pl/group/:id - Update group
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'group/:group_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Update P&L group'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'group/:group_id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_groups
    SET group_name      = NVL(:group_name, group_name),
        group_label     = NVL(:group_label, group_label),
        group_type      = NVL(:group_type, group_type),
        display_order   = NVL(:display_order, display_order),
        sign_convention = NVL(:sign_convention, sign_convention),
        show_subtotal   = NVL(:show_subtotal, show_subtotal),
        subtotal_label  = NVL(:subtotal_label, subtotal_label),
        updated_date    = CURRENT_TIMESTAMP
    WHERE group_id = :group_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Group not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update a group'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'group/:group_id',
        p_method             => 'PUT',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 11. DELETE /pl/group/:id - Delete group
-- ============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'group/:group_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_groups
    SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE group_id = :group_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Group not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Soft delete a group'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'group/:group_id',
        p_method             => 'DELETE',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 12. PUT /pl/section/:id - Update section
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'section/:section_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Update P&L section'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'section/:section_id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_sections
    SET section_name   = NVL(:section_name, section_name),
        section_label  = NVL(:section_label, section_label),
        display_order  = NVL(:display_order, display_order),
        show_subtotal  = NVL(:show_subtotal, show_subtotal),
        subtotal_label = NVL(:subtotal_label, subtotal_label),
        updated_date   = CURRENT_TIMESTAMP
    WHERE section_id = :section_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Section not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update a section'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'section/:section_id',
        p_method             => 'PUT',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 13. DELETE /pl/section/:id - Delete section
-- ============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'section/:section_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_sections
    SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE section_id = :section_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Section not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Soft delete a section'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'section/:section_id',
        p_method             => 'DELETE',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 14. DELETE /pl/account/:id - Remove account from section
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'account/:section_account_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Remove account from section'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'account/:section_account_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_section_accounts
    SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE section_account_id = :section_account_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Account assignment not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Remove account from section'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'account/:section_account_id',
        p_method             => 'DELETE',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 15. PUT /pl/total/:id - Update total
-- ============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'pl',
        p_pattern        => 'total/:total_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Update P&L total'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'total/:total_id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_totals
    SET total_name          = NVL(:total_name, total_name),
        total_label         = NVL(:total_label, total_label),
        calculation_formula = NVL(:calculation_formula, calculation_formula),
        display_order       = NVL(:display_order, display_order),
        after_group_code    = NVL(:after_group_code, after_group_code),
        font_style          = NVL(:font_style, font_style),
        row_style           = NVL(:row_style, row_style),
        updated_date        = CURRENT_TIMESTAMP
    WHERE total_id = :total_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Total not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update a total row'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'total/:total_id',
        p_method             => 'PUT',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

-- ============================================================================
-- 16. DELETE /pl/total/:id - Delete total
-- ============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'pl',
        p_pattern        => 'total/:total_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_source         => q'[
BEGIN
    UPDATE rr_pl_totals
    SET is_active = 'N', updated_date = CURRENT_TIMESTAMP
    WHERE total_id = :total_id;

    IF SQL%ROWCOUNT > 0 THEN
        COMMIT;
        :result := '{"success":true}';
    ELSE
        :result := '{"success":false,"error":"Total not found"}';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        :result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
END;
]',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Soft delete a total'
    );

    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'pl',
        p_pattern            => 'total/:total_id',
        p_method             => 'DELETE',
        p_name               => 'result',
        p_bind_variable_name => 'result',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'STRING',
        p_access_method      => 'OUT'
    );
    COMMIT;
END;
/

COMMIT;
