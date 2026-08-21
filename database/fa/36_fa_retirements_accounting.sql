-- =============================================================================
-- 36_FA_RETIREMENTS_ACCOUNTING.SQL (v2)
--
-- Accounting preview and posting for Asset Retirements
-- GET  reerp/fa/retirements/:retirementId/accounting-preview
--      -> Returns complete SLA accounting preview matching FA depreciation pattern
-- PUT  reerp/fa/retirements/:retirementId/status
--      -> Updates retirement status to ACCOUNTED
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

  FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN '"' || REPLACE(REPLACE(p, '\', '\\'), '"', '\"') || '"';
  END jstr;

  PROCEDURE GET_RETIREMENT_ACCT_PREVIEW(
    p_retirement_id  IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  ) IS
    v_asset_id            VARCHAR2(400);
    v_asset_number        VARCHAR2(100);
    v_asset_description   VARCHAR2(500);
    v_book_type_code      VARCHAR2(100);
    v_date_retired        VARCHAR2(30);
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
    v_acct_status         VARCHAR2(30);
    v_acct_date           VARCHAR2(30);
    v_company_code        VARCHAR2(30);
    v_ledger_name         VARCHAR2(100);
    v_ledger_id           NUMBER;
    v_currency_code       VARCHAR2(15);
    v_accumulated_deprn   NUMBER;
    v_json_response       CLOB;
  BEGIN
    -- Fetch retirement and asset details
    BEGIN
      SELECT
        r.RETIREMENT_ID, r.ASSET_ID, r.BOOK_TYPE_CODE, r.DATE_RETIRED,
        r.COST_RETIRED, r.NBV_RETIRED, r.GAIN_LOSS_AMOUNT,
        r.PROCEEDS_OF_SALE, r.COST_OF_REMOVAL, r.STATUS,
        NVL(TO_CHAR(r.DATE_RETIRED, 'YYYY-MM-DD'), TO_CHAR(SYSDATE, 'YYYY-MM-DD')),
        r.ASSET_COST_ACCOUNT, r.DEPRN_RESERVE_ACCOUNT, r.PROCEEDS_ACCOUNT,
        r.COST_OF_REMOVAL_ACCOUNT, r.GAIN_ACCOUNT, r.LOSS_ACCOUNT,
        a.ASSET_NUMBER, a.DESCRIPTION
      INTO
        v_retirement_id, v_asset_id, v_book_type_code, v_date_retired,
        v_cost_retired, v_nbv_retired, v_gain_loss_amount,
        v_proceeds_of_sale, v_cost_of_removal, v_acct_status, v_acct_date,
        v_asset_cost_account, v_deprn_account, v_proceeds_account,
        v_removal_account, v_gain_account, v_loss_account,
        v_asset_number, v_asset_description
      FROM RR_FA_RETIREMENTS r
      LEFT JOIN RR_FA_ADDITIONS a ON r.ASSET_ID = a.ASSET_ID
      WHERE r.RETIREMENT_ID = p_retirement_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_http_status := 404;
        p_result := '{"success":false,"error":"Retirement record not found"}';
        RETURN;
    END;

    -- Get book controls (ledger, currency, company)
    BEGIN
      SELECT COMPANY_CODE, LEDGER_NAME, LEDGER_ID, NVL(CURRENCY_CODE, 'AED')
      INTO v_company_code, v_ledger_name, v_ledger_id, v_currency_code
      FROM RR_FA_BOOK_CONTROLS
      WHERE BOOK_TYPE_CODE = v_book_type_code AND ROWNUM = 1;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        v_company_code := NULL;
        v_ledger_name := 'Primary Ledger';
        v_ledger_id := 1;
        v_currency_code := 'AED';
    END;

    -- Calculate gain/loss if not already set
    IF v_gain_loss_amount IS NULL THEN
      v_gain_loss_amount := NVL(v_proceeds_of_sale, 0) - NVL(v_cost_of_removal, 0) - NVL(v_nbv_retired, 0);
    END IF;

    -- Accumulated Depreciation = Cost - NBV
    v_accumulated_deprn := NVL(v_cost_retired, 0) - NVL(v_nbv_retired, 0);

    -- Build complete SLA accounting preview (header + lines) matching FA depreciation pattern
    v_json_response := '{'
      || '"success":true'
      || ',"accountedStatus":' || jstr(v_acct_status)
      || ',"accountedDate":' || NVL(jstr(v_acct_date), 'null')
      || ',"header":{'
      ||   '"moduleName":"FA"'
      ||   ',"source":"Fixed Assets"'
      ||   ',"category":"Retirement"'
      ||   ',"sourceTable":"RR_FA_RETIREMENTS"'
      ||   ',"sourceId":' || jstr(p_retirement_id)
      ||   ',"assetId":' || jstr(v_asset_id)
      ||   ',"sourceNumber":' || jstr(v_asset_number)
      ||   ',"sourceType":"RETIREMENT"'
      ||   ',"eventTypeCode":"FA_RETIREMENT"'
      ||   ',"eventDate":' || jstr(NVL(SUBSTR(v_date_retired, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')))
      ||   ',"accountingDate":' || jstr(NVL(SUBSTR(v_date_retired, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')))
      ||   ',"periodName":"' || UPPER(SUBSTR(TO_CHAR(TO_DATE(NVL(SUBSTR(v_date_retired, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')), 'YYYY-MM-DD'), 'Mon'), 1, 1))
      ||                        LOWER(SUBSTR(TO_CHAR(TO_DATE(NVL(SUBSTR(v_date_retired, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')), 'YYYY-MM-DD'), 'Mon'), 2))
      ||                        TO_CHAR(TO_DATE(NVL(SUBSTR(v_date_retired, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')), 'YYYY-MM-DD'), '-YY') || '"'
      ||   ',"ledgerId":' || NVL(TO_CHAR(v_ledger_id), '1')
      ||   ',"ledgerName":' || jstr(NVL(v_ledger_name, 'Primary Ledger'))
      ||   ',"currencyCode":' || jstr(v_currency_code)
      ||   ',"ledgerCurrency":' || jstr(v_currency_code)
      ||   ',"description":"FA Retirement — ' || REPLACE(v_asset_number, '"', '\"')
      ||                                    ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 200), '"', '\"') || '"'
      ||   ',"bookTypeCode":' || jstr(v_book_type_code)
      ||   ',"assetNumber":' || jstr(v_asset_number)
      ||   ',"assetDescription":' || jstr(v_asset_description)
      ||   ',"costRetired":' || NVL(TO_CHAR(v_cost_retired), '0')
      ||   ',"totalAmount":' || NVL(TO_CHAR(v_cost_retired), '0')
      || '}'
      || ',"lines":[';

    -- Build lines array
    v_json_response := v_json_response || '{'
      || '"lineNumber":1,"lineType":"DR","accountingClass":"ACCUMULATED_DEPRECIATION"'
      || ',"description":"Retirement Accumulated Depreciation — ' || REPLACE(v_asset_number, '"', '\"')
      ||                                        ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 100), '"', '\"') || '"'
      || ',"accountedDr":' || v_accumulated_deprn
      || ',"accountedCr":0'
      || ',"enteredDr":' || v_accumulated_deprn
      || ',"enteredCr":0'
      || ',"accountCombination":' || NVL(jstr(v_deprn_account), 'null')
      || ',"reference1":' || jstr(v_asset_number)
      || ',"reference2":' || jstr(p_retirement_id)
      || ',"reference5":"FA_RETIREMENT"'
      || '},{'
      || '"lineNumber":2,"lineType":"CR","accountingClass":"ASSET_COST"'
      || ',"description":"Retirement Asset Cost — ' || REPLACE(v_asset_number, '"', '\"')
      ||                               ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 100), '"', '\"') || '"'
      || ',"accountedDr":0'
      || ',"accountedCr":' || NVL(TO_CHAR(v_cost_retired), '0')
      || ',"enteredDr":0'
      || ',"enteredCr":' || NVL(TO_CHAR(v_cost_retired), '0')
      || ',"accountCombination":' || NVL(jstr(v_asset_cost_account), 'null')
      || ',"reference1":' || jstr(v_asset_number)
      || ',"reference2":' || jstr(p_retirement_id)
      || ',"reference5":"FA_RETIREMENT"'
      || '}';

    -- Line 3: Proceeds of Sale (only if proceeds > 0)
    IF v_proceeds_of_sale > 0 THEN
      v_json_response := v_json_response || ',{'
        || '"lineNumber":3,"lineType":"DR","accountingClass":"PROCEEDS"'
        || ',"description":"Proceeds of Sale — ' || REPLACE(v_asset_number, '"', '\"')
        ||                           ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 100), '"', '\"') || '"'
        || ',"accountedDr":' || v_proceeds_of_sale
        || ',"accountedCr":0'
        || ',"enteredDr":' || v_proceeds_of_sale
        || ',"enteredCr":0'
        || ',"accountCombination":' || NVL(jstr(v_proceeds_account), 'null')
        || ',"reference1":' || jstr(v_asset_number)
        || ',"reference2":' || jstr(p_retirement_id)
        || ',"reference5":"FA_RETIREMENT"'
        || '}';
    END IF;

    -- Line 4: Cost of Removal (only if cost_of_removal != 0)
    IF v_cost_of_removal != 0 THEN
      v_json_response := v_json_response || ',{'
        || '"lineNumber":' || CASE WHEN v_proceeds_of_sale > 0 THEN '4' ELSE '3' END
        || ',"lineType":"' || CASE WHEN v_cost_of_removal > 0 THEN 'DR' ELSE 'CR' END || '"'
        || ',"accountingClass":"REMOVAL"'
        || ',"description":"Cost of Removal — ' || REPLACE(v_asset_number, '"', '\"')
        ||                               ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 100), '"', '\"') || '"'
        || ',"accountedDr":' || CASE WHEN v_cost_of_removal > 0 THEN TO_CHAR(v_cost_of_removal) ELSE '0' END
        || ',"accountedCr":' || CASE WHEN v_cost_of_removal < 0 THEN TO_CHAR(ABS(v_cost_of_removal)) ELSE '0' END
        || ',"enteredDr":' || CASE WHEN v_cost_of_removal > 0 THEN TO_CHAR(v_cost_of_removal) ELSE '0' END
        || ',"enteredCr":' || CASE WHEN v_cost_of_removal < 0 THEN TO_CHAR(ABS(v_cost_of_removal)) ELSE '0' END
        || ',"accountCombination":' || NVL(jstr(v_removal_account), 'null')
        || ',"reference1":' || jstr(v_asset_number)
        || ',"reference2":' || jstr(p_retirement_id)
        || ',"reference5":"FA_RETIREMENT"'
        || '}';
    END IF;

    -- Line 5: Gain/Loss (only if gain_loss_amount != 0)
    IF v_gain_loss_amount != 0 THEN
      v_json_response := v_json_response || ',{'
        || '"lineNumber":' || CASE WHEN v_proceeds_of_sale > 0 AND v_cost_of_removal != 0 THEN '5' WHEN v_proceeds_of_sale > 0 OR v_cost_of_removal != 0 THEN '4' ELSE '3' END
        || ',"lineType":"' || CASE WHEN v_gain_loss_amount > 0 THEN 'CR' ELSE 'DR' END || '"'
        || ',"accountingClass":"' || CASE WHEN v_gain_loss_amount > 0 THEN 'GAIN' ELSE 'LOSS' END || '"'
        || ',"description":"' || CASE WHEN v_gain_loss_amount > 0 THEN 'Gain' ELSE 'Loss' END || ' on Sale — ' || REPLACE(v_asset_number, '"', '\"')
        ||                                           ' — ' || REPLACE(SUBSTR(v_asset_description, 1, 100), '"', '\"') || '"'
        || ',"accountedDr":' || CASE WHEN v_gain_loss_amount < 0 THEN TO_CHAR(ABS(v_gain_loss_amount)) ELSE '0' END
        || ',"accountedCr":' || CASE WHEN v_gain_loss_amount > 0 THEN TO_CHAR(v_gain_loss_amount) ELSE '0' END
        || ',"enteredDr":' || CASE WHEN v_gain_loss_amount < 0 THEN TO_CHAR(ABS(v_gain_loss_amount)) ELSE '0' END
        || ',"enteredCr":' || CASE WHEN v_gain_loss_amount > 0 THEN TO_CHAR(v_gain_loss_amount) ELSE '0' END
        || ',"accountCombination":' || NVL(jstr(CASE WHEN v_gain_loss_amount > 0 THEN v_gain_account ELSE v_loss_account END), 'null')
        || ',"reference1":' || jstr(v_asset_number)
        || ',"reference2":' || jstr(p_retirement_id)
        || ',"reference5":"FA_RETIREMENT"'
        || '}';
    END IF;

    v_json_response := v_json_response || ']}';

    p_http_status := 200;
    p_result := v_json_response;

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
