-- =============================================================================
-- ORDS Handlers for RR_RAW_AP_INVOICES_ALL
--
-- Module  : reerp
-- Pattern : ap/raw-invoices
--
-- GET  ap/raw-invoices          – query synced raw invoices
-- POST ap/raw-invoices          – upsert one or many invoices (JSON body)
-- GET  ap/raw-invoices/:id      – single invoice by INVOICE_ID
-- GET  ap/raw-invoices/stats    – row count + latest sync date
--
-- POST body format (single):
-- { "INVOICE_ID":1021, "INVOICE_NUM":"1P-739131", "INVOICE_AMOUNT":3590, ... }
--
-- POST body format (bulk):
-- { "items": [ {...}, {...} ] }
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper package — MERGE logic
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_RAW_AP_INVOICES_PKG AS

    -- Upsert one invoice from a JSON object string
    PROCEDURE save_one(p_json IN CLOB);

    -- Upsert many invoices from {"items":[...]} or [...] JSON
    PROCEDURE save_many(p_json IN CLOB,
                        p_saved  OUT NUMBER,
                        p_errors OUT NUMBER);

END RR_RAW_AP_INVOICES_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RAW_AP_INVOICES_PKG AS

    -- ── internal helpers ──────────────────────────────────────────────────────
    FUNCTION to_date_safe(p IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
        -- Fusion dates: 2023-07-13T00:00:00.000+00:00
        RETURN TO_DATE(SUBSTR(p, 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION to_ts_safe(p IN VARCHAR2) RETURN TIMESTAMP WITH TIME ZONE IS
    BEGIN
        IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP_TZ(
            REGEXP_REPLACE(p, '(\.\d+)', ''),   -- strip sub-seconds
            'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'
        );
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            RETURN TO_TIMESTAMP_TZ(SUBSTR(p,1,19)||'+00:00',
                                   'YYYY-MM-DD"T"HH24:MI:SS TZH:TZM');
        EXCEPTION WHEN OTHERS THEN RETURN NULL;
        END;
    END;

    -- ── merge one JSON object into the table ──────────────────────────────────
    PROCEDURE merge_row(p_json IN CLOB) IS
        FUNCTION jv(k VARCHAR2) RETURN VARCHAR2 IS
        BEGIN
            RETURN JSON_VALUE(p_json, '$.' || k);
        EXCEPTION WHEN OTHERS THEN RETURN NULL;
        END;
        FUNCTION jn(k VARCHAR2) RETURN NUMBER IS
        BEGIN
            RETURN TO_NUMBER(JSON_VALUE(p_json, '$.' || k));
        EXCEPTION WHEN OTHERS THEN RETURN NULL;
        END;
    BEGIN
        MERGE INTO RR_RAW_AP_INVOICES_ALL tgt
        USING (SELECT TO_NUMBER(JSON_VALUE(p_json, '$.INVOICE_ID')) AS invoice_id FROM DUAL) src
        ON (tgt.INVOICE_ID = src.invoice_id)
        WHEN MATCHED THEN UPDATE SET
            VENDOR_ID                       = jn('VENDOR_ID'),
            VENDOR_SITE_ID                  = jn('VENDOR_SITE_ID'),
            PARTY_ID                        = jn('PARTY_ID'),
            PARTY_SITE_ID                   = jn('PARTY_SITE_ID'),
            INVOICE_NUM                     = jv('INVOICE_NUM'),
            INVOICE_AMOUNT                  = jn('INVOICE_AMOUNT'),
            INVOICE_DATE                    = to_date_safe(jv('INVOICE_DATE')),
            INVOICE_CURRENCY_CODE           = jv('INVOICE_CURRENCY_CODE'),
            INVOICE_TYPE_LOOKUP_CODE        = jv('INVOICE_TYPE_LOOKUP_CODE'),
            SOURCE                          = jv('SOURCE'),
            DESCRIPTION                     = jv('DESCRIPTION'),
            BATCH_ID                        = jn('BATCH_ID'),
            PAYMENT_CURRENCY_CODE           = jv('PAYMENT_CURRENCY_CODE'),
            PAYMENT_CROSS_RATE              = jn('PAYMENT_CROSS_RATE'),
            PAYMENT_CROSS_RATE_DATE         = to_date_safe(jv('PAYMENT_CROSS_RATE_DATE')),
            PAY_CURR_INVOICE_AMOUNT         = jn('PAY_CURR_INVOICE_AMOUNT'),
            AMOUNT_PAID                     = jn('AMOUNT_PAID'),
            DISCOUNT_AMOUNT_TAKEN           = jn('DISCOUNT_AMOUNT_TAKEN'),
            AMOUNT_APPLICABLE_TO_DISCOUNT   = jn('AMOUNT_APPLICABLE_TO_DISCOUNT'),
            PAYMENT_STATUS_FLAG             = jv('PAYMENT_STATUS_FLAG'),
            PAYMENT_METHOD_CODE             = jv('PAYMENT_METHOD_CODE'),
            PAYMENT_FUNCTION                = jv('PAYMENT_FUNCTION'),
            PAY_PROC_TRXN_TYPE_CODE         = jv('PAY_PROC_TRXN_TYPE_CODE'),
            EXCLUSIVE_PAYMENT_FLAG          = jv('EXCLUSIVE_PAYMENT_FLAG'),
            PAY_GROUP_LOOKUP_CODE           = jv('PAY_GROUP_LOOKUP_CODE'),
            SET_OF_BOOKS_ID                 = jn('SET_OF_BOOKS_ID'),
            ORG_ID                          = jn('ORG_ID'),
            LEGAL_ENTITY_ID                 = jn('LEGAL_ENTITY_ID'),
            ACCTS_PAY_CODE_COMBINATION_ID   = jn('ACCTS_PAY_CODE_COMBINATION_ID'),
            GL_DATE                         = to_date_safe(jv('GL_DATE')),
            BUDGET_DATE                     = to_date_safe(jv('BUDGET_DATE')),
            TERMS_ID                        = jn('TERMS_ID'),
            TERMS_DATE                      = to_date_safe(jv('TERMS_DATE')),
            DOC_SEQUENCE_ID                 = jn('DOC_SEQUENCE_ID'),
            DOC_SEQUENCE_VALUE              = jn('DOC_SEQUENCE_VALUE'),
            DOC_CATEGORY_CODE               = jv('DOC_CATEGORY_CODE'),
            APPROVAL_STATUS                 = jv('APPROVAL_STATUS'),
            APPROVAL_READY_FLAG             = jv('APPROVAL_READY_FLAG'),
            WFAPPROVAL_STATUS               = jv('WFAPPROVAL_STATUS'),
            ROUTING_STATUS_LOOKUP_CODE      = jv('ROUTING_STATUS_LOOKUP_CODE'),
            FORCE_REVALIDATION_FLAG         = jv('FORCE_REVALIDATION_FLAG'),
            TAXATION_COUNTRY                = jv('TAXATION_COUNTRY'),
            CUST_REGISTRATION_NUMBER        = jv('CUST_REGISTRATION_NUMBER'),
            CHECK_VAT_AMOUNT_PAID           = jv('CHECK_VAT_AMOUNT_PAID'),
            DISC_IS_INV_LESS_TAX_FLAG       = jv('DISC_IS_INV_LESS_TAX_FLAG'),
            EXCLUDE_FREIGHT_FROM_DISCOUNT   = jv('EXCLUDE_FREIGHT_FROM_DISCOUNT'),
            INTERCOMPANY_FLAG               = jv('INTERCOMPANY_FLAG'),
            IMPORT_DOCUMENT_DATE            = to_date_safe(jv('IMPORT_DOCUMENT_DATE')),
            REFERENCE_KEY2                  = jv('REFERENCE_KEY2'),
            REQUEST_ID                      = jn('REQUEST_ID'),
            OBJECT_VERSION_NUMBER           = jn('OBJECT_VERSION_NUMBER'),
            CREATION_DATE                   = to_ts_safe(jv('CREATION_DATE')),
            CREATED_BY                      = jv('CREATED_BY'),
            LAST_UPDATE_DATE                = to_ts_safe(jv('LAST_UPDATE_DATE')),
            LAST_UPDATED_BY                 = jv('LAST_UPDATED_BY'),
            LAST_UPDATE_LOGIN               = jv('LAST_UPDATE_LOGIN'),
            SYNC_DATE                       = SYSTIMESTAMP,
            SYNC_STATUS                     = 'SYNCED'
        WHEN NOT MATCHED THEN INSERT (
            INVOICE_ID, VENDOR_ID, VENDOR_SITE_ID, PARTY_ID, PARTY_SITE_ID,
            INVOICE_NUM, INVOICE_AMOUNT, INVOICE_DATE, INVOICE_CURRENCY_CODE,
            INVOICE_TYPE_LOOKUP_CODE, SOURCE, DESCRIPTION, BATCH_ID,
            PAYMENT_CURRENCY_CODE, PAYMENT_CROSS_RATE, PAYMENT_CROSS_RATE_DATE,
            PAY_CURR_INVOICE_AMOUNT, AMOUNT_PAID, DISCOUNT_AMOUNT_TAKEN,
            AMOUNT_APPLICABLE_TO_DISCOUNT, PAYMENT_STATUS_FLAG,
            PAYMENT_METHOD_CODE, PAYMENT_FUNCTION, PAY_PROC_TRXN_TYPE_CODE,
            EXCLUSIVE_PAYMENT_FLAG, PAY_GROUP_LOOKUP_CODE,
            SET_OF_BOOKS_ID, ORG_ID, LEGAL_ENTITY_ID,
            ACCTS_PAY_CODE_COMBINATION_ID, GL_DATE, BUDGET_DATE,
            TERMS_ID, TERMS_DATE, DOC_SEQUENCE_ID, DOC_SEQUENCE_VALUE,
            DOC_CATEGORY_CODE, APPROVAL_STATUS, APPROVAL_READY_FLAG,
            WFAPPROVAL_STATUS, ROUTING_STATUS_LOOKUP_CODE, FORCE_REVALIDATION_FLAG,
            TAXATION_COUNTRY, CUST_REGISTRATION_NUMBER, CHECK_VAT_AMOUNT_PAID,
            DISC_IS_INV_LESS_TAX_FLAG, EXCLUDE_FREIGHT_FROM_DISCOUNT,
            INTERCOMPANY_FLAG, IMPORT_DOCUMENT_DATE, REFERENCE_KEY2,
            REQUEST_ID, OBJECT_VERSION_NUMBER,
            CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
            LAST_UPDATE_LOGIN, SYNC_DATE, SYNC_STATUS
        ) VALUES (
            jn('INVOICE_ID'), jn('VENDOR_ID'), jn('VENDOR_SITE_ID'),
            jn('PARTY_ID'), jn('PARTY_SITE_ID'),
            jv('INVOICE_NUM'), jn('INVOICE_AMOUNT'),
            to_date_safe(jv('INVOICE_DATE')), jv('INVOICE_CURRENCY_CODE'),
            jv('INVOICE_TYPE_LOOKUP_CODE'), jv('SOURCE'), jv('DESCRIPTION'),
            jn('BATCH_ID'),
            jv('PAYMENT_CURRENCY_CODE'), jn('PAYMENT_CROSS_RATE'),
            to_date_safe(jv('PAYMENT_CROSS_RATE_DATE')),
            jn('PAY_CURR_INVOICE_AMOUNT'), jn('AMOUNT_PAID'),
            jn('DISCOUNT_AMOUNT_TAKEN'), jn('AMOUNT_APPLICABLE_TO_DISCOUNT'),
            jv('PAYMENT_STATUS_FLAG'), jv('PAYMENT_METHOD_CODE'),
            jv('PAYMENT_FUNCTION'), jv('PAY_PROC_TRXN_TYPE_CODE'),
            jv('EXCLUSIVE_PAYMENT_FLAG'), jv('PAY_GROUP_LOOKUP_CODE'),
            jn('SET_OF_BOOKS_ID'), jn('ORG_ID'), jn('LEGAL_ENTITY_ID'),
            jn('ACCTS_PAY_CODE_COMBINATION_ID'),
            to_date_safe(jv('GL_DATE')), to_date_safe(jv('BUDGET_DATE')),
            jn('TERMS_ID'), to_date_safe(jv('TERMS_DATE')),
            jn('DOC_SEQUENCE_ID'), jn('DOC_SEQUENCE_VALUE'),
            jv('DOC_CATEGORY_CODE'), jv('APPROVAL_STATUS'),
            jv('APPROVAL_READY_FLAG'), jv('WFAPPROVAL_STATUS'),
            jv('ROUTING_STATUS_LOOKUP_CODE'), jv('FORCE_REVALIDATION_FLAG'),
            jv('TAXATION_COUNTRY'), jv('CUST_REGISTRATION_NUMBER'),
            jv('CHECK_VAT_AMOUNT_PAID'), jv('DISC_IS_INV_LESS_TAX_FLAG'),
            jv('EXCLUDE_FREIGHT_FROM_DISCOUNT'), jv('INTERCOMPANY_FLAG'),
            to_date_safe(jv('IMPORT_DOCUMENT_DATE')), jv('REFERENCE_KEY2'),
            jn('REQUEST_ID'), jn('OBJECT_VERSION_NUMBER'),
            to_ts_safe(jv('CREATION_DATE')), jv('CREATED_BY'),
            to_ts_safe(jv('LAST_UPDATE_DATE')), jv('LAST_UPDATED_BY'),
            jv('LAST_UPDATE_LOGIN'), SYSTIMESTAMP, 'SYNCED'
        );
    END merge_row;

    -- ── public: save one ──────────────────────────────────────────────────────
    PROCEDURE save_one(p_json IN CLOB) IS
    BEGIN
        merge_row(p_json);
        COMMIT;
    END save_one;

    -- ── public: save many ─────────────────────────────────────────────────────
    PROCEDURE save_many(p_json  IN  CLOB,
                        p_saved  OUT NUMBER,
                        p_errors OUT NUMBER) IS
        l_items  CLOB;
        l_item   CLOB;
        l_count  NUMBER := 0;
        l_ok     NUMBER := 0;
        l_err    NUMBER := 0;
    BEGIN
        -- Accept both {"items":[...]} and [...]
        l_items := CASE
            WHEN JSON_VALUE(p_json, '$.items[0].INVOICE_ID') IS NOT NULL
              OR JSON_EXISTS(p_json, '$.items[0]')
            THEN JSON_QUERY(p_json, '$.items')
            ELSE p_json
        END;

        -- Count items
        SELECT JSON_VALUE(l_items, '$.size()')
        INTO   l_count
        FROM   DUAL;

        FOR i IN 0 .. NVL(l_count, 0) - 1 LOOP
            BEGIN
                l_item := JSON_QUERY(l_items, '$[' || i || ']');
                IF l_item IS NOT NULL THEN
                    merge_row(l_item);
                    l_ok := l_ok + 1;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                l_err := l_err + 1;
            END;
        END LOOP;

        COMMIT;
        p_saved  := l_ok;
        p_errors := l_err;
    END save_many;

END RR_RAW_AP_INVOICES_PKG;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDS: template ap/raw-invoices
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/raw-invoices');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/raw-invoices',
        p_comments    => 'Raw Fusion AP invoices — GET list, POST upsert'
    );
    COMMIT;
END;
/

-- ── GET ap/raw-invoices ───────────────────────────────────────────────────────
-- Params: invoice_num, vendor_id, org_id, approval_status,
--         invoice_date_from, invoice_date_to, limit (default 200)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/raw-invoices',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'Query raw Fusion AP invoices with optional filters',
        p_source         => q'[
SELECT
    INVOICE_ID,
    INVOICE_NUM,
    TO_CHAR(INVOICE_DATE,        'YYYY-MM-DD')  AS INVOICE_DATE,
    TO_CHAR(GL_DATE,             'YYYY-MM-DD')  AS GL_DATE,
    TO_CHAR(BUDGET_DATE,         'YYYY-MM-DD')  AS BUDGET_DATE,
    INVOICE_CURRENCY_CODE,
    INVOICE_AMOUNT,
    AMOUNT_PAID,
    DISCOUNT_AMOUNT_TAKEN,
    AMOUNT_APPLICABLE_TO_DISCOUNT,
    INVOICE_TYPE_LOOKUP_CODE,
    SOURCE,
    DESCRIPTION,
    PAYMENT_STATUS_FLAG,
    PAYMENT_METHOD_CODE,
    PAY_GROUP_LOOKUP_CODE,
    APPROVAL_STATUS,
    WFAPPROVAL_STATUS,
    ROUTING_STATUS_LOOKUP_CODE,
    TAXATION_COUNTRY,
    CUST_REGISTRATION_NUMBER,
    ORG_ID,
    LEGAL_ENTITY_ID,
    SET_OF_BOOKS_ID,
    VENDOR_ID,
    VENDOR_SITE_ID,
    PARTY_ID,
    PARTY_SITE_ID,
    ACCTS_PAY_CODE_COMBINATION_ID,
    DOC_SEQUENCE_VALUE,
    DOC_CATEGORY_CODE,
    OBJECT_VERSION_NUMBER,
    TO_CHAR(CREATION_DATE,       'YYYY-MM-DD"T"HH24:MI:SS')  AS CREATION_DATE,
    CREATED_BY,
    TO_CHAR(LAST_UPDATE_DATE,    'YYYY-MM-DD"T"HH24:MI:SS')  AS LAST_UPDATE_DATE,
    LAST_UPDATED_BY,
    TO_CHAR(SYNC_DATE,           'YYYY-MM-DD"T"HH24:MI:SS')  AS SYNC_DATE,
    SYNC_STATUS
FROM RR_RAW_AP_INVOICES_ALL
WHERE (:invoice_num      IS NULL OR UPPER(INVOICE_NUM)      LIKE '%'||UPPER(:invoice_num)||'%')
  AND (:vendor_id        IS NULL OR VENDOR_ID               = TO_NUMBER(:vendor_id))
  AND (:org_id           IS NULL OR ORG_ID                  = TO_NUMBER(:org_id))
  AND (:approval_status  IS NULL OR UPPER(APPROVAL_STATUS)  = UPPER(:approval_status))
  AND (:invoice_date_from IS NULL OR INVOICE_DATE >= TO_DATE(:invoice_date_from,'YYYY-MM-DD'))
  AND (:invoice_date_to  IS NULL OR INVOICE_DATE  <= TO_DATE(:invoice_date_to,  'YYYY-MM-DD'))
ORDER BY INVOICE_DATE DESC, INVOICE_ID DESC
]'
    );
    COMMIT;
