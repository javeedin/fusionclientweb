-- ============================================================================
-- Package: APEX_REBATE_REST_HANDLER
-- Purpose: APEX REST endpoint handlers for rebate management API
-- Created: 2026-08-08
-- ============================================================================

CREATE OR REPLACE PACKAGE APEX_REBATE_REST_HANDLER IS

  -- GET: List all rebates with optional filtering
  FUNCTION apex_rebate_list(
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_vendor IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB;

  -- GET: Fetch single rebate by ID
  FUNCTION apex_rebate_get(
    p_prhm_sys_id IN NUMBER
  ) RETURN CLOB;

  -- POST: Create new rebate from JSON
  FUNCTION apex_rebate_create_json(
    p_json_input IN CLOB
  ) RETURN CLOB;

  -- PUT: Update rebate header
  FUNCTION apex_rebate_update(
    p_prhm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB;

  -- POST: Add line to rebate
  FUNCTION apex_rebate_add_line(
    p_prhm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB;

  -- PUT: Update rebate line
  FUNCTION apex_rebate_update_line(
    p_prdm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB;

  -- DELETE: Delete rebate and all lines
  FUNCTION apex_rebate_delete(
    p_prhm_sys_id IN NUMBER
  ) RETURN CLOB;

  -- DELETE: Delete single rebate line
  FUNCTION apex_rebate_delete_line(
    p_prdm_sys_id IN NUMBER
  ) RETURN CLOB;

END APEX_REBATE_REST_HANDLER;
/

CREATE OR REPLACE PACKAGE BODY APEX_REBATE_REST_HANDLER IS

  -- ========================================================================
  -- FUNCTION: apex_rebate_list
  -- Purpose: GET /rebate/ - List all rebates with optional filtering
  -- ========================================================================
  FUNCTION apex_rebate_list(
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_vendor IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB IS
    v_response CLOB;
    v_data CLOB;
  BEGIN
    FC_REBATE_PKG.get_all_rebates_json(
      p_comp_code => p_comp_code,
      p_vendor => p_vendor,
      p_period => p_period,
      p_json_response => v_data
    );

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Rebates retrieved successfully',
      'data' VALUE JSON(v_data)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_list;

  -- ========================================================================
  -- FUNCTION: apex_rebate_get
  -- Purpose: GET /rebate/:id - Fetch single rebate by ID
  -- ========================================================================
  FUNCTION apex_rebate_get(
    p_prhm_sys_id IN NUMBER
  ) RETURN CLOB IS
    v_response CLOB;
    v_data CLOB;
  BEGIN
    FC_REBATE_PKG.get_rebate_json(
      p_prhm_sys_id => p_prhm_sys_id,
      p_json_response => v_data
    );

    IF v_data LIKE '%error%' THEN
      v_response := JSON_OBJECT(
        'status' VALUE 'NOT_FOUND',
        'message' VALUE 'Rebate not found',
        'data' VALUE NULL
      );
    ELSE
      v_response := JSON_OBJECT(
        'status' VALUE 'SUCCESS',
        'message' VALUE 'Rebate retrieved successfully',
        'data' VALUE JSON(v_data)
      );
    END IF;

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_get;

  -- ========================================================================
  -- FUNCTION: apex_rebate_create_json
  -- Purpose: POST /rebate/ - Create new rebate from JSON
  -- ========================================================================
  FUNCTION apex_rebate_create_json(
    p_json_input IN CLOB
  ) RETURN CLOB IS
    v_prhm_sys_id NUMBER;
    v_status VARCHAR2(20);
    v_message VARCHAR2(4000);
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.create_rebate_with_lines(
      p_json_input => p_json_input,
      p_prhm_sys_id => v_prhm_sys_id,
      p_status => v_status,
      p_message => v_message
    );

    v_response := JSON_OBJECT(
      'status' VALUE v_status,
      'message' VALUE v_message,
      'data' VALUE JSON_OBJECT('prhm_sys_id' VALUE v_prhm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to create rebate: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_create_json;

  -- ========================================================================
  -- FUNCTION: apex_rebate_update
  -- Purpose: PUT /rebate/:id - Update rebate header
  -- ========================================================================
  FUNCTION apex_rebate_update(
    p_prhm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB IS
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.update_rebate_header(
      p_prhm_sys_id => p_prhm_sys_id,
      p_sm_code => JSON_VALUE(p_json_input, '$.prhm_sm_code'),
      p_annotation => JSON_VALUE(p_json_input, '$.prhm_annotation'),
      p_appr_status => JSON_VALUE(p_json_input, '$.prhm_appr_status' RETURNING NUMBER),
      p_appr_uid => JSON_VALUE(p_json_input, '$.prhm_appr_uid'),
      p_submit_status => JSON_VALUE(p_json_input, '$.prhm_submit_status' RETURNING NUMBER),
      p_amd_no => JSON_VALUE(p_json_input, '$.prhm_amd_no' RETURNING NUMBER),
      p_amd_user_id => JSON_VALUE(p_json_input, '$.prhm_amd_user_id'),
      p_upd_uid => JSON_VALUE(p_json_input, '$.prhm_upd_uid')
    );

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Rebate header updated successfully',
      'data' VALUE JSON_OBJECT('prhm_sys_id' VALUE p_prhm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to update rebate: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_update;

  -- ========================================================================
  -- FUNCTION: apex_rebate_add_line
  -- Purpose: POST /rebate/:id/lines - Add line to rebate
  -- ========================================================================
  FUNCTION apex_rebate_add_line(
    p_prhm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB IS
    v_prdm_sys_id NUMBER;
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.add_rebate_line(
      p_prhm_sys_id => p_prhm_sys_id,
      p_sm_code => JSON_VALUE(p_json_input, '$.prdm_sm_code'),
      p_dt => TO_DATE(JSON_VALUE(p_json_input, '$.prdm_dt'), 'YYYY-MM-DD'),
      p_rebt_type => JSON_VALUE(p_json_input, '$.prdm_rebt_type'),
      p_choice_list => JSON_VALUE(p_json_input, '$.prdm_choice_list'),
      p_pm_amt => JSON_VALUE(p_json_input, '$.prdm_pm_amt' RETURNING NUMBER),
      p_pm_conf_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_pm_conf_yn'), 'N'),
      p_pm_remarks => JSON_VALUE(p_json_input, '$.prdm_pm_remarks'),
      p_ba_amt => JSON_VALUE(p_json_input, '$.prdm_ba_amt' RETURNING NUMBER),
      p_ba_remarks => JSON_VALUE(p_json_input, '$.prdm_ba_remarks'),
      p_ba_conf_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_ba_conf_yn'), 'N'),
      p_cr_rcvd_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_cr_rcvd_yn'), 'N'),
      p_comp_code => JSON_VALUE(p_json_input, '$.prdm_comp_code'),
      p_ref => JSON_VALUE(p_json_input, '$.prdm_ref'),
      p_rebt_used => JSON_VALUE(p_json_input, '$.prdm_rebt_used' RETURNING NUMBER),
      p_ba_rcvd_dt => TO_DATE(JSON_VALUE(p_json_input, '$.prdm_ba_rcvd_dt'), 'YYYY-MM-DD'),
      p_profit_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_profit_yn'), 'N'),
      p_ven_recv_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_ven_recv_yn'), 'N'),
      p_region => JSON_VALUE(p_json_input, '$.prdm_region'),
      p_jv_yn => NVL(JSON_VALUE(p_json_input, '$.prdm_jv_yn'), 'N'),
      p_ref_doc => JSON_VALUE(p_json_input, '$.prdm_ref_doc'),
      p_total_amt => JSON_VALUE(p_json_input, '$.prdm_total_amt' RETURNING NUMBER),
      p_customer => JSON_VALUE(p_json_input, '$.prdm_customer'),
      p_bsns_type => JSON_VALUE(p_json_input, '$.prdm_bsns_type'),
      p_cr_uid => JSON_VALUE(p_json_input, '$.prdm_cr_uid'),
      p_prdm_sys_id => v_prdm_sys_id
    );

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Line added successfully',
      'data' VALUE JSON_OBJECT('prdm_sys_id' VALUE v_prdm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to add line: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_add_line;

  -- ========================================================================
  -- FUNCTION: apex_rebate_update_line
  -- Purpose: PUT /rebate/line/:id - Update rebate line
  -- ========================================================================
  FUNCTION apex_rebate_update_line(
    p_prdm_sys_id IN NUMBER,
    p_json_input IN CLOB
  ) RETURN CLOB IS
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.update_rebate_line(
      p_prdm_sys_id => p_prdm_sys_id,
      p_sm_code => JSON_VALUE(p_json_input, '$.prdm_sm_code'),
      p_dt => TO_DATE(JSON_VALUE(p_json_input, '$.prdm_dt'), 'YYYY-MM-DD'),
      p_rebt_type => JSON_VALUE(p_json_input, '$.prdm_rebt_type'),
      p_pm_amt => JSON_VALUE(p_json_input, '$.prdm_pm_amt' RETURNING NUMBER),
      p_ba_amt => JSON_VALUE(p_json_input, '$.prdm_ba_amt' RETURNING NUMBER),
      p_upd_uid => JSON_VALUE(p_json_input, '$.prdm_upd_uid')
    );

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Line updated successfully',
      'data' VALUE JSON_OBJECT('prdm_sys_id' VALUE p_prdm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to update line: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_update_line;

  -- ========================================================================
  -- FUNCTION: apex_rebate_delete
  -- Purpose: DELETE /rebate/:id - Delete rebate and all lines
  -- ========================================================================
  FUNCTION apex_rebate_delete(
    p_prhm_sys_id IN NUMBER
  ) RETURN CLOB IS
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.delete_rebate(p_prhm_sys_id => p_prhm_sys_id);

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Rebate deleted successfully',
      'data' VALUE JSON_OBJECT('prhm_sys_id' VALUE p_prhm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to delete rebate: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_delete;

  -- ========================================================================
  -- FUNCTION: apex_rebate_delete_line
  -- Purpose: DELETE /rebate/line/:id - Delete single rebate line
  -- ========================================================================
  FUNCTION apex_rebate_delete_line(
    p_prdm_sys_id IN NUMBER
  ) RETURN CLOB IS
    v_response CLOB;
  BEGIN
    FC_REBATE_PKG.delete_rebate_line(p_prdm_sys_id => p_prdm_sys_id);

    v_response := JSON_OBJECT(
      'status' VALUE 'SUCCESS',
      'message' VALUE 'Line deleted successfully',
      'data' VALUE JSON_OBJECT('prdm_sys_id' VALUE p_prdm_sys_id)
    );

    RETURN v_response;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'status' VALUE 'ERROR',
        'message' VALUE 'Failed to delete line: ' || SQLERRM,
        'data' VALUE NULL
      );
  END apex_rebate_delete_line;

END APEX_REBATE_REST_HANDLER;
/
