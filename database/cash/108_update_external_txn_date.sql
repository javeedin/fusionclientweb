-- =============================================================================
-- 108: Update TRANSACTION_DATE on an external cash transaction
--
-- PUT reerp/cash/externaltransactions/:id/date
-- Body: { "transactionDate": "2026-08-26",
--         "externalTransactionId": 1234,        -- optional, see below
--         "updatedBy": "name" }
--
-- Updates RR_EXTERNAL_CASH_TRANSACTIONS.TRANSACTION_DATE
-- (+ LAST_UPDATED_BY / LAST_UPDATE_DATE audit columns).
--
-- Row matching:
--   * If the body contains "externalTransactionId" -> row is matched by
--     EXTERNAL_TRANSACTION_ID (this is what the Re-ERP UI sends, because the
--     app only ever holds EXTERNAL_TRANSACTION_ID — the GET handler does not
--     expose the ID column).
--   * Otherwise -> row is matched by the ID primary-key column using the :id
--     value from the URL (or "id" from the body). Use this form in Postman:
--         PUT .../cash/externaltransactions/45/date
--         { "transactionDate": "2026-08-26" }
--   The response tells you which key was used ("matchedBy").
--
-- Recipe follows the PROVEN-WORKING 120_update_journal_period_date.sql v4:
-- camelCase URI bind (no underscores), :status (not :status_code),
-- stored procedure + APEX_JSON, separate DEFINE_TEMPLATE block,
-- diagnostic 400 response.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands — run EACH block separately.
-- =============================================================================


-- =============================================================================
-- 1. PROCEDURE: RR_UPDATE_EXT_TXN_DATE
-- =============================================================================
CREATE OR REPLACE PROCEDURE RR_UPDATE_EXT_TXN_DATE (
    p_id          IN  NUMBER,       -- RR_EXTERNAL_CASH_TRANSACTIONS.ID
    p_ext_txn_id  IN  NUMBER,       -- EXTERNAL_TRANSACTION_ID (optional alternative key)
    p_date_str    IN  VARCHAR2,     -- YYYY-MM-DD
    p_updated_by  IN  VARCHAR2,
    p_status      OUT NUMBER,
    p_message     OUT CLOB
) AS
    v_date       DATE;
    v_count      NUMBER := 0;
    v_matched_by VARCHAR2(30);
BEGIN
    IF p_date_str IS NULL OR (p_id IS NULL AND p_ext_txn_id IS NULL) THEN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'transactionDate and id (or externalTransactionId) are required');
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 400;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    v_date := TO_DATE(SUBSTR(p_date_str, 1, 10), 'YYYY-MM-DD');

    IF p_ext_txn_id IS NOT NULL THEN
        v_matched_by := 'EXTERNAL_TRANSACTION_ID';
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
           SET TRANSACTION_DATE = v_date,
               LAST_UPDATED_BY  = NVL(p_updated_by, LAST_UPDATED_BY),
               LAST_UPDATE_DATE = SYSTIMESTAMP
         WHERE EXTERNAL_TRANSACTION_ID = p_ext_txn_id;
    ELSE
        v_matched_by := 'ID';
        UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
           SET TRANSACTION_DATE = v_date,
               LAST_UPDATED_BY  = NVL(p_updated_by, LAST_UPDATED_BY),
               LAST_UPDATE_DATE = SYSTIMESTAMP
         WHERE ID = p_id;
    END IF;
    v_count := SQL%ROWCOUNT;

    IF v_count = 0 THEN
        ROLLBACK;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'No transaction found for ' || v_matched_by || ' '
                                 || NVL(TO_CHAR(NVL(p_ext_txn_id, p_id)), 'NULL'));
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 404;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    COMMIT;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',         TRUE);
    APEX_JSON.WRITE('matchedBy',       v_matched_by);
    APEX_JSON.WRITE('key',             NVL(p_ext_txn_id, p_id));
    APEX_JSON.WRITE('transactionDate', TO_CHAR(v_date, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('rowsUpdated',     v_count);
    APEX_JSON.WRITE('updatedBy',       NVL(p_updated_by, 'REERP'));
    APEX_JSON.CLOSE_OBJECT;
    p_status  := 200;
    p_message := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('error',     SQLERRM);
        APEX_JSON.WRITE('errorCode', SQLCODE);
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 500;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
END RR_UPDATE_EXT_TXN_DATE;
/


-- =============================================================================
-- 2. Clean up any earlier template variants (avoid duplicate-template 555s)
-- =============================================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'cash/externaltransactions/:id/date');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'cash/externaltransactions/:txnId/date');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- =============================================================================
-- 3. Template
-- =============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/externaltransactions/:id/date',
        p_comments    => 'Update transaction date of an external cash transaction'
    );
    COMMIT;
END;
/


-- =============================================================================
-- 4. Handler
-- =============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:id/date',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_body     CLOB := :body_text;
                v_id       NUMBER;
                v_ext_id   NUMBER;
                v_date_str VARCHAR2(100);
                v_status   NUMBER;
                v_message  CLOB;
            BEGIN
                -- id: URI bind first, JSON body as fallback
                BEGIN v_id := TO_NUMBER(:id); EXCEPTION WHEN OTHERS THEN v_id := NULL; END;
                IF v_body IS NOT NULL THEN
                    IF v_id IS NULL THEN
                        v_id := TO_NUMBER(JSON_VALUE(v_body, '$.id'));
                    END IF;
                    v_ext_id   := TO_NUMBER(JSON_VALUE(v_body, '$.externalTransactionId'));
                    v_date_str := JSON_VALUE(v_body, '$.transactionDate');
                END IF;

                IF v_date_str IS NULL OR (v_id IS NULL AND v_ext_id IS NULL) THEN
                    :status := 400;
                    HTP.P('{"success":false,"error":"transactionDate and id (or externalTransactionId) are required",'
                       || '"diag":{"uriBind":"'   || NVL(:id, 'NULL') || '",'
                       || '"bodyLength":'         || NVL(DBMS_LOB.GETLENGTH(v_body), 0) || ','
                       || '"bodyStart":"'
                       || REPLACE(REPLACE(REPLACE(NVL(DBMS_LOB.SUBSTR(v_body, 150, 1), '(empty)'), CHR(92), ''), '"', ''''), CHR(10), ' ')
                       || '"}}');
                    RETURN;
                END IF;

                RR_UPDATE_EXT_TXN_DATE(
                    p_id         => v_id,
                    p_ext_txn_id => v_ext_id,
                    p_date_str   => v_date_str,
                    p_updated_by => JSON_VALUE(v_body, '$.updatedBy'),
                    p_status     => v_status,
                    p_message    => v_message
                );

                :status := v_status;
                HTP.P(v_message);
            END;
        ]'
    );
    COMMIT;
END;
/
