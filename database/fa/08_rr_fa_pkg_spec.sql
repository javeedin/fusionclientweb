-- =============================================================================
-- 08_RR_FA_PKG_SPEC.SQL
-- Package specification for all Fixed Assets REST logic.
-- Run this before 09_rr_fa_pkg_body.sql.
-- =============================================================================

CREATE OR REPLACE PACKAGE RR_FA_PKG AS

    -- ── Asset Search & List ───────────────────────────────────────────────────
    PROCEDURE GET_ASSETS (
        p_asset_number  IN  VARCHAR2,
        p_description   IN  VARCHAR2,
        p_category      IN  VARCHAR2,
        p_book_type     IN  VARCHAR2,
        p_asset_type    IN  VARCHAR2,
        p_status        IN  VARCHAR2,
        p_offset        IN  NUMBER,
        p_limit         IN  NUMBER,
        p_http_status   OUT NUMBER,
        p_result        OUT CLOB
    );

    -- ── Single Asset Detail ───────────────────────────────────────────────────
    PROCEDURE GET_ASSET_DETAIL (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    -- ── Asset Sub-Resources ───────────────────────────────────────────────────
    PROCEDURE GET_ASSET_BOOKS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_ASSET_DEPRN (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_ASSET_DISTRIBUTIONS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_ASSET_INVOICES (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_ASSET_TRANSACTIONS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    -- ── Setup Lookups ─────────────────────────────────────────────────────────
    PROCEDURE GET_CATEGORIES (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_METHODS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_LOCATIONS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_BOOK_CONTROLS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_DEPRN_PERIODS (
        p_book_type   IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE GET_RETIREMENTS (
        p_book_type   IN  VARCHAR2,
        p_ret_status  IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    -- ── Depreciation Workbench ────────────────────────────────────────────────
    PROCEDURE GET_DEPRN_WORKBENCH (
        p_book_type      IN  VARCHAR2,
        p_period_counter IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    );

    -- ── Depreciation by period (all assets, one period) ───────────────────────
    -- Pass a period (name or counter). Returns every ACTIVE asset for the book
    -- with its depreciation for that period from RR_FA_DEPRN_DETAIL, and a
    -- status of 'Posted' (depreciated) or 'Not Posted'.
    PROCEDURE GET_DEPRN_BY_PERIOD (
        p_book_type      IN  VARCHAR2,
        p_period_name    IN  VARCHAR2,
        p_period_counter IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    );

    -- NOTE: GET_DEPRN_VIEW and ADJUST_DEPRN now live in their OWN package
    -- (RR_FA_VIEW_PKG, file 31_rr_fa_view_pkg.sql) so the "View Depreciation"
    -- and adjustment features can never invalidate this core read package.

    -- ── Write Operations ──────────────────────────────────────────────────────
    PROCEDURE CREATE_ASSET (
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE RETIRE_ASSET (
        p_asset_id    IN  NUMBER,
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

    PROCEDURE ADJUST_ASSET (
        p_asset_id    IN  NUMBER,
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    );

END RR_FA_PKG;
/
