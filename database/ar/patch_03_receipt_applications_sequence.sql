-- =============================================================
-- PATCH 03 — RR_AR_RECEIPT_APPLICATIONS
-- Add sequence for APPLICATION_ID auto-generation.
-- Update ORDS POST handler to use sequence when ApplicationId
-- is not supplied in the payload.
-- Safe to re-run.
-- =============================================================

-- ── 1. Create sequence (skip if already exists) ─────────────
BEGIN
    EXECUTE IMMEDIATE '
        CREATE SEQUENCE RR_AR_RCPT_APPS_SEQ
        START WITH 1000000
        INCREMENT BY 1
        NOCACHE
        NOCYCLE
    ';
    DBMS_OUTPUT.PUT_LINE('Sequence RR_AR_RCPT_APPS_SEQ created.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -00955 THEN
            DBMS_OUTPUT.PUT_LINE('Sequence RR_AR_RCPT_APPS_SEQ already exists — skipped.');
        ELSE
            RAISE;
        END IF;
END;
/

-- ── 2. Update ORDS POST handler ─────────────────────────────
-- Wraps the posted object in {"items":[...]} and auto-generates
-- APPLICATION_ID via sequence when the caller does not supply one.
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert single AR receipt application (auto-generates ApplicationId via sequence)',
        p_source         => '
DECLARE
    l_status     VARCHAR2(20);
    l_message    VARCHAR2(4000);
    l_inserted   NUMBER;
    l_updated    NUMBER;
    l_errors     NUMBER;
    l_body       CLOB;
    l_app_id     NUMBER;
    l_wrapped    CLOB;
BEGIN
    l_body := :body_text;

    -- Auto-generate ApplicationId if not provided or null
    BEGIN
        SELECT JSON_VALUE(l_body, ''$.ApplicationId'') INTO l_app_id FROM DUAL;
    EXCEPTION WHEN OTHERS THEN l_app_id := NULL;
    END;

    IF l_app_id IS NULL THEN
        l_app_id := RR_AR_RCPT_APPS_SEQ.NEXTVAL;
        -- Inject the generated id into the JSON body
        -- Inject id by stripping trailing } and appending the field
        -- (JSON_MERGEPATCH requires Oracle 21c; this approach works on 19c and below)
        l_body := SUBSTR(TRIM(l_body), 1, LENGTH(TRIM(l_body)) - 1)
                  || '',"ApplicationId":'' || l_app_id || ''}'';
    END IF;

    l_wrapped := ''{"items":['' || l_body || '']}'';

    RR_AR_RECEIPT_APPLICATIONS_PKG.save_applications_bulk(
        p_json      => l_wrapped,
        p_status    => l_status,
        p_message   => l_message,
        p_inserted  => l_inserted,
        p_updated   => l_updated,
        p_errors    => l_errors
    );

    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;
    HTP.P(''{"status":"''        || l_status                            ||
          ''","message":"''      || REPLACE(l_message, ''"'', ''\\"'') ||
          ''","applicationId":'' || l_app_id                           ||
          '',"inserted":''       || l_inserted                         ||
          '',"updated":''        || l_updated                          ||
          '',"errors":''         || l_errors || ''}'');
END;'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('ORDS POST handler updated to return applicationId.');
END;
/
