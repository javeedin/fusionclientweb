-- =============================================================================
-- 33_FA_RETIREMENT.SQL   (isolated package RR_FA_RETIRE_PKG)
--
-- Asset retirement with accounting:
--   GET  reerp/fa/assets/:assetId/retirement-preview?bookTypeCode=...
--        -> { cost, deprnReserve, nbv, assetCostAccount, accumDeprnAccount }
--   POST reerp/fa/assets/:assetId/retire-post
--        body: { bookTypeCode, dateRetired, proceedsOfSale, costOfRemoval,
--                soldTo, retirementTypeCode, lines:[{lineType,accountCombination,
--                enteredDr,enteredCr}] }
--        -> retires the asset + records the Dr/Cr account combinations on
--           RR_FA_RETIREMENTS (new account columns added below)
--
-- The Dr/Cr account combinations are stored on RR_FA_RETIREMENTS in six new
-- columns (one per accounting line type).
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- =============================================================================

-- ── Add the Dr/Cr account columns to RR_FA_RETIREMENTS (idempotent) ──────────
DECLARE
  PROCEDURE add_col(p_col VARCHAR2) IS
    v_n NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_n FROM USER_TAB_COLUMNS
     WHERE TABLE_NAME = 'RR_FA_RETIREMENTS' AND COLUMN_NAME = p_col;
    IF v_n = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE RR_FA_RETIREMENTS ADD ("' || p_col || '" VARCHAR2(200))';
    END IF;
  END;
BEGIN
  add_col('ASSET_COST_ACCOUNT');        -- Cr  asset cost
  add_col('DEPRN_RESERVE_ACCOUNT');     -- Dr  accumulated depreciation
  add_col('PROCEEDS_ACCOUNT');          -- Dr  proceeds of sale
  add_col('COST_OF_REMOVAL_ACCOUNT');   -- Cr  cost of removal
  add_col('GAIN_ACCOUNT');              -- Cr  gain on retirement
  add_col('LOSS_ACCOUNT');              -- Dr  loss on retirement
END;
/

CREATE OR REPLACE PACKAGE RR_FA_RETIRE_PKG AS
  PROCEDURE GET_RETIRE_PREVIEW(p_asset_id IN NUMBER, p_book_type IN VARCHAR2,
                               p_status OUT NUMBER, p_result OUT CLOB);
  PROCEDURE RETIRE_POST(p_asset_id IN NUMBER, p_body IN CLOB,
                        p_status OUT NUMBER, p_result OUT CLOB);
