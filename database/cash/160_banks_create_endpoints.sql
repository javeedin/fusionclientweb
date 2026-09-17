-- ============================================================================
-- 160_banks_create_endpoints.sql
-- Manual create endpoints for the Banks page wizard (New Bank / New Branch /
-- Create Bank Account). Inserts go into the same tables the Fusion sync uses
-- (RR_BANKS / RR_BANK_BRANCHES / RR_BANK_ACCOUNTS) so the lists, LOVs and the
-- account PUT keep working unchanged.
--
-- Locally created rows get IDs from RR_BANK_LOCAL_SEQ (starts at
-- 900000000001) so they can never collide with Fusion party/account ids, and
-- their party numbers are prefixed 'L-' to make the origin obvious.
--
--   POST banks/create           {bankName*, bankNumber, countryName, description, createdBy}
--   POST banks/branches/create  {bankName*, branchName*, branchNumber, swiftCode, countryName, description, createdBy}
--   POST banks/accounts/create  {bankName*, branchName*, accountName*, accountNumber*, legalEntityName*,
--                                currencyCode, accountType, ibanNumber, description,
--                                apUseAllowed, arUseAllowed, createdBy}
--
-- Run ALL blocks in APEX SQL Workshop -> SQL Scripts (not SQL Commands).
-- ============================================================================

-- ── Block 1: local id sequence ──────────────────────────────────────────────
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_sequences WHERE sequence_name = 'RR_BANK_LOCAL_SEQ';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_BANK_LOCAL_SEQ START WITH 900000000001 INCREMENT BY 1 NOCACHE';
    END IF;
END;
/

-- ── Block 2: POST banks/create ──────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/create',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Create a bank manually (local row in RR_BANKS)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Insert a manually created bank',
        p_source         => q'[
DECLARE
    l_body        CLOB;
    l_bank_name   VARCHAR2(360);
    l_bank_number VARCHAR2(60);
    l_country     VARCHAR2(100);
    l_desc        VARCHAR2(240);
    l_created_by  VARCHAR2(150);
    l_id          NUMBER;
    l_dup         NUMBER;
