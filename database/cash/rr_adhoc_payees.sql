-- ============================================================
-- RR_ADHOC_PAYEE — Ad-hoc / manual payee registry
-- RR_PAYEE_BANK_ACCOUNTS — Bank accounts per payee
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE RR_ADHOC_PAYEE (
    PAYEE_ID                NUMBER          NOT NULL,
    PAYEE_NAME              VARCHAR2(360)   NOT NULL,
    TAX_REGISTRATION_NUMBER VARCHAR2(60),
    DESCRIPTION             VARCHAR2(500),
    ACTIVE                  VARCHAR2(1)     DEFAULT 'Y' NOT NULL,
    CREATED_BY              VARCHAR2(150),
    CREATION_DATE           DATE            DEFAULT SYSDATE,
    LAST_UPDATED_BY         VARCHAR2(150),
    LAST_UPDATE_DATE        DATE            DEFAULT SYSDATE,
    CONSTRAINT RR_ADHOC_PAYEE_PK PRIMARY KEY (PAYEE_ID)
);

CREATE SEQUENCE RR_ADHOC_PAYEE_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;

CREATE TABLE RR_PAYEE_BANK_ACCOUNTS (
    PAYEE_BANK_ACCOUNT_ID   NUMBER          NOT NULL,
    PAYEE_ID                NUMBER          NOT NULL,
    COUNTRY                 VARCHAR2(100),
    ACCOUNT_NUMBER          VARCHAR2(100),
    CURRENCY_CODE           VARCHAR2(15),
    IBAN                    VARCHAR2(100),
    ACCOUNT_HOLDER_NAME     VARCHAR2(360),
    BANK_NAME               VARCHAR2(360),
    BANK_BRANCH             VARCHAR2(360),
    BIC_CODE                VARCHAR2(30),
    ACTIVE                  VARCHAR2(1)     DEFAULT 'Y' NOT NULL,
    CREATED_BY              VARCHAR2(150),
    CREATION_DATE           DATE            DEFAULT SYSDATE,
    LAST_UPDATED_BY         VARCHAR2(150),
    LAST_UPDATE_DATE        DATE            DEFAULT SYSDATE,
    CONSTRAINT RR_PAYEE_BANK_ACCTS_PK PRIMARY KEY (PAYEE_BANK_ACCOUNT_ID),
    CONSTRAINT RR_PAYEE_BANK_ACCTS_FK FOREIGN KEY (PAYEE_ID)
        REFERENCES RR_ADHOC_PAYEE(PAYEE_ID) ON DELETE CASCADE
);

CREATE SEQUENCE RR_PAYEE_BANK_ACCT_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;

CREATE INDEX RR_PAYEE_BANK_ACCTS_IDX ON RR_PAYEE_BANK_ACCOUNTS(PAYEE_ID);

-- ── ORDS: GET + POST /cash/payees ────────────────────────────

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Ad-hoc payees'
    );

    -- GET: list payees (collection feed, snake_case keys)
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'List all payees',
        p_source         => q'[
SELECT PAYEE_ID,
       PAYEE_NAME,
       TAX_REGISTRATION_NUMBER,
       DESCRIPTION,
       ACTIVE,
       TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
       TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE
  FROM RR_ADHOC_PAYEE
 ORDER BY PAYEE_NAME
]'
    );

    -- POST: create payee
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create payee',
        p_source         => q'[
DECLARE
    l_json   CLOB  := :body_text;
    l_id     NUMBER;
    l_name   VARCHAR2(360);
    l_tax    VARCHAR2(60);
    l_desc   VARCHAR2(500);
    l_active VARCHAR2(1);
BEGIN
    SELECT RR_ADHOC_PAYEE_SEQ.NEXTVAL INTO l_id FROM DUAL;

    SELECT
        j.payee_name,
        j.tax_registration_number,
        j.description,
        NVL(j.active, 'Y')
    INTO l_name, l_tax, l_desc, l_active
    FROM JSON_TABLE(l_json, '$'
         COLUMNS (
             payee_name              VARCHAR2(360) PATH '$.payeeName',
             tax_registration_number VARCHAR2(60)  PATH '$.taxRegistrationNumber',
             description             VARCHAR2(500) PATH '$.description',
             active                  VARCHAR2(1)   PATH '$.active'
         )
    ) j;

    INSERT INTO RR_ADHOC_PAYEE (
        PAYEE_ID, PAYEE_NAME, TAX_REGISTRATION_NUMBER, DESCRIPTION, ACTIVE,
        CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
    ) VALUES (
        l_id, l_name, l_tax, l_desc, l_active,
        'ERP_USER', SYSDATE, 'ERP_USER', SYSDATE
    );
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"payeeId":' || l_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── ORDS: PUT + DELETE /cash/payees/:payee_id ────────────────

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Payee by ID'
    );

    -- PUT: update payee
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update payee',
        p_source         => q'[
