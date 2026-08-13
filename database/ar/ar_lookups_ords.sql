-- =====================================================
-- AR Lookups — Payment Terms, Txn Sources, Txn Types,
--              Memo Lines, Revenue Scheduling Rules
-- Package : RR_AR_LOOKUPS_PKG
-- Module  : ar
-- POST    : ar/lookups/bulk  (single handler, lookup_type routes to table)
-- GET     : ar/payment-terms | ar/transaction-sources | ar/transaction-types
--           ar/memo-lines    | ar/revenue-scheduling-rules
-- =====================================================

-- =====================================================
-- 1. Tables
-- =====================================================

CREATE TABLE RR_AR_PAYMENT_TERMS (
    PAYMENT_TERMS_ID  NUMBER PRIMARY KEY,
    NAME              VARCHAR2(240),
    DESCRIPTION       VARCHAR2(500),
    SET_NAME          VARCHAR2(100),
    SYNC_DATE         TIMESTAMP DEFAULT SYSTIMESTAMP
);
COMMENT ON TABLE RR_AR_PAYMENT_TERMS IS 'AR Payment Terms synced from Fusion paymentTermsLOV';

CREATE TABLE RR_AR_TXN_SOURCES (
    TRANSACTION_SOURCE_ID  NUMBER PRIMARY KEY,
    NAME                   VARCHAR2(240),
    DESCRIPTION            VARCHAR2(500),
    SET_NAME               VARCHAR2(100),
    SYNC_DATE              TIMESTAMP DEFAULT SYSTIMESTAMP
);
COMMENT ON TABLE RR_AR_TXN_SOURCES IS 'AR Transaction Sources synced from Fusion transactionSourcesLOV';

CREATE TABLE RR_AR_TXN_TYPES (
    TRANSACTION_TYPE_ID  NUMBER PRIMARY KEY,
    NAME                 VARCHAR2(240),
    DESCRIPTION          VARCHAR2(500),
    SET_NAME             VARCHAR2(100),
    SYNC_DATE            TIMESTAMP DEFAULT SYSTIMESTAMP
);
COMMENT ON TABLE RR_AR_TXN_TYPES IS 'AR Transaction Types synced from Fusion transactionTypesLOV';

CREATE TABLE RR_AR_MEMO_LINES (
    MEMO_LINE_ID           NUMBER PRIMARY KEY,
    NAME                   VARCHAR2(240),
    DESCRIPTION            VARCHAR2(500),
    TAX_CODE               VARCHAR2(100),
    TAX_PRODUCT_CATEGORY   VARCHAR2(100),
    UOM_CODE               VARCHAR2(30),
    SET_NAME               VARCHAR2(100),
    SYNC_DATE              TIMESTAMP DEFAULT SYSTIMESTAMP
);
COMMENT ON TABLE RR_AR_MEMO_LINES IS 'AR Memo Lines synced from Fusion memoLinesLOV';

CREATE TABLE RR_AR_REVENUE_SCHED_RULES (
    RULE_ID      NUMBER PRIMARY KEY,
    NAME         VARCHAR2(240),
    DESCRIPTION  VARCHAR2(500),
    SET_NAME     VARCHAR2(100),
    TYPE         VARCHAR2(50),
    OCCURRENCES  NUMBER,
    STATUS       VARCHAR2(10),
    SYNC_DATE    TIMESTAMP DEFAULT SYSTIMESTAMP
);
COMMENT ON TABLE RR_AR_REVENUE_SCHED_RULES IS 'AR Revenue Scheduling Rules synced from Fusion revenueSchedulingRulesLOV';

-- =====================================================
-- 2. Package spec
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AR_LOOKUPS_PKG AS

    /*
     * Single entry point for all AR lookup bulk upserts.
     * p_lookup_type: PAYMENT_TERMS | TXN_SOURCES | TXN_TYPES | MEMO_LINES | REVENUE_RULES
     * p_items      : JSON CLOB  — the "items" array from the Fusion LOV response
     */
    PROCEDURE BULK_UPSERT (
        p_lookup_type IN  VARCHAR2,
        p_items       IN  CLOB,
        p_inserted    OUT NUMBER,
        p_updated     OUT NUMBER,
        p_errors      OUT NUMBER,
        p_error_msgs  OUT VARCHAR2
    );

END RR_AR_LOOKUPS_PKG;
/

