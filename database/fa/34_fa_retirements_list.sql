-- =============================================================================
-- 34_FA_RETIREMENTS_LIST.SQL
--
-- Generic retirements endpoint for listing and creating retirements.
-- GET  reerp/fa/retirements?bookTypeCode=...&assetId=...
--      -> Returns retirement records with asset details
-- POST reerp/fa/retirements
--      body: { bookTypeCode, assetId, dateRetired, proceedsOfSale,
--              costOfRemoval, retirementTypeCode, createdBy, lines:[...] }
--      -> Creates a new retirement record
--
-- This is separate from fa/assets/:assetId/retire-post (single-asset retirement)
-- and provides a list/search interface for retirements.
-- =============================================================================

-- Create sequence for retirement IDs (idempotent)
BEGIN
  EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_FA_RETIREMENTS_SEQ START WITH 1000001 INCREMENT BY 1 NOCACHE';
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
/

CREATE OR REPLACE PACKAGE RR_FA_RETIREMENTS_PKG AS
  PROCEDURE GET_RETIREMENTS_LIST(
    p_book_type_code IN VARCHAR2,
    p_asset_id       IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  );

  PROCEDURE POST_RETIREMENT(
    p_body           IN CLOB,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  );
END RR_FA_RETIREMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_RETIREMENTS_PKG AS

  PROCEDURE GET_RETIREMENTS_LIST(
    p_book_type_code IN VARCHAR2,
    p_asset_id       IN VARCHAR2,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  ) IS
  BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('items');

    FOR r IN (
      SELECT r.RETIREMENT_ID,
             r.BOOK_TYPE_CODE,
             r.ASSET_ID,
             a.ASSET_NUMBER,
             a.DESCRIPTION,
             r.DATE_RETIRED,
             r.COST_RETIRED,
             r.STATUS,
             r.NBV_RETIRED,
             r.GAIN_LOSS_AMOUNT,
             r.PROCEEDS_OF_SALE,
             r.COST_OF_REMOVAL,
             r.RETIREMENT_TYPE_CODE,
             r.SOLD_TO,
             r.ASSET_COST_ACCOUNT,
             r.DEPRN_RESERVE_ACCOUNT,
             r.PROCEEDS_ACCOUNT,
             r.COST_OF_REMOVAL_ACCOUNT,
             r.GAIN_ACCOUNT,
             r.LOSS_ACCOUNT
      FROM RR_FA_RETIREMENTS r
      LEFT JOIN RR_FA_ADDITIONS a ON r.ASSET_ID = a.ASSET_ID
      WHERE (r.BOOK_TYPE_CODE = p_book_type_code OR p_book_type_code IS NULL)
        AND (r.ASSET_ID = p_asset_id OR p_asset_id IS NULL)
      ORDER BY r.CREATION_DATE DESC
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('retirementId', r.RETIREMENT_ID);
      APEX_JSON.WRITE('bookTypeCode', r.BOOK_TYPE_CODE);
      APEX_JSON.WRITE('assetId', r.ASSET_ID);
      APEX_JSON.WRITE('assetNumber', r.ASSET_NUMBER);
      APEX_JSON.WRITE('description', r.DESCRIPTION);
      APEX_JSON.WRITE('dateRetired', r.DATE_RETIRED);
      APEX_JSON.WRITE('costRetired', r.COST_RETIRED);
      APEX_JSON.WRITE('status', r.STATUS);
      APEX_JSON.WRITE('nbvRetired', r.NBV_RETIRED);
      APEX_JSON.WRITE('gainLossAmount', r.GAIN_LOSS_AMOUNT);
      APEX_JSON.WRITE('proceedsOfSale', r.PROCEEDS_OF_SALE);
      APEX_JSON.WRITE('costOfRemoval', r.COST_OF_REMOVAL);
      APEX_JSON.WRITE('retirementTypeCode', r.RETIREMENT_TYPE_CODE);
      APEX_JSON.WRITE('soldTo', r.SOLD_TO);
      APEX_JSON.WRITE('assetCostAccount', r.ASSET_COST_ACCOUNT);
      APEX_JSON.WRITE('deprnReserveAccount', r.DEPRN_RESERVE_ACCOUNT);
      APEX_JSON.WRITE('proceedsAccount', r.PROCEEDS_ACCOUNT);
      APEX_JSON.WRITE('costOfRemovalAccount', r.COST_OF_REMOVAL_ACCOUNT);
      APEX_JSON.WRITE('gainAccount', r.GAIN_ACCOUNT);
      APEX_JSON.WRITE('lossAccount', r.LOSS_ACCOUNT);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    p_http_status := 200;
    p_result      := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
  EXCEPTION
    WHEN OTHERS THEN
      p_http_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END GET_RETIREMENTS_LIST;

  PROCEDURE POST_RETIREMENT(
    p_body           IN CLOB,
    p_http_status    OUT NUMBER,
    p_result         OUT CLOB
  ) IS
    v_book_type_code       VARCHAR2(100);
    v_asset_id             VARCHAR2(400);
    v_date_retired         VARCHAR2(40);
    v_cost_retired         NUMBER;
    v_proceeds_of_sale     NUMBER;
    v_cost_of_removal      NUMBER;
    v_retirement_type_code VARCHAR2(100);
    v_created_by           VARCHAR2(240);
    v_retirement_id        VARCHAR2(100);
    v_line_count           NUMBER;
    v_line_type            VARCHAR2(200);
    v_account_combination  VARCHAR2(200);
    v_acc_cost             VARCHAR2(200);
    v_acc_deprn            VARCHAR2(200);
    v_acc_proc             VARCHAR2(200);
    v_acc_remv             VARCHAR2(200);
    v_acc_gain             VARCHAR2(200);
    v_acc_loss             VARCHAR2(200);
    v_i                    NUMBER;
  BEGIN
    -- Parse JSON request body
    APEX_JSON.PARSE(p_body);

    v_book_type_code       := APEX_JSON.GET_VARCHAR2(p_path => 'bookTypeCode');
    v_asset_id             := APEX_JSON.GET_VARCHAR2(p_path => 'assetId');
    v_date_retired         := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'dateRetired'), TO_CHAR(SYSDATE, 'YYYY-MM-DD'));
    v_cost_retired         := NVL(APEX_JSON.GET_NUMBER(p_path => 'costRetired'), 0);
    v_proceeds_of_sale     := NVL(APEX_JSON.GET_NUMBER(p_path => 'proceedsOfSale'), 0);
    v_cost_of_removal      := NVL(APEX_JSON.GET_NUMBER(p_path => 'costOfRemoval'), 0);
    v_retirement_type_code := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'retirementTypeCode'), 'ORDINARY');
    v_created_by           := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REACTERP');

    -- Generate RETIREMENT_ID using sequence
    v_retirement_id := TO_CHAR(RR_FA_RETIREMENTS_SEQ.NEXTVAL);

    -- Validate required fields
    IF v_book_type_code IS NULL THEN
      p_http_status := 400;
      p_result := '{"success":false,"error":"bookTypeCode is required"}';
      RETURN;
    END IF;

    IF v_asset_id IS NULL THEN
      p_http_status := 400;
      p_result := '{"success":false,"error":"assetId is required"}';
      RETURN;
    END IF;

    -- Insert retirement record
    INSERT INTO RR_FA_RETIREMENTS (
      RETIREMENT_ID,
      BOOK_TYPE_CODE,
      ASSET_ID,
      DATE_RETIRED,
      COST_RETIRED,
      PROCEEDS_OF_SALE,
      COST_OF_REMOVAL,
      RETIREMENT_TYPE_CODE,
      STATUS,
      CREATION_DATE,
      CREATED_BY,
      LAST_UPDATE_DATE,
      LAST_UPDATED_BY
    ) VALUES (
      v_retirement_id,
      v_book_type_code,
      v_asset_id,
      TO_DATE(v_date_retired, 'YYYY-MM-DD'),
      v_cost_retired,
      v_proceeds_of_sale,
      v_cost_of_removal,
      v_retirement_type_code,
      'DRAFT',
      SYSTIMESTAMP,
      v_created_by,
      SYSTIMESTAMP,
      v_created_by
    );

    -- Process accounting lines if present
    v_line_count := NVL(APEX_JSON.GET_COUNT(p_path => 'lines'), 0);
    FOR v_i IN 1 .. v_line_count LOOP
      v_line_type            := APEX_JSON.GET_VARCHAR2(p_path => 'lines[%d].lineType', p0 => v_i);
      v_account_combination  := APEX_JSON.GET_VARCHAR2(p_path => 'lines[%d].accountCombination', p0 => v_i);

      -- Map line type to account column
      IF v_line_type IS NOT NULL AND v_account_combination IS NOT NULL THEN
        IF UPPER(v_line_type) LIKE '%ACCUMULATED%' OR UPPER(v_line_type) LIKE '%RESERVE%' THEN
          v_acc_deprn := v_account_combination;
        ELSIF UPPER(v_line_type) LIKE '%ASSET COST%' OR UPPER(v_line_type) = 'COST' THEN
          v_acc_cost  := v_account_combination;
        ELSIF UPPER(v_line_type) LIKE '%PROCEEDS%' THEN
          v_acc_proc  := v_account_combination;
        ELSIF UPPER(v_line_type) LIKE '%REMOVAL%' THEN
          v_acc_remv  := v_account_combination;
        ELSIF UPPER(v_line_type) LIKE '%GAIN%' THEN
          v_acc_gain  := v_account_combination;
        ELSIF UPPER(v_line_type) LIKE '%LOSS%' THEN
          v_acc_loss  := v_account_combination;
        END IF;
      END IF;
    END LOOP;

    -- Update the retirement record with all account combinations
    UPDATE RR_FA_RETIREMENTS
    SET
      ASSET_COST_ACCOUNT       = NVL(v_acc_cost, ASSET_COST_ACCOUNT),
      DEPRN_RESERVE_ACCOUNT    = NVL(v_acc_deprn, DEPRN_RESERVE_ACCOUNT),
      PROCEEDS_ACCOUNT         = NVL(v_acc_proc, PROCEEDS_ACCOUNT),
      COST_OF_REMOVAL_ACCOUNT  = NVL(v_acc_remv, COST_OF_REMOVAL_ACCOUNT),
      GAIN_ACCOUNT             = NVL(v_acc_gain, GAIN_ACCOUNT),
      LOSS_ACCOUNT             = NVL(v_acc_loss, LOSS_ACCOUNT),
      LAST_UPDATE_DATE         = SYSTIMESTAMP,
      LAST_UPDATED_BY          = v_created_by
    WHERE RETIREMENT_ID = v_retirement_id;

    COMMIT;
    p_http_status := 201;
    p_result := '{"success":true,"retirementId":"' || v_retirement_id || '","assetId":"' || v_asset_id || '"}';

  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_http_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
  END POST_RETIREMENT;

END RR_FA_RETIREMENTS_PKG;
/

-- ── GET reerp/fa/retirements ──────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/retirements', p_method => 'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/retirements'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/retirements', p_priority => 0, p_etag_type => 'HASH');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/retirements',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB;
BEGIN
  RR_FA_RETIREMENTS_PKG.GET_RETIREMENTS_LIST(
    p_book_type_code => :bookTypeCode,
    p_asset_id       => :assetId,
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

-- ── POST reerp/fa/retirements ─────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/retirements', p_method => 'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/retirements',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB;
BEGIN
  RR_FA_RETIREMENTS_PKG.POST_RETIREMENT(
    p_body        => :body_text,
    p_http_status => v_status,
    p_result      => v_result);
  :status_code := v_status;
  HTP.P(v_result);
END;
]'
  );
  COMMIT;
END;
/

-- ── Verify the package compiled (returns no rows on success) ──────────────────
ALTER PACKAGE RR_FA_RETIREMENTS_PKG COMPILE BODY;
SELECT name, type, line, position, text FROM USER_ERRORS
 WHERE name = 'RR_FA_RETIREMENTS_PKG' ORDER BY sequence;