END;
/

-- ── POST ap/raw-invoices ──────────────────────────────────────────────────────
-- Body: single invoice JSON object OR {"items":[...]} array
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/raw-invoices',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_items_per_page => 0,
        p_comments       => 'Upsert one or many raw Fusion AP invoices (MERGE on INVOICE_ID)',
        p_source         => q'[
DECLARE
    l_saved  NUMBER := 0;
    l_errors NUMBER := 0;
    l_is_bulk BOOLEAN;
BEGIN
    -- Detect bulk vs single
    l_is_bulk := JSON_EXISTS(:body_text, '$.items') OR
                 SUBSTR(LTRIM(:body_text), 1, 1) = '[';

    IF l_is_bulk THEN
        RR_RAW_AP_INVOICES_PKG.save_many(
            p_json   => :body_text,
            p_saved  => l_saved,
            p_errors => l_errors
        );
        :status_code := CASE WHEN l_errors = 0 THEN 201 ELSE 207 END;
        HTP.PRN('{"status":"' ||
                CASE WHEN l_errors = 0 THEN 'SUCCESS' ELSE 'PARTIAL' END ||
                '","saved":' || l_saved ||
                ',"errors":' || l_errors || '}');
    ELSE
        RR_RAW_AP_INVOICES_PKG.save_one(p_json => :body_text);
        :status_code := 201;
        HTP.PRN('{"status":"SUCCESS","saved":1,"errors":0}');
    END IF;

