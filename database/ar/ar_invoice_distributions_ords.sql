-- =====================================================
-- AR Invoice Distributions
-- Table  : RR_AR_INVOICE_DISTRIBUTIONS
-- Module : ar
-- Base   : /ar/invoices/:id/distributions
-- =====================================================

-- =====================================================
-- 1. Drop and recreate ORDS template
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoices/:id/distributions');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoices/:id/distributions',
        p_comments    => 'AR Invoice Distributions — GET all distributions for an invoice, POST upsert distributions'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. POST /ar/invoices/:id/distributions
--    Body: { "items": [ { "DistributionId": N, ... } ] }
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/distributions',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert AR Invoice Distributions from Fusion receivablesInvoiceDistributions',
        p_source         => q'[
DECLARE
    l_status  VARCHAR2(20);
    l_message VARCHAR2(4000);
BEGIN
    RR_AR_INVOICE_DIST_PKG.save_distributions(
        p_transaction_id => :id,
        p_json           => :body_text,
        p_status         => l_status,
        p_message        => l_message
    );

    IF l_status = 'SUCCESS' THEN
        :status_code := 201;
        HTP.P(l_message);
    ELSE
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":"' || REPLACE(l_message, '"', '\"') || '"}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. GET /ar/invoices/:id/distributions
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/distributions',
        p_method         => 'GET',
        p_source_type    => 'collection/query',
        p_items_per_page => 0,
        p_comments       => 'Fetch all distributions for an AR invoice',
        p_source         => q'[SELECT
    d.DISTRIBUTION_ID,
    d.CUSTOMER_TRANSACTION_ID,
    d.INVOICE_LINE_NUMBER,
    d.DETAILED_TAX_LINE_NUMBER,
    d.ACCOUNT_CLASS,
    d.ACCOUNT_COMBINATION,
    vsv.DESCRIPTION                              AS ACCOUNT_COMBINATION_DESC,
    d.AMOUNT,
    d.ACCOUNTED_AMOUNT,
    d.PERCENT,
    d.COMMENTS,
    d.FUSION_CREATED_BY,
    d.FUSION_CREATION_DATE,
    d.FUSION_LAST_UPDATED_BY,
    d.FUSION_LAST_UPDATE_DATE,
    d.SYNC_DATE,
    d.SYNC_STATUS
FROM RR_AR_INVOICE_DISTRIBUTIONS d
LEFT JOIN RR_VALUE_SET_VALUES vsv
       ON vsv.VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
      AND vsv.VALUE = NULLIF(TRIM(REGEXP_SUBSTR(d.ACCOUNT_COMBINATION, '[^-]+', 1, 4)), '')
WHERE d.CUSTOMER_TRANSACTION_ID = :id
ORDER BY d.INVOICE_LINE_NUMBER, d.DISTRIBUTION_ID]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. Package Spec: RR_AR_INVOICE_DIST_PKG
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AR_INVOICE_DIST_PKG AS

    PROCEDURE save_distributions(
        p_transaction_id IN  NUMBER,
        p_json           IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2
    );

END RR_AR_INVOICE_DIST_PKG;
/

