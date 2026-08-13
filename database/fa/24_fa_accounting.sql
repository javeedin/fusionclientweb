-- =============================================================================
-- 24_FA_ACCOUNTING.SQL
-- FA Create Accounting — Additions (Dr Asset Cost / Cr Asset Clearing)
--
-- This file only provides:
--   1. New columns on FA tables (accounted_status, accounted_date)
--   2. GET  fa/accounting/additions-preview  — build Dr/Cr preview from category accounts
--   3. POST fa/accounting/mark-accounted     — update RR_FA_ADDITIONS after accounting is created
--
-- All SLA / GL creation is done via the existing services:
--   POST sla/accounting/create   (RR_SLA_PKG.create_accounting)
--   POST sla/accounting/post     (RR_SLA_PKG.post_to_ledger)
--   GET  sla/accounting/exists   (RR_SLA_PKG.check_accounting_exists)
--   POST gl/journals/headers     (MERGE into RR_GL_HEADERS)
--   POST gl/journals/lines       (MERGE into RR_GL_LINES_ALL)
-- =============================================================================

-- ── 1. Add accounting columns ─────────────────────────────────────────────────
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_FA_ADDITIONS   ADD (ACCOUNTED_STATUS VARCHAR2(30), ACCOUNTED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_FA_DEPRN_DETAIL  ADD (ACCOUNTED_STATUS VARCHAR2(30), ACCOUNTED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_FA_DEPRN_SUMMARY ADD (ACCOUNTED_STATUS VARCHAR2(30), ACCOUNTED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/

-- ── 2. Package ────────────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_FA_ACCOUNTING_PKG AS

    -- Returns preview JSON: asset header info + Dr/Cr line details from category accounts
    PROCEDURE GET_ADDITIONS_PREVIEW(
        p_asset_id  IN  VARCHAR2,
        p_book      IN  VARCHAR2,
        p_status    OUT NUMBER,
        p_response  OUT CLOB
    );

    -- Called after SLA/GL accounting is created externally to mark the FA addition as ACCOUNTED
    PROCEDURE MARK_ACCOUNTED(
        p_asset_id      IN  VARCHAR2,
        p_sla_header_id IN  NUMBER,
        p_gl_header_id  IN  NUMBER,
        p_created_by    IN  VARCHAR2,
        p_status        OUT NUMBER,
        p_response      OUT CLOB
    );

END RR_FA_ACCOUNTING_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_ACCOUNTING_PKG AS

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN '"' || REPLACE(REPLACE(p, '\', '\\'), '"', '\"') || '"'; END;

    -- p_company overrides the first segment (Co) with the book's company code
    FUNCTION get_account_combo(p_ccid IN NUMBER, p_company IN VARCHAR2 DEFAULT NULL) RETURN VARCHAR2 IS
        v_combo VARCHAR2(750);
    BEGIN
        IF p_ccid IS NULL OR p_ccid = 0 THEN RETURN NULL; END IF;
        SELECT
            NVL(p_company, NVL("buimercFinGlbCoaCo", '')) || '-' ||
            NVL("buimercFinGlbCoaLob", '')        || '-' ||
            NVL("buimercFinGlbCoaDepartment", '') || '-' ||
            NVL("buimercFinGlbCoaAccount", '')    || '-' ||
            NVL("buimercFinGlbCoaSubAcc", '')     || '-' ||
            NVL("buimercFinGlbCoaAlys", '')       || '-' ||
            NVL("buimercFinGlbCoaIc", '')         || '-' ||
            NVL("buimercFinGlbCoaFut1", '')       || '-' ||
            NVL("buimercFinGlbCoaFut2", '')
        INTO v_combo
        FROM REERP_GL_CODE_COMBINATIONS
        WHERE "_CODE_COMBINATION_ID" = p_ccid;
        RETURN v_combo;
    EXCEPTION WHEN NO_DATA_FOUND THEN RETURN TO_CHAR(p_ccid); END;

    -- =========================================================================
    -- GET_ADDITIONS_PREVIEW
    -- Returns the accounting preview (journal header template + Dr/Cr lines)
    -- that the frontend will use to call sla/accounting/create.
    -- =========================================================================
    PROCEDURE GET_ADDITIONS_PREVIEW(
        p_asset_id IN  VARCHAR2,
        p_book     IN  VARCHAR2,
        p_status   OUT NUMBER,
        p_response OUT CLOB
    ) IS
        v_asset_number   VARCHAR2(100);
        v_description    VARCHAR2(500);
        v_cost           NUMBER;
        v_category_id    NUMBER;
        v_date_svc       VARCHAR2(30);
        v_acct_status    VARCHAR2(30);
        v_acct_date      VARCHAR2(30);
        v_cost_ccid      NUMBER;
        v_clearing_ccid  NUMBER;
        v_cost_combo     VARCHAR2(750);
        v_clearing_combo VARCHAR2(750);
        v_period_name    VARCHAR2(15);
        v_company_code   VARCHAR2(30);
        v_ledger_name    VARCHAR2(100);
        v_ledger_id      NUMBER;
        v_currency_code  VARCHAR2(15);
    BEGIN
        -- Get asset data
        BEGIN
            SELECT
                a.ASSET_NUMBER, a.DESCRIPTION,
                b.COST,
                a.ASSET_CATEGORY_ID, b.DATE_PLACED_IN_SERVICE,
                NVL(a.ACCOUNTED_STATUS, 'UNACCOUNTED'),
                TO_CHAR(a.ACCOUNTED_DATE, 'YYYY-MM-DD')
            INTO v_asset_number, v_description, v_cost, v_category_id,
                 v_date_svc, v_acct_status, v_acct_date
            FROM RR_FA_ADDITIONS a
            LEFT JOIN RR_FA_BOOKS b ON b.ASSET_ID = a.ASSET_ID AND b.BOOK_TYPE_CODE = p_book
            WHERE a.ASSET_ID = p_asset_id
            AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            p_status   := 404;
            p_response := '{"success":false,"error":"Asset not found: ' || p_asset_id || '"}';
            RETURN;
        END;

        -- Get category account CCIDs
        BEGIN
            SELECT cb.ASSET_COST_ACCOUNT_CCID, cb.ASSET_CLEARING_ACCOUNT_CCID
            INTO   v_cost_ccid, v_clearing_ccid
            FROM   RR_FA_CATEGORY_BOOKS cb
            WHERE  cb.CATEGORY_ID    = v_category_id
            -- AND    cb.BOOK_TYPE_CODE = p_book
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_cost_ccid     := NULL;
            v_clearing_ccid := NULL;
        END;

        -- Get company code, ledger name/id, currency from book controls
        BEGIN
            SELECT COMPANY_CODE, LEDGER_NAME, LEDGER_ID, NVL(CURRENCY_CODE, 'AED')
            INTO   v_company_code, v_ledger_name, v_ledger_id, v_currency_code
            FROM   RR_FA_BOOK_CONTROLS
            WHERE  BOOK_TYPE_CODE = p_book
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_company_code  := NULL;
            v_ledger_name   := 'Primary Ledger';
            v_ledger_id     := 1;
            v_currency_code := 'AED';
        END;

        v_cost_combo     := get_account_combo(v_cost_ccid,     v_company_code);
        v_clearing_combo := get_account_combo(v_clearing_ccid, v_company_code);
        DECLARE
            v_dt DATE := NVL(TO_DATE(SUBSTR(v_date_svc, 1, 10), 'YYYY-MM-DD'), SYSDATE);
        BEGIN
            v_period_name :=
                UPPER(SUBSTR(TO_CHAR(v_dt, 'Mon'), 1, 1)) ||
                LOWER(SUBSTR(TO_CHAR(v_dt, 'Mon'), 2)) ||
                TO_CHAR(v_dt, '-YY');
        END;

        p_status := 200;
        p_response :=
            '{"success":true'
         || ',"accountedStatus":' || jstr(v_acct_status)
         || ',"accountedDate":' || NVL(jstr(v_acct_date), 'null')
         -- Header template to pass to sla/accounting/create
         || ',"header":{'
         ||   '"moduleName":"FA"'
         ||   ',"sourceTable":"RR_FA_ADDITIONS"'
         ||   ',"sourceId":' || p_asset_id
         ||   ',"sourceNumber":' || jstr(v_asset_number)
         ||   ',"sourceType":"ADDITION"'
         ||   ',"eventTypeCode":"FA_ADDITION"'
         ||   ',"eventDate":' || jstr(NVL(SUBSTR(v_date_svc, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')))
         ||   ',"accountingDate":' || jstr(NVL(SUBSTR(v_date_svc, 1, 10), TO_CHAR(SYSDATE, 'YYYY-MM-DD')))
         ||   ',"periodName":' || jstr(v_period_name)
         ||   ',"ledgerId":' || NVL(TO_CHAR(v_ledger_id), '1')
         ||   ',"ledgerName":' || jstr(NVL(v_ledger_name, 'Primary Ledger'))
         ||   ',"currencyCode":' || jstr(v_currency_code)
         ||   ',"ledgerCurrency":' || jstr(v_currency_code)
         ||   ',"description":"FA Addition — ' || REPLACE(v_asset_number, '"', '\"')
         ||                                  ' — ' || REPLACE(SUBSTR(v_description,1,200), '"', '\"') || '"'
         ||   ',"bookTypeCode":' || jstr(p_book)
         ||   ',"assetNumber":' || jstr(v_asset_number)
         ||   ',"cost":' || NVL(TO_CHAR(v_cost), '0')
         || '}'
         -- Lines template to pass to sla/accounting/create
         || ',"lines":['
         ||   '{"lineNumber":1,"lineType":"DR","accountingClass":"ASSET"'
         ||    ',"description":"Asset Cost — ' || REPLACE(v_asset_number, '"', '\"') || '"'
         ||    ',"accountedDr":' || NVL(TO_CHAR(v_cost), '0')
         ||    ',"accountedCr":0'
         ||    ',"enteredDr":' || NVL(TO_CHAR(v_cost), '0')
         ||    ',"enteredCr":0'
         ||    ',"ccid":' || NVL(TO_CHAR(v_cost_ccid), 'null')
         ||    ',"accountCombination":' || NVL(jstr(v_cost_combo), 'null')
         ||    ',"reference1":' || jstr(v_asset_number)
         ||    ',"reference2":' || jstr(p_asset_id)
         ||    ',"reference5":"FA_ADDITIONS"'
         ||   '},'
         ||   '{"lineNumber":2,"lineType":"CR","accountingClass":"CLEARING"'
         ||    ',"description":"Asset Clearing — ' || REPLACE(v_asset_number, '"', '\"') || '"'
         ||    ',"accountedDr":0'
         ||    ',"accountedCr":' || NVL(TO_CHAR(v_cost), '0')
         ||    ',"enteredDr":0'
         ||    ',"enteredCr":' || NVL(TO_CHAR(v_cost), '0')
         ||    ',"ccid":' || NVL(TO_CHAR(v_clearing_ccid), 'null')
         ||    ',"accountCombination":' || NVL(jstr(v_clearing_combo), 'null')
         ||    ',"reference1":' || jstr(v_asset_number)
         ||    ',"reference2":' || jstr(p_asset_id)
         ||    ',"reference5":"FA_ADDITIONS"'
         ||   '}'
         || ']'
         || '}';

    EXCEPTION WHEN OTHERS THEN
        p_status   := 500;
        p_response := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END GET_ADDITIONS_PREVIEW;

    -- =========================================================================
    -- MARK_ACCOUNTED
    -- Called by the frontend after sla/accounting/post succeeds.
    -- =========================================================================
    PROCEDURE MARK_ACCOUNTED(
        p_asset_id      IN  VARCHAR2,
        p_sla_header_id IN  NUMBER,
        p_gl_header_id  IN  NUMBER,
        p_created_by    IN  VARCHAR2,
        p_status        OUT NUMBER,
        p_response      OUT CLOB
    ) IS
        v_rows NUMBER;
    BEGIN
        UPDATE RR_FA_ADDITIONS
        SET    ACCOUNTED_STATUS = 'ACCOUNTED',
               ACCOUNTED_DATE   = SYSDATE
        WHERE  ASSET_ID = p_asset_id;

        v_rows := SQL%ROWCOUNT;
        COMMIT;

        p_status   := 200;
        p_response := '{"success":true,"status":"ACCOUNTED"'
                   || ',"rowsUpdated":' || v_rows
                   || ',"slaHeaderId":' || NVL(TO_CHAR(p_sla_header_id), 'null')
                   || ',"glHeaderId":' || NVL(TO_CHAR(p_gl_header_id), 'null')
                   || ',"message":"Addition marked as accounted"}';

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_status   := 500;
        p_response := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END MARK_ACCOUNTED;

END RR_FA_ACCOUNTING_PKG;
/

-- ── 3. ORDS clean up ─────────────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/accounting/additions-preview',p_method=>'GET');  COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/accounting/mark-accounted',p_method=>'POST');    COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/accounting/additions-preview'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/accounting/mark-accounted');   COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ── 4. ORDS: GET fa/accounting/additions-preview ──────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/accounting/additions-preview',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: Dr/Cr preview for additions accounting'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/accounting/additions-preview',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE v_s NUMBER; v_r CLOB; BEGIN
    RR_FA_ACCOUNTING_PKG.GET_ADDITIONS_PREVIEW(
        p_asset_id => :assetId, p_book => :bookTypeCode,
        p_status => v_s, p_response => v_r);
    :status := v_s; HTP.P(v_r);
END;]'
    );
    COMMIT;
END;
/

-- ── 5. ORDS: POST fa/accounting/mark-accounted ────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/accounting/mark-accounted',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: mark addition as ACCOUNTED after SLA/GL created externally'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/accounting/mark-accounted',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body CLOB := :body_text;
    v_s NUMBER; v_r CLOB;
BEGIN
    RR_FA_ACCOUNTING_PKG.MARK_ACCOUNTED(
        p_asset_id      => JSON_VALUE(v_body, '$.assetId'),
        p_sla_header_id => TO_NUMBER(JSON_VALUE(v_body, '$.slaHeaderId')),
        p_gl_header_id  => TO_NUMBER(JSON_VALUE(v_body, '$.glHeaderId')),
        p_created_by    => NVL(JSON_VALUE(v_body, '$.createdBy'), 'REACTERP'),
        p_status => v_s, p_response => v_r);
    :status := v_s; HTP.P(v_r);
EXCEPTION WHEN OTHERS THEN
    ROLLBACK; :status := 500;
    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;]'
    );
    COMMIT;
END;
/
