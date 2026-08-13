-- ============================================================
-- RR_CURRENCY_PKG  — Package Specification
-- ============================================================
CREATE OR REPLACE PACKAGE RR_CURRENCY_PKG AS

    -- ── Currency List ─────────────────────────────────────────
    -- Sync currencies from Oracle Cloud (batch upsert from frontend)
    PROCEDURE sync_currencies(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    -- Get currency list from local DB
    PROCEDURE get_currencies(
        p_search      IN  VARCHAR2 DEFAULT NULL,
        p_enabled     IN  VARCHAR2 DEFAULT NULL,
        p_status_code OUT NUMBER
    );

    -- Enable / disable a currency
    PROCEDURE toggle_currency(
        p_code        IN  VARCHAR2,
        p_enabled     IN  VARCHAR2,
        p_status_code OUT NUMBER
    );

    -- ── Rate Types ────────────────────────────────────────────
    -- List all rate types
    PROCEDURE get_rate_types(
        p_status_code OUT NUMBER
    );

    -- Bulk save (upsert) rate types
    PROCEDURE save_rate_types(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    -- Delete a rate type
    PROCEDURE delete_rate_type(
        p_id          IN  NUMBER,
        p_status_code OUT NUMBER
    );

    -- ── Daily Rates ───────────────────────────────────────────
    -- Search daily rates
    PROCEDURE get_daily_rates(
        p_from_currency IN  VARCHAR2 DEFAULT NULL,
        p_to_currency   IN  VARCHAR2 DEFAULT NULL,
        p_rate_type     IN  VARCHAR2 DEFAULT NULL,
        p_date_from     IN  VARCHAR2 DEFAULT NULL,
        p_date_to       IN  VARCHAR2 DEFAULT NULL,
        p_limit         IN  NUMBER   DEFAULT 200,
        p_offset        IN  NUMBER   DEFAULT 0,
        p_status_code   OUT NUMBER
    );

    -- Create or update a daily rate
    PROCEDURE save_daily_rate(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    -- Bulk import rates (from spreadsheet or public API)
    PROCEDURE import_daily_rates(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    -- Delete a daily rate
    PROCEDURE delete_daily_rate(
        p_id          IN  NUMBER,
        p_status_code OUT NUMBER
    );

END RR_CURRENCY_PKG;
/