-- =====================================================
-- 5. Package Body: RR_AR_INVOICE_DIST_PKG
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AR_INVOICE_DIST_PKG AS

    PROCEDURE save_distributions(
        p_transaction_id IN  NUMBER,
        p_json           IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2
    ) IS
        l_inserted   NUMBER := 0;
        l_updated    NUMBER := 0;
        l_errors     NUMBER := 0;
        l_error_msgs VARCHAR2(4000) := '';

        CURSOR c_items IS
            SELECT
                jt.distribution_id,
                jt.invoice_line_number,
                jt.detailed_tax_line_number,
                jt.account_class,
                jt.account_combination,
                jt.amount,
                jt.accounted_amount,
                jt.percent,
                jt.comments,
                jt.created_by,
                jt.creation_date,
                jt.last_updated_by,
                jt.last_update_date
            FROM JSON_TABLE(
                p_json, '$.items[*]'
                COLUMNS (
                    distribution_id         NUMBER          PATH '$.DistributionId',
                    invoice_line_number     NUMBER          PATH '$.InvoiceLineNumber',
                    detailed_tax_line_number NUMBER         PATH '$.DetailedTaxLineNumber',
                    account_class           VARCHAR2(100)   PATH '$.AccountClass',
                    account_combination     VARCHAR2(500)   PATH '$.AccountCombination',
                    amount                  NUMBER          PATH '$.Amount',
                    accounted_amount        NUMBER          PATH '$.AccountedAmount',
                    percent                 NUMBER          PATH '$.Percent',
                    comments                VARCHAR2(4000)  PATH '$.Comments',
                    created_by              VARCHAR2(240)   PATH '$.CreatedBy',
                    creation_date           VARCHAR2(50)    PATH '$.CreationDate',
                    last_updated_by         VARCHAR2(240)   PATH '$.LastUpdatedBy',
                    last_update_date        VARCHAR2(50)    PATH '$.LastUpdateDate'
                )
            ) jt;

        v_exists     NUMBER;
        v_fusion_creation_date  TIMESTAMP;
        v_fusion_last_upd_date  TIMESTAMP;

        FUNCTION safe_ts(p_str VARCHAR2) RETURN TIMESTAMP IS
        BEGIN
            IF p_str IS NULL THEN
                RETURN NULL;
            END IF;
            RETURN TO_TIMESTAMP(SUBSTR(p_str, 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS');
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END safe_ts;

    BEGIN
        FOR r IN c_items LOOP
            BEGIN
                v_fusion_creation_date := safe_ts(r.creation_date);
                v_fusion_last_upd_date := safe_ts(r.last_update_date);

                SELECT COUNT(*) INTO v_exists
                FROM RR_AR_INVOICE_DISTRIBUTIONS
                WHERE DISTRIBUTION_ID = r.distribution_id;

                MERGE INTO RR_AR_INVOICE_DISTRIBUTIONS d
                USING (SELECT r.distribution_id AS did FROM DUAL) s
                ON (d.DISTRIBUTION_ID = s.did)
                WHEN MATCHED THEN UPDATE SET
                    CUSTOMER_TRANSACTION_ID    = p_transaction_id,
                    INVOICE_LINE_NUMBER        = r.invoice_line_number,
                    DETAILED_TAX_LINE_NUMBER   = r.detailed_tax_line_number,
                    ACCOUNT_CLASS              = r.account_class,
                    ACCOUNT_COMBINATION        = r.account_combination,
                    AMOUNT                     = r.amount,
                    ACCOUNTED_AMOUNT           = r.accounted_amount,
                    PERCENT                    = r.percent,
                    COMMENTS                   = r.comments,
                    FUSION_CREATED_BY          = r.created_by,
                    FUSION_CREATION_DATE       = v_fusion_creation_date,
                    FUSION_LAST_UPDATED_BY     = r.last_updated_by,
                    FUSION_LAST_UPDATE_DATE    = v_fusion_last_upd_date,
                    SYNC_DATE                  = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (
                    DISTRIBUTION_ID,
                    CUSTOMER_TRANSACTION_ID,
                    INVOICE_LINE_NUMBER,
                    DETAILED_TAX_LINE_NUMBER,
                    ACCOUNT_CLASS,
                    ACCOUNT_COMBINATION,
                    AMOUNT,
                    ACCOUNTED_AMOUNT,
                    PERCENT,
                    COMMENTS,
                    FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE,
                    SYNC_DATE
                ) VALUES (
                    r.distribution_id,
                    p_transaction_id,
                    r.invoice_line_number,
                    r.detailed_tax_line_number,
                    r.account_class,
                    r.account_combination,
                    r.amount,
                    r.accounted_amount,
                    r.percent,
                    r.comments,
                    r.created_by,
                    v_fusion_creation_date,
                    r.last_updated_by,
                    v_fusion_last_upd_date,
                    SYSTIMESTAMP
                );

                IF v_exists > 0 THEN
                    l_updated  := l_updated  + 1;
                ELSE
                    l_inserted := l_inserted + 1;
                END IF;

            EXCEPTION WHEN OTHERS THEN
                l_errors := l_errors + 1;
                IF LENGTH(l_error_msgs) < 3500 THEN
                    l_error_msgs := l_error_msgs || SUBSTR(SQLERRM, 1, 200) || '; ';
                END IF;
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := '{"status":"SUCCESS","inserted":' || l_inserted ||
                     ',"updated":'  || l_updated  ||
                     ',"errors":'   || l_errors   ||
                     CASE WHEN l_error_msgs IS NOT NULL
                          THEN ',"errorDetail":"' || REPLACE(l_error_msgs, '"', '\"') || '"'
                          ELSE '' END || '}';

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_status  := 'ERROR';
        p_message := SQLERRM;
    END save_distributions;

END RR_AR_INVOICE_DIST_PKG;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/invoices/:id/distributions   All distributions for an invoice
-- POST {base}/ar/invoices/:id/distributions   Upsert distributions from Fusion
-- =====================================================
