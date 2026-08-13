-- ============================================================
-- PATCH: DELETE /cash/banktransfers/:transferId
--
-- HOW TO RUN: SQL Workshop → SQL Commands
--   Copy the entire BEGIN...END; block, paste, Run.
--   Expected: "PL/SQL procedure successfully completed."
--
-- Guards:
--   - 404 if transfer not found
--   - 422 if already accounted (ACCOUNTING_FLAG = 'Y')
--   - Otherwise hard-deletes the transfer and its attachments
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers/:transferId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers/:transferId',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/banktransfers/:transferId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete a bank transfer',
        p_source         => q'[
DECLARE
    v_accounting_flag VARCHAR2(1);
BEGIN
    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N')
          INTO v_accounting_flag
          FROM RR_BANK_ACCOUNT_TRANSFERS
         WHERE BANK_ACCOUNT_TRANSFER_ID = :transferId;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"status":"error","message":"Transfer not found"}');
            RETURN;
    END;

    IF v_accounting_flag = 'Y' THEN
        :status_code := 422;
        HTP.P('{"status":"error","message":"Cannot delete an accounted transfer. Reverse the accounting entries first."}');
        RETURN;
    END IF;

    BEGIN
        DELETE FROM RR_BANK_TRANSFER_ATTACHMENTS
         WHERE BANK_ACCOUNT_TRANSFER_ID = :transferId;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    DELETE FROM RR_BANK_ACCOUNT_TRANSFERS
     WHERE BANK_ACCOUNT_TRANSFER_ID = :transferId;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"success","message":"Transfer deleted"}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
