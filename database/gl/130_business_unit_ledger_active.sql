-- =====================================================
-- PATCH 130: Business Unit — Active Flag + Ledger name fixes
--
-- Fixes two problems seen when creating a Business Unit from the
-- GL → Manage Business Units page:
--
--   1. ACTIVE_FLAG was blanked/inverted for manually created BUs.
--      RR_SYNC_BUSINESS_UNITS only mapped the Fusion boolean
--      ('true'/'false'); the UI sends 'Y'/'N', so LOWER('Y') <> 'true'
--      forced every manual BU to 'N' (and it then vanished from the
--      active-only GET). The procedure below accepts BOTH the Fusion
--      boolean and a literal 'Y'/'N', and defaults to 'Y' when absent.
--
--   2. Ledger name showed blank in the grid. The GET handlers returned
--      only PRIMARY_LEDGER_ID — there is no ledger-name column on the BU
--      table. Both GET handlers now resolve the ledger name from
--      RR_LEDGERS by PRIMARY_LEDGER_ID and return it as "ledger".
--
-- COMPANY was already mapped from $.Company by RR_SYNC_BUSINESS_UNITS and
-- returned by the GET; this patch re-deploys the procedure so any pod
-- still running an older version (which is why Company came back blank)
-- picks up the mapping.
--
-- RUN ORDER: the guarded ALTER, the CREATE OR REPLACE PROCEDURE, then the
-- two ORDS blocks. Safe to re-run.
-- =====================================================

-- ── 0. Ensure audit columns exist (idempotent; also added by patch 129) ─
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_GL_BUSINESS_UNITS ADD (CREATED_BY VARCHAR2(150))';
EXCEPTION WHEN OTHERS THEN NULL; -- column already exists
END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_GL_BUSINESS_UNITS ADD (CREATION_DATE TIMESTAMP(6))';
EXCEPTION WHEN OTHERS THEN NULL; -- column already exists
END;
/

-- ── 1. Procedure: accept 'Y'/'N' as well as true/false ───────────────
CREATE OR REPLACE PROCEDURE RR_SYNC_BUSINESS_UNITS (
    p_json  IN  CLOB,
    p_count OUT NUMBER,
    p_error OUT VARCHAR2
) AS
    v_business_unit_id   NUMBER;
    v_business_unit_name VARCHAR2(360);
    v_active_flag        VARCHAR2(1);
    v_primary_ledger_id  NUMBER;
    v_location_id        NUMBER;
    v_manager_id         NUMBER;
    v_legal_entity_id    NUMBER;
    v_profit_center_flag VARCHAR2(1);
    v_company            VARCHAR2(30);
    v_created_by         VARCHAR2(150);
