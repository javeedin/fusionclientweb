-- ============================================================
-- Distribution Combinations — ORDS REST Handlers
-- File: database/ap/rr_dist_combinations_ords.sql
-- Run order: 3rd
-- Base path: /distributions/
-- ============================================================

-- Clean up any existing module to avoid handler conflicts
BEGIN
    ORDS.DELETE_MODULE(p_module_name => 'distributions');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'distributions',
        p_base_path      => '/distributions/',
        p_items_per_page => 1000,
        p_status         => 'PUBLISHED',
        p_comments       => 'Distribution Combinations master data'
    );

    -- ──────────────────────────────────────────────────────────
    -- Template: combinations
    -- ──────────────────────────────────────────────────────────
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'distributions',
        p_pattern     => 'combinations'
    );

    -- GET /distributions/combinations?q=&module=&status=&bu=
    -- Uses source_type_plsql + APEX_JSON (same pattern as /pc/registers)
    -- so that unset query params arrive as NULL in PL/SQL context
    ORDS.DEFINE_HANDLER(
        p_module_name => 'distributions',
        p_pattern     => 'combinations',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    v_clob CLOB;
    CURSOR c IS
        SELECT c.COMBINATION_ID,
               c.COMBINATION_NAME,
               c.BUSINESS_UNIT,
               c.GL_ACCOUNT_CCID,
               c.GL_ACCOUNT_DESC,
               c.MODULE,
               c.DESCRIPTION,
               c.STATUS,
               c.CREATED_BY,
               c.CREATION_DATE,
               c.LAST_UPDATED_BY,
               c.LAST_UPDATE_DATE
        FROM   RR_DIST_COMBINATIONS c
        WHERE  (:q      IS NULL OR UPPER(c.COMBINATION_NAME) LIKE ''%''||UPPER(:q)||''%'')
        AND    (:module IS NULL OR c.MODULE        = :module)
        AND    (:status IS NULL OR c.STATUS        = :status)
        AND    (:bu     IS NULL OR c.BUSINESS_UNIT = :bu)
        ORDER BY c.MODULE, c.COMBINATION_NAME;
BEGIN
    :status_code := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'', TRUE);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR rec IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''combinationId'',   rec.COMBINATION_ID);
        APEX_JSON.WRITE(''combinationName'', rec.COMBINATION_NAME);
        APEX_JSON.WRITE(''businessUnit'',    rec.BUSINESS_UNIT);
        APEX_JSON.WRITE(''glAccountCcid'',   rec.GL_ACCOUNT_CCID);
        APEX_JSON.WRITE(''glAccountDesc'',   rec.GL_ACCOUNT_DESC);
        APEX_JSON.WRITE(''module'',          rec.MODULE);
        APEX_JSON.WRITE(''description'',     rec.DESCRIPTION);
        APEX_JSON.WRITE(''status'',          rec.STATUS);
        APEX_JSON.WRITE(''createdBy'',       rec.CREATED_BY);
        APEX_JSON.WRITE(''creationDate'',    TO_CHAR(rec.CREATION_DATE,    ''YYYY-MM-DD"T"HH24:MI:SS''));
        APEX_JSON.WRITE(''lastUpdatedBy'',   rec.LAST_UPDATED_BY);
        APEX_JSON.WRITE(''lastUpdateDate'',  TO_CHAR(rec.LAST_UPDATE_DATE, ''YYYY-MM-DD"T"HH24:MI:SS''));
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    HTP.PRN(v_clob);
END;
'
    );

    -- POST /distributions/combinations
    ORDS.DEFINE_HANDLER(
        p_module_name => 'distributions',
        p_pattern     => 'combinations',
        p_method      => 'POST',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_body CLOB := :body_text;
BEGIN
    RR_DIST_PKG.create_combination(l_body);
END;
'
    );

    -- ──────────────────────────────────────────────────────────
    -- Template: combinations/:combinationId
    -- ──────────────────────────────────────────────────────────
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'distributions',
        p_pattern     => 'combinations/:combinationId'
    );

    -- PUT /distributions/combinations/:combinationId
    ORDS.DEFINE_HANDLER(
        p_module_name => 'distributions',
        p_pattern     => 'combinations/:combinationId',
        p_method      => 'PUT',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_body CLOB := :body_text;
    l_id   NUMBER := :combinationId;
BEGIN
    RR_DIST_PKG.update_combination(l_id, l_body);
END;
'
    );

    -- DELETE /distributions/combinations/:combinationId
    ORDS.DEFINE_HANDLER(
        p_module_name => 'distributions',
        p_pattern     => 'combinations/:combinationId',
        p_method      => 'DELETE',
        p_source_type => ORDS.source_type_plsql,
        p_source      => '
DECLARE
    l_id NUMBER := :combinationId;
BEGIN
    RR_DIST_PKG.delete_combination(l_id);
END;
'
    );

    COMMIT;
END;
/
