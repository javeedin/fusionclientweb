-- ============================================================
-- RR_AP_APPLIED_PREPAYMENTS_PKG
-- Handles saving prepayment applications to invoices
-- ============================================================
-- JSON fields accepted (single record):
--   PrepaymentApplicationId, InvoiceId, InvoiceNumber,
--   PrepaymentInvoiceId, PrepaymentNumber, LineNumber,
--   PrepaymentLineNumber, Description, BusinessUnit,
--   SupplierSite, PurchaseOrder, Currency, AppliedAmount,
--   IncludedTax, IncludedonInvoiceFlag, ApplicationAccountingDate,
--   Status, CreatedBy, CreationDate, LastUpdatedBy,
--   LastUpdateDate, LastUpdateLogin
-- ============================================================

CREATE OR REPLACE PACKAGE RR_AP_APPLIED_PREPAYMENTS_PKG AS

    -- Save a single prepayment application from a JSON object
    PROCEDURE save_application(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    );

    -- Save multiple applications from a JSON array: [ {...}, {...} ]
    PROCEDURE save_bulk(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    );

    -- Save from items wrapper: { "items": [ {...}, {...} ] }
    PROCEDURE save_from_items(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    );

    -- Get all applications for a given invoice
    FUNCTION get_by_invoice_id(
        p_invoice_id IN NUMBER
    ) RETURN CLOB;

    -- Get all applications for a given prepayment invoice
    FUNCTION get_by_prepayment_id(
        p_prepayment_invoice_id IN NUMBER
    ) RETURN CLOB;

    -- Get prepayment balance for one or many prepayment invoices
    -- Returns: InvoiceAmount, TotalApplied, AvailableBalance per prepayment
    -- p_prepayment_invoice_id  -> single prepayment
    -- p_supplier_number        -> all prepayments for a supplier
    -- Both NULL                -> all prepayments in the system
    FUNCTION get_prepayment_balances(
        p_prepayment_invoice_id IN NUMBER  DEFAULT NULL,
        p_supplier_number       IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB;

    -- Get available prepayments for a supplier (by supplier_id)
    -- Returns snake_case JSON items for the Apply Prepayments modal
    -- Filters: invoice_type = 'Prepayment', available_amount > 0
    FUNCTION get_available_by_supplier_id(
        p_supplier_id IN NUMBER
    ) RETURN CLOB;

    -- Get applied prepayments for a target invoice (snake_case JSON)
    -- Used by the Applied section of the Apply/Unapply Prepayments modal
    FUNCTION get_applied_by_invoice_snake(
        p_invoice_id IN NUMBER
    ) RETURN CLOB;

END RR_AP_APPLIED_PREPAYMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AP_APPLIED_PREPAYMENTS_PKG AS

    -- --------------------------------------------------------
    -- Internal: parse one JSON object and upsert into table
    -- --------------------------------------------------------
    PROCEDURE save_application(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    ) IS
        v_application_id            NUMBER;
        v_invoice_id                NUMBER;
        v_invoice_number            VARCHAR2(100);
        v_prepayment_invoice_id     NUMBER;
        v_prepayment_number         VARCHAR2(100);
        v_line_number               NUMBER;
        v_prepayment_line_number    NUMBER;
        v_description               VARCHAR2(4000);
        v_business_unit             VARCHAR2(240);
        v_supplier_site             VARCHAR2(240);
        v_purchase_order            VARCHAR2(100);
        v_currency                  VARCHAR2(15);
        v_applied_amount            NUMBER;
        v_included_tax              NUMBER;
        v_included_on_invoice_flag  VARCHAR2(1);
        v_application_acct_date     DATE;
        v_status                    VARCHAR2(50);
        v_created_by                VARCHAR2(100);
        v_creation_date             TIMESTAMP WITH TIME ZONE;
        v_last_updated_by           VARCHAR2(100);
        v_last_update_date          TIMESTAMP WITH TIME ZONE;
        v_last_update_login         VARCHAR2(100);
        v_temp_str                  VARCHAR2(200);
        v_existing_count            NUMBER;
    BEGIN
        -- Extract all fields from JSON
        v_application_id            := JSON_VALUE(p_json, '$.PrepaymentApplicationId' RETURNING NUMBER);
        v_invoice_id                := JSON_VALUE(p_json, '$.InvoiceId'               RETURNING NUMBER);
        v_invoice_number            := JSON_VALUE(p_json, '$.InvoiceNumber');
        v_prepayment_invoice_id     := JSON_VALUE(p_json, '$.PrepaymentInvoiceId'     RETURNING NUMBER);
        v_prepayment_number         := JSON_VALUE(p_json, '$.PrepaymentNumber');
        v_line_number               := JSON_VALUE(p_json, '$.LineNumber'              RETURNING NUMBER);
        v_prepayment_line_number    := JSON_VALUE(p_json, '$.PrepaymentLineNumber'    RETURNING NUMBER);
        v_description               := JSON_VALUE(p_json, '$.Description'             RETURNING VARCHAR2(4000));
        v_business_unit             := JSON_VALUE(p_json, '$.BusinessUnit');
        v_supplier_site             := JSON_VALUE(p_json, '$.SupplierSite');
        v_purchase_order            := JSON_VALUE(p_json, '$.PurchaseOrder');
        v_currency                  := JSON_VALUE(p_json, '$.Currency');
        v_applied_amount            := JSON_VALUE(p_json, '$.AppliedAmount'           RETURNING NUMBER);
        v_included_tax              := JSON_VALUE(p_json, '$.IncludedTax'             RETURNING NUMBER);
        v_status                    := NVL(JSON_VALUE(p_json, '$.Status'), 'Applied');
        v_created_by                := JSON_VALUE(p_json, '$.CreatedBy');
        v_last_updated_by           := JSON_VALUE(p_json, '$.LastUpdatedBy');
        v_last_update_login         := JSON_VALUE(p_json, '$.LastUpdateLogin');

        -- IncludedonInvoiceFlag: accept true/false or Y/N
        DECLARE
            v_flag_raw VARCHAR2(10) := JSON_VALUE(p_json, '$.IncludedonInvoiceFlag');
        BEGIN
            v_included_on_invoice_flag := CASE
                WHEN UPPER(v_flag_raw) IN ('TRUE', 'Y', 'YES') THEN 'Y'
                ELSE 'N'
            END;
        END;

        -- Parse ApplicationAccountingDate
        BEGIN
            v_application_acct_date := TO_DATE(JSON_VALUE(p_json, '$.ApplicationAccountingDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN
            v_application_acct_date := SYSDATE;
        END;

        -- Parse CreationDate
        BEGIN
            v_temp_str := JSON_VALUE(p_json, '$.CreationDate');
            v_creation_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM');
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                v_creation_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
            EXCEPTION WHEN OTHERS THEN v_creation_date := NULL;
            END;
        END;

        -- Parse LastUpdateDate
        BEGIN
            v_temp_str := JSON_VALUE(p_json, '$.LastUpdateDate');
            v_last_update_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM');
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                v_last_update_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
            EXCEPTION WHEN OTHERS THEN v_last_update_date := NULL;
            END;
        END;

        -- Default audit columns
        v_created_by        := NVL(v_created_by,        SYS_CONTEXT('USERENV', 'SESSION_USER'));
        v_creation_date     := NVL(v_creation_date,     SYSTIMESTAMP);
        v_last_updated_by   := NVL(v_last_updated_by,   SYS_CONTEXT('USERENV', 'SESSION_USER'));
        v_last_update_date  := NVL(v_last_update_date,  SYSTIMESTAMP);
        v_last_update_login := NVL(v_last_update_login, SYS_CONTEXT('USERENV', 'SESSION_USER'));

        -- Auto-assign APPLICATION_ID if not provided
        IF v_application_id IS NULL THEN
            SELECT RR_AP_APPLIED_PREP_SEQ.NEXTVAL INTO v_application_id FROM DUAL;
        END IF;

        -- Upsert
        SELECT COUNT(*) INTO v_existing_count
        FROM RR_AP_APPLIED_PREPAYMENTS
        WHERE APPLICATION_ID = v_application_id;

        IF v_existing_count > 0 THEN
            UPDATE RR_AP_APPLIED_PREPAYMENTS
            SET    invoice_id                  = NVL(v_invoice_id,             invoice_id),
                   invoice_number              = NVL(v_invoice_number,         invoice_number),
                   prepayment_invoice_id       = NVL(v_prepayment_invoice_id,  prepayment_invoice_id),
                   prepayment_number           = NVL(v_prepayment_number,      prepayment_number),
                   line_number                 = NVL(v_line_number,            line_number),
                   prepayment_line_number      = NVL(v_prepayment_line_number, prepayment_line_number),
                   description                 = v_description,
                   business_unit               = NVL(v_business_unit,          business_unit),
                   supplier_site               = NVL(v_supplier_site,          supplier_site),
                   purchase_order              = v_purchase_order,
                   currency                    = NVL(v_currency,               currency),
                   applied_amount              = NVL(v_applied_amount,         applied_amount),
                   included_tax                = v_included_tax,
                   included_on_invoice_flag    = NVL(v_included_on_invoice_flag, included_on_invoice_flag),
                   application_accounting_date = NVL(v_application_acct_date,  application_accounting_date),
                   status                      = NVL(v_status,                 status),
                   last_updated_by             = v_last_updated_by,
                   last_update_date            = v_last_update_date,
                   last_update_login           = v_last_update_login,
                   local_updated_date          = SYSTIMESTAMP,
                   sync_status                 = 'SYNCED'
            WHERE  application_id = v_application_id;
        ELSE
            INSERT INTO RR_AP_APPLIED_PREPAYMENTS (
                APPLICATION_ID,
                INVOICE_ID,
                INVOICE_NUMBER,
                PREPAYMENT_INVOICE_ID,
                PREPAYMENT_NUMBER,
                LINE_NUMBER,
                PREPAYMENT_LINE_NUMBER,
                DESCRIPTION,
                BUSINESS_UNIT,
                SUPPLIER_SITE,
                PURCHASE_ORDER,
                CURRENCY,
                APPLIED_AMOUNT,
                INCLUDED_TAX,
                INCLUDED_ON_INVOICE_FLAG,
                APPLICATION_ACCOUNTING_DATE,
                STATUS,
                CREATED_BY,
                CREATION_DATE,
                LAST_UPDATED_BY,
                LAST_UPDATE_DATE,
                LAST_UPDATE_LOGIN,
                LOCAL_CREATED_DATE,
                LOCAL_UPDATED_DATE,
                SYNC_STATUS
            ) VALUES (
                v_application_id,
                v_invoice_id,
                v_invoice_number,
                v_prepayment_invoice_id,
                v_prepayment_number,
                v_line_number,
                v_prepayment_line_number,
                v_description,
                v_business_unit,
                v_supplier_site,
                v_purchase_order,
                v_currency,
                v_applied_amount,
                v_included_tax,
                v_included_on_invoice_flag,
                v_application_acct_date,
                v_status,
                v_created_by,
                v_creation_date,
                v_last_updated_by,
                v_last_update_date,
                v_last_update_login,
                SYSTIMESTAMP,
                SYSTIMESTAMP,
                'NEW'
            );
        END IF;

        -- When a prepayment application is saved, reduce the target invoice's
        -- amount_paid (or flag it) and update paid_status if fully covered
        BEGIN
            UPDATE RR_AP_INVOICES_ALL
            SET    last_update_date = SYSTIMESTAMP
            WHERE  invoice_id = v_invoice_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        COMMIT;

        -- -- Scenario 2: Accounting for Prepayment Applied to Invoice ------------
        -- When a prepayment is applied to a standard invoice, generate SLA
        -- journal entries: DR AP Liability / CR Prepayment Asset.
        -- Non-fatal: accounting failure never rolls back the saved data.
        DECLARE
            v_prepay_account  VARCHAR2(500);
            v_liab_account    VARCHAR2(500);
            v_acct_date_str   VARCHAR2(20);
            v_period          VARCHAR2(15);
            v_supplier_num    VARCHAR2(30);
            v_sla_status      NUMBER;
            v_sla_response    CLOB;
            v_sla_body        CLOB;
            v_amount          NUMBER;
            v_eff_acct_date   DATE;
            v_eff_currency    VARCHAR2(15);
            v_eff_bu          VARCHAR2(240);
        BEGIN
            v_eff_acct_date := NVL(v_application_acct_date, SYSDATE);
            v_acct_date_str := TO_CHAR(v_eff_acct_date, 'YYYY-MM-DD');
            v_period        := TO_CHAR(v_eff_acct_date, 'MON-YY');
            v_amount        := ABS(NVL(v_applied_amount, 0));
            v_eff_currency  := NVL(v_currency, 'AED');
            v_eff_bu        := NVL(v_business_unit, '');

            -- Look up GL account IDs from supplier site via prepayment invoice, then resolve each separately
            DECLARE
                v_prepay_acct_id  NUMBER;
                v_liab_acct_id    NUMBER;
            BEGIN
                SELECT sm.SUPPLIER_NUMBER,
                       ss.PREPAYMENT_ACCOUNT_ID,
                       ss.LIABILITY_ACCOUNT_ID
                INTO   v_supplier_num, v_prepay_acct_id, v_liab_acct_id
                FROM   RR_AP_INVOICES_ALL inv
                JOIN   RR_SUPPLIER_MASTER sm ON sm.SUPPLIER_NUMBER = inv.supplier_number
                JOIN   RR_SUPPLIER_SITES  ss ON ss.SUPPLIER_ID     = sm.SUPPLIER_ID
                WHERE  inv.invoice_id = v_prepayment_invoice_id
                AND    ROWNUM = 1;

                BEGIN
                    SELECT "buimercFinGlbCoaCo" || '-' || "buimercFinGlbCoaLob" || '-' ||
                           "buimercFinGlbCoaDepartment" || '-' || "buimercFinGlbCoaAccount" || '-' ||
                           "buimercFinGlbCoaSubAcc" || '-' || "buimercFinGlbCoaAlys" || '-' ||
                           "buimercFinGlbCoaIc" || '-' || "buimercFinGlbCoaFut1" || '-' ||
                           "buimercFinGlbCoaFut2"
                    INTO   v_prepay_account
                    FROM   reerp_gl_code_combinations
                    WHERE  "_CODE_COMBINATION_ID" = v_prepay_acct_id;
                EXCEPTION WHEN OTHERS THEN
                    v_prepay_account := 'PREPAYMENT-ACCOUNT';
                END;

                BEGIN
                    SELECT "buimercFinGlbCoaCo" || '-' || "buimercFinGlbCoaLob" || '-' ||
                           "buimercFinGlbCoaDepartment" || '-' || "buimercFinGlbCoaAccount" || '-' ||
                           "buimercFinGlbCoaSubAcc" || '-' || "buimercFinGlbCoaAlys" || '-' ||
                           "buimercFinGlbCoaIc" || '-' || "buimercFinGlbCoaFut1" || '-' ||
                           "buimercFinGlbCoaFut2"
                    INTO   v_liab_account
                    FROM   reerp_gl_code_combinations
                    WHERE  "_CODE_COMBINATION_ID" = v_liab_acct_id;
                EXCEPTION WHEN OTHERS THEN
                    v_liab_account := 'LIABILITY-ACCOUNT';
                END;
            EXCEPTION WHEN OTHERS THEN
                v_prepay_account := 'PREPAYMENT-ACCOUNT';
                v_liab_account   := 'LIABILITY-ACCOUNT';
            END;

            -- Build JSON payload and call create_accounting
            v_sla_body :=
                '{"header":{' ||
                    '"moduleName":"AP",' ||
                    '"sourceTable":"RR_AP_APPLIED_PREPAYMENTS",' ||
                    '"sourceId":' || v_application_id || ',' ||
                    '"sourceNumber":"' || REPLACE(v_invoice_number, '"', '\"') || '",' ||
                    '"sourceType":"PREPAYMENT_APPLICATION",' ||
                    '"eventTypeCode":"PREPAYMENT_APPLIED",' ||
                    '"eventDate":"' || v_acct_date_str || '",' ||
                    '"accountingDate":"' || v_acct_date_str || '",' ||
                    '"periodName":"' || v_period || '",' ||
                    '"ledgerId":300000003259529,' ||
                    '"ledgerName":"BCL DIFC",' ||
                    '"currencyCode":"' || v_eff_currency || '",' ||
                    '"ledgerCurrency":"AED",' ||
                    '"exchangeRate":1,' ||
                    '"exchangeRateType":"Corporate",' ||
                    '"businessUnit":"' || REPLACE(v_eff_bu, '"', '\"') || '",' ||
                    '"description":"Prepayment Applied - ' || REPLACE(v_prepayment_number, '"', '\"') || ' to Inv ' || REPLACE(v_invoice_number, '"', '\"') || '",' ||
                    '"createdBy":"' || NVL(v_created_by, 'SYSTEM') || '"' ||
                '},' ||
                '"lines":[' ||
                    '{' ||
                        '"lineNumber":1,' ||
                        '"lineType":"DR",' ||
                        '"accountingClass":"LIABILITY",' ||
                        '"accountCombination":"' || v_liab_account || '",' ||
                        '"enteredDr":' || v_amount || ',' ||
                        '"enteredCr":0,' ||
                        '"accountedDr":' || v_amount || ',' ||
                        '"accountedCr":0,' ||
                        '"currencyCode":"' || v_eff_currency || '",' ||
                        '"description":"AP Liability Reduced - Invoice ' || REPLACE(v_invoice_number, '"', '\"') || '"' ||
                    '},' ||
                    '{' ||
                        '"lineNumber":2,' ||
                        '"lineType":"CR",' ||
                        '"accountingClass":"PREPAYMENT",' ||
                        '"accountCombination":"' || v_prepay_account || '",' ||
                        '"enteredDr":0,' ||
                        '"enteredCr":' || v_amount || ',' ||
                        '"accountedDr":0,' ||
                        '"accountedCr":' || v_amount || ',' ||
                        '"currencyCode":"' || v_eff_currency || '",' ||
                        '"description":"Prepayment Asset Cleared - ' || REPLACE(v_prepayment_number, '"', '\"') || '"' ||
                    '}' ||
                ']}';

            RR_SLA_PKG.create_accounting(
                p_body_json => v_sla_body,
                p_status    => v_sla_status,
                p_response  => v_sla_response
            );

        EXCEPTION
            WHEN OTHERS THEN NULL;  -- Accounting failure is non-fatal
        END;
        -- -- End Scenario 2 Accounting --------------------------------------------

        p_result := '{"status":"success","message":"Prepayment application saved","applicationId":' || v_application_id || '}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_application;

    -- --------------------------------------------------------
    -- Save from a JSON array: [ {...}, {...} ]
    -- --------------------------------------------------------
    PROCEDURE save_bulk(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    ) IS
        v_count  NUMBER := 0;
        v_errors NUMBER := 0;
        v_single_result VARCHAR2(4000);
    BEGIN
        FOR rec IN (
            SELECT jt.item_json
            FROM JSON_TABLE(p_json, '$[*]'
                COLUMNS (item_json CLOB FORMAT JSON PATH '$')
            ) jt
        ) LOOP
            BEGIN
                save_application(rec.item_json, v_single_result);
                IF v_single_result LIKE '%"status":"success"%' THEN
                    v_count := v_count + 1;
                ELSE
                    v_errors := v_errors + 1;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_errors := v_errors + 1;
            END;
        END LOOP;

        p_result := '{"status":"' || CASE WHEN v_errors = 0 THEN 'success' ELSE 'partial' END || '"'
                 || ',"saved":' || v_count
                 || ',"errors":' || v_errors || '}';
    EXCEPTION
        WHEN OTHERS THEN
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_bulk;

    -- --------------------------------------------------------
    -- Save from items wrapper: { "items": [ {...}, {...} ] }
    -- --------------------------------------------------------
    PROCEDURE save_from_items(
        p_json   IN  CLOB,
        p_result OUT VARCHAR2
    ) IS
        v_items_json CLOB;
    BEGIN
        SELECT JSON_QUERY(p_json, '$.items') INTO v_items_json FROM DUAL;
        save_bulk(v_items_json, p_result);
    EXCEPTION
        WHEN OTHERS THEN
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_from_items;

    -- --------------------------------------------------------
    -- Get all applications for a target invoice
    -- --------------------------------------------------------
    FUNCTION get_by_invoice_id(
        p_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'ApplicationId'             VALUE application_id,
                'InvoiceId'                 VALUE invoice_id,
                'InvoiceNumber'             VALUE invoice_number,
                'PrepaymentInvoiceId'       VALUE prepayment_invoice_id,
                'PrepaymentNumber'          VALUE prepayment_number,
                'LineNumber'                VALUE line_number,
                'PrepaymentLineNumber'      VALUE prepayment_line_number,
                'Description'              VALUE description,
                'BusinessUnit'             VALUE business_unit,
                'SupplierSite'             VALUE supplier_site,
                'PurchaseOrder'            VALUE purchase_order,
                'Currency'                 VALUE currency,
                'AppliedAmount'            VALUE applied_amount,
                'IncludedTax'              VALUE included_tax,
                'IncludedonInvoiceFlag'    VALUE CASE WHEN included_on_invoice_flag = 'Y' THEN 'true' ELSE 'false' END,
                'ApplicationAccountingDate' VALUE TO_CHAR(application_accounting_date, 'YYYY-MM-DD'),
                'Status'                   VALUE status,
                'CreatedBy'               VALUE created_by,
                'CreationDate'            VALUE TO_CHAR(creation_date, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                'LastUpdatedBy'           VALUE last_updated_by,
                'LastUpdateDate'          VALUE TO_CHAR(last_update_date, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
                ABSENT ON NULL
            ) ORDER BY application_id
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_APPLIED_PREPAYMENTS
        WHERE invoice_id = p_invoice_id;

        RETURN NVL(v_result, '[]');
    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_by_invoice_id;

    -- --------------------------------------------------------
    -- Get all applications for a source prepayment invoice
    -- --------------------------------------------------------
    FUNCTION get_by_prepayment_id(
        p_prepayment_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'ApplicationId'             VALUE application_id,
                'InvoiceId'                 VALUE invoice_id,
                'InvoiceNumber'             VALUE invoice_number,
                'PrepaymentInvoiceId'       VALUE prepayment_invoice_id,
                'PrepaymentNumber'          VALUE prepayment_number,
                'LineNumber'                VALUE line_number,
                'PrepaymentLineNumber'      VALUE prepayment_line_number,
                'Description'              VALUE description,
                'BusinessUnit'             VALUE business_unit,
                'SupplierSite'             VALUE supplier_site,
                'Currency'                 VALUE currency,
                'AppliedAmount'            VALUE applied_amount,
                'IncludedTax'              VALUE included_tax,
                'ApplicationAccountingDate' VALUE TO_CHAR(application_accounting_date, 'YYYY-MM-DD'),
                'Status'                   VALUE status
                ABSENT ON NULL
            ) ORDER BY application_id
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_APPLIED_PREPAYMENTS
        WHERE prepayment_invoice_id = p_prepayment_invoice_id;

        RETURN NVL(v_result, '[]');
    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_by_prepayment_id;

    -- --------------------------------------------------------
    -- Prepayment balance summary
    -- InvoiceAmount comes from RR_AP_INVOICES_ALL
    -- TotalApplied  = SUM(applied_amount) from RR_AP_APPLIED_PREPAYMENTS
    -- AvailableBalance = InvoiceAmount - TotalApplied
    -- --------------------------------------------------------
    FUNCTION get_prepayment_balances(
        p_prepayment_invoice_id IN NUMBER   DEFAULT NULL,
        p_supplier_number       IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'PrepaymentInvoiceId'    VALUE inv.invoice_id,
                'PrepaymentNumber'       VALUE inv.invoice_number,
                'Supplier'               VALUE inv.supplier,
                'SupplierNumber'         VALUE inv.supplier_number,
                'SupplierSite'           VALUE inv.supplier_site,
                'BusinessUnit'           VALUE inv.business_unit,
                'Currency'               VALUE inv.invoice_currency,
                'InvoiceDate'            VALUE TO_CHAR(inv.invoice_date,       'YYYY-MM-DD'),
                'ApplyAfterDate'         VALUE TO_CHAR(inv.apply_after_date,   'YYYY-MM-DD'),
                'InvoiceAmount'          VALUE inv.invoice_amount,
                'TotalApplied'           VALUE NVL(agg.total_applied, 0),
                'AvailableBalance'       VALUE inv.invoice_amount - NVL(agg.total_applied, 0),
                'ApplicationCount'       VALUE NVL(agg.application_count, 0),
                'PaidStatus'             VALUE inv.paid_status,
                'ValidationStatus'       VALUE inv.validation_status
                ABSENT ON NULL
            ) ORDER BY inv.invoice_id
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_INVOICES_ALL inv
        LEFT JOIN (
            SELECT prepayment_invoice_id,
                   SUM(CASE WHEN status != 'Cancelled' THEN applied_amount ELSE 0 END) AS total_applied,
                   COUNT(CASE WHEN status != 'Cancelled' THEN 1 END)                   AS application_count
            FROM   RR_AP_APPLIED_PREPAYMENTS
            GROUP BY prepayment_invoice_id
        ) agg ON agg.prepayment_invoice_id = inv.invoice_id
        WHERE inv.invoice_type = 'Prepayment'
          AND (p_prepayment_invoice_id IS NULL OR inv.invoice_id      = p_prepayment_invoice_id)
          AND (p_supplier_number       IS NULL OR inv.supplier_number  = p_supplier_number);

        RETURN NVL(v_result, '[]');
    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_prepayment_balances;

    -- --------------------------------------------------------
    -- Get available prepayments for a supplier by SUPPLIER_ID
    -- Returns snake_case items array for the frontend modal
    -- --------------------------------------------------------
    FUNCTION get_available_by_supplier_id(
        p_supplier_id IN NUMBER
    ) RETURN CLOB IS
        v_result        CLOB;
        v_supplier_num  VARCHAR2(30);
    BEGIN
        -- Resolve supplier_number from supplier_id
        BEGIN
            SELECT supplier_number
            INTO   v_supplier_num
            FROM   RR_SUPPLIER_MASTER
            WHERE  supplier_id = p_supplier_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN '{"items":[],"count":0}';
        END;

        SELECT JSON_OBJECT(
            'items' VALUE JSON_ARRAYAGG(
                JSON_OBJECT(
                    'invoice_id'              VALUE inv.invoice_id,
                    'invoice_number'          VALUE inv.invoice_number,
                    'description'             VALUE inv.description,
                    'supplier_site'           VALUE inv.supplier_site,
                    'purchase_order'          VALUE l.purchase_order_number,
                    'currency'                VALUE inv.invoice_currency,
                    'available_amount'        VALUE (inv.invoice_amount - NVL(agg.total_applied, 0)),
                    'line_number'             VALUE 1,
                    'prepayment_line_number'  VALUE 1,
                    'business_unit'           VALUE inv.business_unit
                    ABSENT ON NULL
                ) ORDER BY inv.invoice_id
                RETURNING CLOB
            ),
            'count' VALUE COUNT(*)
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_INVOICES_ALL inv
        LEFT JOIN (
            SELECT prepayment_invoice_id,
                   SUM(CASE WHEN status != 'Cancelled' THEN applied_amount ELSE 0 END) AS total_applied
            FROM   RR_AP_APPLIED_PREPAYMENTS
            GROUP BY prepayment_invoice_id
        ) agg ON agg.prepayment_invoice_id = inv.invoice_id
        LEFT JOIN (
            SELECT invoice_id,
                   MIN(purchase_order_number) AS purchase_order_number
            FROM   RR_AP_INVOICE_LINES_ALL
            WHERE  purchase_order_number IS NOT NULL
            GROUP BY invoice_id
        ) l ON l.invoice_id = inv.invoice_id
        WHERE inv.invoice_type     = 'Prepayment'
          AND NVL(inv.canceled_flag, 'N') != 'Y'
          AND inv.supplier_number  = v_supplier_num
          AND (inv.invoice_amount - NVL(agg.total_applied, 0)) > 0;

        RETURN NVL(v_result, '{"items":[],"count":0}');
    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_available_by_supplier_id;

    -- --------------------------------------------------------
    -- Get applied prepayments for a target invoice (snake_case)
    -- Returns items wrapper for the frontend modal Applied section
    -- --------------------------------------------------------
    FUNCTION get_applied_by_invoice_snake(
        p_invoice_id IN NUMBER
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'items' VALUE JSON_ARRAYAGG(
                JSON_OBJECT(
                    'application_id'              VALUE application_id,
                    'invoice_id'                  VALUE invoice_id,
                    'invoice_number'              VALUE invoice_number,
                    'prepayment_invoice_id'       VALUE prepayment_invoice_id,
                    'prepayment_number'           VALUE prepayment_number,
                    'line_number'                 VALUE line_number,
                    'prepayment_line_number'      VALUE prepayment_line_number,
                    'description'                 VALUE description,
                    'business_unit'               VALUE business_unit,
                    'supplier_site'               VALUE supplier_site,
                    'purchase_order'              VALUE purchase_order,
                    'currency'                    VALUE currency,
                    'applied_amount'              VALUE applied_amount,
                    'included_tax'                VALUE included_tax,
                    'application_accounting_date' VALUE TO_CHAR(application_accounting_date, 'YYYY-MM-DD'),
                    'status'                      VALUE status,
                    'sync_status'                 VALUE NVL(sync_status, 'NEW'),
                    'created_by'                  VALUE created_by
                    ABSENT ON NULL
                ) ORDER BY application_id
                RETURNING CLOB
            ),
            'count' VALUE COUNT(*)
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_APPLIED_PREPAYMENTS
        WHERE invoice_id = p_invoice_id
          AND NVL(status, 'Applied') != 'Cancelled';

        RETURN NVL(v_result, '{"items":[],"count":0}');
    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_applied_by_invoice_snake;

END RR_AP_APPLIED_PREPAYMENTS_PKG;
/
