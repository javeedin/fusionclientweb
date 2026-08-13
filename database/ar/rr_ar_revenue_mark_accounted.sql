-- =============================================================================
-- RR_AR_REVENUE_MARK_ACCOUNTED.SQL   — Revenue Recognition mark-accounted handler
--
-- Companion to rr_ar_revenue.sql. Provides the POST handler the React frontend
-- (markRevenueScheduleAccounted in src/services/revenue.service.ts) calls after
-- the standard SLA + GL journal accounting has been created & posted, to stamp
-- the revenue schedule row as ACCOUNTED.
--
-- All SLA / GL creation is done via the existing shared services:
--   POST sla/accounting/create   (RR_SLA_PKG.create_accounting)
--   POST sla/accounting/post     (RR_SLA_PKG.post_to_ledger)
--   POST gl/journals/headers / gl/journals/lines
-- This file ONLY marks RR_AR_REVENUE_SCHDULES.ACCOUNT_STATUS = 'ACCOUNTED'.
--
-- Webservice:
--   POST reerp/ar/revenue-schedules/mark-accounted
--     body: { scheduleId, slaHeaderId, accountStatus, updatedBy }
--     resp: { success, status, rowsUpdated, scheduleId, slaHeaderId }
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- Mirrors the pattern in database/fa/24_fa_accounting.sql.
-- =============================================================================

-- ── 1. Add tracking columns (best-effort; ignore "already exists" -1430) ──────
--    The base RR_AR_REVENUE_SCHDULES table has ACCOUNT_STATUS but no SLA header
--    id / accounted-date / last-update audit columns, so add them here.
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_AR_REVENUE_SCHDULES ADD (SLA_HEADER_ID NUMBER)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_AR_REVENUE_SCHDULES ADD (ACCOUNTED_DATE DATE)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_AR_REVENUE_SCHDULES ADD (LAST_UPDATE_DATE TIMESTAMP)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_AR_REVENUE_SCHDULES ADD (LAST_UPDATED_BY VARCHAR2(240))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/

-- ── 2. Package ────────────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_AR_REVENUE_ACCT_PKG AS

    -- Called after SLA/GL accounting is created externally to mark a revenue
    -- schedule row (by ID) as ACCOUNTED.
    PROCEDURE MARK_ACCOUNTED(
        p_schedule_id   IN  NUMBER,
        p_sla_header_id IN  NUMBER,
        p_account_status IN VARCHAR2,
        p_updated_by    IN  VARCHAR2,
        p_status        OUT NUMBER,
        p_response      OUT CLOB
    );

END RR_AR_REVENUE_ACCT_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_REVENUE_ACCT_PKG AS

    PROCEDURE MARK_ACCOUNTED(
        p_schedule_id   IN  NUMBER,
        p_sla_header_id IN  NUMBER,
        p_account_status IN VARCHAR2,
        p_updated_by    IN  VARCHAR2,
        p_status        OUT NUMBER,
        p_response      OUT CLOB
    ) IS
        v_rows   NUMBER;
        v_status VARCHAR2(30) := NVL(p_account_status, 'ACCOUNTED');
    BEGIN
        IF p_schedule_id IS NULL THEN
            p_status   := 400;
            p_response := '{"success":false,"error":"scheduleId is required"}';
            RETURN;
        END IF;

        UPDATE RR_AR_REVENUE_SCHDULES
        SET    ACCOUNT_STATUS   = v_status,
               SLA_HEADER_ID    = NVL(p_sla_header_id, SLA_HEADER_ID),
               ACCOUNTED_DATE   = SYSDATE,
               LAST_UPDATE_DATE = SYSTIMESTAMP,
               LAST_UPDATED_BY  = NVL(p_updated_by, 'REACTERP')
        WHERE  ID = p_schedule_id;

        v_rows := SQL%ROWCOUNT;

        IF v_rows = 0 THEN
            ROLLBACK;
            p_status   := 404;
            p_response := '{"success":false,"error":"Revenue schedule not found: '
                       || p_schedule_id || '","scheduleId":' || p_schedule_id || '}';
            RETURN;
        END IF;

        COMMIT;

        p_status   := 200;
        p_response := '{"success":true,"status":"' || v_status || '"'
                   || ',"rowsUpdated":' || v_rows
                   || ',"scheduleId":' || p_schedule_id
                   || ',"slaHeaderId":' || NVL(TO_CHAR(p_sla_header_id), 'null')
                   || ',"message":"Revenue schedule marked as accounted"}';

    EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        p_status   := 500;
        p_response := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END MARK_ACCOUNTED;

END RR_AR_REVENUE_ACCT_PKG;
/

-- ── 3. ORDS clean up ──────────────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'ar/revenue-schedules/mark-accounted',p_method=>'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'ar/revenue-schedules/mark-accounted'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ── 4. ORDS: POST ar/revenue-schedules/mark-accounted ─────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ar/revenue-schedules/mark-accounted',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AR: mark revenue schedule as ACCOUNTED after SLA/GL created externally'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ar/revenue-schedules/mark-accounted',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_source         => q'[
DECLARE
    v_body CLOB := :body_text;
    v_s NUMBER; v_r CLOB;
BEGIN
    RR_AR_REVENUE_ACCT_PKG.MARK_ACCOUNTED(
        p_schedule_id    => TO_NUMBER(JSON_VALUE(v_body, '$.scheduleId')),
        p_sla_header_id  => TO_NUMBER(JSON_VALUE(v_body, '$.slaHeaderId')),
        p_account_status => JSON_VALUE(v_body, '$.accountStatus'),
        p_updated_by     => NVL(JSON_VALUE(v_body, '$.updatedBy'), 'REACTERP'),
        p_status => v_s, p_response => v_r);
    :status := v_s; HTP.P(v_r);
EXCEPTION WHEN OTHERS THEN
    ROLLBACK; :status := 500;
    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- ── 5. Verify the package compiled (returns no rows on success) ───────────────
ALTER PACKAGE RR_AR_REVENUE_ACCT_PKG COMPILE BODY;
SELECT name, type, line, position, text FROM USER_ERRORS
 WHERE name = 'RR_AR_REVENUE_ACCT_PKG' ORDER BY sequence;