BEGIN
    p_count := 0;
    p_error := NULL;

    FOR rec IN (
        SELECT *
        FROM JSON_TABLE(p_json, '$.items[*]'
            COLUMNS (
                business_unit_id    NUMBER        PATH '$.BusinessUnitId',
                business_unit_name  VARCHAR2(360) PATH '$.BusinessUnitName',
                -- May arrive as a Fusion boolean ('true'/'false') OR a
                -- literal 'Y'/'N' from the manual create form.
                active_flag_raw     VARCHAR2(10)  PATH '$.ActiveFlag',
                primary_ledger_id   NUMBER        PATH '$.PrimaryLedgerId',
                location_id         NUMBER        PATH '$.LocationId',
                manager_id          NUMBER        PATH '$.ManagerId',
                legal_entity_id     NUMBER        PATH '$.LegalEntityId',
                profit_center_raw   VARCHAR2(10)  PATH '$.ProfitCenterFlag',
                company             VARCHAR2(30)  PATH '$.Company',
                created_by          VARCHAR2(150) PATH '$.CreatedBy'
            )
        )
    ) LOOP
        v_business_unit_id   := rec.business_unit_id;
        v_business_unit_name := rec.business_unit_name;
        -- 'true'/'y'/'yes'/'1' => Y ; NULL/absent => Y ; anything else => N
        v_active_flag        := CASE
                                    WHEN rec.active_flag_raw IS NULL THEN 'Y'
                                    WHEN LOWER(rec.active_flag_raw) IN ('true', 'y', 'yes', '1') THEN 'Y'
                                    ELSE 'N'
                                END;
        v_primary_ledger_id  := rec.primary_ledger_id;
        v_location_id        := rec.location_id;
        v_manager_id         := rec.manager_id;
        v_legal_entity_id    := rec.legal_entity_id;
        v_profit_center_flag := CASE
                                    WHEN LOWER(rec.profit_center_raw) IN ('true', 'y', 'yes', '1') THEN 'Y'
                                    ELSE 'N'
                                END;
        v_company            := rec.company;
        v_created_by         := rec.created_by;

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
                PROFIT_CENTER_FLAG,
                COMPANY,
                CREATED_BY,
                CREATION_DATE,
                SYNC_DATE
            ) VALUES (
                v_business_unit_id,
                v_business_unit_name,
                v_active_flag,
                v_primary_ledger_id,
                v_location_id,
                v_manager_id,
                v_legal_entity_id,
                v_profit_center_flag,
                v_company,
                v_created_by,
                SYSTIMESTAMP,
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


-- ── 2. GET gl/businessunits — return ledger name + company ───────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/businessunits',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'Return all active Business Units (with ledger name)',
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
    -- Ledger display name resolved from the ledger master
    (SELECT l.ledger_name FROM RR_LEDGERS l
      WHERE l.ledger_id = bu.PRIMARY_LEDGER_ID AND ROWNUM = 1) AS LEDGER,
    -- COMPANY: stored value if set, otherwise derive from first segment
    -- of an account combination on this BU's ledger
    NVL(
        bu.COMPANY,
        (SELECT REGEXP_SUBSTR(jl.account_combination, '[^-]+', 1, 1)
         FROM   RR_SLA_ACCOUNTING_HEADERS sh
         JOIN   RR_SLA_JOURNAL_LINES      jl ON jl.header_id = sh.header_id
         WHERE  sh.ledger_id              = bu.PRIMARY_LEDGER_ID
           AND  jl.account_combination   IS NOT NULL
           AND  ROWNUM                    = 1)
    ) AS COMPANY,
    bu.CREATED_BY,
    TO_CHAR(bu.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI') AS CREATION_DATE,
    bu.SYNC_DATE
FROM RR_GL_BUSINESS_UNITS bu
WHERE bu.ACTIVE_FLAG = 'Y'
ORDER BY bu.BUSINESS_UNIT_NAME
]'
    );

    COMMIT;
END;
/


-- ── 3. GET gl/businessunits/all — same, including inactive ───────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/businessunits/all',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'All Business Units (active + inactive, with ledger name)',
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
    (SELECT l.ledger_name FROM RR_LEDGERS l
      WHERE l.ledger_id = bu.PRIMARY_LEDGER_ID AND ROWNUM = 1) AS LEDGER,
    NVL(
        bu.COMPANY,
        (SELECT REGEXP_SUBSTR(jl.account_combination, '[^-]+', 1, 1)
         FROM   RR_SLA_ACCOUNTING_HEADERS sh
         JOIN   RR_SLA_JOURNAL_LINES      jl ON jl.header_id = sh.header_id
         WHERE  sh.ledger_id              = bu.PRIMARY_LEDGER_ID
           AND  jl.account_combination   IS NOT NULL
           AND  ROWNUM                    = 1)
    ) AS COMPANY,
    bu.CREATED_BY,
    TO_CHAR(bu.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI') AS CREATION_DATE,
    bu.SYNC_DATE
FROM RR_GL_BUSINESS_UNITS bu
ORDER BY bu.BUSINESS_UNIT_NAME
]'
    );

    COMMIT;
END;
/

-- =====================================================
-- VERIFY
--   In the app: GL → Manage Business Units → Create Business Unit
--     • Active Flag defaults to Y (now a real field you can change)
--     • After Create, the new row shows Company code and Ledger name
--   GET {base}/gl/businessunits       → each item has "ledger" + "company"
--   GET {base}/gl/businessunits/all   → same, includes inactive BUs
-- =====================================================
