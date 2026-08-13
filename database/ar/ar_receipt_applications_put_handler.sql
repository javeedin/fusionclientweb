-- =====================================================
-- PUT /ar/receipt-applications/:appId
--
-- Updates an existing AR Receipt Application AND
-- reduces the linked installment balance atomically.
--
-- Expected JSON body:
-- {
--   "ApplicationDate":              "YYYY-MM-DD",
--   "AccountingDate":               "YYYY-MM-DD",
--   "ApplicationAmount":            12345.00,      -- used to update installment balance
--   "ApplicationStatus":            "APP",
--   "ActivityName":                 "Invoice",
--   "ProcessStatus":                "PENDING",
--   "IsLatestApplication":          "Y",
--   "ReferenceTransactionId":       9001,          -- CUSTOMER_TRANSACTION_ID on installments table
--   "ReferenceTransactionNumber":   "INV-2024-001",
--   "ReferenceTransactionStatus":   "OP",
--   "ReferenceInstallmentId":       1,             -- INSTALLMENT_ID on installments table
--   "InstallmentPreviousBalance":   50000.00,      -- old balance before this application (for AMOUNT_PAID calc)
--   "CustAccountId":                12345,
--   "CustomerSite":                 "SITE-001",
--   "ReceiptMethod":                "BANK TRANSFER",
--   "EnteredCurrency":              "AED",
--   "LastUpdatedBy":                "user@example.com"
-- }
--
-- Installment update logic:
--   INSTALLMENT_BALANCE_DUE  -= ApplicationAmount
--   AMOUNT_PAID              += ApplicationAmount
--   INSTALLMENT_STATUS        = 'CL' when balance reaches 0, else 'OP'
-- =====================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'ar',
            p_pattern     => 'receipt-applications/:appId',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/

BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'ar',
            p_pattern     => 'receipt-applications/:appId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Single AR receipt application by APPLICATION_ID'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications/:appId',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update AR receipt application and reduce linked installment balance',
        p_source         => q'[
