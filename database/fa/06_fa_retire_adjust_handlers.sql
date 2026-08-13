-- =============================================================================
-- 06_FA_RETIRE_ADJUST_HANDLERS.SQL
--
-- PUT reerp/fa/assets/:assetId/retire   — retire an asset
-- PUT reerp/fa/assets/:assetId/adjust   — cost/units adjustment
-- =============================================================================


-- ============================================================
-- PROCEDURE: RR_FA_RETIRE_ASSET
-- ============================================================
CREATE OR REPLACE PROCEDURE RR_FA_RETIRE_ASSET (
    p_asset_id  IN  NUMBER,
    p_body      IN  CLOB,
    p_status    OUT NUMBER,
    p_message   OUT CLOB
) AS
    v_book_type_code       VARCHAR2(100);
    v_date_retired         VARCHAR2(100);
    v_cost_retired         NUMBER;
    v_proceeds_of_sale     NUMBER;
    v_cost_of_removal      NUMBER;
    v_retirement_type_code VARCHAR2(100);
    v_sold_to              VARCHAR2(400);
    v_units                NUMBER;

    -- Computed
    v_current_cost         NUMBER;
    v_deprn_reserve        NUMBER;
    v_nbv_retired          NUMBER;
    v_gain_loss            NUMBER;
    v_retirement_id        NUMBER;
    v_txn_header_id        NUMBER;

    -- Validation
    v_asset_number         VARCHAR2(200);
    v_retired_flag         VARCHAR2(10);