-- =====================================================
-- 3. Package body
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AR_LOOKUPS_PKG AS

    -- ── Private helpers ──────────────────────────────
    FUNCTION safe_str(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null THEN
            RETURN p_obj.get_string(p_key);
        END IF;
        RETURN NULL;
    END;

    FUNCTION safe_num(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null THEN
            RETURN p_obj.get_number(p_key);
        END IF;
        RETURN NULL;
    END;

    -- ── Per-object upsert procedures ─────────────────

    PROCEDURE upsert_payment_terms (
        p_items    IN  JSON_ARRAY_T,
        p_inserted IN OUT NUMBER,
        p_updated  IN OUT NUMBER,
        p_errors   IN OUT NUMBER,
        p_msgs     IN OUT VARCHAR2
    ) IS
        l_item    JSON_OBJECT_T;
        v_id      NUMBER;
        v_name    VARCHAR2(240);
        v_desc    VARCHAR2(500);
        v_set     VARCHAR2(100);
        v_exists  NUMBER;
    BEGIN
        FOR i IN 0 .. p_items.get_size() - 1 LOOP
            BEGIN
                l_item := JSON_OBJECT_T(p_items.get(i));
                v_id   := safe_num(l_item, 'PaymentTermsId');
                v_name := safe_str(l_item, 'Name');
                v_desc := safe_str(l_item, 'Description');
                v_set  := safe_str(l_item, 'SetName');

                SELECT COUNT(*) INTO v_exists FROM RR_AR_PAYMENT_TERMS WHERE PAYMENT_TERMS_ID = v_id;

                MERGE INTO RR_AR_PAYMENT_TERMS d
                USING (SELECT v_id AS id FROM DUAL) s ON (d.PAYMENT_TERMS_ID = s.id)
                WHEN MATCHED THEN UPDATE SET
                    NAME = v_name, DESCRIPTION = v_desc, SET_NAME = v_set, SYNC_DATE = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (PAYMENT_TERMS_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE)
                    VALUES (v_id, v_name, v_desc, v_set, SYSTIMESTAMP);

                IF v_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1; END IF;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF LENGTH(p_msgs) < 3500 THEN p_msgs := p_msgs || 'Row '||i||': '||SUBSTR(SQLERRM,1,150)||'; '; END IF;
            END;
        END LOOP;
    END upsert_payment_terms;

    PROCEDURE upsert_txn_sources (
        p_items    IN  JSON_ARRAY_T,
        p_inserted IN OUT NUMBER,
        p_updated  IN OUT NUMBER,
        p_errors   IN OUT NUMBER,
        p_msgs     IN OUT VARCHAR2
    ) IS
        l_item    JSON_OBJECT_T;
        v_id      NUMBER;
        v_name    VARCHAR2(240);
        v_desc    VARCHAR2(500);
        v_set     VARCHAR2(100);
        v_exists  NUMBER;
    BEGIN
        FOR i IN 0 .. p_items.get_size() - 1 LOOP
            BEGIN
                l_item := JSON_OBJECT_T(p_items.get(i));
                v_id   := safe_num(l_item, 'TransactionSourceId');
                v_name := safe_str(l_item, 'Name');
                v_desc := safe_str(l_item, 'Description');
                v_set  := safe_str(l_item, 'SetName');

                SELECT COUNT(*) INTO v_exists FROM RR_AR_TXN_SOURCES WHERE TRANSACTION_SOURCE_ID = v_id;

                MERGE INTO RR_AR_TXN_SOURCES d
                USING (SELECT v_id AS id FROM DUAL) s ON (d.TRANSACTION_SOURCE_ID = s.id)
                WHEN MATCHED THEN UPDATE SET
                    NAME = v_name, DESCRIPTION = v_desc, SET_NAME = v_set, SYNC_DATE = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (TRANSACTION_SOURCE_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE)
                    VALUES (v_id, v_name, v_desc, v_set, SYSTIMESTAMP);

                IF v_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1; END IF;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF LENGTH(p_msgs) < 3500 THEN p_msgs := p_msgs || 'Row '||i||': '||SUBSTR(SQLERRM,1,150)||'; '; END IF;
            END;
        END LOOP;
    END upsert_txn_sources;

    PROCEDURE upsert_txn_types (
        p_items    IN  JSON_ARRAY_T,
        p_inserted IN OUT NUMBER,
        p_updated  IN OUT NUMBER,
        p_errors   IN OUT NUMBER,
        p_msgs     IN OUT VARCHAR2
    ) IS
        l_item    JSON_OBJECT_T;
        v_id      NUMBER;
        v_name    VARCHAR2(240);
        v_desc    VARCHAR2(500);
        v_set     VARCHAR2(100);
        v_exists  NUMBER;
    BEGIN
        FOR i IN 0 .. p_items.get_size() - 1 LOOP
            BEGIN
                l_item := JSON_OBJECT_T(p_items.get(i));
                v_id   := safe_num(l_item, 'TransactionTypeId');
                v_name := safe_str(l_item, 'Name');
                v_desc := safe_str(l_item, 'Description');
                v_set  := safe_str(l_item, 'SetName');

                SELECT COUNT(*) INTO v_exists FROM RR_AR_TXN_TYPES WHERE TRANSACTION_TYPE_ID = v_id;

                MERGE INTO RR_AR_TXN_TYPES d
                USING (SELECT v_id AS id FROM DUAL) s ON (d.TRANSACTION_TYPE_ID = s.id)
                WHEN MATCHED THEN UPDATE SET
                    NAME = v_name, DESCRIPTION = v_desc, SET_NAME = v_set, SYNC_DATE = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (TRANSACTION_TYPE_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE)
                    VALUES (v_id, v_name, v_desc, v_set, SYSTIMESTAMP);

                IF v_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1; END IF;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF LENGTH(p_msgs) < 3500 THEN p_msgs := p_msgs || 'Row '||i||': '||SUBSTR(SQLERRM,1,150)||'; '; END IF;
            END;
        END LOOP;
    END upsert_txn_types;

    PROCEDURE upsert_memo_lines (
        p_items    IN  JSON_ARRAY_T,
        p_inserted IN OUT NUMBER,
        p_updated  IN OUT NUMBER,
        p_errors   IN OUT NUMBER,
        p_msgs     IN OUT VARCHAR2
    ) IS
        l_item    JSON_OBJECT_T;
        v_id      NUMBER;
        v_name    VARCHAR2(240);
        v_desc    VARCHAR2(500);
        v_tax     VARCHAR2(100);
        v_taxcat  VARCHAR2(100);
        v_uom     VARCHAR2(30);
        v_set     VARCHAR2(100);
        v_exists  NUMBER;
    BEGIN
        FOR i IN 0 .. p_items.get_size() - 1 LOOP
            BEGIN
                l_item  := JSON_OBJECT_T(p_items.get(i));
                v_id    := safe_num(l_item, 'MemoLineId');
                v_name  := safe_str(l_item, 'Name');
                v_desc  := safe_str(l_item, 'Description');
                v_tax   := safe_str(l_item, 'TaxCode');
                v_taxcat:= safe_str(l_item, 'TaxProductCategory');
                v_uom   := safe_str(l_item, 'UOMCode');
                v_set   := safe_str(l_item, 'SetName');

                SELECT COUNT(*) INTO v_exists FROM RR_AR_MEMO_LINES WHERE MEMO_LINE_ID = v_id;

                MERGE INTO RR_AR_MEMO_LINES d
                USING (SELECT v_id AS id FROM DUAL) s ON (d.MEMO_LINE_ID = s.id)
                WHEN MATCHED THEN UPDATE SET
                    NAME = v_name, DESCRIPTION = v_desc, TAX_CODE = v_tax,
                    TAX_PRODUCT_CATEGORY = v_taxcat, UOM_CODE = v_uom,
                    SET_NAME = v_set, SYNC_DATE = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (
                    MEMO_LINE_ID, NAME, DESCRIPTION, TAX_CODE,
                    TAX_PRODUCT_CATEGORY, UOM_CODE, SET_NAME, SYNC_DATE)
                VALUES (v_id, v_name, v_desc, v_tax, v_taxcat, v_uom, v_set, SYSTIMESTAMP);

                IF v_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1; END IF;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF LENGTH(p_msgs) < 3500 THEN p_msgs := p_msgs || 'Row '||i||': '||SUBSTR(SQLERRM,1,150)||'; '; END IF;
            END;
        END LOOP;
    END upsert_memo_lines;

    PROCEDURE upsert_revenue_rules (
        p_items    IN  JSON_ARRAY_T,
        p_inserted IN OUT NUMBER,
        p_updated  IN OUT NUMBER,
        p_errors   IN OUT NUMBER,
        p_msgs     IN OUT VARCHAR2
    ) IS
        l_item    JSON_OBJECT_T;
        v_id      NUMBER;
        v_name    VARCHAR2(240);
        v_desc    VARCHAR2(500);
        v_set     VARCHAR2(100);
        v_type    VARCHAR2(50);
        v_occ     NUMBER;
        v_status  VARCHAR2(10);
        v_exists  NUMBER;
    BEGIN
        FOR i IN 0 .. p_items.get_size() - 1 LOOP
            BEGIN
                l_item   := JSON_OBJECT_T(p_items.get(i));
                v_id     := safe_num(l_item, 'RuleId');
                v_name   := safe_str(l_item, 'Name');
                v_desc   := safe_str(l_item, 'Description');
                v_set    := safe_str(l_item, 'SetName');
                v_type   := safe_str(l_item, 'Type');
                v_occ    := safe_num(l_item, 'Occurrences');
                v_status := safe_str(l_item, 'Status');

                SELECT COUNT(*) INTO v_exists FROM RR_AR_REVENUE_SCHED_RULES WHERE RULE_ID = v_id;

                MERGE INTO RR_AR_REVENUE_SCHED_RULES d
                USING (SELECT v_id AS id FROM DUAL) s ON (d.RULE_ID = s.id)
                WHEN MATCHED THEN UPDATE SET
                    NAME = v_name, DESCRIPTION = v_desc, SET_NAME = v_set,
                    TYPE = v_type, OCCURRENCES = v_occ, STATUS = v_status,
                    SYNC_DATE = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (
                    RULE_ID, NAME, DESCRIPTION, SET_NAME, TYPE, OCCURRENCES, STATUS, SYNC_DATE)
                VALUES (v_id, v_name, v_desc, v_set, v_type, v_occ, v_status, SYSTIMESTAMP);

                IF v_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1; END IF;
            EXCEPTION WHEN OTHERS THEN
                p_errors := p_errors + 1;
                IF LENGTH(p_msgs) < 3500 THEN p_msgs := p_msgs || 'Row '||i||': '||SUBSTR(SQLERRM,1,150)||'; '; END IF;
            END;
        END LOOP;
    END upsert_revenue_rules;

    -- ── Public entry point ───────────────────────────
    PROCEDURE BULK_UPSERT (
        p_lookup_type IN  VARCHAR2,
        p_items       IN  CLOB,
        p_inserted    OUT NUMBER,
        p_updated     OUT NUMBER,
        p_errors      OUT NUMBER,
        p_error_msgs  OUT VARCHAR2
    ) IS
        l_arr      JSON_ARRAY_T;
        l_inserted NUMBER := 0;
        l_updated  NUMBER := 0;
        l_errors   NUMBER := 0;
        l_msgs     VARCHAR2(4000) := '';
    BEGIN
        l_arr := JSON_ARRAY_T(p_items);

        CASE UPPER(p_lookup_type)
            WHEN 'PAYMENT_TERMS'   THEN upsert_payment_terms (l_arr, l_inserted, l_updated, l_errors, l_msgs);
            WHEN 'TXN_SOURCES'     THEN upsert_txn_sources   (l_arr, l_inserted, l_updated, l_errors, l_msgs);
            WHEN 'TXN_TYPES'       THEN upsert_txn_types     (l_arr, l_inserted, l_updated, l_errors, l_msgs);
            WHEN 'MEMO_LINES'      THEN upsert_memo_lines    (l_arr, l_inserted, l_updated, l_errors, l_msgs);
            WHEN 'REVENUE_RULES'   THEN upsert_revenue_rules (l_arr, l_inserted, l_updated, l_errors, l_msgs);
            ELSE
                l_errors := 1;
                l_msgs   := 'Unknown lookup_type: ' || p_lookup_type;
        END CASE;

        COMMIT;
        p_inserted   := l_inserted;
        p_updated    := l_updated;
        p_errors     := l_errors;
        p_error_msgs := l_msgs;
    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_inserted   := 0;
        p_updated    := 0;
        p_errors     := 1;
        p_error_msgs := SQLERRM;
    END BULK_UPSERT;

END RR_AR_LOOKUPS_PKG;
/

-- =====================================================
-- 4. Single POST handler — ar/lookups/bulk
--    Body: { "lookupType": "PAYMENT_TERMS", "items": [...] }
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'lookups/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'lookups/bulk',
        p_comments    => 'Bulk upsert any AR lookup table — pass lookupType in body'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'ar',
        p_pattern       => 'lookups/bulk',
        p_method        => 'POST',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Route to correct AR lookup table based on lookupType',
        p_source        => q'[
DECLARE
    l_body       CLOB;
    l_root       JSON_OBJECT_T;
    l_items_clob CLOB;
    l_lookup     VARCHAR2(100);
    l_inserted   NUMBER;
    l_updated    NUMBER;
    l_errors     NUMBER;
    l_msgs       VARCHAR2(4000);
    v_dest_off   INTEGER := 1;
    v_src_off    INTEGER := 1;
    v_lang_ctx   INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning    INTEGER;
BEGIN
    DBMS_LOB.CREATETEMPORARY(l_body, TRUE);
    DBMS_LOB.CONVERTTOCLOB(
        l_body, :body, DBMS_LOB.LOBMAXSIZE,
        v_dest_off, v_src_off,
        NLS_CHARSET_ID('AL32UTF8'), v_lang_ctx, v_warning
    );

    l_root       := JSON_OBJECT_T.PARSE(l_body);
    l_lookup     := l_root.get_string('lookupType');
    l_items_clob := l_root.get_array('items').to_clob();

    RR_AR_LOOKUPS_PKG.BULK_UPSERT(
        p_lookup_type => l_lookup,
        p_items       => l_items_clob,
        p_inserted    => l_inserted,
        p_updated     => l_updated,
        p_errors      => l_errors,
        p_error_msgs  => l_msgs
    );

    :status_code := CASE WHEN l_errors = 0 THEN 201 ELSE 207 END;
    HTP.P('{"status":"'    || CASE WHEN l_errors = 0 THEN 'SUCCESS' ELSE 'PARTIAL' END || '"'
        || ',"lookupType":' || '"' || l_lookup || '"'
        || ',"inserted":'  || l_inserted
        || ',"updated":'   || l_updated
        || ',"errors":'    || l_errors
        || CASE WHEN l_msgs IS NOT NULL
               THEN ',"errorDetail":"' || REPLACE(l_msgs, '"', '\"') || '"'
               ELSE '' END || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET handlers (one per lookup — json/collection)
-- =====================================================

-- 5a. ar/payment-terms
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'ar',p_pattern=>'payment-terms'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'ar', p_pattern=>'payment-terms', p_comments=>'AR Payment Terms');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(p_module_name=>'ar', p_pattern=>'payment-terms', p_method=>'GET',
        p_source_type=>'json/collection', p_items_per_page=>500,
        p_source=>'SELECT PAYMENT_TERMS_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE FROM RR_AR_PAYMENT_TERMS ORDER BY NAME');
    COMMIT;
END;
/

-- 5b. ar/transaction-sources
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'ar',p_pattern=>'transaction-sources'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'ar', p_pattern=>'transaction-sources', p_comments=>'AR Transaction Sources');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(p_module_name=>'ar', p_pattern=>'transaction-sources', p_method=>'GET',
        p_source_type=>'json/collection', p_items_per_page=>500,
        p_source=>'SELECT TRANSACTION_SOURCE_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE FROM RR_AR_TXN_SOURCES ORDER BY NAME');
    COMMIT;
END;
/

-- 5c. ar/transaction-types
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'ar',p_pattern=>'transaction-types'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'ar', p_pattern=>'transaction-types', p_comments=>'AR Transaction Types');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(p_module_name=>'ar', p_pattern=>'transaction-types', p_method=>'GET',
        p_source_type=>'json/collection', p_items_per_page=>500,
        p_source=>'SELECT TRANSACTION_TYPE_ID, NAME, DESCRIPTION, SET_NAME, SYNC_DATE FROM RR_AR_TXN_TYPES ORDER BY NAME');
    COMMIT;