END RR_FA_RETIRE_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_RETIRE_PKG AS

  -- CCID -> concatenated account combination string (same as RR_FA_PKG.acct_str).
  FUNCTION acct_str(p_ccid VARCHAR2) RETURN VARCHAR2 IS
    v_str VARCHAR2(200);
  BEGIN
    IF p_ccid IS NULL THEN RETURN NULL; END IF;
    BEGIN
      SELECT NVL("buimercFinGlbCoaCo",'')          || '-' ||
             NVL("buimercFinGlbCoaLob",'')          || '-' ||
             NVL("buimercFinGlbCoaDepartment",'')   || '-' ||
             NVL("buimercFinGlbCoaAccount",'')      || '-' ||
             NVL("buimercFinGlbCoaSubAcc",'')       || '-' ||
             NVL("buimercFinGlbCoaAlys",'')         || '-' ||
             NVL("buimercFinGlbCoaIc",'')           || '-' ||
             NVL("buimercFinGlbCoaFut1",'')         || '-' ||
             NVL("buimercFinGlbCoaFut2",'')
      INTO   v_str
      FROM   REERP_GL_CODE_COMBINATIONS
      WHERE  "_CODE_COMBINATION_ID" = TO_NUMBER(p_ccid);
    EXCEPTION WHEN OTHERS THEN v_str := p_ccid; END;
    RETURN v_str;
  END acct_str;

  -- Current cost + latest reserve for an asset/book.
  PROCEDURE get_cost_reserve(p_asset_id IN NUMBER, p_book IN OUT VARCHAR2,
                             p_cost OUT NUMBER, p_reserve OUT NUMBER) IS
  BEGIN
    SELECT NVL(b.COST,0), b.BOOK_TYPE_CODE
      INTO p_cost, p_book
      FROM RR_FA_BOOKS b
     WHERE b.ASSET_ID = p_asset_id
       AND b.BOOK_TYPE_CODE = NVL(p_book, b.BOOK_TYPE_CODE)
       AND b.DATE_INEFFECTIVE IS NULL
       AND ROWNUM = 1;
    SELECT NVL((SELECT ds.DEPRN_RESERVE
                  FROM RR_FA_DEPRN_SUMMARY ds
                 WHERE ds.ASSET_ID = p_asset_id
                   AND ds.BOOK_TYPE_CODE = p_book
                   AND ds.PERIOD_COUNTER = (SELECT MAX(ds2.PERIOD_COUNTER)
                                              FROM RR_FA_DEPRN_SUMMARY ds2
                                             WHERE ds2.ASSET_ID = ds.ASSET_ID
                                               AND ds2.BOOK_TYPE_CODE = ds.BOOK_TYPE_CODE)), 0)
      INTO p_reserve FROM DUAL;
  END get_cost_reserve;

  PROCEDURE GET_RETIRE_PREVIEW(p_asset_id IN NUMBER, p_book_type IN VARCHAR2,
                               p_status OUT NUMBER, p_result OUT CLOB) IS
    v_book     VARCHAR2(100) := p_book_type;
    v_cost     NUMBER := 0;
    v_reserve  NUMBER := 0;
    v_cat      NUMBER;
    v_num      VARCHAR2(200);
    v_cost_cc  VARCHAR2(100);
    v_res_cc   VARCHAR2(100);
  BEGIN
    SELECT a.ASSET_CATEGORY_ID, a.ASSET_NUMBER INTO v_cat, v_num
      FROM RR_FA_ADDITIONS a WHERE a.ASSET_ID = p_asset_id;

    get_cost_reserve(p_asset_id, v_book, v_cost, v_reserve);

    SELECT MAX(ASSET_COST_ACCOUNT_CCID), MAX(RESERVE_ACCOUNT_CCID)
      INTO v_cost_cc, v_res_cc
      FROM RR_FA_CATEGORY_BOOKS WHERE CATEGORY_ID = v_cat;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('assetId', p_asset_id);
    APEX_JSON.WRITE('assetNumber', v_num);
    APEX_JSON.WRITE('bookTypeCode', v_book);
    APEX_JSON.WRITE('cost', v_cost);
    APEX_JSON.WRITE('deprnReserve', v_reserve);
    APEX_JSON.WRITE('nbv', v_cost - v_reserve);
    APEX_JSON.WRITE('assetCostAccount', acct_str(v_cost_cc));
    APEX_JSON.WRITE('accumDeprnAccount', acct_str(v_res_cc));
    APEX_JSON.CLOSE_OBJECT;
    p_status := 200;
    p_result := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      p_status := 404;
      p_result := '{"success":false,"error":"Asset not found or has no active book"}';
    WHEN OTHERS THEN
      p_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
  END GET_RETIRE_PREVIEW;

  PROCEDURE RETIRE_POST(p_asset_id IN NUMBER, p_body IN CLOB,
                        p_status OUT NUMBER, p_result OUT CLOB) IS
    v_book       VARCHAR2(100);
    v_date       VARCHAR2(40);
    v_proceeds   NUMBER;
    v_removal    NUMBER;
    v_soldto     VARCHAR2(400);
    v_type       VARCHAR2(100);
    v_by         VARCHAR2(240);
    v_num        VARCHAR2(200);
    v_flag       VARCHAR2(10);
    v_cost       NUMBER := 0;
    v_reserve    NUMBER := 0;
    v_nbv        NUMBER;
    v_gain_loss  NUMBER;
    v_ret_id     NUMBER;
    v_txn_id     NUMBER;
    v_cnt        NUMBER;
    -- per-line-type account combinations
    v_acc_cost   VARCHAR2(200);
    v_acc_deprn  VARCHAR2(200);
    v_acc_proc   VARCHAR2(200);
    v_acc_remv   VARCHAR2(200);
    v_acc_gain   VARCHAR2(200);
    v_acc_loss   VARCHAR2(200);
    v_lt         VARCHAR2(80);
    v_acc        VARCHAR2(200);
  BEGIN
    -- Validate asset / not already retired
    BEGIN
      SELECT ASSET_NUMBER, NVL(RETIRED_FLAG,'NO') INTO v_num, v_flag
        FROM RR_FA_ADDITIONS WHERE ASSET_ID = p_asset_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      p_status := 404; p_result := '{"success":false,"error":"Asset not found"}'; RETURN;
    END;
    IF v_flag = 'YES' THEN
      p_status := 422; p_result := '{"success":false,"error":"Asset ' || v_num || ' is already retired"}'; RETURN;
    END IF;

    APEX_JSON.PARSE(p_body);
    v_book     := APEX_JSON.GET_VARCHAR2(p_path => 'bookTypeCode');
    v_date     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'dateRetired'), TO_CHAR(SYSDATE,'YYYY-MM-DD'));
    v_proceeds := NVL(APEX_JSON.GET_NUMBER(p_path => 'proceedsOfSale'), 0);
    v_removal  := NVL(APEX_JSON.GET_NUMBER(p_path => 'costOfRemoval'), 0);
    v_soldto   := APEX_JSON.GET_VARCHAR2(p_path => 'soldTo');
    v_type     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'retirementTypeCode'), 'ORDINARY');
    v_by       := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REACTERP');

    -- Map each accounting line to its account column by line type.
    v_cnt := NVL(APEX_JSON.GET_COUNT(p_path => 'lines'), 0);
    FOR i IN 1 .. v_cnt LOOP
      v_lt  := UPPER(APEX_JSON.GET_VARCHAR2(p_path => 'lines[%d].lineType', p0 => i));
      v_acc := APEX_JSON.GET_VARCHAR2(p_path => 'lines[%d].accountCombination', p0 => i);
      IF    v_lt LIKE '%ACCUMULATED%' OR v_lt LIKE '%RESERVE%' THEN v_acc_deprn := v_acc;
      ELSIF v_lt LIKE '%ASSET COST%'  OR v_lt = 'COST'         THEN v_acc_cost  := v_acc;
      ELSIF v_lt LIKE '%PROCEEDS%'                             THEN v_acc_proc  := v_acc;
      ELSIF v_lt LIKE '%REMOVAL%'                              THEN v_acc_remv  := v_acc;
      ELSIF v_lt LIKE '%GAIN%'                                 THEN v_acc_gain  := v_acc;
      ELSIF v_lt LIKE '%LOSS%'                                 THEN v_acc_loss  := v_acc;
      END IF;
    END LOOP;

    get_cost_reserve(p_asset_id, v_book, v_cost, v_reserve);
    v_nbv       := v_cost - v_reserve;
    v_gain_loss := v_proceeds - v_removal - v_nbv;

    SELECT NVL(MAX(TO_NUMBER(RETIREMENT_ID)),0)+1 INTO v_ret_id FROM RR_FA_RETIREMENTS;
    SELECT NVL(MAX(TO_NUMBER(TRANSACTION_HEADER_ID)),0)+1 INTO v_txn_id FROM RR_FA_TRANSACTION_HEADERS;

    INSERT INTO RR_FA_RETIREMENTS (
      RETIREMENT_ID, BOOK_TYPE_CODE, ASSET_ID, TRANSACTION_HEADER_ID_IN,
      DATE_RETIRED, DATE_EFFECTIVE, COST_RETIRED, STATUS, UNITS,
      NBV_RETIRED, GAIN_LOSS_AMOUNT, PROCEEDS_OF_SALE, COST_OF_REMOVAL,
      RETIREMENT_TYPE_CODE, UNREVALUED_COST_RETIRED, SOLD_TO, OBJECT_VERSION_NUMBER,
      ASSET_COST_ACCOUNT, DEPRN_RESERVE_ACCOUNT, PROCEEDS_ACCOUNT,
      COST_OF_REMOVAL_ACCOUNT, GAIN_ACCOUNT, LOSS_ACCOUNT,
      CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
      v_ret_id, v_book, p_asset_id, v_txn_id,
      v_date, SYSDATE, v_cost, 'PROCESSED', NULL,
      v_nbv, v_gain_loss, v_proceeds, v_removal,
      v_type, v_cost, v_soldto, 1,
      v_acc_cost, v_acc_deprn, v_acc_proc,
      v_acc_remv, v_acc_gain, v_acc_loss,
      SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
    );

    INSERT INTO RR_FA_TRANSACTION_HEADERS (
      TRANSACTION_HEADER_ID, BOOK_TYPE_CODE, ASSET_ID,
      TRANSACTION_TYPE_CODE, TRANSACTION_DATE_ENTERED, DATE_EFFECTIVE,
      CALLING_INTERFACE, OBJECT_VERSION_NUMBER,
      CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
      v_txn_id, v_book, p_asset_id,
      'FULL RETIREMENT', SYSDATE, SYSDATE,
      'REACTERP', 1, SYSTIMESTAMP, v_by, SYSTIMESTAMP, v_by
    );

    UPDATE RR_FA_ADDITIONS
       SET RETIRED_FLAG = 'YES', LAST_UPDATED_BY = v_by, LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE ASSET_ID = p_asset_id;

    UPDATE RR_FA_BOOKS
       SET DATE_INEFFECTIVE = SYSDATE, RETIREMENT_ID = v_ret_id,
           TRANSACTION_HEADER_ID_OUT = v_txn_id,
           LAST_UPDATED_BY = v_by, LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE ASSET_ID = p_asset_id
       AND BOOK_TYPE_CODE = NVL(v_book, BOOK_TYPE_CODE)
       AND DATE_INEFFECTIVE IS NULL;

    COMMIT;
    p_status := 200;
    p_result := '{"success":true,"assetId":' || p_asset_id
             || ',"assetNumber":"' || REPLACE(v_num,'"','\"') || '"'
             || ',"retirementId":' || v_ret_id
             || ',"cost":' || v_cost
             || ',"nbvRetired":' || v_nbv
             || ',"gainLoss":' || v_gain_loss
             || ',"lines":' || v_cnt || '}';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_status := 500;
      p_result := '{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
  END RETIRE_POST;