BEGIN
    -- Check asset exists and is not already retired
    BEGIN
        SELECT ASSET_NUMBER, NVL(RETIRED_FLAG,'NO')
        INTO   v_asset_number, v_retired_flag
        FROM   RR_FA_ADDITIONS
        WHERE  ASSET_ID = p_asset_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status := 404;
            APEX_JSON.INITIALIZE_CLOB_OUTPUT;
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('success', FALSE);
            APEX_JSON.WRITE('error',   'Asset ' || p_asset_id || ' not found');
            APEX_JSON.CLOSE_OBJECT;
            p_message := APEX_JSON.GET_CLOB_OUTPUT;
            APEX_JSON.FREE_OUTPUT;
            RETURN;
    END;

    IF v_retired_flag = 'YES' THEN
        p_status := 422;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',   'Asset ' || v_asset_number || ' is already retired');
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    -- Parse body
    APEX_JSON.PARSE(p_body);
    v_book_type_code       := APEX_JSON.GET_VARCHAR2(p_path => 'bookTypeCode');
    v_date_retired         := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'dateRetired'),
                                   TO_CHAR(SYSDATE,'YYYY-MM-DD'));
    v_cost_retired         := APEX_JSON.GET_NUMBER(p_path => 'costRetired');
    v_proceeds_of_sale     := NVL(APEX_JSON.GET_NUMBER(p_path => 'proceedsOfSale'), 0);
    v_cost_of_removal      := NVL(APEX_JSON.GET_NUMBER(p_path => 'costOfRemoval'), 0);
    v_retirement_type_code := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'retirementTypeCode'), 'ORDINARY');
    v_sold_to              := APEX_JSON.GET_VARCHAR2(p_path => 'soldTo');
    v_units                := APEX_JSON.GET_NUMBER(p_path => 'units');

    -- Get current cost and deprn reserve from latest book record
    BEGIN
        SELECT NVL(b.COST,0),
               NVL(ds.DEPRN_RESERVE,0)
        INTO   v_current_cost, v_deprn_reserve
        FROM   RR_FA_BOOKS b
        LEFT JOIN (
            SELECT ASSET_ID, BOOK_TYPE_CODE, DEPRN_RESERVE
            FROM   RR_FA_DEPRN_SUMMARY ds1
            WHERE  PERIOD_COUNTER = (
                SELECT MAX(PERIOD_COUNTER) FROM RR_FA_DEPRN_SUMMARY ds2
                WHERE ds2.ASSET_ID = ds1.ASSET_ID
                AND   ds2.BOOK_TYPE_CODE = ds1.BOOK_TYPE_CODE)
        ) ds ON ds.ASSET_ID = b.ASSET_ID AND ds.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
        WHERE  b.ASSET_ID      = p_asset_id
        AND    b.BOOK_TYPE_CODE = NVL(v_book_type_code, b.BOOK_TYPE_CODE)
        AND    b.DATE_INEFFECTIVE IS NULL
        AND    ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_current_cost  := 0;
            v_deprn_reserve := 0;
    END;

    -- Use full cost if cost_retired not supplied
    v_cost_retired := NVL(v_cost_retired, v_current_cost);

    -- NBV = cost - accumulated deprn
    v_nbv_retired := v_current_cost - v_deprn_reserve;

    -- Gain/Loss = Proceeds - Cost of Removal - NBV
    v_gain_loss := v_proceeds_of_sale - v_cost_of_removal - v_nbv_retired;

    -- Generate retirement ID
    SELECT NVL(MAX(TO_NUMBER(RETIREMENT_ID)),0)+1
    INTO   v_retirement_id
    FROM   RR_FA_RETIREMENTS;

    -- Generate transaction header ID
    SELECT NVL(MAX(TO_NUMBER(TRANSACTION_HEADER_ID)),0)+1
    INTO   v_txn_header_id
    FROM   RR_FA_TRANSACTION_HEADERS;

    -- Insert retirement record
    INSERT INTO RR_FA_RETIREMENTS (
        RETIREMENT_ID, BOOK_TYPE_CODE, ASSET_ID,
        TRANSACTION_HEADER_ID_IN,
        DATE_RETIRED, DATE_EFFECTIVE,
        COST_RETIRED, STATUS, UNITS,
        NBV_RETIRED, GAIN_LOSS_AMOUNT,
        PROCEEDS_OF_SALE, COST_OF_REMOVAL,
        RETIREMENT_TYPE_CODE, UNREVALUED_COST_RETIRED,
        SOLD_TO, OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_retirement_id, v_book_type_code, p_asset_id,
        v_txn_header_id,
        v_date_retired, SYSDATE,
        v_cost_retired, 'PROCESSED', v_units,
        v_nbv_retired, v_gain_loss,
        v_proceeds_of_sale, v_cost_of_removal,
        v_retirement_type_code, v_cost_retired,
        v_sold_to, 1,
        SYSTIMESTAMP, 'REACTERP', SYSTIMESTAMP, 'REACTERP'
    );

    -- Insert transaction header
    INSERT INTO RR_FA_TRANSACTION_HEADERS (
        TRANSACTION_HEADER_ID, BOOK_TYPE_CODE, ASSET_ID,
        TRANSACTION_TYPE_CODE, TRANSACTION_DATE_ENTERED, DATE_EFFECTIVE,
        CALLING_INTERFACE, OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_txn_header_id, v_book_type_code, p_asset_id,
        'FULL RETIREMENT', SYSDATE, SYSDATE,
        'REACTERP', 1,
        SYSTIMESTAMP, 'REACTERP', SYSTIMESTAMP, 'REACTERP'
    );

    -- Mark asset as retired in additions
    UPDATE RR_FA_ADDITIONS
    SET    RETIRED_FLAG      = 'YES',
           LAST_UPDATED_BY   = 'REACTERP',
           LAST_UPDATE_DATE  = SYSTIMESTAMP
    WHERE  ASSET_ID = p_asset_id;

    -- Mark book row as ineffective
    UPDATE RR_FA_BOOKS
    SET    DATE_INEFFECTIVE       = SYSDATE,
           RETIREMENT_ID          = v_retirement_id,
           TRANSACTION_HEADER_ID_OUT = v_txn_header_id,
           LAST_UPDATED_BY        = 'REACTERP',
           LAST_UPDATE_DATE       = SYSTIMESTAMP
    WHERE  ASSET_ID               = p_asset_id
    AND    BOOK_TYPE_CODE          = NVL(v_book_type_code, BOOK_TYPE_CODE)
    AND    DATE_INEFFECTIVE        IS NULL;

    COMMIT;

    p_status := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',        TRUE);
    APEX_JSON.WRITE('message',        'Asset retired successfully');
    APEX_JSON.WRITE('assetId',        p_asset_id);
    APEX_JSON.WRITE('assetNumber',    v_asset_number);
    APEX_JSON.WRITE('retirementId',   v_retirement_id);
    APEX_JSON.WRITE('costRetired',    v_cost_retired);
    APEX_JSON.WRITE('nbvRetired',     v_nbv_retired);
    APEX_JSON.WRITE('gainLoss',       v_gain_loss);
    APEX_JSON.CLOSE_OBJECT;
    p_message := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_status := 500;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('error',     SQLERRM);
        APEX_JSON.WRITE('errorCode', SQLCODE);
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
END RR_FA_RETIRE_ASSET;
/


