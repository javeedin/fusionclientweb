-- ============================================================================
-- Fusion SQL — "Query Runner" data-model SQL (DBMS_XMLGEN approach)
--
-- Paste this as the data set of the QueryRunnerDM BI Publisher data model
-- (see README.md), with **Type of SQL = Standard SQL** and Data Source =
-- ApplicationDB_FSCM.
--
-- Why not a ref cursor? On Fusion SaaS, BI Publisher does NOT register the
-- reserved `:xdo_cursor` output bind for a Non-standard SQL (PL/SQL) data set,
-- so a ref-cursor runner fails at run time with:
--     java.sql.SQLException: ORA-17041: Missing IN or OUT parameter at index: N
-- DBMS_XMLGEN.getXML sidesteps that entirely: it takes a SQL string and returns
-- the whole result set as an XML document in a single scalar column, so the
-- data set is plain **Standard SQL** and BIP auto-detects the :P_QRY_STMT bind.
--
-- P_QRY_STMT is the base64 of the user's SELECT (the app encodes it for safe
-- SOAP transport). We base64-decode it inline, run it through DBMS_XMLGEN, and
-- strip the leading <?xml?> prolog so nothing downstream trips on a nested
-- declaration. The app unwraps the inner <ROWSET>/<ROW> into rows/columns.
--
-- Read-only: the app rejects anything that is not SELECT/WITH and caps rows
-- with ROWNUM before encoding, so only bounded SELECTs ever reach here.
-- ============================================================================
SELECT REGEXP_REPLACE(
         DBMS_XMLGEN.getxml(
           UTL_RAW.cast_to_varchar2(
             UTL_ENCODE.base64_decode(UTL_RAW.cast_to_raw(:P_QRY_STMT))
           )
         ),
         '<\?xml[^>]*\?>', ''
       ) AS result
FROM dual

-- ----------------------------------------------------------------------------
-- Notes
--  * Parameter: create P_QRY_STMT manually (String / Text). Standard SQL
--    auto-detects the :bind, but you still define the parameter so runReport
--    can pass it.
--  * DBMS_XMLGEN.getXML returns NULL when the query has zero rows -> the app
--    treats an empty/absent result as an empty grid.
--  * The base64 (and thus the decoded SQL) must fit VARCHAR2 (<= 32767 chars),
--    which is far more than any capped SELECT the app sends.
--  * Column element names in the inner XML are DBMS_XMLGEN's uppercased column
--    names; alias columns in your SELECT if you want specific casing.
-- ----------------------------------------------------------------------------
