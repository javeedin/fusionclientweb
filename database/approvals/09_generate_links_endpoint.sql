-- =============================================================================
-- PATCH 09: POST approvals/generate-links
--
-- Replaces POST approvals/tokens (which ORDS blocks because "tokens" is a
-- reserved OAuth path). Renamed to approvals/generate-links.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the BEGIN...END; block below
-- =============================================================================

BEGIN
    -- Remove old conflicting handler if it exists
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/tokens',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Remove new handler if previously registered
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/generate-links',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/generate-links',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body       CLOB    := :body_text;
    v_ref        VARCHAR2(200);
    v_req_id     NUMBER;
    v_to_email   VARCHAR2(500);
    v_to_name    VARCHAR2(300);
    v_tok_app    VARCHAR2(128);
    v_tok_rej    VARCHAR2(128);
    v_expires    TIMESTAMP := SYSTIMESTAMP + INTERVAL '72' HOUR;
BEGIN
    SELECT jt.request_ref, jt.request_id, jt.to_email, jt.to_name
    INTO   v_ref, v_req_id, v_to_email, v_to_name
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               request_ref VARCHAR2(200) PATH '$.requestRef',
               request_id  NUMBER        PATH '$.requestId',
               to_email    VARCHAR2(500) PATH '$.toEmail',
               to_name     VARCHAR2(300) PATH '$.toName'
             )
           ) jt;

    v_tok_app := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID()));
    v_tok_rej := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID()));

    INSERT INTO RR_APPROVAL_TOKENS
        (TOKEN_VALUE, ACTION, REQUEST_REF, REQUEST_ID, TO_EMAIL, TO_NAME, EXPIRES_DATE)
    VALUES
        (v_tok_app, 'APPROVE', v_ref, v_req_id, v_to_email, v_to_name, v_expires);

    INSERT INTO RR_APPROVAL_TOKENS
        (TOKEN_VALUE, ACTION, REQUEST_REF, REQUEST_ID, TO_EMAIL, TO_NAME, EXPIRES_DATE)
    VALUES
        (v_tok_rej, 'REJECT', v_ref, v_req_id, v_to_email, v_to_name, v_expires);

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","approveToken":"' || v_tok_app || '","rejectToken":"' || v_tok_rej || '"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