-- ============================================================
-- TEMPLATE + HANDLER: PUT fa/assets/:assetId/retire
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/retire',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: retire an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/retire',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_status  NUMBER;
                v_message CLOB;
            BEGIN
                RR_FA_RETIRE_ASSET(
                    p_asset_id => TO_NUMBER(:assetId),
                    p_body     => :body_text,
                    p_status   => v_status,
                    p_message  => v_message
                );
                :status := v_status;
                HTP.P(v_message);
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- PROCEDURE: RR_FA_ADJUST_ASSET
-- Adjust cost / units on a capitalised asset
-- Body: { "bookTypeCode","adjustmentType","adjustmentAmount","description" }
-- adjustmentType: COST_ADDITION | COST_REDUCTION | UNIT_ADDITION | UNIT_REDUCTION
-- ============================================================
CREATE OR REPLACE PROCEDURE RR_FA_ADJUST_ASSET (
    p_asset_id  IN  NUMBER,
    p_body      IN  CLOB,
    p_status    OUT NUMBER,
    p_message   OUT CLOB
) AS
    v_book_type_code   VARCHAR2(100);
    v_adjustment_type  VARCHAR2(50);
    v_adj_amount       NUMBER;
    v_description      VARCHAR2(4000);

    v_asset_number     VARCHAR2(200);
    v_old_cost         NUMBER;
    v_new_cost         NUMBER;
    v_txn_header_id    NUMBER;
    v_adj_line_id      NUMBER;
    v_exists           NUMBER;
