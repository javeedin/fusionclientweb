-- ============================================================
-- 111_fix_createinvoiceslines_get_tax.sql
-- Redefine the ap/createinvoiceslines GET endpoint to include
-- TAX_CONTROL_AMOUNT so the UI can display and validate tax.
-- ============================================================

BEGIN
  -- Remove existing handler first
  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'ap',
      p_pattern     => 'createinvoiceslines',
      p_method      => 'GET'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'createinvoiceslines',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_collection_feed,
    p_source         => q'[
SELECT
    l.LINE_ID                       AS line_id,
    l.INVOICE_ID                    AS invoice_id,
    l.INVOICE_NUMBER                AS invoice_number,
    l.LINE_NUMBER                   AS line_number,
    l.LINE_TYPE                     AS line_type,
    l.LINE_AMOUNT                   AS line_amount,
    l.DESCRIPTION                   AS description,
    TO_CHAR(l.ACCOUNTING_DATE, 'YYYY-MM-DD') AS accounting_date,
    l.DISTRIBUTION_COMBINATION      AS distribution_combination,
    l.DISTRIBUTION_SET              AS distribution_set,
    l.TAX_CLASSIFICATION            AS tax_classification,
    l.TAX_CONTROL_AMOUNT            AS tax_control_amount,
    l.QUANTITY                      AS quantity,
    l.UNIT_PRICE                    AS unit_price,
    l.UOM                           AS uom,
    l.PURCHASE_ORDER_NUMBER         AS purchase_order_number,
    l.PURCHASE_ORDER_LINE_NUMBER    AS purchase_order_line_number,
    l.RECEIPT_NUMBER                AS receipt_number,
    l.RECEIPT_LINE_NUMBER           AS receipt_line_number,
    l.SHIP_TO_LOCATION              AS ship_to_location,
    TO_CHAR(l.MULTIPERIOD_START_DATE, 'YYYY-MM-DD') AS multiperiod_start_date,
    TO_CHAR(l.MULTIPERIOD_END_DATE,   'YYYY-MM-DD') AS multiperiod_end_date,
    l.MULTIPERIOD_ACCRUAL_ACCOUNT   AS multiperiod_accrual_account,
    l.PROCESS_STATUS                AS process_status,
    l.CREATED_BY                    AS created_by,
    TO_CHAR(l.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS creation_date,
    l.LAST_UPDATED_BY               AS last_updated_by,
    TO_CHAR(l.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_update_date
FROM RR_AP_INVOICE_LINES_ALL l
WHERE l.INVOICE_ID = :P_INVOICE_ID
ORDER BY l.LINE_NUMBER
]',
    p_items_per_page => 200
  );
  COMMIT;
END;
/
