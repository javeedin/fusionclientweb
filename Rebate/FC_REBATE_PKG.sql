-- ============================================================================
-- Package: FC_REBATE_PKG
-- Purpose: Rebate Management - CRUD operations for header and detail records
-- Created: 2026-08-08
-- ============================================================================

CREATE OR REPLACE PACKAGE FC_REBATE_PKG IS

  -- Type definitions for return values
  TYPE rebate_header_type IS RECORD (
    prhm_sys_id NUMBER,
    prhm_comp_code VARCHAR2(12),
    prhm_vendor VARCHAR2(30),
    prhm_group VARCHAR2(30),
    prhm_sm_code VARCHAR2(30),
    prhm_period VARCHAR2(30),
    prhm_dr_main_acnt_code VARCHAR2(12),
    prhm_dr_sub_acnt_code VARCHAR2(12),
    prhm_cr_main_acnt_code VARCHAR2(12),
    prhm_cr_sub_acnt_code VARCHAR2(12),
    prhm_currency VARCHAR2(12),
    prhm_annotation VARCHAR2(2400),
    prhm_appr_status NUMBER,
    prhm_appr_uid VARCHAR2(12),
    prhm_appr_dt DATE,
    prhm_submit_status NUMBER,
    prhm_amd_no NUMBER,
    prhm_amd_dt DATE,
    prhm_amd_user_id VARCHAR2(12),
    prhm_cr_dt DATE,
    prhm_cr_uid VARCHAR2(12),
    prhm_upd_dt DATE,
    prhm_upd_uid VARCHAR2(12)
  );

  -- Procedures

  -- Fetch single rebate with lines as JSON
  PROCEDURE get_rebate_json(
    p_prhm_sys_id IN NUMBER,
    p_json_response OUT CLOB
  );

  -- Fetch all rebates with optional filtering
  PROCEDURE get_all_rebates_json(
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_vendor IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2 DEFAULT NULL,
    p_json_response OUT CLOB
  );

  -- Fetch rebate header only
  PROCEDURE get_rebate_header(
    p_prhm_sys_id IN NUMBER,
    p_header OUT rebate_header_type
  );

  -- Fetch rebate lines for a header
  PROCEDURE get_rebate_lines(
    p_prhm_sys_id IN NUMBER,
    p_lines_json OUT CLOB
  );

  -- Create new rebate header
  PROCEDURE create_rebate_header(
    p_comp_code IN VARCHAR2,
    p_vendor IN VARCHAR2,
    p_group IN VARCHAR2,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2,
    p_dr_main_acnt_code IN VARCHAR2,
    p_dr_sub_acnt_code IN VARCHAR2,
    p_cr_main_acnt_code IN VARCHAR2,
    p_cr_sub_acnt_code IN VARCHAR2,
    p_currency IN VARCHAR2,
    p_annotation IN VARCHAR2 DEFAULT NULL,
    p_cr_uid IN VARCHAR2,
    p_prhm_sys_id OUT NUMBER
  );

  -- Add new line to rebate
  PROCEDURE add_rebate_line(
    p_prhm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2,
    p_dt IN DATE,
    p_rebt_type IN VARCHAR2,
    p_choice_list IN VARCHAR2 DEFAULT NULL,
    p_pm_amt IN NUMBER DEFAULT NULL,
    p_pm_conf_yn IN VARCHAR2 DEFAULT 'N',
    p_pm_remarks IN VARCHAR2 DEFAULT NULL,
    p_ba_amt IN NUMBER DEFAULT NULL,
    p_ba_remarks IN VARCHAR2 DEFAULT NULL,
    p_ba_conf_yn IN VARCHAR2 DEFAULT 'N',
    p_cr_rcvd_yn IN VARCHAR2 DEFAULT 'N',
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_ref IN VARCHAR2 DEFAULT NULL,
    p_rebt_used IN NUMBER DEFAULT NULL,
    p_ba_rcvd_dt IN DATE DEFAULT NULL,
    p_profit_yn IN VARCHAR2 DEFAULT 'N',
    p_ven_recv_yn IN VARCHAR2 DEFAULT 'N',
    p_region IN VARCHAR2 DEFAULT NULL,
    p_jv_yn IN VARCHAR2 DEFAULT 'N',
    p_ref_doc IN VARCHAR2 DEFAULT NULL,
    p_total_amt IN NUMBER DEFAULT NULL,
    p_customer IN VARCHAR2 DEFAULT NULL,
    p_bsns_type IN VARCHAR2 DEFAULT NULL,
    p_cr_uid IN VARCHAR2 DEFAULT NULL,
    p_prdm_sys_id OUT NUMBER
  );

  -- Update rebate line
  PROCEDURE update_rebate_line(
    p_prdm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_dt IN DATE DEFAULT NULL,
    p_rebt_type IN VARCHAR2 DEFAULT NULL,
    p_pm_amt IN NUMBER DEFAULT NULL,
    p_ba_amt IN NUMBER DEFAULT NULL,
    p_upd_uid IN VARCHAR2
  );

  -- Delete rebate line
  PROCEDURE delete_rebate_line(
    p_prdm_sys_id IN NUMBER
  );

  -- Update rebate header
  PROCEDURE update_rebate_header(
    p_prhm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_annotation IN VARCHAR2 DEFAULT NULL,
    p_appr_status IN NUMBER DEFAULT NULL,
    p_appr_uid IN VARCHAR2 DEFAULT NULL,
    p_submit_status IN NUMBER DEFAULT NULL,
    p_amd_no IN NUMBER DEFAULT NULL,
    p_amd_user_id IN VARCHAR2 DEFAULT NULL,
    p_upd_uid IN VARCHAR2
  );

  -- Delete rebate (cascading delete of header and lines)
  PROCEDURE delete_rebate(
    p_prhm_sys_id IN NUMBER
  );

  -- Create complete rebate from JSON
  PROCEDURE create_rebate_with_lines(
    p_json_input IN CLOB,
    p_prhm_sys_id OUT NUMBER,
    p_status OUT VARCHAR2,
    p_message OUT VARCHAR2
  );

