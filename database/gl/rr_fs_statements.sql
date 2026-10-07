-- =============================================================================
-- Financial statements: Balance Sheet + Cash Flow on the P&L template tables
--   · RR_PL_TEMPLATES.TEMPLATE_TYPE  'BALANCE_SHEET' → Balance Sheet
--                                    'CASH_FLOW'     → Cash Flow (indirect)
--                                    anything else   → Income Statement (as before)
--   · group types for the new statements (check constraint extended):
--       Balance Sheet : ASSET, LIABILITY, EQUITY
--       Cash Flow     : OPERATING, INVESTING, FINANCING, CASH (the bank / cash
--                       accounts — gives opening / closing cash and the check)
--   · seeds "Standard Balance Sheet" (STD_BS_01) and "Standard Cash Flow"
--     (STD_CF_01) with groups, sections and totals; map the accounts from
--     Run → "As per TB" (Add missing / Paste accounts) or the template editor.
--
-- How the run works (no new endpoint — same trial balance GET as the P&L):
--   BS  "As at <period>" = closing balance, "Start of year" = YTD opening balance;
--       assets debit-positive, liabilities / equity credit-positive; the profit
--       for the year is added to the first EQUITY group automatically (unless
--       the template maps P&L accounts itself); a check row proves A = L + E.
--   CF  profit for the period at the top of Operating, then for every mapped
--       balance-sheet account the cash effect (opening − closing): an asset that
--       grows is cash out, a liability that grows is cash in. Mapped P&L
--       accounts (depreciation, provisions …) are added back. Opening / closing
--       cash come from the CASH group; a check row ties to the cash accounts.
--
-- Run in bcldifc (SQL Developer, F5). Safe to re-run.
-- =============================================================================
SET SERVEROUTPUT ON

-- 1. allow the new group types
DECLARE
    e_missing EXCEPTION; PRAGMA EXCEPTION_INIT(e_missing, -2443);
BEGIN
    BEGIN EXECUTE IMMEDIATE 'ALTER TABLE rr_pl_groups DROP CONSTRAINT chk_pl_group_type';
    EXCEPTION WHEN e_missing THEN NULL; END;
    EXECUTE IMMEDIATE q'[ALTER TABLE rr_pl_groups ADD CONSTRAINT chk_pl_group_type CHECK (group_type IN (
        'REVENUE', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE', 'TAX', 'COMPREHENSIVE', 'CALCULATED',
        'ASSET', 'LIABILITY', 'EQUITY',
        'OPERATING', 'INVESTING', 'FINANCING', 'CASH'))]';
    DBMS_OUTPUT.PUT_LINE('chk_pl_group_type: BS / CF group types allowed');
END;
/

COMMENT ON COLUMN rr_pl_templates.template_type IS 'STANDARD / MANAGEMENT / REGULATORY / CUSTOM = Income Statement; BALANCE_SHEET; CASH_FLOW';

-- 2. standard templates (skipped when the code already exists)
DECLARE
    l_tpl NUMBER;
    l_grp NUMBER;

    FUNCTION tpl (p_code VARCHAR2, p_name VARCHAR2, p_desc VARCHAR2, p_type VARCHAR2) RETURN NUMBER IS
        l_id NUMBER;
    BEGIN
        SELECT template_id INTO l_id FROM rr_pl_templates WHERE template_code = p_code;
        DBMS_OUTPUT.PUT_LINE(p_code || ' exists (template ' || l_id || ') - left as is');
        RETURN NULL;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        INSERT INTO rr_pl_templates (template_code, template_name, description, template_type, is_default, created_by)
        VALUES (p_code, p_name, p_desc, p_type, 'N', 'SETUP')
        RETURNING template_id INTO l_id;
        DBMS_OUTPUT.PUT_LINE(p_code || ' created (template ' || l_id || ')');
        RETURN l_id;
    END;

    FUNCTION grp (p_code VARCHAR2, p_name VARCHAR2, p_type VARCHAR2, p_order NUMBER) RETURN NUMBER IS
        l_id NUMBER;
    BEGIN
        INSERT INTO rr_pl_groups (template_id, group_code, group_name, group_label, group_type, display_order,
                                  sign_convention, show_subtotal, subtotal_label, font_style)
        VALUES (l_tpl, p_code, p_name, p_name, p_type, p_order, 1, 'Y', 'Total ' || LOWER(p_name), 'BOLD')
        RETURNING group_id INTO l_id;
        RETURN l_id;
    END;

    PROCEDURE sec (p_code VARCHAR2, p_name VARCHAR2, p_order NUMBER) IS
    BEGIN
        INSERT INTO rr_pl_sections (group_id, section_code, section_name, section_label, display_order)
        VALUES (l_grp, p_code, p_name, p_name, p_order);
    END;

    PROCEDURE tot (p_code VARCHAR2, p_name VARCHAR2, p_formula VARCHAR2, p_order NUMBER, p_after VARCHAR2, p_style VARCHAR2 DEFAULT 'HIGHLIGHT') IS
    BEGIN
        INSERT INTO rr_pl_totals (template_id, total_code, total_name, total_label, calculation_formula,
                                  display_order, after_group_code, font_style, row_style)
        VALUES (l_tpl, p_code, p_name, p_name, p_formula, p_order, p_after, 'BOLD', p_style);
    END;
