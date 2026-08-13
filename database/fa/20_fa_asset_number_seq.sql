-- =============================================================================
-- 20_FA_ASSET_NUMBER_SEQ.SQL
-- Sequence for FA Asset Numbers (last used = 100078)
--
-- GET reerp/fa/peek-asset-number  → reads LAST_NUMBER (no consumption) — used on page open
-- NEXTVAL is called INSIDE the POST procedure (fa/assets) at submit time
-- =============================================================================

-- ── Sequence ─────────────────────────────────────────────────────────────────
-- DROP SEQUENCE RR_FA_ASSET_NUMBER_SEQ;

CREATE SEQUENCE RR_FA_ASSET_NUMBER_SEQ
    START WITH  100079
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

-- ── ORDS Template: peek (read-only preview, no NEXTVAL) ──────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/peek-asset-number',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: preview next asset number without consuming sequence'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/peek-asset-number',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_next NUMBER;
BEGIN
    -- Read LAST_NUMBER from dictionary — no NEXTVAL consumed
    SELECT LAST_NUMBER
    INTO   v_next
    FROM   USER_SEQUENCES
    WHERE  SEQUENCE_NAME = 'RR_FA_ASSET_NUMBER_SEQ';

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',     TRUE);
    APEX_JSON.WRITE('assetNumber', TO_CHAR(v_next));
    APEX_JSON.WRITE('preview',     TRUE);
    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    HTP.P(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