EXCEPTION WHEN OTHERS THEN
    :status_code := 400;
    HTP.PRN('{"status":"ERROR","message":"' ||
            REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDS: template ap/raw-invoices/:id   (GET single by INVOICE_ID)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/raw-invoices/:id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/raw-invoices/:id',
        p_comments    => 'Single raw invoice by INVOICE_ID'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/raw-invoices/:id',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_items_per_page => 0,
        p_comments       => 'Fetch one raw invoice by Fusion INVOICE_ID',
        p_source         => q'[
SELECT
    INVOICE_ID, INVOICE_NUM,
    TO_CHAR(INVOICE_DATE,     'YYYY-MM-DD') AS INVOICE_DATE,
    TO_CHAR(GL_DATE,          'YYYY-MM-DD') AS GL_DATE,
    TO_CHAR(BUDGET_DATE,      'YYYY-MM-DD') AS BUDGET_DATE,
    TO_CHAR(TERMS_DATE,       'YYYY-MM-DD') AS TERMS_DATE,
    TO_CHAR(IMPORT_DOCUMENT_DATE,'YYYY-MM-DD') AS IMPORT_DOCUMENT_DATE,
    TO_CHAR(PAYMENT_CROSS_RATE_DATE,'YYYY-MM-DD') AS PAYMENT_CROSS_RATE_DATE,
    INVOICE_CURRENCY_CODE, PAYMENT_CURRENCY_CODE, PAYMENT_CROSS_RATE,
    INVOICE_AMOUNT, AMOUNT_PAID, PAY_CURR_INVOICE_AMOUNT,
    DISCOUNT_AMOUNT_TAKEN, AMOUNT_APPLICABLE_TO_DISCOUNT,
    INVOICE_TYPE_LOOKUP_CODE, SOURCE, DESCRIPTION, BATCH_ID,
    PAYMENT_STATUS_FLAG, PAYMENT_METHOD_CODE, PAYMENT_FUNCTION,
    PAY_PROC_TRXN_TYPE_CODE, EXCLUSIVE_PAYMENT_FLAG, PAY_GROUP_LOOKUP_CODE,
    SET_OF_BOOKS_ID, ORG_ID, LEGAL_ENTITY_ID, ACCTS_PAY_CODE_COMBINATION_ID,
    TERMS_ID, DOC_SEQUENCE_ID, DOC_SEQUENCE_VALUE, DOC_CATEGORY_CODE,
    APPROVAL_STATUS, APPROVAL_READY_FLAG, WFAPPROVAL_STATUS,
    ROUTING_STATUS_LOOKUP_CODE, FORCE_REVALIDATION_FLAG,
    TAXATION_COUNTRY, CUST_REGISTRATION_NUMBER,
    CHECK_VAT_AMOUNT_PAID, DISC_IS_INV_LESS_TAX_FLAG, EXCLUDE_FREIGHT_FROM_DISCOUNT,
    INTERCOMPANY_FLAG, REFERENCE_KEY2, REQUEST_ID, OBJECT_VERSION_NUMBER,
    VENDOR_ID, VENDOR_SITE_ID, PARTY_ID, PARTY_SITE_ID,
    TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
    CREATED_BY,
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
    LAST_UPDATED_BY, LAST_UPDATE_LOGIN,
    TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS') AS SYNC_DATE,
    SYNC_STATUS
FROM RR_RAW_AP_INVOICES_ALL
WHERE INVOICE_ID = TO_NUMBER(:id)
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDS: template ap/raw-invoices/stats
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/raw-invoices/stats');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/raw-invoices/stats',
        p_comments    => 'Raw invoice sync statistics'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/raw-invoices/stats',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_items_per_page => 0,
        p_comments       => 'Total rows, latest sync date, approval status counts',
        p_source         => q'[
SELECT
    COUNT(*)                                                        AS total_rows,
    TO_CHAR(MAX(SYNC_DATE), 'YYYY-MM-DD"T"HH24:MI:SS')             AS last_sync_date,
    TO_CHAR(MIN(INVOICE_DATE), 'YYYY-MM-DD')                        AS oldest_invoice_date,
    TO_CHAR(MAX(INVOICE_DATE), 'YYYY-MM-DD')                        AS newest_invoice_date,
    SUM(CASE WHEN APPROVAL_STATUS = 'APPROVED'     THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN APPROVAL_STATUS = 'REJECTED'     THEN 1 ELSE 0 END) AS rejected_count,
    SUM(CASE WHEN APPROVAL_STATUS = 'PENDING'      THEN 1 ELSE 0 END) AS pending_count,
    SUM(CASE WHEN PAYMENT_STATUS_FLAG = 'Y'        THEN 1 ELSE 0 END) AS fully_paid_count,
    SUM(NVL(INVOICE_AMOUNT, 0))                                     AS total_invoice_amount,
    SUM(NVL(AMOUNT_PAID, 0))                                        AS total_amount_paid
FROM RR_RAW_AP_INVOICES_ALL
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT t.uri_template, h.method, h.source_type
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template LIKE 'ap/raw-invoices%'
ORDER  BY t.uri_template, h.method;
