-- =============================================
-- RR_USER_ACCOUNT_ROLES Table and Sync Procedure
-- For syncing User Account Roles from Oracle HCM
-- =============================================

-- Drop existing objects (optional, for clean setup)
-- DROP TABLE RR_USER_ACCOUNT_ROLES;
-- DROP PROCEDURE RR_SYNC_USER_ACCOUNT_ROLES;

-- =============================================
-- 1. Create the RR_USER_ACCOUNT_ROLES table
-- =============================================
CREATE TABLE RR_USER_ACCOUNT_ROLES (
    USER_ROLE_ID         NUMBER PRIMARY KEY,
    USER_ID              NUMBER,
    ROLE_ID              NUMBER,
    ROLE_CODE            VARCHAR2(240),
    CREATED_BY           VARCHAR2(240),
    CREATION_DATE        TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY      VARCHAR2(240),
    LAST_UPDATE_DATE     TIMESTAMP WITH TIME ZONE,
    -- Audit columns
    SYNC_DATE            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SYNC_SOURCE          VARCHAR2(50) DEFAULT 'ORACLE_HCM'
);

-- Create indexes for performance
CREATE INDEX IDX_USER_ACCOUNT_ROLES_USER ON RR_USER_ACCOUNT_ROLES(USER_ID);
CREATE INDEX IDX_USER_ACCOUNT_ROLES_ROLE ON RR_USER_ACCOUNT_ROLES(ROLE_ID);
CREATE INDEX IDX_USER_ACCOUNT_ROLES_CODE ON RR_USER_ACCOUNT_ROLES(ROLE_CODE);

-- =============================================
-- 2. Create the sync procedure (MERGE/Upsert)
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_USER_ACCOUNT_ROLES (
    p_json_data IN CLOB,
    p_user_id   IN NUMBER,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- MERGE (upsert) user account roles from JSON
    MERGE INTO RR_USER_ACCOUNT_ROLES target
    USING (
        SELECT
            jt.USER_ROLE_ID,
            p_user_id AS USER_ID,
            jt.ROLE_ID,
            jt.ROLE_CODE,
            jt.CREATED_BY,
            CASE
                WHEN INSTR(jt.CREATION_DATE, '.') > 0
                THEN TO_TIMESTAMP_TZ(jt.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')
                ELSE TO_TIMESTAMP_TZ(jt.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
            END AS CREATION_DATE,
            jt.LAST_UPDATED_BY,
            CASE
                WHEN INSTR(jt.LAST_UPDATE_DATE, '.') > 0
                THEN TO_TIMESTAMP_TZ(jt.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')
                ELSE TO_TIMESTAMP_TZ(jt.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
            END AS LAST_UPDATE_DATE
        FROM JSON_TABLE(
            p_json_data,
            '$.items[*]'
            COLUMNS (
                USER_ROLE_ID      NUMBER        PATH '$.UserRoleId',
                ROLE_ID           NUMBER        PATH '$.RoleId',
                ROLE_CODE         VARCHAR2(240) PATH '$.RoleCode',
                CREATED_BY        VARCHAR2(240) PATH '$.CreatedBy',
                CREATION_DATE     VARCHAR2(50)  PATH '$.CreationDate',
                LAST_UPDATED_BY   VARCHAR2(240) PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE  VARCHAR2(50)  PATH '$.LastUpdateDate'
            )
        ) jt
        WHERE jt.USER_ROLE_ID IS NOT NULL
    ) source
    ON (target.USER_ROLE_ID = source.USER_ROLE_ID)
    WHEN MATCHED THEN
        UPDATE SET
            target.USER_ID = source.USER_ID,
            target.ROLE_ID = source.ROLE_ID,
            target.ROLE_CODE = source.ROLE_CODE,
            target.CREATED_BY = source.CREATED_BY,
            target.CREATION_DATE = source.CREATION_DATE,
            target.LAST_UPDATED_BY = source.LAST_UPDATED_BY,
            target.LAST_UPDATE_DATE = source.LAST_UPDATE_DATE,
            target.SYNC_DATE = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            USER_ROLE_ID, USER_ID, ROLE_ID, ROLE_CODE,
            CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE,
            SYNC_DATE, SYNC_SOURCE
        )
        VALUES (
            source.USER_ROLE_ID, source.USER_ID, source.ROLE_ID, source.ROLE_CODE,
            source.CREATED_BY, source.CREATION_DATE, source.LAST_UPDATED_BY, source.LAST_UPDATE_DATE,
            CURRENT_TIMESTAMP, 'ORACLE_HCM'
        );

    v_count := SQL%ROWCOUNT;
    COMMIT;

    p_result := '{"success": true, "message": "Synced ' || v_count || ' user account roles", "count": ' || v_count || '}';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := '{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
END RR_SYNC_USER_ACCOUNT_ROLES;
/

-- =============================================
-- 3. Create APEX REST Handler
-- =============================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'useraccounts/userroles',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync User Account Roles from Oracle HCM',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_user_id   NUMBER;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    -- Extract user_id from the JSON (passed as a parameter)
    SELECT JSON_VALUE(l_json_clob, '$.userId') INTO l_user_id FROM DUAL;

    RR_SYNC_USER_ACCOUNT_ROLES(
        p_json_data => l_json_clob,
        p_user_id   => l_user_id,
        p_result    => l_result
    );

    :status_code := 200;
    HTP.P(l_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- =============================================
-- Verification Queries
-- =============================================
-- SELECT COUNT(*) FROM RR_USER_ACCOUNT_ROLES;
-- SELECT * FROM RR_USER_ACCOUNT_ROLES WHERE ROWNUM <= 10;
-- SELECT USER_ID, COUNT(*) AS ROLE_COUNT FROM RR_USER_ACCOUNT_ROLES GROUP BY USER_ID;
