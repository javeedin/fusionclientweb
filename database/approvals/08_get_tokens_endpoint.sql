-- =============================================================================
-- PATCH 08: GET approvals/tokens — list approval link tokens for UI display
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the BEGIN...END; block below
-- =============================================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/tokens',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/tokens',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT TOKEN_ID, ACTION, REQUEST_REF, REQUEST_ID,
               TO_EMAIL, TO_NAME, STATUS,
               TO_CHAR(CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               TO_CHAR(EXPIRES_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS EXPIRES_DATE,
               TO_CHAR(USED_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS USED_DATE
        FROM   RR_APPROVAL_TOKENS
        ORDER  BY CREATED_DATE DESC
        FETCH  FIRST 200 ROWS ONLY
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"tokenId":'     || r.TOKEN_ID                                          ||
            ',"action":'      || APEX_JSON.STRINGIFY(NVL(r.ACTION,''))               ||
            ',"requestRef":'  || APEX_JSON.STRINGIFY(NVL(r.REQUEST_REF,''))          ||
            ',"requestId":'   || NVL(TO_CHAR(r.REQUEST_ID),'null')                   ||
            ',"toEmail":'     || APEX_JSON.STRINGIFY(NVL(r.TO_EMAIL,''))             ||
            ',"toName":'      || APEX_JSON.STRINGIFY(NVL(r.TO_NAME,''))              ||
            ',"status":'      || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))        ||
            ',"createdDate":' || APEX_JSON.STRINGIFY(NVL(r.CREATED_DATE,''))         ||
            ',"expiresDate":' || APEX_JSON.STRINGIFY(NVL(r.EXPIRES_DATE,''))         ||
            ',"usedDate":'    || APEX_JSON.STRINGIFY(NVL(r.USED_DATE,''))            ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"items":[],"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