END RR_FA_RETIRE_PKG;
/

-- ── GET reerp/fa/assets/:assetId/retirement-preview ──────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retirement-preview', p_method => 'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retirement-preview'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retirement-preview', p_priority => 0, p_etag_type => 'HASH');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/assets/:assetId/retirement-preview',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB;
BEGIN
  RR_FA_RETIRE_PKG.GET_RETIRE_PREVIEW(
    p_asset_id  => TO_NUMBER(:assetId),
    p_book_type => :bookTypeCode,
    p_status    => v_status,
    p_result    => v_result);
  :status := v_status;
  HTP.P(v_result);
END;
]'
  );
  COMMIT;
END;
/

-- ── POST reerp/fa/assets/:assetId/retire-post ────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retire-post', p_method => 'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retire-post'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/assets/:assetId/retire-post', p_priority => 0, p_etag_type => 'HASH');
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'fa/assets/:assetId/retire-post',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_source         => q'[
DECLARE
  v_status NUMBER; v_result CLOB;
BEGIN
  RR_FA_RETIRE_PKG.RETIRE_POST(
    p_asset_id => TO_NUMBER(:assetId),
    p_body     => :body_text,
    p_status   => v_status,
    p_result   => v_result);
  :status_code := v_status;
  HTP.P(v_result);
END;
]'
  );
  COMMIT;
END;
/

-- ── Verify the package compiled (returns no rows on success) ─────────────────
ALTER PACKAGE RR_FA_RETIRE_PKG COMPILE BODY;
SELECT name, type, line, position, text FROM USER_ERRORS
 WHERE name = 'RR_FA_RETIRE_PKG' ORDER BY sequence;