DECLARE
    l_json   CLOB  := :body_text;
    l_id     NUMBER := :payee_id;
    l_name   VARCHAR2(360);
    l_tax    VARCHAR2(60);
    l_desc   VARCHAR2(500);
    l_active VARCHAR2(1);
BEGIN
    SELECT j.payee_name, j.tax_registration_number, j.description, j.active
    INTO   l_name, l_tax, l_desc, l_active
    FROM JSON_TABLE(l_json, '$'
         COLUMNS (
             payee_name              VARCHAR2(360) PATH '$.payeeName',
             tax_registration_number VARCHAR2(60)  PATH '$.taxRegistrationNumber',
             description             VARCHAR2(500) PATH '$.description',
             active                  VARCHAR2(1)   PATH '$.active'
         )
    ) j;

    UPDATE RR_ADHOC_PAYEE SET
        PAYEE_NAME              = l_name,
        TAX_REGISTRATION_NUMBER = l_tax,
        DESCRIPTION             = l_desc,
        ACTIVE                  = l_active,
        LAST_UPDATED_BY         = 'ERP_USER',
        LAST_UPDATE_DATE        = SYSDATE
    WHERE PAYEE_ID = l_id;
    COMMIT;

    :status_code := 200;
    HTP.P('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    -- DELETE: delete payee (cascades to bank accounts)
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete payee',
        p_source         => q'[
BEGIN
    DELETE FROM RR_ADHOC_PAYEE WHERE PAYEE_ID = :payee_id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── ORDS: GET + POST /cash/payees/:payee_id/bankaccounts ─────

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id/bankaccounts'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id/bankaccounts',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Bank accounts for a payee'
    );

    -- GET: list bank accounts for payee
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id/bankaccounts',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Get bank accounts for a payee',
        p_source         => q'[
SELECT PAYEE_BANK_ACCOUNT_ID,
       PAYEE_ID,
       COUNTRY,
       ACCOUNT_NUMBER,
       CURRENCY_CODE,
       IBAN,
       ACCOUNT_HOLDER_NAME,
       BANK_NAME,
       BANK_BRANCH,
       BIC_CODE,
       ACTIVE
  FROM RR_PAYEE_BANK_ACCOUNTS
 WHERE PAYEE_ID = :payee_id
 ORDER BY PAYEE_BANK_ACCOUNT_ID
]'
    );

    -- POST: add bank account
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id/bankaccounts',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Add bank account to payee',
        p_source         => q'[
DECLARE
    l_json  CLOB   := :body_text;
    l_pid   NUMBER := :payee_id;
    l_id    NUMBER;
    l_country VARCHAR2(100); l_acct VARCHAR2(100); l_ccy VARCHAR2(15);
    l_iban  VARCHAR2(100);   l_holder VARCHAR2(360);
    l_bank  VARCHAR2(360);   l_branch VARCHAR2(360);
    l_bic   VARCHAR2(30);    l_active VARCHAR2(1);
