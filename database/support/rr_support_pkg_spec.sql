-- ============================================================
-- RR_SUPPORT_PKG  — Package Spec
-- ============================================================
CREATE OR REPLACE PACKAGE RR_SUPPORT_PKG AS

    PROCEDURE get_tickets(
        p_status      IN  VARCHAR2 DEFAULT NULL,
        p_module      IN  VARCHAR2 DEFAULT NULL,
        p_priority    IN  VARCHAR2 DEFAULT NULL,
        p_date_from   IN  VARCHAR2 DEFAULT NULL,
        p_date_to     IN  VARCHAR2 DEFAULT NULL,
        p_search      IN  VARCHAR2 DEFAULT NULL,
        p_created_by  IN  VARCHAR2 DEFAULT NULL,
        p_assigned_to IN  VARCHAR2 DEFAULT NULL,
        p_limit       IN  NUMBER   DEFAULT 200,
        p_offset      IN  NUMBER   DEFAULT 0,
        p_status_code OUT NUMBER
    );

    PROCEDURE create_ticket(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    PROCEDURE get_ticket_detail(
        p_ticket_id   IN  NUMBER,
        p_status_code OUT NUMBER
    );

    PROCEDURE update_ticket(
        p_body        IN  CLOB,
        p_status_code OUT NUMBER
    );

    PROCEDURE get_dashboard(
        p_status_code OUT NUMBER
    );

END RR_SUPPORT_PKG;
/