END;
/

-- 5d. ar/memo-lines
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'ar',p_pattern=>'memo-lines'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'ar', p_pattern=>'memo-lines', p_comments=>'AR Memo Lines');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(p_module_name=>'ar', p_pattern=>'memo-lines', p_method=>'GET',
        p_source_type=>'json/collection', p_items_per_page=>500,
        p_source=>'SELECT MEMO_LINE_ID, NAME, DESCRIPTION, TAX_CODE, TAX_PRODUCT_CATEGORY, UOM_CODE, SET_NAME, SYNC_DATE FROM RR_AR_MEMO_LINES ORDER BY NAME');
    COMMIT;
END;
/

-- 5e. ar/revenue-scheduling-rules
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'ar',p_pattern=>'revenue-scheduling-rules'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'ar', p_pattern=>'revenue-scheduling-rules', p_comments=>'AR Revenue Scheduling Rules');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(p_module_name=>'ar', p_pattern=>'revenue-scheduling-rules', p_method=>'GET',
        p_source_type=>'json/collection', p_items_per_page=>500,
        p_source=>'SELECT RULE_ID, NAME, DESCRIPTION, SET_NAME, TYPE, OCCURRENCES, STATUS, SYNC_DATE FROM RR_AR_REVENUE_SCHED_RULES ORDER BY NAME');
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- POST {base}/ar/lookups/bulk   body: {"lookupType":"PAYMENT_TERMS|TXN_SOURCES|TXN_TYPES|MEMO_LINES|REVENUE_RULES","items":[...]}
-- GET  {base}/ar/payment-terms
-- GET  {base}/ar/transaction-sources
-- GET  {base}/ar/transaction-types
-- GET  {base}/ar/memo-lines
-- GET  {base}/ar/revenue-scheduling-rules
-- =====================================================