BEGIN
    SELECT RR_PAYEE_BANK_ACCT_SEQ.NEXTVAL INTO l_id FROM DUAL;

    SELECT j.country, j.account_number, j.currency_code, j.iban,
           j.account_holder_name, j.bank_name, j.bank_branch, j.bic_code, NVL(j.active,'Y')
    INTO   l_country, l_acct, l_ccy, l_iban,
           l_holder, l_bank, l_branch, l_bic, l_active
    FROM JSON_TABLE(l_json, '$'
         COLUMNS (
             country              VARCHAR2(100) PATH '$.country',
             account_number       VARCHAR2(100) PATH '$.accountNumber',
             currency_code        VARCHAR2(15)  PATH '$.currencyCode',
             iban                 VARCHAR2(100) PATH '$.iban',
             account_holder_name  VARCHAR2(360) PATH '$.accountHolderName',
             bank_name            VARCHAR2(360) PATH '$.bankName',
             bank_branch          VARCHAR2(360) PATH '$.bankBranch',
             bic_code             VARCHAR2(30)  PATH '$.bicCode',
             active               VARCHAR2(1)   PATH '$.active'
         )
    ) j;

    INSERT INTO RR_PAYEE_BANK_ACCOUNTS (
        PAYEE_BANK_ACCOUNT_ID, PAYEE_ID,
        COUNTRY, ACCOUNT_NUMBER, CURRENCY_CODE, IBAN,
        ACCOUNT_HOLDER_NAME, BANK_NAME, BANK_BRANCH, BIC_CODE, ACTIVE,
        CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE
    ) VALUES (
        l_id, l_pid,
        l_country, l_acct, l_ccy, l_iban,
        l_holder, l_bank, l_branch, l_bic, l_active,
        'ERP_USER', SYSDATE, 'ERP_USER', SYSDATE
    );
    COMMIT;

    :status_code := 201;
    HTP.P('{"success":true,"payeeBankAccountId":' || l_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/

-- ── ORDS: PUT + DELETE /cash/payees/:payee_id/bankaccounts/:account_id ──

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id/bankaccounts/:account_id'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/payees/:payee_id/bankaccounts/:account_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Payee bank account by ID'
    );

    -- PUT: update bank account
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id/bankaccounts/:account_id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update payee bank account',
        p_source         => q'[
DECLARE
    l_json  CLOB   := :body_text;
    l_id    NUMBER := :account_id;
    l_country VARCHAR2(100); l_acct VARCHAR2(100); l_ccy VARCHAR2(15);
    l_iban  VARCHAR2(100);   l_holder VARCHAR2(360);
    l_bank  VARCHAR2(360);   l_branch VARCHAR2(360);
    l_bic   VARCHAR2(30);    l_active VARCHAR2(1);
BEGIN
    SELECT j.country, j.account_number, j.currency_code, j.iban,
           j.account_holder_name, j.bank_name, j.bank_branch, j.bic_code, j.active
    INTO   l_country, l_acct, l_ccy, l_iban,
           l_holder, l_bank, l_branch, l_bic, l_active
    FROM JSON_TABLE(l_json, '$'
         COLUMNS (
             country              VARCHAR2(100) PATH '$.country',
             account_number       VARCHAR2(100) PATH '$.accountNumber',
             currency_code        VARCHAR2(15)  PATH '$.currencyCode',
             iban                 VARCHAR2(100) PATH '$.iban',
             account_holder_name  VARCHAR2(360) PATH '$.accountHolderName',
             bank_name            VARCHAR2(360) PATH '$.bankName',
             bank_branch          VARCHAR2(360) PATH '$.bankBranch',
             bic_code             VARCHAR2(30)  PATH '$.bicCode',
             active               VARCHAR2(1)   PATH '$.active'
         )
    ) j;

    UPDATE RR_PAYEE_BANK_ACCOUNTS SET
        COUNTRY              = l_country,
        ACCOUNT_NUMBER       = l_acct,
        CURRENCY_CODE        = l_ccy,
        IBAN                 = l_iban,
        ACCOUNT_HOLDER_NAME  = l_holder,
        BANK_NAME            = l_bank,
        BANK_BRANCH          = l_branch,
        BIC_CODE             = l_bic,
        ACTIVE               = l_active,
        LAST_UPDATED_BY      = 'ERP_USER',
        LAST_UPDATE_DATE     = SYSDATE
    WHERE PAYEE_BANK_ACCOUNT_ID = l_id;
    COMMIT;

    :status_code := 200;
    HTP.P('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    -- DELETE: remove bank account
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/payees/:payee_id/bankaccounts/:account_id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete payee bank account',
        p_source         => q'[
BEGIN
    DELETE FROM RR_PAYEE_BANK_ACCOUNTS
     WHERE PAYEE_BANK_ACCOUNT_ID = :account_id
       AND PAYEE_ID              = :payee_id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"success":true}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"success":false,"error":' || '"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/
