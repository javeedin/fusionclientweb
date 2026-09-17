-- ============================================================
-- Patch 155 (DATA FIX): assign ALL parties to business unit
--   'BUMERIC CORP_DIFC_INVST'
-- with Receivables account 01-00-00-1221101-0000-000-00-000-000
--
-- Source of parties: RR_RAW_AR_HZ_PARTIES_DM (PARTY_ID, PARTY_NAME).
-- Target: RR_BU_ACCOUNTS_ASSIGNMENTS (script 154).
--
-- Idempotent:
--   * party has no row for this BU        -> row inserted
--   * party already has a row for this BU -> untouched, except a NULL
--     RECEIVABLES_ACCOUNT is filled with the account below
--
-- NOTE: verify the BU name spelling first — the rest of the system
-- uses the prefix 'BUIMERC'. Check with:
--   SELECT business_unit_name, company_code FROM (whatever gl/businessunits reads)
-- or via GET {base}/gl/businessunits — and correct c_bu below if needed.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands, run the block, then
-- the verify SELECT.
-- ============================================================

DECLARE
    c_bu    CONSTANT VARCHAR2(240) := 'BUMERIC CORP_DIFC_INVST';
    c_acct  CONSTANT VARCHAR2(200) := '01-00-00-1221101-0000-000-00-000-000';
    c_co    CONSTANT VARCHAR2(30)  := '01';   -- company segment of the account
    l_ins   NUMBER;
BEGIN
    MERGE INTO RR_BU_ACCOUNTS_ASSIGNMENTS t
    USING (
        SELECT TO_NUMBER(p.PARTY_ID DEFAULT NULL ON CONVERSION ERROR) AS party_id,
               MAX(p.PARTY_NAME)                                      AS party_name
          FROM RR_RAW_AR_HZ_PARTIES_DM p
         WHERE TO_NUMBER(p.PARTY_ID DEFAULT NULL ON CONVERSION ERROR) IS NOT NULL
         GROUP BY TO_NUMBER(p.PARTY_ID DEFAULT NULL ON CONVERSION ERROR)
    ) s
    ON (t.PARTY_ID = s.party_id AND t.BUSINESS_UNIT_NAME = c_bu)
    WHEN MATCHED THEN UPDATE
        SET t.RECEIVABLES_ACCOUNT = NVL(t.RECEIVABLES_ACCOUNT, c_acct),
            t.LAST_UPDATED_BY     = 'DATA_FIX_155',
            t.LAST_UPDATE_DATE    = SYSTIMESTAMP
        WHERE t.RECEIVABLES_ACCOUNT IS NULL
    WHEN NOT MATCHED THEN INSERT (
        PARTY_ID, PARTY_NAME, BUSINESS_UNIT_NAME, COMPANY_CODE,
        RECEIVABLES_ACCOUNT, STATUS, CREATED_BY, LAST_UPDATED_BY
    ) VALUES (
        s.party_id, s.party_name, c_bu, c_co,
        c_acct, 'ACTIVE', 'DATA_FIX_155', 'DATA_FIX_155'
    );

    l_ins := SQL%ROWCOUNT;
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('Rows inserted/updated: ' || l_ins);
END;
/

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) AS assigned,
--        COUNT(DISTINCT party_id) AS parties
--   FROM RR_BU_ACCOUNTS_ASSIGNMENTS
--  WHERE BUSINESS_UNIT_NAME = 'BUMERIC CORP_DIFC_INVST';
--
-- Parties still without the BU (should be 0):
-- SELECT COUNT(*)
--   FROM (SELECT DISTINCT TO_NUMBER(PARTY_ID DEFAULT NULL ON CONVERSION ERROR) pid
--           FROM RR_RAW_AR_HZ_PARTIES_DM
--          WHERE TO_NUMBER(PARTY_ID DEFAULT NULL ON CONVERSION ERROR) IS NOT NULL) p
--  WHERE NOT EXISTS (SELECT 1 FROM RR_BU_ACCOUNTS_ASSIGNMENTS a
--                     WHERE a.PARTY_ID = p.pid
--                       AND a.BUSINESS_UNIT_NAME = 'BUMERIC CORP_DIFC_INVST');
