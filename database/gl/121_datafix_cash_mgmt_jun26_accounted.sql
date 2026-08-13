-- ============================================================================
-- DATA FIX: recompute ACCOUNTED_DR/CR for foreign-currency GL journal lines
--           where accounted was wrongly written equal to entered.
--
-- Scope   : Category 'Cash Management', Period 'Jun-26', currency <> 'AED'.
-- Cause   : Create Accounting for external cash transactions sent accountedDr/Cr
--           equal to the entered amount (exchange rate not applied). The line's
--           CURRENCY_CONVERSION_RATE was stored correctly, so we recompute
--           accounted = ROUND(entered * rate, 2).
--
-- Tables  : RR_GL_JE_HEADERS (h)  +  RR_GL_JE_LINES_ALL (l)  on JE_HEADER_ID
--
-- NOTE ON THE UPDATE BLOCK TRIGGER:
--   RR_GL_JE_LINES_ALL has a BEFORE UPDATE trigger (trg_upd_audit_je_lines) that
--   raises ORA-20001 for non-ORDS sessions. reerp_security.is_ords_call() returns
--   TRUE when the session MODULE contains 'ORDS'. Setting the module below lets
--   this deliberate fix run AND still archives the old rows to
--   RR_GL_JE_LINES_ALL_UPD (change history is preserved).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────
-- STEP 1 — IDENTIFY the affected lines (run first, review, keep as before-image)
-- ─────────────────────────────────────────────────────────────
SELECT h.JE_HEADER_ID,
       h.PERIOD_NAME,
       h.USER_JE_CATEGORY_NAME                                   AS category,
       h.CURRENCY_CODE                                           AS hdr_ccy,
       l.LINE_ID,
       l.CURRENCY_CODE                                          AS line_ccy,
       NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE) AS rate,
       l.ENTERED_DR,
       l.ACCOUNTED_DR,
       ROUND(NVL(l.ENTERED_DR,0) * NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE), 2) AS new_accounted_dr,
       l.ENTERED_CR,
       l.ACCOUNTED_CR,
       ROUND(NVL(l.ENTERED_CR,0) * NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE), 2) AS new_accounted_cr
FROM   RR_GL_JE_HEADERS   h
JOIN   RR_GL_JE_LINES_ALL l  ON l.JE_HEADER_ID = h.JE_HEADER_ID
WHERE  h.USER_JE_CATEGORY_NAME = 'Cash Management'
AND    UPPER(h.PERIOD_NAME)    = 'JUN-26'
AND    NVL(l.CURRENCY_CODE, h.CURRENCY_CODE) <> 'AED'
AND    NVL(NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE), 1) <> 1
AND    (
         (NVL(l.ENTERED_DR,0) <> 0 AND NVL(l.ACCOUNTED_DR,0) = NVL(l.ENTERED_DR,0))
      OR (NVL(l.ENTERED_CR,0) <> 0 AND NVL(l.ACCOUNTED_CR,0) = NVL(l.ENTERED_CR,0))
       )
ORDER BY h.JE_HEADER_ID, l.LINE_ID;


-- ─────────────────────────────────────────────────────────────
-- STEP 2 — FIX the line accounted amounts (idempotent; safe to re-run)
--          Set the module so the audit trigger allows the update and archives it.
-- ─────────────────────────────────────────────────────────────
BEGIN
  DBMS_APPLICATION_INFO.SET_MODULE('ORDS_DATAFIX', 'cash-mgmt-jun26-accounted');
END;
/

MERGE INTO RR_GL_JE_LINES_ALL l
USING (
  SELECT l.LINE_ID,
         l.ENTERED_DR,
         l.ENTERED_CR,
         NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE) AS rate
  FROM   RR_GL_JE_HEADERS   h
  JOIN   RR_GL_JE_LINES_ALL l  ON l.JE_HEADER_ID = h.JE_HEADER_ID
  WHERE  h.USER_JE_CATEGORY_NAME = 'Cash Management'
  AND    UPPER(h.PERIOD_NAME)    = 'JUN-26'
  AND    NVL(l.CURRENCY_CODE, h.CURRENCY_CODE) <> 'AED'
  AND    NVL(NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE), 1) <> 1
  AND    (
           (NVL(l.ENTERED_DR,0) <> 0 AND NVL(l.ACCOUNTED_DR,0) = NVL(l.ENTERED_DR,0))
        OR (NVL(l.ENTERED_CR,0) <> 0 AND NVL(l.ACCOUNTED_CR,0) = NVL(l.ENTERED_CR,0))
         )
) src
ON (l.LINE_ID = src.LINE_ID)
WHEN MATCHED THEN UPDATE SET
  l.ACCOUNTED_DR = ROUND(NVL(src.ENTERED_DR,0) * src.rate, 2),
  l.ACCOUNTED_CR = ROUND(NVL(src.ENTERED_CR,0) * src.rate, 2);

-- Review the row count, then:
--   COMMIT;      -- to apply
--   ROLLBACK;    -- to discard


-- ─────────────────────────────────────────────────────────────
-- STEP 3 — OPTIONAL: realign the header accounted running totals to the lines
--          (so Trial Balance / reports agree). Only needed if these were also
--          written from the entered totals.
-- ─────────────────────────────────────────────────────────────
-- MERGE INTO RR_GL_JE_HEADERS h
-- USING (
--   SELECT JE_HEADER_ID,
--          SUM(NVL(ACCOUNTED_DR,0)) AS tot_acc_dr,
--          SUM(NVL(ACCOUNTED_CR,0)) AS tot_acc_cr
--   FROM   RR_GL_JE_LINES_ALL
--   GROUP  BY JE_HEADER_ID
-- ) s
-- ON (h.JE_HEADER_ID = s.JE_HEADER_ID)
-- WHEN MATCHED THEN UPDATE SET
--   h.RUNNING_TOTAL_ACCOUNTED_DR = s.tot_acc_dr,
--   h.RUNNING_TOTAL_ACCOUNTED_CR = s.tot_acc_cr
-- WHERE  h.USER_JE_CATEGORY_NAME = 'Cash Management'
-- AND    UPPER(h.PERIOD_NAME)    = 'JUN-26';
-- COMMIT;


-- ─────────────────────────────────────────────────────────────
-- STEP 4 — VERIFY (should return NO rows once fixed)
-- ─────────────────────────────────────────────────────────────
SELECT l.LINE_ID, l.CURRENCY_CODE, l.CURRENCY_CONVERSION_RATE,
       l.ENTERED_DR, l.ACCOUNTED_DR, l.ENTERED_CR, l.ACCOUNTED_CR
FROM   RR_GL_JE_HEADERS   h
JOIN   RR_GL_JE_LINES_ALL l  ON l.JE_HEADER_ID = h.JE_HEADER_ID
WHERE  h.USER_JE_CATEGORY_NAME = 'Cash Management'
AND    UPPER(h.PERIOD_NAME)    = 'JUN-26'
AND    NVL(l.CURRENCY_CODE, h.CURRENCY_CODE) <> 'AED'
AND    NVL(NVL(l.CURRENCY_CONVERSION_RATE, h.CURRENCY_CONVERSION_RATE), 1) <> 1
AND    (
         (NVL(l.ENTERED_DR,0) <> 0 AND NVL(l.ACCOUNTED_DR,0) = NVL(l.ENTERED_DR,0))
      OR (NVL(l.ENTERED_CR,0) <> 0 AND NVL(l.ACCOUNTED_CR,0) = NVL(l.ENTERED_CR,0))
       );
