-- =============================================================================
-- ORDS Handler — GET /reerp/ap/reconciliation
-- Delegates to RR_AP_RECON_PKG.get_recon()
--
-- Query parameters:
--   periodName        VARCHAR2  e.g. Mar-26
--   businessUnit      VARCHAR2  e.g. BUIMERC CORP FZE_JAFZA_TRADING
--   ledgerName        VARCHAR2  e.g. BCL DIFC AED
--   moduleName        VARCHAR2  default AP
--   accountingStatus  VARCHAR2  DRAFT / FINAL / POSTED / ERROR
--   sourceTable       VARCHAR2  AP_INVOICES / AP_PAYMENTS / RR_AP_APPLIED_PREPAYMENTS
--   dateFrom          VARCHAR2  YYYY-MM-DD
--   dateTo            VARCHAR2  YYYY-MM-DD
--   limit             NUMBER    default 500
--   offset            NUMBER    default 0
--
-- Example:
--   GET .../reerp/ap/reconciliation?periodName=Mar-26&businessUnit=BUIMERC+CORP+FZE_JAFZA_TRADING
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop template if it already exists (clean re-run)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/reconciliation');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ---------------------------------------------------------------------------
-- 2. Create template
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/reconciliation',
        p_comments    => 'Payables-to-GL reconciliation — single query joining SLA + GL tables'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 3. GET handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'ap/reconciliation',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Delegates to RR_AP_RECON_PKG.get_recon — returns summary + items[]',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_limit  NUMBER := NVL(TO_NUMBER(:limit),  500);
  v_offset NUMBER := NVL(TO_NUMBER(:offset), 0);
BEGIN
  v_result := RR_AP_RECON_PKG.get_recon(
    p_period_name       => :periodName,
    p_business_unit     => :businessUnit,
    p_ledger_name       => :ledgerName,
    p_module_name       => NVL(:moduleName, ''AP''),
    p_accounting_status => :accountingStatus,
    p_source_table      => :sourceTable,
    p_date_from         => :dateFrom,
    p_date_to           => :dateTo,
    p_limit             => v_limit,
    p_offset            => v_offset
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  HTP.PRN(v_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 60) source_preview
FROM   user_ords_modules m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template = 'ap/reconciliation'
ORDER BY h.method;