BEGIN
    -- ── Balance Sheet ───────────────────────────────────────────────────────
    l_tpl := tpl('STD_BS_01', 'Standard Balance Sheet',
                 'Statement of financial position: assets, liabilities and equity (profit for the year added to equity)', 'BALANCE_SHEET');
    IF l_tpl IS NOT NULL THEN
        l_grp := grp('BS1', 'Non-current assets', 'ASSET', 10);
        sec('BS1S1', 'Property, plant and equipment', 10);
        sec('BS1S2', 'Right-of-use assets', 20);
        sec('BS1S3', 'Investments', 30);
        sec('BS1S4', 'Intangible assets', 40);
        l_grp := grp('BS2', 'Current assets', 'ASSET', 20);
        sec('BS2S1', 'Inventories', 10);
        sec('BS2S2', 'Trade and other receivables', 20);
        sec('BS2S3', 'Prepayments and advances', 30);
        sec('BS2S4', 'Cash and bank balances', 40);
        tot('TA', 'Total assets', 'BS1+BS2', 25, 'BS2');
        l_grp := grp('BS3', 'Equity', 'EQUITY', 30);
        sec('BS3S1', 'Share capital', 10);
        sec('BS3S2', 'Reserves', 20);
        sec('BS3S3', 'Retained earnings', 30);
        l_grp := grp('BS4', 'Non-current liabilities', 'LIABILITY', 40);
        sec('BS4S1', 'Borrowings', 10);
        sec('BS4S2', 'Lease liabilities', 20);
        sec('BS4S3', 'Employees end of service benefits', 30);
        l_grp := grp('BS5', 'Current liabilities', 'LIABILITY', 50);
        sec('BS5S1', 'Trade and other payables', 10);
        sec('BS5S2', 'Accruals', 20);
        sec('BS5S3', 'Short-term borrowings', 30);
        sec('BS5S4', 'Tax payable', 40);
        tot('TL', 'Total liabilities', 'BS4+BS5', 55, 'BS5');
        tot('TLE', 'Total equity and liabilities', 'BS3+TL', 60, 'BS5', 'DOUBLE_LINE');
    END IF;

    -- ── Cash Flow (indirect) ────────────────────────────────────────────────
    l_tpl := tpl('STD_CF_01', 'Standard Cash Flow',
                 'Statement of cash flows, indirect method: profit, non-cash items, working capital, investing and financing', 'CASH_FLOW');
    IF l_tpl IS NOT NULL THEN
        l_grp := grp('CF1', 'Cash flows from operating activities', 'OPERATING', 10);
        sec('CF1S1', 'Adjustments for non-cash items (depreciation, provisions)', 10);
        sec('CF1S2', '(Increase) / decrease in receivables', 20);
        sec('CF1S3', '(Increase) / decrease in inventories and prepayments', 30);
        sec('CF1S4', 'Increase / (decrease) in payables and accruals', 40);
        tot('NOP', 'Net cash from operating activities', 'CF1', 15, 'CF1');
        l_grp := grp('CF2', 'Cash flows from investing activities', 'INVESTING', 20);
        sec('CF2S1', 'Purchase / disposal of property, plant and equipment', 10);
        sec('CF2S2', 'Investments', 20);
        tot('NIN', 'Net cash used in investing activities', 'CF2', 25, 'CF2');
        l_grp := grp('CF3', 'Cash flows from financing activities', 'FINANCING', 30);
        sec('CF3S1', 'Borrowings and lease liabilities', 10);
        sec('CF3S2', 'Share capital and dividends', 20);
        tot('NFI', 'Net cash from financing activities', 'CF3', 35, 'CF3');
        l_grp := grp('CF9', 'Cash and cash equivalents', 'CASH', 90);
        sec('CF9S1', 'Cash and bank accounts', 10);
    END IF;
    COMMIT;
END;
/

-- Verify
SELECT t.template_code, t.template_type, g.group_code, g.group_type, g.group_name,
       (SELECT COUNT(*) FROM rr_pl_sections s WHERE s.group_id = g.group_id) AS sections
FROM   rr_pl_templates t JOIN rr_pl_groups g ON g.template_id = t.template_id
WHERE  t.template_type IN ('BALANCE_SHEET', 'CASH_FLOW')
ORDER  BY t.template_code, g.display_order;
