-- ============================================================
-- Patch 149: fix ?force=Y not binding on
--            DELETE /cash/externaltransactions/delete/:externalTransactionId
--
-- Symptom after patch 148: deleting a journal-linked external
-- transaction from Delete Journals returned
--   "Cannot delete an accounted transaction"
-- even though the frontend sent ?force=Y — ORDS did not bind the
-- :force query parameter on the DELETE method (same quirk as the
-- path-param binding fixed in patch 88).
--
-- Fix, both belts and braces:
--   1. ORDS.DEFINE_PARAMETER declares the 'force' URI parameter.
--   2. The handler also falls back to parsing QUERY_STRING directly.
-- Everything else is identical to patch 148.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste and run as one block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/delete/:externalTransactionId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- template already exists from patch 148; create it only if missing
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/delete/:externalTransactionId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Delete an external cash transaction (own path — avoids template-shape conflicts)'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/delete/:externalTransactionId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete external cash transaction — ?force=Y allows accounted txn when its GL journal is already gone',
        p_source         => q'[
DECLARE
    v_path  VARCHAR2(1000);
    v_qs    VARCHAR2(1000);
    v_raw   VARCHAR2(200);
    v_fraw  VARCHAR2(50);
    v_id    NUMBER;
    v_force VARCHAR2(1);
    l_flag  VARCHAR2(1);
    l_gl    NUMBER;
    l_rows  NUMBER;
BEGIN
    -- Read path parameter from URL: prefer bind var, fall back to URL parsing
    v_raw := :externalTransactionId;

    IF v_raw IS NULL THEN
        v_path := OWA_UTIL.get_cgi_env('PATH_INFO');
        v_raw  := REGEXP_SUBSTR(v_path, '[0-9]+$');
    END IF;

    IF v_raw IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Could not determine transaction ID from request","path":"' || NVL(v_path,'null') || '"}');
        RETURN;
    END IF;

    BEGIN
        v_id := TO_NUMBER(v_raw);
    EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Invalid transaction ID: ' || v_raw || '"}');
        RETURN;
    END;

    -- force flag: prefer bind var, fall back to raw QUERY_STRING parsing
    -- (ORDS does not reliably bind query params on DELETE handlers)
    v_fraw := :force;
    IF v_fraw IS NULL THEN
        v_qs   := OWA_UTIL.get_cgi_env('QUERY_STRING');
        v_fraw := REGEXP_SUBSTR(v_qs, '(^|&)force=([^&]*)', 1, 1, NULL, 2);
    END IF;
    v_force := CASE WHEN UPPER(NVL(v_fraw, 'N')) = 'Y' THEN 'Y' ELSE 'N' END;

    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N')
          INTO l_flag
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE EXTERNAL_TRANSACTION_ID = v_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.PRN('{"status":"error","message":"Transaction not found","id":' || v_id || '}');
            RETURN;
    END;

    IF l_flag = 'Y' THEN
        IF v_force = 'Y' THEN
            -- Accounted, but caller says the GL journal was deleted. Verify:
            -- no journal line may still reference this transaction.
            SELECT COUNT(*)
              INTO l_gl
              FROM RR_GL_JE_LINES_ALL
             WHERE REFERENCE5 = 'BANK_EXTERNAL_TRANSACTIONS'
               AND REFERENCE2 = TO_CHAR(v_id);

            IF l_gl > 0 THEN
                :status_code := 409;
                HTP.PRN('{"status":"error","message":"Cannot delete: ' || l_gl || ' GL journal line(s) still reference this transaction. Delete the GL batch first.","id":' || v_id || '}');
                RETURN;
            END IF;
        ELSE
            :status_code := 400;
            HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction","id":' || v_id || ',"forceReceived":"' || NVL(v_fraw,'null') || '"}');
            RETURN;
        END IF;
    END IF;

    -- Child rows first (FK FK_EXT_TRX_ATT)
    DELETE FROM RR_EXTERNAL_TRX_ATTACHMENTS
     WHERE EXTERNAL_TRANSACTION_ID = v_id;

    DELETE FROM RR_EXTERNAL_CASH_TRANSACTIONS
     WHERE EXTERNAL_TRANSACTION_ID = v_id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found","id":' || v_id || '}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"status":"success","message":"Transaction deleted","externalTransactionId":' || v_id || ',"forced":"' || v_force || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || ',"id":"' || NVL(v_raw,'NULL') || '"}');
END;
]'
    );

    -- Declare the force query parameter so ORDS binds it where it can
    BEGIN
        ORDS.DEFINE_PARAMETER(
            p_module_name        => 'reerp',
            p_pattern            => 'cash/externaltransactions/delete/:externalTransactionId',
            p_method             => 'DELETE',
            p_name               => 'force',
            p_bind_variable_name => 'force',
            p_source_type        => 'URI',
            p_param_type         => 'STRING',
            p_access_method      => 'IN'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    COMMIT;
END;
/
