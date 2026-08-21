-- =============================================================================
-- 35_FA_RETIREMENTS_ACCOUNTING.SQL
--
-- Accounting preview and posting for Asset Retirements
-- GET  reerp/fa/retirements/:retirementId/accounting-preview
--      -> Returns preview of journal entries for the retirement
-- POST reerp/fa/retirements/:retirementId/post-accounting
--      -> Posts the retirement accounting to SLA
-- =============================================================================

CREATE OR REPLACE PACKAGE RR_FA_RETIREMENTS_ACCT_PKG AS
  PROCEDURE GET_RETIREMENT_ACCT_PREVIEW(
    p_retirement_id  IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  );

  PROCEDURE PUT_RETIREMENT_STATUS(
    p_retirement_id  IN VARCHAR2,
    p_status         IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  );
END RR_FA_RETIREMENTS_ACCT_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_RETIREMENTS_ACCT_PKG AS

  PROCEDURE GET_RETIREMENT_ACCT_PREVIEW(
    p_retirement_id  IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  ) IS
    v_asset_id            VARCHAR2(400);
    v_asset_number        VARCHAR2(100);
    v_book_type_code      VARCHAR2(100);
    v_cost_retired        NUMBER;
    v_nbv_retired         NUMBER;
    v_gain_loss_amount    NUMBER;
    v_proceeds_of_sale    NUMBER;
    v_cost_of_removal     NUMBER;
    v_asset_cost_account  VARCHAR2(200);
    v_deprn_account       VARCHAR2(200);
    v_proceeds_account    VARCHAR2(200);
    v_removal_account     VARCHAR2(200);
    v_gain_account        VARCHAR2(200);
    v_loss_account        VARCHAR2(200);
    v_line_num            NUMBER := 1;
  BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;

    -- Fetch retirement and asset details
    BEGIN
      SELECT
        r.ASSET_ID, r.BOOK_TYPE_CODE, r.COST_RETIRED, r.NBV_RETIRED,
        r.GAIN_LOSS_AMOUNT, r.PROCEEDS_OF_SALE, r.COST_OF_REMOVAL,
        r.ASSET_COST_ACCOUNT, r.DEPRN_RESERVE_ACCOUNT, r.PROCEEDS_ACCOUNT,
        r.COST_OF_REMOVAL_ACCOUNT, r.GAIN_ACCOUNT, r.LOSS_ACCOUNT,
        a.ASSET_NUMBER
      INTO
        v_asset_id, v_book_type_code, v_cost_retired, v_nbv_retired,
        v_gain_loss_amount, v_proceeds_of_sale, v_cost_of_removal,
        v_asset_cost_account, v_deprn_account, v_proceeds_account,
        v_removal_account, v_gain_account, v_loss_account,
        v_asset_number
      FROM RR_FA_RETIREMENTS r
      LEFT JOIN RR_FA_ADDITIONS a ON r.ASSET_ID = a.ASSET_ID
      WHERE r.RETIREMENT_ID = p_retirement_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_http_status := 404;
        p_result := '{"success":false,"error":"Retirement record not found"}';
        RETURN;
    END;

    -- Return header info
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('retirementId', p_retirement_id);
    APEX_JSON.WRITE('assetId', v_asset_id);
    APEX_JSON.WRITE('assetNumber', v_asset_number);
    APEX_JSON.WRITE('bookTypeCode', v_book_type_code);

    -- Generate journal lines based on account assignments
    APEX_JSON.OPEN_ARRAY('lines');

    -- Line 1: Debit Depreciation Reserve Account (accumulated depreciation)
    -- Accumulated Depreciation = Cost - NBV
    IF v_deprn_account IS NOT NULL THEN
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('lineNumber', v_line_num);
      APEX_JSON.WRITE('lineType', 'Accumulated Depreciation');
      APEX_JSON.WRITE('accountCombination', v_deprn_account);
      APEX_JSON.WRITE('enteredDr', NVL(v_cost_retired, 0) - NVL(v_nbv_retired, 0));
      APEX_JSON.WRITE('enteredCr', 0);
      APEX_JSON.CLOSE_OBJECT;
      v_line_num := v_line_num + 1;
    END IF;

    -- Line 2: Credit Asset Cost Account (removes the asset cost)
    IF v_asset_cost_account IS NOT NULL THEN
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('lineNumber', v_line_num);
      APEX_JSON.WRITE('lineType', 'Asset Cost');
      APEX_JSON.WRITE('accountCombination', v_asset_cost_account);
      APEX_JSON.WRITE('enteredDr', 0);
      APEX_JSON.WRITE('enteredCr', NVL(v_cost_retired, 0));
      APEX_JSON.CLOSE_OBJECT;
      v_line_num := v_line_num + 1;
    END IF;

    -- Line 3: Debit/Credit Proceeds of Sale Account (positive = money received = credit)
    IF v_proceeds_account IS NOT NULL AND v_proceeds_of_sale != 0 THEN
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('lineNumber', v_line_num);
      APEX_JSON.WRITE('lineType', 'Proceeds of Sale');
      APEX_JSON.WRITE('accountCombination', v_proceeds_account);
      APEX_JSON.WRITE('enteredDr', CASE WHEN v_proceeds_of_sale < 0 THEN ABS(v_proceeds_of_sale) ELSE 0 END);
      APEX_JSON.WRITE('enteredCr', CASE WHEN v_proceeds_of_sale > 0 THEN v_proceeds_of_sale ELSE 0 END);
      APEX_JSON.CLOSE_OBJECT;
      v_line_num := v_line_num + 1;
    END IF;

    -- Line 4: Debit/Credit Cost of Removal Account
    IF v_removal_account IS NOT NULL AND v_cost_of_removal != 0 THEN
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('lineNumber', v_line_num);
      APEX_JSON.WRITE('lineType', 'Cost of Removal');
      APEX_JSON.WRITE('accountCombination', v_removal_account);
      APEX_JSON.WRITE('enteredDr', CASE WHEN v_cost_of_removal > 0 THEN v_cost_of_removal ELSE 0 END);
      APEX_JSON.WRITE('enteredCr', CASE WHEN v_cost_of_removal < 0 THEN ABS(v_cost_of_removal) ELSE 0 END);
      APEX_JSON.CLOSE_OBJECT;
      v_line_num := v_line_num + 1;
    END IF;

    -- Line 5: Debit/Credit Gain/Loss Account
    IF v_gain_loss_amount != 0 THEN
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('lineNumber', v_line_num);
      APEX_JSON.WRITE('lineType', CASE WHEN v_gain_loss_amount > 0 THEN 'Gain' ELSE 'Loss' END);
      APEX_JSON.WRITE('accountCombination', CASE WHEN v_gain_loss_amount > 0 THEN v_gain_account ELSE v_loss_account END);
      APEX_JSON.WRITE('enteredDr', CASE WHEN v_gain_loss_amount < 0 THEN ABS(v_gain_loss_amount) ELSE 0 END);
      APEX_JSON.WRITE('enteredCr', CASE WHEN v_gain_loss_amount > 0 THEN v_gain_loss_amount ELSE 0 END);
      APEX_JSON.CLOSE_OBJECT;
      v_line_num := v_line_num + 1;
    END IF;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    p_http_status := 200;
    p_result      := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;

  EXCEPTION
    WHEN OTHERS THEN
      p_http_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END GET_RETIREMENT_ACCT_PREVIEW;

  PROCEDURE PUT_RETIREMENT_STATUS(
    p_retirement_id  IN VARCHAR2,
    p_status         IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  ) IS
  BEGIN
    UPDATE RR_FA_RETIREMENTS
    SET
      STATUS = p_status,
      LAST_UPDATE_DATE = SYSTIMESTAMP,
      LAST_UPDATED_BY = NVL(SYS_CONTEXT('apex$session','app_user'), 'REACTERP')
    WHERE RETIREMENT_ID = p_retirement_id;

    IF SQL%ROWCOUNT = 0 THEN
      p_http_status := 404;
      p_result := '{"success":false,"error":"Retirement record not found"}';
    ELSE
      COMMIT;
      p_http_status := 200;
      APEX_JSON.INITIALIZE_CLOB_OUTPUT;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('success', TRUE);
      APEX_JSON.WRITE('message', 'Retirement status updated to ' || p_status);
      APEX_JSON.CLOSE_OBJECT;
      p_result := APEX_JSON.GET_CLOB_OUTPUT;
      APEX_JSON.FREE_OUTPUT;
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_http_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END PUT_RETIREMENT_STATUS;

