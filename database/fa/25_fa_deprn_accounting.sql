-- =============================================================================
-- 25_FA_DEPRN_ACCOUNTING.SQL
-- FA Create Accounting — Depreciation
--   Dr  Depreciation Expense   (DEPRN_EXPENSE_ACCOUNT_CCID from RR_FA_CATEGORY_BOOKS)
--   Cr  Depreciation Reserve   (RESERVE_ACCOUNT_CCID from RR_FA_CATEGORY_BOOKS)
--
-- Endpoints:
--   GET  fa/accounting/deprn-preview?assetId=&bookTypeCode=&periodName=
--   POST fa/accounting/mark-deprn-accounted
-- =============================================================================

-- ── 1. Add procedures to existing package ─────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_FA_ACCOUNTING_PKG AS

    PROCEDURE GET_ADDITIONS_PREVIEW(
        p_asset_id  IN  VARCHAR2,
        p_book      IN  VARCHAR2,
        p_status    OUT NUMBER,
        p_response  OUT CLOB
    );

    PROCEDURE MARK_ACCOUNTED(
        p_asset_id      IN  VARCHAR2,
        p_sla_header_id IN  NUMBER,
        p_gl_header_id  IN  NUMBER,
        p_created_by    IN  VARCHAR2,
        p_status        OUT NUMBER,
        p_response      OUT CLOB
    );

    -- NEW: depreciation accounting preview — identify row by asset_id + distribution_id
    PROCEDURE GET_DEPRN_PREVIEW(
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,  -- DISTRIBUTION_ID from RR_FA_DEPRN_DETAIL
        p_period_name     IN  VARCHAR2,  -- kept for display / fallback when dist_id not supplied
        p_status          OUT NUMBER,
        p_response        OUT CLOB
    );

    -- NEW: mark exact RR_FA_DEPRN_DETAIL row as ACCOUNTED by distribution_id
    PROCEDURE MARK_DEPRN_ACCOUNTED(
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,  -- exact row to mark; falls back to period_name
        p_period_name     IN  VARCHAR2,
        p_sla_header_id   IN  NUMBER,
        p_gl_header_id    IN  NUMBER,
        p_created_by      IN  VARCHAR2,
        p_status          OUT NUMBER,
        p_response        OUT CLOB
    );

