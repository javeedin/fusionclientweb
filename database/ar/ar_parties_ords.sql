-- =====================================================
-- ORDS REST Handlers: AR Parties + their Customer Accounts
--
-- Flow: search PARTIES -> drill into one PARTY -> its ACCOUNTS
--
--   GET {base}/ar/parties?q=<name|number>&status=<status>
--        Search RR_RAW_AR_HZ_PARTIES_DM (list for the search grid)
--   GET {base}/ar/parties/:partyId
--        One party's full detail (RR_RAW_AR_HZ_PARTIES_DM)
--   GET {base}/ar/parties/:partyId/accounts
--        Customer accounts for the party (RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP)
--
-- Module 'ar' (same as ar/customers) — resolves under {base}/ar/...
-- NOTE: ORDS requires each bind variable to appear exactly ONCE in the
--       source SQL, so :q / :status are read once into a params CTE and
--       then referenced as columns (p.q / p.st).
--
-- Run in APEX SQL Workshop -> SQL Commands.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. GET /ar/parties  — search parties
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'parties');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'parties',
        p_comments    => 'AR Parties search'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'parties',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Search AR parties by name / number, optional status (returns {items,count} or {error})',
        p_source         => q'[
DECLARE
    l_q     VARCHAR2(4000) := :q;
    l_st    VARCHAR2(100)  := :status;
    l_cnt   NUMBER := 0;
    l_probe NUMBER;
BEGIN
    -- Probe table visibility first so any ORA error is returned as clean JSON
    -- (instead of a half-written array). ROWNUM=1 keeps it cheap.
    SELECT COUNT(*) INTO l_probe FROM RR_RAW_AR_HZ_PARTIES_DM WHERE ROWNUM = 1;

    APEX_JSON.open_object;
    APEX_JSON.open_array('items');
    FOR r IN (
        SELECT PARTY_ID, PARTY_NUMBER, PARTY_NAME, PARTY_TYPE,
               COUNTRY, ADDRESS1, ADDRESS2, CITY, STATUS
        FROM   RR_RAW_AR_HZ_PARTIES_DM
        WHERE  (l_q IS NULL OR TRIM(l_q) IS NULL
                OR UPPER(PARTY_NAME)   LIKE UPPER('%' || l_q || '%')
                OR UPPER(PARTY_NUMBER) LIKE UPPER('%' || l_q || '%'))
          AND  (l_st IS NULL OR TRIM(l_st) IS NULL
                OR UPPER(STATUS) = UPPER(l_st))
        ORDER  BY PARTY_NAME
        FETCH FIRST 500 ROWS ONLY
    ) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('party_id',     r.PARTY_ID);
        APEX_JSON.write('party_number', r.PARTY_NUMBER);
        APEX_JSON.write('party_name',   r.PARTY_NAME);
        APEX_JSON.write('party_type',   r.PARTY_TYPE);
        APEX_JSON.write('country',      r.COUNTRY);
        APEX_JSON.write('address1',     r.ADDRESS1);
        APEX_JSON.write('address2',     r.ADDRESS2);
        APEX_JSON.write('city',         r.CITY);
        APEX_JSON.write('status',       r.STATUS);
        APEX_JSON.close_object;
        l_cnt := l_cnt + 1;
    END LOOP;
    APEX_JSON.close_array;
    APEX_JSON.write('count',      l_cnt);
    APEX_JSON.write('tableCount', l_probe);   -- rows visible to ORDS (0/1 probe)
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.open_object;
        APEX_JSON.open_array('items');
        APEX_JSON.close_array;
        APEX_JSON.write('count', 0);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END;
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────
-- 2. GET /ar/parties/:partyId  — one party's detail
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'parties/:partyId');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'parties/:partyId',
        p_comments    => 'AR Party detail'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'parties/:partyId',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_comments       => 'Full detail for a single party',
        p_source         => q'[
SELECT c.*
FROM RR_RAW_AR_HZ_PARTIES_DM c
WHERE c.PARTY_ID = :partyId
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────
-- 3. GET /ar/parties/:partyId/accounts  — accounts for a party
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'parties/:partyId/accounts');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'parties/:partyId/accounts',
        p_comments    => 'Customer accounts for a party'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'parties/:partyId/accounts',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'Customer accounts (RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP) for the party',
        p_source         => q'[
SELECT c.*
FROM RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP c
WHERE c.PARTY_ID = :partyId
ORDER BY c.ACCOUNT_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- GET {base}/ar/parties?q=<name|number>&status=<status>   List/search parties
-- GET {base}/ar/parties/:partyId                          One party's detail
-- GET {base}/ar/parties/:partyId/accounts                 Accounts for the party
-- =====================================================

-- Verify
SELECT module_name, uri_template, method
FROM   user_ords_handlers
WHERE  module_name = 'ar'
  AND  uri_template LIKE 'parties%'
ORDER  BY uri_template;
