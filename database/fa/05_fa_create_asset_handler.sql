-- =============================================================================
-- 05_FA_CREATE_ASSET_HANDLER.SQL
--
-- Procedure RR_FA_CREATE_ASSET
-- POST reerp/fa/assets
--
-- JSON body:
-- {
--   "assetNumber":       "FA-0001",
--   "description":       "Office Laptop",
--   "assetType":         "CAPITALIZED",
--   "categoryId":        "150",
--   "tagNumber":         "TAG-001",
--   "serialNumber":      "SN-12345",
--   "manufacturerName":  "Dell",
--   "modelNumber":       "Latitude 5540",
--   "inUseFlag":         "YES",
--   "ownedLeased":       "OWNED",
--   "newUsed":           "NEW",
--   "units":             1,
--   "capitalizedFlag":   "YES",
--   "propertyTypeCode":  "REAL",
--   "bookTypeCode":      "CORPORATE BOOK",
--   "datePlacedInService": "2026-01-15",
--   "cost":              5000,
--   "salvageValue":      500,
--   "depreciateFlag":    "YES",
--   "methodId":          "200",
--   "conventionTypeId":  "300",
--   "locationId":        "100",
--   "codeCombinationId": "12345"
-- }
-- =============================================================================


-- ============================================================
-- PROCEDURE: RR_FA_CREATE_ASSET
-- ============================================================
CREATE OR REPLACE PROCEDURE RR_FA_CREATE_ASSET (
    p_body    IN  CLOB,
    p_status  OUT NUMBER,
    p_message OUT CLOB
) AS
    -- Parsed fields
    v_asset_number        VARCHAR2(200);
    v_description         VARCHAR2(4000);
    v_asset_type          VARCHAR2(100);
    v_category_id         VARCHAR2(100);
    v_tag_number          VARCHAR2(200);
    v_serial_number       VARCHAR2(200);
    v_manufacturer        VARCHAR2(200);
    v_model_number        VARCHAR2(200);
    v_in_use_flag         VARCHAR2(10);
    v_owned_leased        VARCHAR2(30);
    v_new_used            VARCHAR2(30);
    v_units               NUMBER;
    v_capitalized_flag    VARCHAR2(10);
    v_property_type       VARCHAR2(30);

    -- Book fields
    v_book_type_code      VARCHAR2(100);
    v_date_placed         VARCHAR2(100);
    v_cost                NUMBER;
    v_salvage_value       NUMBER;
    v_depreciate_flag     VARCHAR2(10);
    v_method_id           VARCHAR2(100);
    v_method_code         VARCHAR2(100);
    v_life_in_months      VARCHAR2(100);
    v_convention_type_id  VARCHAR2(100);

    -- Assignment
    v_location_id         VARCHAR2(100);
    v_ccid                VARCHAR2(100);

    -- Audit
    v_created_by          VARCHAR2(400);
    v_updated_by          VARCHAR2(400);

    -- Generated IDs (use sequences or max+1 fallback)
    v_asset_id            NUMBER;
    v_distribution_id     NUMBER;
    v_txn_header_id       NUMBER;

    -- Validation
    v_exists              NUMBER;