END RR_FA_RETIREMENTS_ACCT_PKG;
/

-- ── GET reerp/fa/retirements/:retirementId/accounting-preview ────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/retirements/:retirementId/accounting-preview', p_method => 'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/retirements/:retirementId/accounting-preview', p_priority => 0, p_etag_type => 'HASH');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/retirements/:retirementId/accounting-preview',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB;
BEGIN
  RR_FA_RETIREMENTS_ACCT_PKG.GET_RETIREMENT_ACCT_PREVIEW(
    p_retirement_id  => :retirementId,
    p_http_status    => v_status,
    p_result         => v_result);
  :status := v_status;
  HTP.P(v_result);
END;
]'
  );
  COMMIT;
END;
/

-- ── PUT reerp/fa/retirements/:retirementId/status ─────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/retirements/:retirementId/status', p_method => 'PUT'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/retirements/:retirementId/status', p_priority => 0, p_etag_type => 'HASH');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/retirements/:retirementId/status',
    p_method         => 'PUT',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB; v_body CLOB; v_new_status VARCHAR2(100);
BEGIN
  v_body := :body_text;
  APEX_JSON.PARSE(v_body);
  v_new_status := APEX_JSON.GET_VARCHAR2(p_path => 'status');

  RR_FA_RETIREMENTS_ACCT_PKG.PUT_RETIREMENT_STATUS(
    p_retirement_id  => :retirementId,
    p_status         => v_new_status,
    p_http_status    => v_status,
    p_result         => v_result);
  :status_code := v_status;
  HTP.P(v_result);
END;
]'
  );
  COMMIT;
END;
/

-- ── Verify the package compiled (returns no rows on success) ──────────────
ALTER PACKAGE RR_FA_RETIREMENTS_ACCT_PKG COMPILE BODY;
SELECT name, type, line, position, text FROM USER_ERRORS
 WHERE name = 'RR_FA_RETIREMENTS_ACCT_PKG' ORDER BY sequence;
