-- ============================================================
-- Patch 147: DELETE /cash/externaltransactions/:externalTransactionId
--            with optional ?force=Y for accounted transactions
--
-- Replaces the handler from patch 88. Behaviour:
--   * Default (no force):     unchanged — refuses when ACCOUNTING_FLAG = 'Y'.
--   * ?force=Y:               allows deleting an ACCOUNTED transaction, but
--                             ONLY after verifying no GL journal lines still
--                             reference it (REFERENCE5 = 'BANK_EXTERNAL_TRANSACTIONS'
--                             and REFERENCE2 = the transaction id). If the GL
--                             batch still exists the call is refused with 409,
--                             so the journal must be deleted first.
--   * Attachments in RR_EXTERNAL_TRX_ATTACHMENTS are removed first
--     (FK FK_EXT_TRX_ATT would otherwise block the delete).
--
-- Used by: Delete Journals → Preview → "Delete this Batch" with
--          "Also delete linked external transaction(s)" checked.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste and run as one block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Single external cash transaction operations'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:externalTransactionId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete external cash transaction — ?force=Y allows accounted txn when its GL journal is already gone',
        p_source         => q'[
DECLARE
    v_path  VARCHAR2(1000);
    v_raw   VARCHAR2(200);
    v_id    NUMBER;
    v_force VARCHAR2(1);
    l_flag  VARCHAR2(1);
    l_gl    NUMBER;
    l_rows  NUMBER;
BEGIN
    -- Read path parameter from URL: prefer bind var, fall back to URL parsing
    v_raw := :externalTransactionId;

    IF v_raw IS NULL THEN
        -- Fallback: extract last numeric segment from request PATH_INFO
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

    v_force := CASE WHEN UPPER(NVL(:force, 'N')) = 'Y' THEN 'Y' ELSE 'N' END;

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
            HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction","id":' || v_id || '}');
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

    COMMIT;
END;
/