DECLARE
    l_body              CLOB;
    l_app_id            NUMBER;
    l_app_rows          NUMBER;
    l_inst_rows         NUMBER;

    -- Parsed field values
    l_app_date          DATE;
    l_acc_date          DATE;
    l_app_amount        NUMBER;
    l_app_status        VARCHAR2(30);
    l_activity          VARCHAR2(100);
    l_proc_status       VARCHAR2(30);
    l_is_latest         VARCHAR2(1);
    l_ref_txn_id        NUMBER;
    l_ref_txn_num       VARCHAR2(150);
    l_ref_txn_status    VARCHAR2(30);
    l_ref_inst_id       NUMBER;
    l_cust_acct_id      NUMBER;
    l_cust_site         VARCHAR2(240);
    l_rcpt_method       VARCHAR2(100);
    l_currency          VARCHAR2(15);
    l_updated_by        VARCHAR2(240);

    -- Installment recalc
    l_new_balance       NUMBER;
    l_new_status        VARCHAR2(30);

    FUNCTION safe_varchar(p_path VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN APEX_JSON.get_varchar2(p_path => p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_number(p_path VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN APEX_JSON.get_number(p_path => p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_date(p_path VARCHAR2) RETURN DATE IS
        l_val VARCHAR2(30);
    BEGIN
        l_val := APEX_JSON.get_varchar2(p_path => p_path);
        RETURN CASE WHEN l_val IS NULL THEN NULL
                    ELSE TO_DATE(SUBSTR(l_val,1,10), 'YYYY-MM-DD') END;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

BEGIN
    l_app_id := TO_NUMBER(:appId);
    l_body   := :body_text;
    APEX_JSON.parse(l_body);

    -- Read all fields from body
    l_app_date       := safe_date   ('ApplicationDate');
    l_acc_date       := safe_date   ('AccountingDate');
    l_app_amount     := safe_number ('ApplicationAmount');
    l_app_status     := safe_varchar('ApplicationStatus');
    l_activity       := safe_varchar('ActivityName');
    l_proc_status    := safe_varchar('ProcessStatus');
    l_is_latest      := safe_varchar('IsLatestApplication');
    l_ref_txn_id     := safe_number ('ReferenceTransactionId');
    l_ref_txn_num    := safe_varchar('ReferenceTransactionNumber');
    l_ref_txn_status := safe_varchar('ReferenceTransactionStatus');
    l_ref_inst_id    := safe_number ('ReferenceInstallmentId');
    l_cust_acct_id   := safe_number ('CustAccountId');
    l_cust_site      := safe_varchar('CustomerSite');
    l_rcpt_method    := safe_varchar('ReceiptMethod');
    l_currency       := safe_varchar('EnteredCurrency');
    l_updated_by     := safe_varchar('LastUpdatedBy');

    -- ─────────────────────────────────────────────────
    -- 1. Update receipt application record
    -- ─────────────────────────────────────────────────
    UPDATE RR_AR_RECEIPT_APPLICATIONS
    SET
        APPLICATION_DATE             = NVL(l_app_date,       APPLICATION_DATE),
        ACCOUNTING_DATE              = NVL(l_acc_date,       ACCOUNTING_DATE),
        APPLICATION_AMOUNT           = NVL(l_app_amount,     APPLICATION_AMOUNT),
        APPLICATION_STATUS           = NVL(l_app_status,     APPLICATION_STATUS),
        ACTIVITY_NAME                = NVL(l_activity,       ACTIVITY_NAME),
        PROCESS_STATUS               = NVL(l_proc_status,    PROCESS_STATUS),
        IS_LATEST_APPLICATION        = NVL(l_is_latest,      IS_LATEST_APPLICATION),
        REFERENCE_TRANSACTION_ID     = NVL(l_ref_txn_id,     REFERENCE_TRANSACTION_ID),
        REFERENCE_TRANSACTION_NUMBER = NVL(l_ref_txn_num,    REFERENCE_TRANSACTION_NUMBER),
        REFERENCE_TRANSACTION_STATUS = NVL(l_ref_txn_status, REFERENCE_TRANSACTION_STATUS),
        REFERENCE_INSTALLMENT_ID     = NVL(l_ref_inst_id,    REFERENCE_INSTALLMENT_ID),
        CUST_ACCOUNT_ID              = NVL(l_cust_acct_id,   CUST_ACCOUNT_ID),
        CUSTOMER_SITE                = NVL(l_cust_site,      CUSTOMER_SITE),
        RECEIPT_METHOD               = NVL(l_rcpt_method,    RECEIPT_METHOD),
        ENTERED_CURRENCY             = NVL(l_currency,       ENTERED_CURRENCY),
        FUSION_LAST_UPDATED_BY       = NVL(l_updated_by,     FUSION_LAST_UPDATED_BY),
        FUSION_LAST_UPDATE_DATE      = SYSTIMESTAMP,
        LAST_UPDATED_BY              = NVL(l_updated_by,     LAST_UPDATED_BY),
        LAST_UPDATE_DATE             = SYSTIMESTAMP
    WHERE APPLICATION_ID = l_app_id;

    l_app_rows := SQL%ROWCOUNT;

    IF l_app_rows = 0 THEN
        ROLLBACK;
        :status := 404;
        HTP.p('{"status":"error","message":"Receipt application not found for ID ' || l_app_id || '"}');
        RETURN;
    END IF;

    -- ─────────────────────────────────────────────────
    -- 2. Update installment balance if installment supplied
    -- ─────────────────────────────────────────────────
    l_inst_rows := 0;
    IF l_ref_inst_id IS NOT NULL AND l_app_amount IS NOT NULL THEN

        -- Calculate new balance (floor at 0)
        SELECT GREATEST(NVL(INSTALLMENT_BALANCE_DUE, 0) - l_app_amount, 0)
        INTO   l_new_balance
        FROM   RR_AR_INVOICE_INSTALLMENTS
        WHERE  INSTALLMENT_ID = l_ref_inst_id;

        l_new_status := CASE WHEN l_new_balance = 0 THEN 'CL' ELSE 'OP' END;

        UPDATE RR_AR_INVOICE_INSTALLMENTS
        SET
            INSTALLMENT_BALANCE_DUE  = l_new_balance,
            AMOUNT_PAID              = NVL(AMOUNT_PAID, 0) + l_app_amount,
            INSTALLMENT_STATUS       = l_new_status,
            INSTALLMENT_CLOSED_DATE  = CASE WHEN l_new_status = 'CL'
                                            THEN NVL(l_app_date, SYSDATE)
                                            ELSE INSTALLMENT_CLOSED_DATE END,
            LAST_UPDATED_BY          = NVL(l_updated_by, LAST_UPDATED_BY),
            LAST_UPDATE_DATE         = SYSTIMESTAMP
        WHERE INSTALLMENT_ID = l_ref_inst_id;

        l_inst_rows := SQL%ROWCOUNT;
    END IF;

    COMMIT;
    :status := 200;
    HTP.p('{"status":"success"' ||
          ',"message":"Receipt application and installment updated"' ||
          ',"application_id":'   || l_app_id    ||
          ',"installment_id":'   || NVL(TO_CHAR(l_ref_inst_id), 'null') ||
          ',"installment_new_balance":' || NVL(TO_CHAR(l_new_balance), 'null') ||
          ',"installment_status":"' || NVL(l_new_status, '') || '"' ||
          ',"app_rows_updated":'  || l_app_rows  ||
          ',"inst_rows_updated":' || l_inst_rows ||
          '}');

EXCEPTION
    WHEN VALUE_ERROR THEN
        ROLLBACK;
        :status := 400;
        HTP.p('{"status":"error","message":"Invalid application ID: ' || :appId || '"}');
    WHEN NO_DATA_FOUND THEN
        ROLLBACK;
        :status := 404;
        HTP.p('{"status":"error","message":"Installment not found for ID ' || TO_CHAR(l_ref_inst_id) || '"}');
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT handler for ar/receipt-applications/:appId created successfully.');
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- =====================================================
-- PUT {base}/ar/receipt-applications/:appId
--
--   Path : appId = APPLICATION_ID (NUMBER)
--   Body : JSON with any updatable fields (all optional)
--
--   Side effect (when ReferenceInstallmentId + ApplicationAmount supplied):
--     RR_AR_INVOICE_INSTALLMENTS
--       INSTALLMENT_BALANCE_DUE  -= ApplicationAmount  (floor 0)
--       AMOUNT_PAID              += ApplicationAmount
--       INSTALLMENT_STATUS        = 'CL' | 'OP'
--       INSTALLMENT_CLOSED_DATE   = ApplicationDate when closed
--
--   HTTP codes:
--     200  success (both tables updated in one commit)
--     404  application not found  OR  installment not found
--     400  non-numeric appId
--     500  unexpected DB error
-- =====================================================