END RR_FA_ACCOUNTING_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_ACCOUNTING_PKG AS

    FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN '"' || REPLACE(REPLACE(p, '\', '\\'), '"', '\"') || '"'; END;

    -- p_sub_account: when not null, overrides segment5 (buimercFinGlbCoaSubAcc); default NULL = use DB value
    FUNCTION get_account_combo(
        p_ccid        IN NUMBER,
        p_company     IN VARCHAR2 DEFAULT NULL,
        p_sub_account IN VARCHAR2 DEFAULT NULL
    ) RETURN VARCHAR2 IS
        v_combo VARCHAR2(750);
    BEGIN
        IF p_ccid IS NULL OR p_ccid = 0 THEN RETURN NULL; END IF;
        SELECT
            NVL(p_company, NVL("buimercFinGlbCoaCo", '')) || '-' ||
            NVL("buimercFinGlbCoaLob", '')        || '-' ||
            NVL("buimercFinGlbCoaDepartment", '') || '-' ||
            NVL("buimercFinGlbCoaAccount", '')    || '-' ||
            NVL(p_sub_account, NVL("buimercFinGlbCoaSubAcc", '')) || '-' ||
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
    -- GET_ADDITIONS_PREVIEW (unchanged from 24_fa_accounting.sql)
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
        BEGIN
            SELECT a.ASSET_NUMBER, a.DESCRIPTION, b.COST, a.ASSET_CATEGORY_ID,
                   b.DATE_PLACED_IN_SERVICE,
                   NVL(a.ACCOUNTED_STATUS, 'UNACCOUNTED'),
                   TO_CHAR(a.ACCOUNTED_DATE, 'YYYY-MM-DD')
            INTO   v_asset_number, v_description, v_cost, v_category_id,
                   v_date_svc, v_acct_status, v_acct_date
            FROM   RR_FA_ADDITIONS a
            LEFT JOIN RR_FA_BOOKS b ON b.ASSET_ID = a.ASSET_ID AND b.BOOK_TYPE_CODE = p_book
            WHERE  a.ASSET_ID = p_asset_id AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            p_status := 404; p_response := '{"success":false,"error":"Asset not found: ' || p_asset_id || '"}'; RETURN;
        END;
        BEGIN
            SELECT cb.ASSET_COST_ACCOUNT_CCID, cb.ASSET_CLEARING_ACCOUNT_CCID
            INTO   v_cost_ccid, v_clearing_ccid
            FROM   RR_FA_CATEGORY_BOOKS cb
            WHERE  cb.CATEGORY_ID = v_category_id AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_cost_ccid := NULL; v_clearing_ccid := NULL; END;
        BEGIN
            SELECT COMPANY_CODE, LEDGER_NAME, LEDGER_ID, NVL(CURRENCY_CODE, 'AED')
            INTO   v_company_code, v_ledger_name, v_ledger_id, v_currency_code
            FROM   RR_FA_BOOK_CONTROLS WHERE BOOK_TYPE_CODE = p_book AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_company_code := NULL; v_ledger_name := 'Primary Ledger'; v_ledger_id := 1; v_currency_code := 'AED';
        END;
        v_cost_combo     := get_account_combo(v_cost_ccid,     v_company_code);
        v_clearing_combo := get_account_combo(v_clearing_ccid, v_company_code);
        DECLARE v_dt DATE := NVL(TO_DATE(SUBSTR(v_date_svc, 1, 10), 'YYYY-MM-DD'), SYSDATE);
        BEGIN
            v_period_name := UPPER(SUBSTR(TO_CHAR(v_dt,'Mon'),1,1)) || LOWER(SUBSTR(TO_CHAR(v_dt,'Mon'),2)) || TO_CHAR(v_dt,'-YY');
        END;
        p_status := 200;
        p_response :=
            '{"success":true'
         || ',"accountedStatus":' || jstr(v_acct_status)
         || ',"accountedDate":' || NVL(jstr(v_acct_date), 'null')
         || ',"header":{"moduleName":"FA","sourceTable":"RR_FA_ADDITIONS","sourceId":' || p_asset_id
         ||   ',"sourceNumber":' || jstr(v_asset_number) || ',"sourceType":"ADDITION","eventTypeCode":"FA_ADDITION"'
         ||   ',"eventDate":' || jstr(NVL(SUBSTR(v_date_svc,1,10), TO_CHAR(SYSDATE,'YYYY-MM-DD')))
         ||   ',"accountingDate":' || jstr(NVL(SUBSTR(v_date_svc,1,10), TO_CHAR(SYSDATE,'YYYY-MM-DD')))
         ||   ',"periodName":' || jstr(v_period_name)
         ||   ',"ledgerId":' || NVL(TO_CHAR(v_ledger_id),'1') || ',"ledgerName":' || jstr(NVL(v_ledger_name,'Primary Ledger'))
         ||   ',"currencyCode":' || jstr(v_currency_code) || ',"ledgerCurrency":' || jstr(v_currency_code)
         ||   ',"description":"FA Addition — ' || REPLACE(v_asset_number,'"','\"') || ' — ' || REPLACE(SUBSTR(v_description,1,200),'"','\"') || '"'
         ||   ',"bookTypeCode":' || jstr(p_book) || ',"assetNumber":' || jstr(v_asset_number) || ',"cost":' || NVL(TO_CHAR(v_cost),'0') || '}'
         || ',"lines":['
         ||   '{"lineNumber":1,"lineType":"DR","accountingClass":"ASSET","description":"Asset Cost — ' || REPLACE(v_asset_number,'"','\"') || '"'
         ||    ',"accountedDr":' || NVL(TO_CHAR(v_cost),'0') || ',"accountedCr":0,"enteredDr":' || NVL(TO_CHAR(v_cost),'0') || ',"enteredCr":0'
         ||    ',"ccid":' || NVL(TO_CHAR(v_cost_ccid),'null') || ',"accountCombination":' || NVL(jstr(v_cost_combo),'null')
         ||    ',"reference1":' || jstr(v_asset_number) || ',"reference2":' || jstr(p_asset_id) || ',"reference5":"FA_ADDITIONS"},'
         ||   '{"lineNumber":2,"lineType":"CR","accountingClass":"CLEARING","description":"Asset Clearing — ' || REPLACE(v_asset_number,'"','\"') || '"'
         ||    ',"accountedDr":0,"accountedCr":' || NVL(TO_CHAR(v_cost),'0') || ',"enteredDr":0,"enteredCr":' || NVL(TO_CHAR(v_cost),'0')
         ||    ',"ccid":' || NVL(TO_CHAR(v_clearing_ccid),'null') || ',"accountCombination":' || NVL(jstr(v_clearing_combo),'null')
         ||    ',"reference1":' || jstr(v_asset_number) || ',"reference2":' || jstr(p_asset_id) || ',"reference5":"FA_ADDITIONS"}'
         || ']}';
    EXCEPTION WHEN OTHERS THEN
        p_status := 500; p_response := '{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END GET_ADDITIONS_PREVIEW;

    -- =========================================================================
    -- MARK_ACCOUNTED (unchanged)
    -- =========================================================================
    PROCEDURE MARK_ACCOUNTED(
        p_asset_id IN VARCHAR2, p_sla_header_id IN NUMBER, p_gl_header_id IN NUMBER,
        p_created_by IN VARCHAR2, p_status OUT NUMBER, p_response OUT CLOB
    ) IS v_rows NUMBER; BEGIN
        UPDATE RR_FA_ADDITIONS SET ACCOUNTED_STATUS='ACCOUNTED', ACCOUNTED_DATE=SYSDATE WHERE ASSET_ID=p_asset_id;
        v_rows := SQL%ROWCOUNT; COMMIT;
        p_status := 200;
        p_response := '{"success":true,"status":"ACCOUNTED","rowsUpdated":' || v_rows
                   || ',"slaHeaderId":' || NVL(TO_CHAR(p_sla_header_id),'null')
                   || ',"glHeaderId":' || NVL(TO_CHAR(p_gl_header_id),'null') || ',"message":"Addition marked as accounted"}';
    EXCEPTION WHEN OTHERS THEN ROLLBACK; p_status:=500; p_response:='{"success":false,"error":"'||REPLACE(SQLERRM,'"','\"')||'"}';
    END MARK_ACCOUNTED;

    -- =========================================================================
    -- GET_DEPRN_PREVIEW
    -- Returns preview JSON for ONE depreciation period:
    --   Dr  Depreciation Expense  (DEPRN_EXPENSE_ACCOUNT_CCID)
    --   Cr  Depreciation Reserve  (RESERVE_ACCOUNT_CCID)
    -- =========================================================================
    PROCEDURE GET_DEPRN_PREVIEW(
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,
        p_period_name     IN  VARCHAR2,
        p_status          OUT NUMBER,
        p_response        OUT CLOB
    ) IS
        v_asset_number      VARCHAR2(100);
        v_asset_category    VARCHAR2(200);
        v_description       VARCHAR2(500);
        v_category_id       NUMBER;
        v_deprn_amount      NUMBER;
        v_period_counter    NUMBER;
        v_period_name_out   VARCHAR2(30);
        v_acct_status       VARCHAR2(30);
        v_acct_date         VARCHAR2(30);
        v_accounting_date   VARCHAR2(10);  -- LAST_DAY of period close
        -- account CCIDs
        v_expense_ccid      NUMBER;
        v_reserve_ccid      NUMBER;
        v_expense_combo     VARCHAR2(750);
        v_reserve_combo     VARCHAR2(750);
        -- sub-account from asset attribute1 (segment5 override on expense line only)
        v_sub_account       VARCHAR2(150);
        -- book controls
        v_company_code      VARCHAR2(30);
        v_ledger_name       VARCHAR2(100);
        v_ledger_id         NUMBER;
        v_currency_code     VARCHAR2(15);
    BEGIN
        -- Fetch exact deprn detail row by distribution_id when provided,
        -- otherwise fall back to period_name lookup
        BEGIN
            IF p_distribution_id IS NOT NULL AND p_distribution_id != '0' THEN
                SELECT a.ASSET_NUMBER, a.DESCRIPTION, a.ASSET_CATEGORY_ID,
                       ROUND(NVL(dd.DEPRN_AMOUNT, 0), 2),
                       dd.PERIOD_COUNTER,
                       dp.PERIOD_NAME,
                       NVL(dd.ACCOUNTED_STATUS, 'UNACCOUNTED'),
                       TO_CHAR(dd.ACCOUNTED_DATE, 'YYYY-MM-DD'),
                       a.ATTRIBUTE1
                INTO   v_asset_number, v_description, v_category_id,
                       v_deprn_amount, v_period_counter, v_period_name_out,
                       v_acct_status, v_acct_date,
                       v_sub_account
                FROM   RR_FA_ADDITIONS a
                JOIN   RR_FA_DEPRN_DETAIL dd
                       ON  dd.ASSET_ID       = a.ASSET_ID
                       AND dd.BOOK_TYPE_CODE  = p_book
                       AND dd.DISTRIBUTION_ID = TO_NUMBER(p_distribution_id)
                JOIN   RR_FA_DEPRN_PERIODS dp
                       ON  dp.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
                       AND dp.PERIOD_COUNTER = dd.PERIOD_COUNTER
                WHERE  a.ASSET_ID = p_asset_id
                AND    ROWNUM = 1;
            ELSE
                SELECT a.ASSET_NUMBER, a.DESCRIPTION, a.ASSET_CATEGORY_ID,
                       ROUND(NVL(dd.DEPRN_AMOUNT, 0), 2),
                       dd.PERIOD_COUNTER,
                       dp.PERIOD_NAME,
                       NVL(dd.ACCOUNTED_STATUS, 'UNACCOUNTED'),
                       TO_CHAR(dd.ACCOUNTED_DATE, 'YYYY-MM-DD'),
                       a.ATTRIBUTE1
                INTO   v_asset_number, v_description, v_category_id,
                       v_deprn_amount, v_period_counter, v_period_name_out,
                       v_acct_status, v_acct_date,
                       v_sub_account
                FROM   RR_FA_ADDITIONS a
                JOIN   RR_FA_DEPRN_DETAIL dd
                       ON  dd.ASSET_ID      = a.ASSET_ID
                       AND dd.BOOK_TYPE_CODE = p_book
                JOIN   RR_FA_DEPRN_PERIODS dp
                       ON  dp.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
                       AND dp.PERIOD_COUNTER = dd.PERIOD_COUNTER
                       AND dp.PERIOD_NAME    = p_period_name
                WHERE  a.ASSET_ID = p_asset_id
                AND    ROWNUM = 1;
            END IF;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            p_status   := 404;
            p_response := '{"success":false,"error":"No depreciation found for asset '
                       || p_asset_id || ' distribution ' || NVL(p_distribution_id, 'n/a')
                       || ' period ' || NVL(v_period_name_out, p_period_name) || '"}';
            RETURN;
        END;

        -- Accounting date = last day of the depreciation period (derived from period name e.g. "Apr-25")
        BEGIN
            v_accounting_date := TO_CHAR(
                LAST_DAY(TO_DATE('01-' || v_period_name_out, 'DD-Mon-YY')),
                'YYYY-MM-DD'
            );
        EXCEPTION WHEN OTHERS THEN
            v_accounting_date := TO_CHAR(LAST_DAY(SYSDATE), 'YYYY-MM-DD');
        END;

        -- Get deprn expense and reserve CCIDs + category description from category books
        BEGIN
            SELECT cb.DEPRN_EXPENSE_ACCOUNT_CCID, cb.RESERVE_ACCOUNT_CCID,
                   NVL(tl.DESCRIPTION, b.SEGMENT1 || ' - ' || b.SEGMENT2)
            INTO   v_expense_ccid, v_reserve_ccid, v_asset_category
            FROM   RR_FA_CATEGORY_BOOKS cb
            JOIN   RR_FA_CATEGORIES_B b  ON b.CATEGORY_ID = cb.CATEGORY_ID
            LEFT JOIN RR_FA_CATEGORIES_TL tl
                   ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = 'US'
            WHERE  cb.CATEGORY_ID = v_category_id
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_expense_ccid := NULL; v_reserve_ccid := NULL;
            v_asset_category := 'Depreciation';
        END;

        -- Get book controls
        BEGIN
            SELECT COMPANY_CODE, LEDGER_NAME, LEDGER_ID, NVL(CURRENCY_CODE, 'AED')
            INTO   v_company_code, v_ledger_name, v_ledger_id, v_currency_code
            FROM   RR_FA_BOOK_CONTROLS WHERE BOOK_TYPE_CODE = p_book AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_company_code := NULL; v_ledger_name := 'Primary Ledger'; v_ledger_id := 1; v_currency_code := 'AED';
        END;

        -- Expense line: replace segment5 with asset attribute1 (Sub Account); default '0000' when blank
        v_expense_combo := get_account_combo(v_expense_ccid, v_company_code, NVL(NULLIF(TRIM(v_sub_account),''), '0000'));
        v_reserve_combo := get_account_combo(v_reserve_ccid, v_company_code);

        p_status := 200;
        p_response :=
            '{"success":true'
         || ',"accountedStatus":' || jstr(v_acct_status)
         || ',"accountedDate":' || NVL(jstr(v_acct_date), 'null')
         || ',"header":{'
         ||   '"moduleName":"FA"'
         ||   ',"source":"Fixed Assets"'
         ||   ',"category":"Depreciation"'
         ||   ',"assetCategory":' || jstr(v_asset_category)
         ||   ',"sourceTable":"RR_FA_DEPRN_DETAIL"'
         ||   ',"sourceId":' || NVL(p_distribution_id, p_asset_id)
         ||   ',"assetId":' || p_asset_id
         ||   ',"distributionId":' || NVL(p_distribution_id, 'null')
         ||   ',"sourceNumber":' || NVL(p_distribution_id, jstr(v_asset_number))
         ||   ',"sourceType":"DEPRECIATION"'
         ||   ',"eventTypeCode":"FA_DEPRECIATION"'
         ||   ',"eventDate":' || jstr(v_accounting_date)
         ||   ',"accountingDate":' || jstr(v_accounting_date)
         ||   ',"periodName":' || jstr(v_period_name_out)
         ||   ',"ledgerId":' || NVL(TO_CHAR(v_ledger_id), '1')
         ||   ',"ledgerName":' || jstr(NVL(v_ledger_name, 'Primary Ledger'))
         ||   ',"currencyCode":' || jstr(v_currency_code)
         ||   ',"ledgerCurrency":' || jstr(v_currency_code)
         ||   ',"description":"FA Depreciation — ' || REPLACE(v_asset_number, '"', '\"')
         ||                                     ' — ' || REPLACE(v_period_name_out, '"', '\"') || '"'
         ||   ',"bookTypeCode":' || jstr(p_book)
         ||   ',"assetNumber":' || jstr(v_asset_number)
         ||   ',"periodCounter":' || NVL(TO_CHAR(v_period_counter), 'null')
         ||   ',"totalAmount":' || NVL(TO_CHAR(v_deprn_amount), '0')
         ||   ',"deprnAmount":' || NVL(TO_CHAR(v_deprn_amount), '0')
         || '}'
         || ',"lines":['
         -- Line 1: Dr Depreciation Expense
         -- reference2 = DISTRIBUTION_ID, reference5 = FA_DEPRECIATION
         ||   '{"lineNumber":1,"lineType":"DR","accountingClass":"DEPRN_EXPENSE"'
         ||    ',"description":"Book : ' || REPLACE(p_book, '"', '\"')
         ||               ' , Asset Period : ' || REPLACE(v_period_name_out, '"', '\"')
         ||               ' , Asset Number : ' || REPLACE(v_asset_number, '"', '\"')
         ||               ' , Depreciation Run Identifier : ' || NVL(p_distribution_id, TO_CHAR(v_period_counter))
         ||               '\nAsset Name : ' || REPLACE(SUBSTR(v_description, 1, 200), '"', '\"') || '"'
         ||    ',"accountedDr":' || NVL(TO_CHAR(v_deprn_amount), '0')
         ||    ',"accountedCr":0'
         ||    ',"enteredDr":' || NVL(TO_CHAR(v_deprn_amount), '0')
         ||    ',"enteredCr":0'
         ||    ',"ccid":' || NVL(TO_CHAR(v_expense_ccid), 'null')
         ||    ',"accountCombination":' || NVL(jstr(v_expense_combo), 'null')
         ||    ',"reference1":' || jstr(v_asset_number)
         ||    ',"reference2":' || NVL(p_distribution_id, TO_CHAR(v_period_counter))
         ||    ',"reference5":"FA_DEPRECIATION"'
         ||   '},'
         -- Line 2: Cr Depreciation Reserve
         ||   '{"lineNumber":2,"lineType":"CR","accountingClass":"DEPRN_RESERVE"'
         ||    ',"description":"Book : ' || REPLACE(p_book, '"', '\"')
         ||               ' , Asset Period : ' || REPLACE(v_period_name_out, '"', '\"')
         ||               ' , Asset Number : ' || REPLACE(v_asset_number, '"', '\"')
         ||               ' , Depreciation Run Identifier : ' || NVL(p_distribution_id, TO_CHAR(v_period_counter))
         ||               '\nAsset Name : ' || REPLACE(SUBSTR(v_description, 1, 200), '"', '\"') || '"'
         ||    ',"accountedDr":0'
         ||    ',"accountedCr":' || NVL(TO_CHAR(v_deprn_amount), '0')
         ||    ',"enteredDr":0'
         ||    ',"enteredCr":' || NVL(TO_CHAR(v_deprn_amount), '0')
         ||    ',"ccid":' || NVL(TO_CHAR(v_reserve_ccid), 'null')
         ||    ',"accountCombination":' || NVL(jstr(v_reserve_combo), 'null')
         ||    ',"reference1":' || jstr(v_asset_number)
         ||    ',"reference2":' || NVL(p_distribution_id, TO_CHAR(v_period_counter))
         ||    ',"reference5":"FA_DEPRECIATION"'
         ||   '}'
         || ']}';

    EXCEPTION WHEN OTHERS THEN
        p_status   := 500;
        p_response := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END GET_DEPRN_PREVIEW;

    -- =========================================================================
    -- MARK_DEPRN_ACCOUNTED
    -- Marks the exact RR_FA_DEPRN_DETAIL row as ACCOUNTED.
    -- Uses distribution_id for a precise single-row update when supplied;
    -- falls back to period_name when distribution_id is null/0.
    -- =========================================================================
    PROCEDURE MARK_DEPRN_ACCOUNTED(
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,
        p_period_name     IN  VARCHAR2,
        p_sla_header_id   IN  NUMBER,
        p_gl_header_id    IN  NUMBER,
        p_created_by      IN  VARCHAR2,
        p_status          OUT NUMBER,
        p_response        OUT CLOB
    ) IS
        v_rows NUMBER;
    BEGIN
        IF p_distribution_id IS NOT NULL AND p_distribution_id != '0' THEN
            -- DISTRIBUTION_ID is globally unique — no need to also filter by ASSET_ID
            UPDATE RR_FA_DEPRN_DETAIL
            SET    ACCOUNTED_STATUS = 'ACCOUNTED',
                   ACCOUNTED_DATE   = SYSDATE
            WHERE  DISTRIBUTION_ID  = TO_NUMBER(p_distribution_id);

            v_rows := SQL%ROWCOUNT;

            -- Mirror on summary (keyed by asset+book+period_counter)
            UPDATE RR_FA_DEPRN_SUMMARY
            SET    ACCOUNTED_STATUS = 'ACCOUNTED',
                   ACCOUNTED_DATE   = SYSDATE
            WHERE  ASSET_ID        = TO_NUMBER(p_asset_id)
            AND    BOOK_TYPE_CODE  = p_book
            AND    PERIOD_COUNTER IN (
                SELECT PERIOD_COUNTER FROM RR_FA_DEPRN_DETAIL
                WHERE  DISTRIBUTION_ID = TO_NUMBER(p_distribution_id)
            );
        ELSE
            -- Fallback: update all rows for asset+book+period
            UPDATE RR_FA_DEPRN_DETAIL
            SET    ACCOUNTED_STATUS = 'ACCOUNTED',
                   ACCOUNTED_DATE   = SYSDATE
            WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
            AND    BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER IN (
                SELECT PERIOD_COUNTER FROM RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE = p_book AND PERIOD_NAME = p_period_name
            );

            v_rows := SQL%ROWCOUNT;

            UPDATE RR_FA_DEPRN_SUMMARY
            SET    ACCOUNTED_STATUS = 'ACCOUNTED',
                   ACCOUNTED_DATE   = SYSDATE
            WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
            AND    BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER IN (
                SELECT PERIOD_COUNTER FROM RR_FA_DEPRN_PERIODS
                WHERE  BOOK_TYPE_CODE = p_book AND PERIOD_NAME = p_period_name
            );
        END IF;

        COMMIT;

        p_status   := 200;
        p_response := '{"success":true,"status":"ACCOUNTED"'
                   || ',"rowsUpdated":'    || v_rows
                   || ',"distributionId":' || NVL(p_distribution_id, 'null')
                   || ',"periodName":'     || jstr(p_period_name)
                   || ',"slaHeaderId":'    || NVL(TO_CHAR(p_sla_header_id), 'null')
                   || ',"glHeaderId":'     || NVL(TO_CHAR(p_gl_header_id), 'null')
                   || ',"message":"Depreciation marked as accounted"}';

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_status   := 500;
        p_response := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END MARK_DEPRN_ACCOUNTED;

END RR_FA_ACCOUNTING_PKG;
/

-- ── 2. ORDS handlers ─────────────────────────────────────────────────────────

-- Clean up
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/accounting/deprn-preview',p_method=>'GET');   COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/accounting/mark-deprn-accounted',p_method=>'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/accounting/deprn-preview');       COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/accounting/mark-deprn-accounted'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- Template: fa/accounting/deprn-preview
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/accounting/deprn-preview',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation accounting preview (Dr Expense / Cr Reserve)'
    );
    COMMIT;