END FC_REBATE_PKG;
/

CREATE OR REPLACE PACKAGE BODY FC_REBATE_PKG IS

  -- Helper: Get next sequence value for header
  FUNCTION get_next_header_id RETURN NUMBER IS
    v_id NUMBER;
  BEGIN
    SELECT NVL(MAX(prhm_sys_id), 0) + 1 INTO v_id FROM OT_PM_REBATE_HEAD_MIT;
    RETURN v_id;
  END;

  -- Helper: Get next sequence value for detail
  FUNCTION get_next_detail_id RETURN NUMBER IS
    v_id NUMBER;
  BEGIN
    SELECT NVL(MAX(prdm_sys_id), 0) + 1 INTO v_id FROM OT_PM_REBATE_DETAIL_MIT;
    RETURN v_id;
  END;

  -- ========================================================================
  -- PROCEDURE: get_rebate_json
  -- Purpose: Fetch single rebate with header and lines as JSON
  -- ========================================================================
  PROCEDURE get_rebate_json(
    p_prhm_sys_id IN NUMBER,
    p_json_response OUT CLOB
  ) IS
    v_header CLOB;
    v_lines CLOB;
  BEGIN
    -- Fetch header
    BEGIN
      SELECT JSON_OBJECT(
        'prhm_sys_id' VALUE prhm_sys_id,
        'prhm_comp_code' VALUE prhm_comp_code,
        'prhm_vendor' VALUE prhm_vendor,
        'prhm_group' VALUE prhm_group,
        'prhm_sm_code' VALUE prhm_sm_code,
        'prhm_period' VALUE prhm_period,
        'prhm_dr_main_acnt_code' VALUE prhm_dr_main_acnt_code,
        'prhm_dr_sub_acnt_code' VALUE prhm_dr_sub_acnt_code,
        'prhm_cr_main_acnt_code' VALUE prhm_cr_main_acnt_code,
        'prhm_cr_sub_acnt_code' VALUE prhm_cr_sub_acnt_code,
        'prhm_currency' VALUE prhm_currency,
        'prhm_annotation' VALUE prhm_annotation,
        'prhm_appr_status' VALUE prhm_appr_status,
        'prhm_appr_uid' VALUE prhm_appr_uid,
        'prhm_appr_dt' VALUE TO_CHAR(prhm_appr_dt, 'YYYY-MM-DD HH24:MI:SS'),
        'prhm_submit_status' VALUE prhm_submit_status,
        'prhm_amd_no' VALUE prhm_amd_no,
        'prhm_amd_dt' VALUE TO_CHAR(prhm_amd_dt, 'YYYY-MM-DD'),
        'prhm_amd_user_id' VALUE prhm_amd_user_id,
        'prhm_cr_dt' VALUE TO_CHAR(prhm_cr_dt, 'YYYY-MM-DD HH24:MI:SS'),
        'prhm_cr_uid' VALUE prhm_cr_uid,
        'prhm_upd_dt' VALUE TO_CHAR(prhm_upd_dt, 'YYYY-MM-DD HH24:MI:SS'),
        'prhm_upd_uid' VALUE prhm_upd_uid
      )
      INTO v_header
      FROM OT_PM_REBATE_HEAD_MIT
      WHERE prhm_sys_id = p_prhm_sys_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_json_response := '{"error":"Rebate not found"}';
        RETURN;
    END;

    -- Fetch lines
    BEGIN
      SELECT JSON_ARRAYAGG(
        JSON_OBJECT(
          'prdm_sys_id' VALUE prdm_sys_id,
          'prdm_prhm_sys_id' VALUE prdm_prhm_sys_id,
          'prdm_sm_code' VALUE prdm_sm_code,
          'prdm_dt' VALUE TO_CHAR(prdm_dt, 'YYYY-MM-DD'),
          'prdm_rebt_type' VALUE prdm_rebt_type,
          'prdm_choice_list' VALUE prdm_choice_list,
          'prdm_pm_amt' VALUE prdm_pm_amt,
          'prdm_pm_conf_yn' VALUE prdm_pm_conf_yn,
          'prdm_pm_remarks' VALUE prdm_pm_remarks,
          'prdm_ba_amt' VALUE prdm_ba_amt,
          'prdm_ba_remarks' VALUE prdm_ba_remarks,
          'prdm_ba_conf_yn' VALUE prdm_ba_conf_yn,
          'prdm_cr_rcvd_yn' VALUE prdm_cr_rcvd_yn,
          'prdm_comp_code' VALUE prdm_comp_code,
          'prdm_ref' VALUE prdm_ref,
          'prdm_rebt_used' VALUE prdm_rebt_used,
          'prdm_ba_rcvd_dt' VALUE TO_CHAR(prdm_ba_rcvd_dt, 'YYYY-MM-DD'),
          'prdm_profit_yn' VALUE prdm_profit_yn,
          'prdm_ven_recv_yn' VALUE prdm_ven_recv_yn,
          'prdm_region' VALUE prdm_region,
          'prdm_jv_yn' VALUE prdm_jv_yn,
          'prdm_ref_doc' VALUE prdm_ref_doc,
          'prdm_total_amt' VALUE prdm_total_amt,
          'prdm_customer' VALUE prdm_customer,
          'prdm_bsns_type' VALUE prdm_bsns_type,
          'prdm_cr_dt' VALUE TO_CHAR(prdm_cr_dt, 'YYYY-MM-DD HH24:MI:SS'),
          'prdm_cr_uid' VALUE prdm_cr_uid,
          'prdm_upd_dt' VALUE TO_CHAR(prdm_upd_dt, 'YYYY-MM-DD HH24:MI:SS'),
          'prdm_upd_uid' VALUE prdm_upd_uid
        )
        ORDER BY prdm_sys_id
      )
      INTO v_lines
      FROM OT_PM_REBATE_DETAIL_MIT
      WHERE prdm_prhm_sys_id = p_prhm_sys_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        v_lines := '[]';
    END;

    -- Combine header and lines
    p_json_response := SUBSTR(v_header, 1, LENGTH(v_header) - 1) ||
                      ', "lines": ' || v_lines || '}';

  EXCEPTION
    WHEN OTHERS THEN
      p_json_response := '{"error":"' || SQLERRM || '"}';
  END get_rebate_json;

  -- ========================================================================
  -- PROCEDURE: get_all_rebates_json
  -- Purpose: Fetch all rebates with optional filtering
  -- ========================================================================
  PROCEDURE get_all_rebates_json(
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_vendor IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2 DEFAULT NULL,
    p_json_response OUT CLOB
  ) IS
  BEGIN
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'prhm_sys_id' VALUE prhm_sys_id,
        'prhm_comp_code' VALUE prhm_comp_code,
        'prhm_vendor' VALUE prhm_vendor,
        'prhm_group' VALUE prhm_group,
        'prhm_period' VALUE prhm_period,
        'prhm_currency' VALUE prhm_currency,
        'prhm_appr_status' VALUE prhm_appr_status,
        'prhm_submit_status' VALUE prhm_submit_status,
        'prhm_cr_dt' VALUE TO_CHAR(prhm_cr_dt, 'YYYY-MM-DD')
      )
      ORDER BY prhm_sys_id DESC
    )
    INTO p_json_response
    FROM OT_PM_REBATE_HEAD_MIT
    WHERE (p_comp_code IS NULL OR prhm_comp_code = p_comp_code)
      AND (p_vendor IS NULL OR prhm_vendor = p_vendor)
      AND (p_period IS NULL OR prhm_period = p_period);

  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_json_response := '[]';
    WHEN OTHERS THEN
      p_json_response := '{"error":"' || SQLERRM || '"}';
  END get_all_rebates_json;

  -- ========================================================================
  -- PROCEDURE: get_rebate_header
  -- Purpose: Fetch rebate header record
  -- ========================================================================
  PROCEDURE get_rebate_header(
    p_prhm_sys_id IN NUMBER,
    p_header OUT rebate_header_type
  ) IS
  BEGIN
    SELECT
      prhm_sys_id, prhm_comp_code, prhm_vendor, prhm_group, prhm_sm_code,
      prhm_period, prhm_dr_main_acnt_code, prhm_dr_sub_acnt_code,
      prhm_cr_main_acnt_code, prhm_cr_sub_acnt_code, prhm_currency,
      prhm_annotation, prhm_appr_status, prhm_appr_uid, prhm_appr_dt,
      prhm_submit_status, prhm_amd_no, prhm_amd_dt, prhm_amd_user_id,
      prhm_cr_dt, prhm_cr_uid, prhm_upd_dt, prhm_upd_uid
    INTO p_header
    FROM OT_PM_REBATE_HEAD_MIT
    WHERE prhm_sys_id = p_prhm_sys_id;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      NULL;
  END get_rebate_header;

  -- ========================================================================
  -- PROCEDURE: get_rebate_lines
  -- Purpose: Fetch lines for a rebate header as JSON
  -- ========================================================================
  PROCEDURE get_rebate_lines(
    p_prhm_sys_id IN NUMBER,
    p_lines_json OUT CLOB
  ) IS
  BEGIN
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'prdm_sys_id' VALUE prdm_sys_id,
        'prdm_dt' VALUE TO_CHAR(prdm_dt, 'YYYY-MM-DD'),
        'prdm_rebt_type' VALUE prdm_rebt_type,
        'prdm_pm_amt' VALUE prdm_pm_amt,
        'prdm_ba_amt' VALUE prdm_ba_amt,
        'prdm_total_amt' VALUE prdm_total_amt
      )
      ORDER BY prdm_sys_id
    )
    INTO p_lines_json
    FROM OT_PM_REBATE_DETAIL_MIT
    WHERE prdm_prhm_sys_id = p_prhm_sys_id;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_lines_json := '[]';
  END get_rebate_lines;

  -- ========================================================================
  -- PROCEDURE: create_rebate_header
  -- Purpose: Create new rebate header
  -- ========================================================================
  PROCEDURE create_rebate_header(
    p_comp_code IN VARCHAR2,
    p_vendor IN VARCHAR2,
    p_group IN VARCHAR2,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_period IN VARCHAR2,
    p_dr_main_acnt_code IN VARCHAR2,
    p_dr_sub_acnt_code IN VARCHAR2,
    p_cr_main_acnt_code IN VARCHAR2,
    p_cr_sub_acnt_code IN VARCHAR2,
    p_currency IN VARCHAR2,
    p_annotation IN VARCHAR2 DEFAULT NULL,
    p_cr_uid IN VARCHAR2,
    p_prhm_sys_id OUT NUMBER
  ) IS
  BEGIN
    p_prhm_sys_id := get_next_header_id();

    INSERT INTO OT_PM_REBATE_HEAD_MIT (
      prhm_sys_id, prhm_comp_code, prhm_vendor, prhm_group, prhm_sm_code,
      prhm_period, prhm_dr_main_acnt_code, prhm_dr_sub_acnt_code,
      prhm_cr_main_acnt_code, prhm_cr_sub_acnt_code, prhm_currency,
      prhm_annotation, prhm_cr_uid, prhm_cr_dt
    ) VALUES (
      p_prhm_sys_id, p_comp_code, p_vendor, p_group, p_sm_code,
      p_period, p_dr_main_acnt_code, p_dr_sub_acnt_code,
      p_cr_main_acnt_code, p_cr_sub_acnt_code, p_currency,
      p_annotation, p_cr_uid, SYSDATE
    );

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END create_rebate_header;

  -- ========================================================================
  -- PROCEDURE: add_rebate_line
  -- Purpose: Add line item to rebate
  -- ========================================================================
  PROCEDURE add_rebate_line(
    p_prhm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2,
    p_dt IN DATE,
    p_rebt_type IN VARCHAR2,
    p_choice_list IN VARCHAR2 DEFAULT NULL,
    p_pm_amt IN NUMBER DEFAULT NULL,
    p_pm_conf_yn IN VARCHAR2 DEFAULT 'N',
    p_pm_remarks IN VARCHAR2 DEFAULT NULL,
    p_ba_amt IN NUMBER DEFAULT NULL,
    p_ba_remarks IN VARCHAR2 DEFAULT NULL,
    p_ba_conf_yn IN VARCHAR2 DEFAULT 'N',
    p_cr_rcvd_yn IN VARCHAR2 DEFAULT 'N',
    p_comp_code IN VARCHAR2 DEFAULT NULL,
    p_ref IN VARCHAR2 DEFAULT NULL,
    p_rebt_used IN NUMBER DEFAULT NULL,
    p_ba_rcvd_dt IN DATE DEFAULT NULL,
    p_profit_yn IN VARCHAR2 DEFAULT 'N',
    p_ven_recv_yn IN VARCHAR2 DEFAULT 'N',
    p_region IN VARCHAR2 DEFAULT NULL,
    p_jv_yn IN VARCHAR2 DEFAULT 'N',
    p_ref_doc IN VARCHAR2 DEFAULT NULL,
    p_total_amt IN NUMBER DEFAULT NULL,
    p_customer IN VARCHAR2 DEFAULT NULL,
    p_bsns_type IN VARCHAR2 DEFAULT NULL,
    p_cr_uid IN VARCHAR2 DEFAULT NULL,
    p_prdm_sys_id OUT NUMBER
  ) IS
  BEGIN
    p_prdm_sys_id := get_next_detail_id();

    INSERT INTO OT_PM_REBATE_DETAIL_MIT (
      prdm_sys_id, prdm_prhm_sys_id, prdm_sm_code, prdm_dt, prdm_rebt_type,
      prdm_choice_list, prdm_pm_amt, prdm_pm_conf_yn, prdm_pm_remarks,
      prdm_ba_amt, prdm_ba_remarks, prdm_ba_conf_yn, prdm_cr_rcvd_yn,
      prdm_comp_code, prdm_ref, prdm_rebt_used, prdm_ba_rcvd_dt,
      prdm_profit_yn, prdm_ven_recv_yn, prdm_region, prdm_jv_yn,
      prdm_ref_doc, prdm_total_amt, prdm_customer, prdm_bsns_type,
      prdm_cr_uid, prdm_cr_dt
    ) VALUES (
      p_prdm_sys_id, p_prhm_sys_id, p_sm_code, p_dt, p_rebt_type,
      p_choice_list, p_pm_amt, p_pm_conf_yn, p_pm_remarks,
      p_ba_amt, p_ba_remarks, p_ba_conf_yn, p_cr_rcvd_yn,
      p_comp_code, p_ref, p_rebt_used, p_ba_rcvd_dt,
      p_profit_yn, p_ven_recv_yn, p_region, p_jv_yn,
      p_ref_doc, p_total_amt, p_customer, p_bsns_type,
      p_cr_uid, SYSDATE
    );

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END add_rebate_line;

  -- ========================================================================
  -- PROCEDURE: update_rebate_line
  -- Purpose: Update line item fields
  -- ========================================================================
  PROCEDURE update_rebate_line(
    p_prdm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_dt IN DATE DEFAULT NULL,
    p_rebt_type IN VARCHAR2 DEFAULT NULL,
    p_pm_amt IN NUMBER DEFAULT NULL,
    p_ba_amt IN NUMBER DEFAULT NULL,
    p_upd_uid IN VARCHAR2
  ) IS
  BEGIN
    UPDATE OT_PM_REBATE_DETAIL_MIT
    SET
      prdm_sm_code = NVL(p_sm_code, prdm_sm_code),
      prdm_dt = NVL(p_dt, prdm_dt),
      prdm_rebt_type = NVL(p_rebt_type, prdm_rebt_type),
      prdm_pm_amt = NVL(p_pm_amt, prdm_pm_amt),
      prdm_ba_amt = NVL(p_ba_amt, prdm_ba_amt),
      prdm_upd_uid = p_upd_uid,
      prdm_upd_dt = SYSDATE
    WHERE prdm_sys_id = p_prdm_sys_id;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END update_rebate_line;

  -- ========================================================================
  -- PROCEDURE: delete_rebate_line
  -- Purpose: Delete single line item
  -- ========================================================================
  PROCEDURE delete_rebate_line(
    p_prdm_sys_id IN NUMBER
  ) IS
  BEGIN
    DELETE FROM OT_PM_REBATE_DETAIL_MIT WHERE prdm_sys_id = p_prdm_sys_id;
    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END delete_rebate_line;

  -- ========================================================================
  -- PROCEDURE: update_rebate_header
  -- Purpose: Update header fields
  -- ========================================================================
  PROCEDURE update_rebate_header(
    p_prhm_sys_id IN NUMBER,
    p_sm_code IN VARCHAR2 DEFAULT NULL,
    p_annotation IN VARCHAR2 DEFAULT NULL,
    p_appr_status IN NUMBER DEFAULT NULL,
    p_appr_uid IN VARCHAR2 DEFAULT NULL,
    p_submit_status IN NUMBER DEFAULT NULL,
    p_amd_no IN NUMBER DEFAULT NULL,
    p_amd_user_id IN VARCHAR2 DEFAULT NULL,
    p_upd_uid IN VARCHAR2
  ) IS
  BEGIN
    UPDATE OT_PM_REBATE_HEAD_MIT
    SET
      prhm_sm_code = NVL(p_sm_code, prhm_sm_code),
      prhm_annotation = NVL(p_annotation, prhm_annotation),
      prhm_appr_status = NVL(p_appr_status, prhm_appr_status),
      prhm_appr_uid = NVL(p_appr_uid, prhm_appr_uid),
      prhm_submit_status = NVL(p_submit_status, prhm_submit_status),
      prhm_amd_no = NVL(p_amd_no, prhm_amd_no),
      prhm_amd_user_id = NVL(p_amd_user_id, prhm_amd_user_id),
      prhm_upd_uid = p_upd_uid,
      prhm_upd_dt = SYSDATE
    WHERE prhm_sys_id = p_prhm_sys_id;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END update_rebate_header;

  -- ========================================================================
  -- PROCEDURE: delete_rebate
  -- Purpose: Delete rebate header and all related lines (cascading)
  -- ========================================================================
  PROCEDURE delete_rebate(
    p_prhm_sys_id IN NUMBER
  ) IS
  BEGIN
    DELETE FROM OT_PM_REBATE_DETAIL_MIT WHERE prdm_prhm_sys_id = p_prhm_sys_id;
    DELETE FROM OT_PM_REBATE_HEAD_MIT WHERE prhm_sys_id = p_prhm_sys_id;
    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END delete_rebate;

  -- ========================================================================
  -- PROCEDURE: create_rebate_with_lines
  -- Purpose: Create rebate header and lines from JSON in single transaction
  -- ========================================================================
  PROCEDURE create_rebate_with_lines(
    p_json_input IN CLOB,
    p_prhm_sys_id OUT NUMBER,
    p_status OUT VARCHAR2,
    p_message OUT VARCHAR2
  ) IS
    v_prdm_sys_id NUMBER;
    v_line_count INTEGER;
  BEGIN
    p_status := 'ERROR';
    p_message := '';

    -- Create header from JSON
    create_rebate_header(
      p_comp_code => JSON_VALUE(p_json_input, '$.prhm_comp_code'),
      p_vendor => JSON_VALUE(p_json_input, '$.prhm_vendor'),
      p_group => JSON_VALUE(p_json_input, '$.prhm_group'),
      p_sm_code => JSON_VALUE(p_json_input, '$.prhm_sm_code'),
      p_period => JSON_VALUE(p_json_input, '$.prhm_period'),
      p_dr_main_acnt_code => JSON_VALUE(p_json_input, '$.prhm_dr_main_acnt_code'),
      p_dr_sub_acnt_code => JSON_VALUE(p_json_input, '$.prhm_dr_sub_acnt_code'),
      p_cr_main_acnt_code => JSON_VALUE(p_json_input, '$.prhm_cr_main_acnt_code'),
      p_cr_sub_acnt_code => JSON_VALUE(p_json_input, '$.prhm_cr_sub_acnt_code'),
      p_currency => JSON_VALUE(p_json_input, '$.prhm_currency'),
      p_annotation => JSON_VALUE(p_json_input, '$.prhm_annotation'),
      p_cr_uid => JSON_VALUE(p_json_input, '$.prhm_cr_uid'),
      p_prhm_sys_id => p_prhm_sys_id
    );

    -- Add lines from JSON array
    FOR rec IN (
      SELECT
        JSON_VALUE(line, '$.prdm_sm_code') AS prdm_sm_code,
        JSON_VALUE(line, '$.prdm_dt') AS prdm_dt,
        JSON_VALUE(line, '$.prdm_rebt_type') AS prdm_rebt_type,
        JSON_VALUE(line, '$.prdm_pm_amt' RETURNING NUMBER) AS prdm_pm_amt,
        JSON_VALUE(line, '$.prdm_ba_amt' RETURNING NUMBER) AS prdm_ba_amt,
        JSON_VALUE(line, '$.prdm_total_amt' RETURNING NUMBER) AS prdm_total_amt,
        JSON_VALUE(line, '$.prdm_customer') AS prdm_customer,
        JSON_VALUE(line, '$.prdm_choice_list') AS prdm_choice_list,
        JSON_VALUE(line, '$.prdm_cr_uid') AS prdm_cr_uid
      FROM JSON_TABLE(
        p_json_input, '$.lines[*]'
        COLUMNS (line VARCHAR2(4000) FORMAT JSON PATH '$')
      )
    ) LOOP
      add_rebate_line(
        p_prhm_sys_id => p_prhm_sys_id,
        p_sm_code => rec.prdm_sm_code,
        p_dt => TO_DATE(rec.prdm_dt, 'YYYY-MM-DD'),
        p_rebt_type => rec.prdm_rebt_type,
        p_pm_amt => rec.prdm_pm_amt,
        p_ba_amt => rec.prdm_ba_amt,
        p_total_amt => rec.prdm_total_amt,
        p_customer => rec.prdm_customer,
        p_choice_list => rec.prdm_choice_list,
        p_cr_uid => rec.prdm_cr_uid,
        p_prdm_sys_id => v_prdm_sys_id
      );
      v_line_count := NVL(v_line_count, 0) + 1;
    END LOOP;

    p_status := 'SUCCESS';
    p_message := 'Rebate created with ' || NVL(v_line_count, 0) || ' lines';

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status := 'ERROR';
      p_message := SQLERRM;
  END create_rebate_with_lines;

END FC_REBATE_PKG;
/
