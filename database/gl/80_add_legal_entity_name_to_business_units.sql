-- ============================================================
-- PATCH 80: Add LEGAL_ENTITY_NAME to RR_GL_BUSINESS_UNITS
--
-- Problem:
--   The Pay in Full popup (and Manage Payments) needs to filter
--   the Disbursement Bank Account dropdown by legal entity.
--   The bank accounts table stores LEGAL_ENTITY_NAME.
--   But the business units endpoint only returns LEGAL_ENTITY_ID —
--   so the legal entity name lookup always returns '' and the
--   dropdown shows ALL bank accounts instead of the correct ones.
--
-- Fix:
--   Step 1: Add LEGAL_ENTITY_NAME column to RR_GL_BUSINESS_UNITS (idempotent)
--   Step 2: Replace RR_SYNC_BUSINESS_UNITS to capture LegalEntityName from JSON
--   Step 3: Update GET gl/businessunits to return legal_entity_name
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run Step 1, Step 2, Step 3 separately (each BEGIN...END; or DDL block).
-- ============================================================


-- ── Step 1: Add LEGAL_ENTITY_NAME column (idempotent) ────────
BEGIN
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_GL_BUSINESS_UNITS ADD LEGAL_ENTITY_NAME VARCHAR2(360)';
        DBMS_OUTPUT.PUT_LINE('LEGAL_ENTITY_NAME column added');
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -1430 THEN
                DBMS_OUTPUT.PUT_LINE('LEGAL_ENTITY_NAME already exists — skipped');
            ELSE RAISE;
            END IF;
    END;
END;
/


-- ── Step 2: Replace sync procedure to capture LegalEntityName ─
CREATE OR REPLACE PROCEDURE RR_SYNC_BUSINESS_UNITS (
    p_json  IN  CLOB,
    p_count OUT NUMBER,
    p_error OUT VARCHAR2
) AS
    v_business_unit_id    NUMBER;
    v_business_unit_name  VARCHAR2(360);
    v_active_flag         VARCHAR2(1);
    v_primary_ledger_id   NUMBER;
    v_location_id         NUMBER;
    v_manager_id          NUMBER;
    v_legal_entity_id     NUMBER;
    v_legal_entity_name   VARCHAR2(360);
    v_profit_center_flag  VARCHAR2(1);
    v_company             VARCHAR2(30);
BEGIN
    p_count := 0;
    p_error := NULL;

    FOR rec IN (
        SELECT *
        FROM JSON_TABLE(p_json, '$.items[*]'
            COLUMNS (
                business_unit_id    NUMBER        PATH '$.BusinessUnitId',
                business_unit_name  VARCHAR2(360) PATH '$.BusinessUnitName',
                active_flag_raw     VARCHAR2(10)  PATH '$.ActiveFlag',
                primary_ledger_id   NUMBER        PATH '$.PrimaryLedgerId',
                location_id         NUMBER        PATH '$.LocationId',
                manager_id          NUMBER        PATH '$.ManagerId',
                legal_entity_id     NUMBER        PATH '$.LegalEntityId',
                legal_entity_name   VARCHAR2(360) PATH '$.LegalEntityName',
                profit_center_raw   VARCHAR2(10)  PATH '$.ProfitCenterFlag',
                company             VARCHAR2(30)  PATH '$.Company'
            )
        )
    ) LOOP
        v_business_unit_id   := rec.business_unit_id;
        v_business_unit_name := rec.business_unit_name;
        v_active_flag        := CASE WHEN LOWER(rec.active_flag_raw) = 'true' THEN 'Y' ELSE 'N' END;
        v_primary_ledger_id  := rec.primary_ledger_id;
        v_location_id        := rec.location_id;
        v_manager_id         := rec.manager_id;
        v_legal_entity_id    := rec.legal_entity_id;
        v_legal_entity_name  := rec.legal_entity_name;
        v_profit_center_flag := CASE WHEN LOWER(rec.profit_center_raw) = 'true' THEN 'Y' ELSE 'N' END;
        v_company            := rec.company;

        MERGE INTO RR_GL_BUSINESS_UNITS tgt
        USING (SELECT v_business_unit_id AS business_unit_id FROM DUAL) src
        ON (tgt.BUSINESS_UNIT_ID = src.business_unit_id)
        WHEN MATCHED THEN
            UPDATE SET
                tgt.BUSINESS_UNIT_NAME  = v_business_unit_name,
                tgt.ACTIVE_FLAG         = v_active_flag,
                tgt.PRIMARY_LEDGER_ID   = v_primary_ledger_id,
                tgt.LOCATION_ID         = v_location_id,
                tgt.MANAGER_ID          = v_manager_id,
                tgt.LEGAL_ENTITY_ID     = v_legal_entity_id,
                tgt.LEGAL_ENTITY_NAME   = NVL(v_legal_entity_name, tgt.LEGAL_ENTITY_NAME),
                tgt.PROFIT_CENTER_FLAG  = v_profit_center_flag,
                tgt.COMPANY             = NVL(v_company, tgt.COMPANY),
                tgt.SYNC_DATE           = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                BUSINESS_UNIT_ID,
                BUSINESS_UNIT_NAME,
                ACTIVE_FLAG,
                PRIMARY_LEDGER_ID,
                LOCATION_ID,
                MANAGER_ID,
                LEGAL_ENTITY_ID,
                LEGAL_ENTITY_NAME,
                PROFIT_CENTER_FLAG,
                COMPANY,
                SYNC_DATE
            ) VALUES (
                v_business_unit_id,
                v_business_unit_name,
                v_active_flag,
                v_primary_ledger_id,
                v_location_id,
                v_manager_id,
                v_legal_entity_id,
                v_legal_entity_name,
                v_profit_center_flag,
                v_company,
                SYSTIMESTAMP
            );

        p_count := p_count + 1;
    END LOOP;

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        p_error := SQLERRM;
        ROLLBACK;
END RR_SYNC_BUSINESS_UNITS;
/


-- ── Step 3: Update GET handler to return legal_entity_name ────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/businessunits',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/businessunits',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'Return all active Business Units including legal_entity_name',
        p_source         => q'[
SELECT
    bu.BUSINESS_UNIT_ID,
    bu.BUSINESS_UNIT_NAME,
    bu.ACTIVE_FLAG,
    bu.PRIMARY_LEDGER_ID,
    bu.LOCATION_ID,
    bu.MANAGER_ID,
    bu.LEGAL_ENTITY_ID,
    bu.LEGAL_ENTITY_NAME,
    bu.PROFIT_CENTER_FLAG,
    NVL(
        bu.COMPANY,
        (SELECT REGEXP_SUBSTR(jl.account_combination, '[^-]+', 1, 1)
         FROM   RR_SLA_ACCOUNTING_HEADERS sh
         JOIN   RR_SLA_JOURNAL_LINES      jl ON jl.header_id = sh.header_id
         WHERE  sh.ledger_id              = bu.PRIMARY_LEDGER_ID
           AND  jl.account_combination   IS NOT NULL
           AND  ROWNUM                    = 1)
    ) AS COMPANY,
    bu.SYNC_DATE
FROM RR_GL_BUSINESS_UNITS bu
WHERE bu.ACTIVE_FLAG = 'Y'
ORDER BY bu.BUSINESS_UNIT_NAME
]'
    );
    COMMIT;
END;
/