END;
/

-- GET fa/accounting/deprn-preview?assetId=&bookTypeCode=&distributionId=&periodName=
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/accounting/deprn-preview',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status   NUMBER;
    v_response CLOB;
    v_pos      PLS_INTEGER := 1;
    v_buf      VARCHAR2(32767);
BEGIN
    RR_FA_ACCOUNTING_PKG.GET_DEPRN_PREVIEW(
        p_asset_id        => :assetId,
        p_book            => :bookTypeCode,
        p_distribution_id => :distributionId,
        p_period_name     => :periodName,
        p_status          => v_status,
        p_response        => v_response
    );
    :status := NVL(v_status, 200);
    LOOP
        v_buf := DBMS_LOB.SUBSTR(v_response, 32767, v_pos);
        EXIT WHEN v_buf IS NULL;
        HTP.PRN(v_buf);
        v_pos := v_pos + 32767;
    END LOOP;
EXCEPTION WHEN OTHERS THEN
    :status := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/

-- Template: fa/accounting/mark-deprn-accounted
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/accounting/mark-deprn-accounted',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: mark depreciation period as ACCOUNTED'
    );
    COMMIT;
END;
/

-- POST fa/accounting/mark-deprn-accounted
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/accounting/mark-deprn-accounted',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body      CLOB := :body_text;
    v_status    NUMBER;
    v_response  CLOB;
    v_pos       PLS_INTEGER := 1;
    v_buf       VARCHAR2(32767);
    v_json      APEX_JSON.t_values;