BEGIN
    -- Validate asset
    SELECT COUNT(*), MAX(ASSET_NUMBER)
    INTO   v_exists, v_asset_number
    FROM   RR_FA_ADDITIONS
    WHERE  ASSET_ID = p_asset_id;

    IF v_exists = 0 THEN
        p_status := 404;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',   'Asset ' || p_asset_id || ' not found');
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    APEX_JSON.PARSE(p_body);
    v_book_type_code  := APEX_JSON.GET_VARCHAR2(p_path => 'bookTypeCode');
    v_adjustment_type := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'adjustmentType'), 'COST_ADDITION');
    v_adj_amount      := NVL(APEX_JSON.GET_NUMBER(p_path => 'adjustmentAmount'), 0);
    v_description     := APEX_JSON.GET_VARCHAR2(p_path => 'description');

    IF v_adj_amount <= 0 THEN
        p_status := 400;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',   'adjustmentAmount must be greater than zero');
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    -- Get current cost
    SELECT NVL(COST,0) INTO v_old_cost
    FROM   RR_FA_BOOKS
    WHERE  ASSET_ID      = p_asset_id
    AND    BOOK_TYPE_CODE = NVL(v_book_type_code, BOOK_TYPE_CODE)
    AND    DATE_INEFFECTIVE IS NULL
    AND    ROWNUM = 1;

    -- Calculate new cost
    v_new_cost := CASE
        WHEN v_adjustment_type IN ('COST_ADDITION',  'UNIT_ADDITION')  THEN v_old_cost + v_adj_amount
        WHEN v_adjustment_type IN ('COST_REDUCTION', 'UNIT_REDUCTION') THEN v_old_cost - v_adj_amount
        ELSE v_old_cost + v_adj_amount
    END;

    -- Generate IDs
    SELECT NVL(MAX(TO_NUMBER(TRANSACTION_HEADER_ID)),0)+1 INTO v_txn_header_id FROM RR_FA_TRANSACTION_HEADERS;
    SELECT NVL(MAX(TO_NUMBER(ADJUSTMENT_LINE_ID)),0)+1   INTO v_adj_line_id    FROM RR_FA_ADJUSTMENTS;

    -- Insert transaction header
    INSERT INTO RR_FA_TRANSACTION_HEADERS (
        TRANSACTION_HEADER_ID, BOOK_TYPE_CODE, ASSET_ID,
        TRANSACTION_TYPE_CODE, TRANSACTION_DATE_ENTERED, DATE_EFFECTIVE,
        CALLING_INTERFACE, OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_txn_header_id, v_book_type_code, p_asset_id,
        'CIP ADDITION', SYSDATE, SYSDATE,
        'REACTERP', 1,
        SYSTIMESTAMP, 'REACTERP', SYSTIMESTAMP, 'REACTERP'
    );

    -- Insert adjustment line
    INSERT INTO RR_FA_ADJUSTMENTS (
        TRANSACTION_HEADER_ID, ADJUSTMENT_LINE_ID,
        SOURCE_TYPE_CODE, ADJUSTMENT_TYPE,
        DEBIT_CREDIT_FLAG, BOOK_TYPE_CODE, ASSET_ID,
        ADJUSTMENT_AMOUNT, ANNUALIZED_ADJUSTMENT,
        PERIOD_COUNTER_CREATED, PERIOD_COUNTER_ADJUSTED,
        OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_txn_header_id, v_adj_line_id,
        'ASSET', v_adjustment_type,
        CASE WHEN v_adjustment_type LIKE '%ADDITION%' THEN 'DR' ELSE 'CR' END,
        v_book_type_code, p_asset_id,
        v_adj_amount, v_adj_amount,
        0, 0, 1,
        SYSTIMESTAMP, 'REACTERP', SYSTIMESTAMP, 'REACTERP'
    );

    -- Update book cost
    UPDATE RR_FA_BOOKS
    SET    COST              = v_new_cost,
           ADJUSTED_COST     = v_new_cost,
           ORIGINAL_COST     = CASE WHEN ORIGINAL_COST IS NULL THEN v_old_cost ELSE ORIGINAL_COST END,
           RECOVERABLE_COST  = v_new_cost - NVL(SALVAGE_VALUE,0),
           LAST_UPDATED_BY   = 'REACTERP',
           LAST_UPDATE_DATE  = SYSTIMESTAMP
    WHERE  ASSET_ID          = p_asset_id
    AND    BOOK_TYPE_CODE     = NVL(v_book_type_code, BOOK_TYPE_CODE)
    AND    DATE_INEFFECTIVE   IS NULL;

    COMMIT;

    p_status := 200;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',           TRUE);
    APEX_JSON.WRITE('message',           'Asset adjusted successfully');
    APEX_JSON.WRITE('assetId',           p_asset_id);
    APEX_JSON.WRITE('assetNumber',       v_asset_number);
    APEX_JSON.WRITE('adjustmentType',    v_adjustment_type);
    APEX_JSON.WRITE('oldCost',           v_old_cost);
    APEX_JSON.WRITE('adjustmentAmount',  v_adj_amount);
    APEX_JSON.WRITE('newCost',           v_new_cost);
    APEX_JSON.WRITE('transactionHeaderId', v_txn_header_id);
    APEX_JSON.CLOSE_OBJECT;
    p_message := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_status := 500;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('error',     SQLERRM);
        APEX_JSON.WRITE('errorCode', SQLCODE);
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
END RR_FA_ADJUST_ASSET;
/


-- ============================================================
-- TEMPLATE + HANDLER: PUT fa/assets/:assetId/adjust
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/adjust',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: cost/units adjustment'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/adjust',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_status  NUMBER;
                v_message CLOB;
            BEGIN
                RR_FA_ADJUST_ASSET(
                    p_asset_id => TO_NUMBER(:assetId),
                    p_body     => :body_text,
                    p_status   => v_status,
                    p_message  => v_message
                );
                :status := v_status;
                HTP.P(v_message);
            END;
        ]'
    );
    COMMIT;
END;
/