BEGIN
    APEX_JSON.PARSE(p_body);

    v_asset_number     := APEX_JSON.GET_VARCHAR2(p_path => 'assetNumber');
    v_description      := APEX_JSON.GET_VARCHAR2(p_path => 'description');
    v_asset_type       := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'assetType'), 'CAPITALIZED');
    v_category_id      := APEX_JSON.GET_VARCHAR2(p_path => 'categoryId');
    v_tag_number       := APEX_JSON.GET_VARCHAR2(p_path => 'tagNumber');
    v_serial_number    := APEX_JSON.GET_VARCHAR2(p_path => 'serialNumber');
    v_manufacturer     := APEX_JSON.GET_VARCHAR2(p_path => 'manufacturerName');
    v_model_number     := APEX_JSON.GET_VARCHAR2(p_path => 'modelNumber');
    v_in_use_flag      := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'inUseFlag'), 'YES');
    v_owned_leased     := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'ownedLeased'), 'OWNED');
    v_new_used         := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'newUsed'), 'NEW');
    v_units            := NVL(APEX_JSON.GET_NUMBER(p_path  => 'units'), 1);
    v_capitalized_flag := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'capitalizedFlag'), 'YES');
    v_property_type    := APEX_JSON.GET_VARCHAR2(p_path => 'propertyTypeCode');

    v_book_type_code   := APEX_JSON.GET_VARCHAR2(p_path => 'bookTypeCode');
    v_date_placed      := APEX_JSON.GET_VARCHAR2(p_path => 'datePlacedInService');
    v_cost             := NVL(APEX_JSON.GET_NUMBER(p_path => 'cost'), 0);
    v_salvage_value    := NVL(APEX_JSON.GET_NUMBER(p_path => 'salvageValue'), 0);
    v_depreciate_flag  := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'depreciateFlag'), 'YES');
    v_method_id        := APEX_JSON.GET_VARCHAR2(p_path => 'methodId');
    v_method_code      := APEX_JSON.GET_VARCHAR2(p_path => 'methodCode');
    v_life_in_months   := APEX_JSON.GET_VARCHAR2(p_path => 'lifeInMonths');
    -- If methodId not provided but methodCode is, look up by methodCode
    IF v_method_id IS NULL AND v_method_code IS NOT NULL THEN
        BEGIN
            SELECT METHOD_ID INTO v_method_id
            FROM   RR_FA_METHODS
            WHERE  METHOD_CODE = v_method_code
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
        END;
    END IF;
    v_convention_type_id := APEX_JSON.GET_VARCHAR2(p_path => 'conventionTypeId');

    v_location_id      := APEX_JSON.GET_VARCHAR2(p_path => 'locationId');
    v_ccid             := APEX_JSON.GET_VARCHAR2(p_path => 'codeCombinationId');

    v_created_by       := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'createdBy'), 'REACTERP');
    v_updated_by       := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'lastUpdatedBy'), v_created_by);

    -- Validate required fields
    IF v_description IS NULL OR v_category_id IS NULL THEN
        p_status  := 400;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',   'description and categoryId are required');
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    -- Assign asset number from sequence (NEXTVAL called here at submit time)
    SELECT RR_FA_ASSET_NUMBER_SEQ.NEXTVAL INTO v_asset_id FROM DUAL;
    v_asset_number := TO_CHAR(v_asset_id);

    -- Check duplicate asset number (safety check)
    SELECT COUNT(*) INTO v_exists
    FROM RR_FA_ADDITIONS WHERE ASSET_NUMBER = v_asset_number;

    IF v_exists > 0 THEN
        -- Sequence collision — should not happen; surface for diagnosis
        p_status  := 409;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',   'Asset number ' || v_asset_number || ' already exists');
        APEX_JSON.CLOSE_OBJECT;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    -- 1. Insert into RR_FA_ADDITIONS
    INSERT INTO RR_FA_ADDITIONS (
        ASSET_ID, ASSET_NUMBER, ASSET_TYPE, TAG_NUMBER, DESCRIPTION,
        ASSET_CATEGORY_ID, MANUFACTURER_NAME, SERIAL_NUMBER, MODEL_NUMBER,
        IN_USE_FLAG, OWNED_LEASED, NEW_USED, UNITS, CURRENT_UNITS,
        CAPITALIZED_FLAG, RETIRED_FLAG, PENDING_FLAG, PROPERTY_TYPE_CODE,
        FEEDER_SYSTEM_NAME, OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_asset_id, v_asset_number, v_asset_type, v_tag_number, v_description,
        v_category_id, v_manufacturer, v_serial_number, v_model_number,
        v_in_use_flag, v_owned_leased, v_new_used, v_units, v_units,
        v_capitalized_flag, 'NO', 'NO', v_property_type,
        'REACTERP', 1,
        SYSTIMESTAMP, v_created_by, SYSTIMESTAMP, v_updated_by
    );

    -- 2. Insert into RR_FA_ADDITIONS_TL
    INSERT INTO RR_FA_ADDITIONS_TL (
        ASSET_ID, LANGUAGE, SOURCE_LANG, DESCRIPTION,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
        OBJECT_VERSION_NUMBER
    ) VALUES (
        v_asset_id, 'US', 'US', v_description,
        SYSTIMESTAMP, v_created_by, SYSTIMESTAMP, v_updated_by, 1
    );

    -- 3. Insert into RR_FA_BOOKS (if book info provided)
    IF v_book_type_code IS NOT NULL THEN
        INSERT INTO RR_FA_BOOKS (
            ASSET_ID, BOOK_TYPE_CODE,
            DATE_PLACED_IN_SERVICE, DATE_EFFECTIVE, DEPRN_START_DATE, PRORATE_DATE,
            COST, ORIGINAL_COST, ADJUSTED_COST,
            SALVAGE_VALUE, RECOVERABLE_COST, ADJUSTED_RECOVERABLE_COST,
            DEPRECIATE_FLAG, CAPITALIZE_FLAG,
            METHOD_ID, CONVENTION_TYPE_ID,
            RATE_ADJUSTMENT_FACTOR, SALVAGE_TYPE, DEPRN_LIMIT_TYPE,
            CIP_COST, UNREVALUED_COST,
            OBJECT_VERSION_NUMBER,
            CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
            v_asset_id, v_book_type_code,
            v_date_placed, SYSTIMESTAMP, v_date_placed, v_date_placed,
            v_cost, v_cost, v_cost,
            v_salvage_value, v_cost - v_salvage_value, v_cost - v_salvage_value,
            v_depreciate_flag, v_capitalized_flag,
            v_method_id, v_convention_type_id,
            1, 'PERCENT', 'NO_LIMIT',
            0, v_cost,
            1,
            SYSTIMESTAMP, v_created_by, SYSTIMESTAMP, v_updated_by
        );
    END IF;

    -- 4. Insert transaction header
    SELECT NVL(MAX(TO_NUMBER(TRANSACTION_HEADER_ID)),0)+1
    INTO   v_txn_header_id
    FROM   RR_FA_TRANSACTION_HEADERS;

    INSERT INTO RR_FA_TRANSACTION_HEADERS (
        TRANSACTION_HEADER_ID, BOOK_TYPE_CODE, ASSET_ID,
        TRANSACTION_TYPE_CODE, TRANSACTION_DATE_ENTERED, DATE_EFFECTIVE,
        CALLING_INTERFACE, OBJECT_VERSION_NUMBER,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
    ) VALUES (
        v_txn_header_id, v_book_type_code, v_asset_id,
        'ADDITION', SYSTIMESTAMP, SYSTIMESTAMP,
        'REACTERP', 1,
        SYSTIMESTAMP, v_created_by, SYSTIMESTAMP, v_updated_by
    );

    -- 5. Insert distribution history (if location provided)
    IF v_location_id IS NOT NULL THEN
        SELECT RR_FA_DISTRIBUTION_ID_SEQ.NEXTVAL
        INTO   v_distribution_id
        FROM   DUAL;

        INSERT INTO RR_FA_DISTRIBUTION_HISTORY (
            DISTRIBUTION_ID, BOOK_TYPE_CODE, ASSET_ID,
            UNITS_ASSIGNED, TRANSACTION_UNITS,
            CODE_COMBINATION_ID, LOCATION_ID,
            TRANSACTION_HEADER_ID_IN, DATE_EFFECTIVE,
            OBJECT_VERSION_NUMBER,
            CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
            v_distribution_id, v_book_type_code, v_asset_id,
            v_units, v_units,
            v_ccid, v_location_id,
            v_txn_header_id, SYSTIMESTAMP,
            1,
            SYSTIMESTAMP, v_created_by, SYSTIMESTAMP, v_updated_by
        );
    END IF;

    COMMIT;

    -- Success response
    p_status := 201;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',              TRUE);
    APEX_JSON.WRITE('message',              'Asset created successfully');
    APEX_JSON.WRITE('assetId',              v_asset_id);
    APEX_JSON.WRITE('assetNumber',          v_asset_number);
    APEX_JSON.WRITE('transactionHeaderId',  v_txn_header_id);
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
END RR_FA_CREATE_ASSET;
/


-- ============================================================
-- ORDS HANDLER: POST reerp/fa/assets
-- ============================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_status  NUMBER;
                v_message CLOB;
            BEGIN
                RR_FA_CREATE_ASSET(
                    p_body    => :body_text,
                    p_status  => v_status,
                    p_message => v_message
                );
                :status := v_status;
                HTP.P(v_message);
            END;
        ]'
    );
    COMMIT;
END;
/