BEGIN
    APEX_JSON.PARSE(v_json, v_body);
    RR_FA_ACCOUNTING_PKG.MARK_DEPRN_ACCOUNTED(
        p_asset_id        => APEX_JSON.get_varchar2(p_values=>v_json, p_path=>'assetId'),
        p_book            => APEX_JSON.get_varchar2(p_values=>v_json, p_path=>'bookTypeCode'),
        p_distribution_id => APEX_JSON.get_varchar2(p_values=>v_json, p_path=>'distributionId'),
        p_period_name     => APEX_JSON.get_varchar2(p_values=>v_json, p_path=>'periodName'),
        p_sla_header_id   => APEX_JSON.get_number(  p_values=>v_json, p_path=>'slaHeaderId'),
        p_gl_header_id    => APEX_JSON.get_number(  p_values=>v_json, p_path=>'glHeaderId'),
        p_created_by      => NVL(APEX_JSON.get_varchar2(p_values=>v_json, p_path=>'createdBy'), 'REACTERP'),
        p_status          => v_status,
        p_response        => v_response
    );
    :status := NVL(v_status, 200);
    LOOP
        v_buf := DBMS_LOB.SUBSTR(v_response, 32767, v_pos);
        EXIT WHEN v_buf IS NULL;
        HTP.PRN(v_buf);
        v_pos := v_pos + 32767;
    END LOOP;
EXCEPTION WHEN OTHERS THEN
    :status := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