BEGIN
    l_body        := :body_text;
    l_bank_name   := JSON_VALUE(l_body, '$.bankName');
    l_bank_number := JSON_VALUE(l_body, '$.bankNumber');
    l_country     := JSON_VALUE(l_body, '$.countryName');
    l_desc        := JSON_VALUE(l_body, '$.description');
    l_created_by  := NVL(JSON_VALUE(l_body, '$.createdBy'), 'REERP');

    IF l_bank_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success": false, "error": "bankName is required"}');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO l_dup FROM RR_BANKS WHERE UPPER(BANK_NAME) = UPPER(l_bank_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P('{"success": false, "error": "A bank with this name already exists"}');
        RETURN;
    END IF;

    l_id := RR_BANK_LOCAL_SEQ.NEXTVAL;

    INSERT INTO RR_BANKS (
        BANK_PARTY_ID, BANK_NAME, BANK_NUMBER, DESCRIPTION, COUNTRY_NAME,
        BANK_PARTY_NUMBER, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE,
        LAST_UPDATED_BY, SYNC_DATE
    ) VALUES (
        l_id, l_bank_name, l_bank_number, l_desc, l_country,
        'L-' || l_id, l_created_by, SYSTIMESTAMP, SYSTIMESTAMP,
        l_created_by, SYSTIMESTAMP
    );
    COMMIT;

    :status_code := 201;
    HTP.P('{"success": true, "bankPartyId": ' || l_id || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── Block 3: POST banks/branches/create ─────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/branches/create',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Create a bank branch manually (local row in RR_BANK_BRANCHES)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/branches/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Insert a manually created bank branch under an existing bank',
        p_source         => q'[
DECLARE
    l_body          CLOB;
    l_bank_name     VARCHAR2(360);
    l_branch_name   VARCHAR2(360);
    l_branch_number VARCHAR2(60);
    l_swift         VARCHAR2(60);
    l_country       VARCHAR2(100);
    l_desc          VARCHAR2(240);
    l_created_by    VARCHAR2(150);
    l_id            NUMBER;
    l_dup           NUMBER;
    l_bank_number   VARCHAR2(60);
    l_bank_party_no VARCHAR2(60);
    l_bank_country  VARCHAR2(100);
BEGIN
    l_body          := :body_text;
    l_bank_name     := JSON_VALUE(l_body, '$.bankName');
    l_branch_name   := JSON_VALUE(l_body, '$.branchName');
    l_branch_number := JSON_VALUE(l_body, '$.branchNumber');
    l_swift         := JSON_VALUE(l_body, '$.swiftCode');
    l_country       := JSON_VALUE(l_body, '$.countryName');
    l_desc          := JSON_VALUE(l_body, '$.description');
    l_created_by    := NVL(JSON_VALUE(l_body, '$.createdBy'), 'REERP');

    IF l_bank_name IS NULL OR l_branch_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success": false, "error": "bankName and branchName are required"}');
        RETURN;
    END IF;

    BEGIN
        SELECT BANK_NUMBER, BANK_PARTY_NUMBER, COUNTRY_NAME
          INTO l_bank_number, l_bank_party_no, l_bank_country
          FROM RR_BANKS
         WHERE UPPER(BANK_NAME) = UPPER(l_bank_name)
           AND ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"success": false, "error": "Bank not found: create the bank first"}');
            RETURN;
    END;

    SELECT COUNT(*) INTO l_dup
      FROM RR_BANK_BRANCHES
     WHERE UPPER(BANK_NAME) = UPPER(l_bank_name)
       AND UPPER(BANK_BRANCH_NAME) = UPPER(l_branch_name);
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P('{"success": false, "error": "This branch already exists for the bank"}');
        RETURN;
    END IF;

    l_id := RR_BANK_LOCAL_SEQ.NEXTVAL;

    INSERT INTO RR_BANK_BRANCHES (
        BRANCH_PARTY_ID, BANK_NAME, BANK_NUMBER, BANK_BRANCH_NAME, BRANCH_NUMBER,
        DESCRIPTION, EFT_SWIFT_CODE, BANK_PARTY_NUMBER, BRANCH_PARTY_NUMBER,
        COUNTRY_NAME, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE, SYNC_DATE
    ) VALUES (
        l_id, l_bank_name, l_bank_number, l_branch_name, l_branch_number,
        l_desc, l_swift, l_bank_party_no, 'L-' || l_id,
        NVL(l_country, l_bank_country), l_created_by, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP
    );
    COMMIT;

    :status_code := 201;
    HTP.P('{"success": true, "branchPartyId": ' || l_id || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── Block 4: POST banks/accounts/create ─────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/accounts/create',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Create a bank account manually (local row in RR_BANK_ACCOUNTS)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/accounts/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Insert a manually created bank account under an existing branch, assigned to a legal entity',
        p_source         => q'[
DECLARE
    l_body          CLOB;
    l_bank_name     VARCHAR2(360);
    l_branch_name   VARCHAR2(360);
    l_acct_name     VARCHAR2(360);
    l_acct_number   VARCHAR2(100);
    l_legal_entity  VARCHAR2(360);
    l_currency      VARCHAR2(15);
    l_acct_type     VARCHAR2(60);
    l_iban          VARCHAR2(100);
    l_desc          VARCHAR2(240);
    l_ap_use        VARCHAR2(5);
    l_ar_use        VARCHAR2(5);
    l_created_by    VARCHAR2(150);
    l_id            NUMBER;
    l_dup           NUMBER;
    l_bank_number   VARCHAR2(60);
    l_branch_number VARCHAR2(60);
    l_country       VARCHAR2(100);
BEGIN
    l_body         := :body_text;
    l_bank_name    := JSON_VALUE(l_body, '$.bankName');
    l_branch_name  := JSON_VALUE(l_body, '$.branchName');
    l_acct_name    := JSON_VALUE(l_body, '$.accountName');
    l_acct_number  := JSON_VALUE(l_body, '$.accountNumber');
    l_legal_entity := JSON_VALUE(l_body, '$.legalEntityName');
    l_currency     := JSON_VALUE(l_body, '$.currencyCode');
    l_acct_type    := JSON_VALUE(l_body, '$.accountType');
    l_iban         := JSON_VALUE(l_body, '$.ibanNumber');
    l_desc         := JSON_VALUE(l_body, '$.description');
    l_ap_use       := NVL(JSON_VALUE(l_body, '$.apUseAllowed'), 'true');
    l_ar_use       := NVL(JSON_VALUE(l_body, '$.arUseAllowed'), 'true');
    l_created_by   := NVL(JSON_VALUE(l_body, '$.createdBy'), 'REERP');

    IF l_bank_name IS NULL OR l_branch_name IS NULL
       OR l_acct_name IS NULL OR l_acct_number IS NULL THEN
        :status_code := 400;
        HTP.P('{"success": false, "error": "bankName, branchName, accountName and accountNumber are required"}');
        RETURN;
    END IF;

    IF l_legal_entity IS NULL THEN
        :status_code := 400;
        HTP.P('{"success": false, "error": "legalEntityName is required"}');
        RETURN;
    END IF;

    BEGIN
        SELECT BANK_NUMBER, BRANCH_NUMBER, COUNTRY_NAME
          INTO l_bank_number, l_branch_number, l_country
          FROM RR_BANK_BRANCHES
         WHERE UPPER(BANK_NAME) = UPPER(l_bank_name)
           AND UPPER(BANK_BRANCH_NAME) = UPPER(l_branch_name)
           AND ROWNUM = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"success": false, "error": "Branch not found: create the branch first"}');
            RETURN;
    END;

    SELECT COUNT(*) INTO l_dup
      FROM RR_BANK_ACCOUNTS
     WHERE UPPER(BANK_BRANCH_NAME) = UPPER(l_branch_name)
       AND BANK_ACCOUNT_NUMBER = l_acct_number;
    IF l_dup > 0 THEN
        :status_code := 409;
        HTP.P('{"success": false, "error": "An account with this number already exists in the branch"}');
        RETURN;
    END IF;

    l_id := RR_BANK_LOCAL_SEQ.NEXTVAL;

    INSERT INTO RR_BANK_ACCOUNTS (
        BANK_ACCOUNT_ID, BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER,
        BANK_ACCOUNT_NUMBER_ELECTRONIC, MASKED_ACCOUNT_NUMBER, IBAN_NUMBER,
        ACCOUNT_TYPE, CURRENCY_CODE, DESCRIPTION,
        BANK_NAME, BANK_BRANCH_NAME, BANK_NUMBER, BRANCH_NUMBER, COUNTRY_NAME,
        LEGAL_ENTITY_NAME, AP_USE_ALLOWED_FLAG, AR_USE_ALLOWED_FLAG,
        CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE, SYNC_DATE
    ) VALUES (
        l_id, l_acct_name, l_acct_number,
        l_acct_number, 'XXXX' || SUBSTR(l_acct_number, -4), l_iban,
        l_acct_type, l_currency, l_desc,
        l_bank_name, l_branch_name, l_bank_number, l_branch_number, l_country,
        l_legal_entity, l_ap_use, l_ar_use,
        l_created_by, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP
    );
    COMMIT;

    :status_code := 201;
    HTP.P('{"success": true, "bankAccountId": ' || l_id || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── Verification ────────────────────────────────────────────────────────────
-- SELECT uh.method, ut.uri_template
--   FROM user_ords_handlers uh
--   JOIN user_ords_templates ut ON ut.id = uh.template_id
--  WHERE ut.uri_template IN ('banks/create', 'banks/branches/create', 'banks/accounts/create')
--  ORDER BY ut.uri_template;
-- Expect one POST per template.
