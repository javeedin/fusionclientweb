# Re-ERP — full ORDS endpoint inventory

(Generated from the application source. All paths are relative to the APEX base;
responses are JSON, lists come as {items:[...]}; {id} marks a dynamic segment.
Endpoints are GET unless a write is explicitly requested and confirmed.)

## /ORDS
- /ORDS

## /SYNC
- /SYNC/jebatches{id}

## /admin
- /admin
- /admin/change-requests
- /admin/change-requests/search
- /admin/claudekeys
- /admin/claudekeys/{id}
- /admin/compare
- /admin/mcplogs
- /admin/mcptools
- /admin/mcptools/{id}
- /admin/record

## /ai
- /ai/training

## /ap
- /ap/applied-prepayments
- /ap/applied-prepayments/balances
- /ap/applied-prepayments/by-invoice/{id}
- /ap/applied-prepayments/by-prepayment/{id}
- /ap/createinvoice
- /ap/createinvoice/installments
- /ap/createinvoice/payments
- /ap/createinvoice/{id}
- /ap/createinvoicefull
- /ap/createinvoicefull/{id}
- /ap/createinvoiceslines
- /ap/createinvoice{id}
- /ap/fusion-invoice-attachments
- /ap/invoice-holds
- /ap/invoices
- /ap/invoices/aging-data{id}
- /ap/invoices/appliedprepayments
- /ap/invoices/bulk
- /ap/invoices/installments/{id}
- /ap/invoices/outstanding-by-supplier{id}
- /ap/invoices/stats
- /ap/invoices/stats{id}
- /ap/invoices/{id}
- /ap/invoices/{id}/approval
- /ap/invoices/{id}/cancel
- /ap/invoices/{id}/cancel-eligibility
- /ap/invoices/{id}/net-balance
- /ap/invoices/{id}/validation-status
- /ap/migration-check/details
- /ap/migration-check/summary
- /ap/multiperiod
- /ap/multiperiod/:invoice_id
- /ap/multiperiod/fusion-data
- /ap/multiperiod/fusion-detail/:id
- /ap/multiperiod/generate
- /ap/multiperiod/mark-posted
- /ap/multiperiod/suspend
- /ap/multiperiod/{id}
- /ap/payments
- /ap/payments/available-installments
- /ap/payments/related-invoices
- /ap/payments/void
- /ap/payments/{check_id}/related-invoices
- /ap/payments/{check_id}/void-eligibility
- /ap/payments/{id}
- /ap/payments/{id}/related-invoices
- /ap/payments/{id}/void-eligibility
- /ap/payments/{payment.checkId}/related-invoices
- /ap/prepayments/available
- /ap/reconciliation
- /ap/reports/payables-ledger-recon
- /ap/system-options

## /applications
- /applications/getall

## /approvals
- /approvals/requests
- /approvals/send-email

## /aprecon
- /aprecon/{id}

## /ar
- /ar/Receivablesactivities
- /ar/adjustmentreasons
- /ar/adjustments
- /ar/adjustments/{id}/accounting-status
- /ar/adjustmenttypes
- /ar/credit-memos
- /ar/customers
- /ar/invoice-balances
- /ar/invoices
- /ar/invoices/:id/installments
- /ar/invoices/{id}
- /ar/invoices/{id}/lines
- /ar/invoicesUI
- /ar/memo-lines
- /ar/receipt-applications
- /ar/receiptmethods
- /ar/receipts
- /ar/revenue-contracts
- /ar/revenue-schedules
- /ar/revenue-schedules/generate
- /ar/revenue-schedules/{id}
- /ar/tax-rates
- /ar/transaction-sources
- /ar/transaction-types

## /auth
- /auth

## /banks
- /banks/bankaccounts

## /bip-reports
- /bip-reports
- /bip-reports/history
- /bip-reports/{id}

## /cash
- /cash/bankstatements
- /cash/bankstatements/{id}
- /cash/bankstatements/{id}/reconcile
- /cash/bankstatements/{id}/unreconcile
- /cash/bankstatements/{initialHeader
- /cash/bankstatements/{initialHeader.statementId}
- /cash/bankstatements/{statementId}/reconcile
- /cash/banktransfers
- /cash/banktransfers/{id}
- /cash/banktransfers/{id}/acctflag
- /cash/externaltransactions
- /cash/externaltransactions/:externalTransactionId/attachments
- /cash/externaltransactions/:externalTransactionId/attachments/:attachmentId
- /cash/externaltransactions/batchstatus/{id}
- /cash/externaltransactions/{id}
- /cash/externaltransactions/{id}/acctflag
- /cash/externaltransactions/{id}/approval
- /cash/externaltransactions/{id}/attachments
- /cash/externaltransactions/{id}/attachments/{id}
- /cash/externaltransactions/{id}/updatetrx
- /cash/payees
- /cash/payees/{id}
- /cash/payees/{id}/bankaccounts
- /cash/payees/{id}/bankaccounts/{id}
- /cash/pdf-templates
- /cash/pdf-templates/{id}
- /cash/recon-status
- /cash/reconciliation/stmtlines
- /cash/reconciliation/stmtlines/{id}
- /cash/reconciliation/systxns
- /cash/reconciliation/systxns/{id}
- /cash/reconciliation/systxns/{txnId}
- /cash/reconciliation/unreconstmtlines/{id}
- /cash/transaction-codes
- /cash/transaction-codes/{id}
- /cash/transaction-codes{id}

## /change-password
- /change-password

## /charofaccounts
- /charofaccounts/getsegments

## /chartofaccounts
- /chartofaccounts/getall
- /chartofaccounts/structuresegments

## /clear
- /clear

## /config
- /config/emailsettings

## /constraint-info
- /constraint-info

## /currencies
- /currencies
- /currencies/bmsrate

## /currentperiodstatus
- /currentperiodstatus

## /distributions
- /distributions
- /distributions/combinations

## /fa
- /fa/accounting/additions-preview
- /fa/accounting/deprn-preview
- /fa/accounting/mark-accounted
- /fa/accounting/mark-deprn-accounted
- /fa/assets
- /fa/assets/{asset.assetId}
- /fa/assets/{id}
- /fa/assets/{id}/attributes
- /fa/assets/{id}/books
- /fa/assets/{id}/deprn
- /fa/assets/{id}/retirement-preview
- /fa/categories
- /fa/categories/{id}/books
- /fa/cost-adjust
- /fa/deprn-adjust
- /fa/deprn-by-period
- /fa/deprn-calculate
- /fa/deprn-calculate/preview
- /fa/deprn-periods/last
- /fa/deprn-post-asset
- /fa/deprn-post-single
- /fa/deprn-view
- /fa/deprn-workbench
- /fa/retirements/{id}
- /fa/retirements/{id}/status

## /getcodecombinations
- /getcodecombinations/get

## /gl
- /gl/accounts
- /gl/businessunits
- /gl/categories
- /gl/fiscalperiods
- /gl/getledgername
- /gl/journals
- /gl/journals/:batchId/post
- /gl/journals/banktxn-lines
- /gl/journals/batches/{
- /gl/journals/batches/{batchId}
- /gl/journals/batches/{id}
- /gl/journals/batches/{id}/period
- /gl/journals/by-txn
- /gl/journals/check
- /gl/journals/create
- /gl/journals/headers
- /gl/journals/lines
- /gl/journals/lines/update-account
- /gl/journals/{batchId}/post
- /gl/journals/{batch_id}/post
- /gl/journals/{glBatchId}/post
- /gl/journals/{glHeaderId}/lines
- /gl/journals/{headerId}
- /gl/journals/{id}
- /gl/journals/{id}/lines
- /gl/journals/{id}/linesaddmissing
- /gl/journals/{id}/post
- /gl/journals/{jeBatchId}/post
- /gl/ledgers
- /gl/ledgers/create
- /gl/legalentities
- /gl/periodsstatus
- /gl/periodstatus
- /gl/reconciliation
- /gl/reconciliation/ledgers
- /gl/reconciliation/lines
- /gl/rr-trialbalance/periods
- /gl/setup/ledgers

## /glaccountslist
- /glaccountslist

## /journals
- /journals/create
- /journals/update/{id}

## /ledgers
- /ledgers

## /pc
- /pc/attachments
- /pc/attachments/:attachmentId
- /pc/attachments/{id}
- /pc/registers/{id}
- /pc/transactions/{id}
- /pc/transactions/{id}/status

## /periodsstatus
- /periodsstatus/create

## /settings
- /settings/claudekey

## /sla
- /sla/accounting
- /sla/accounting/create
- /sla/accounting/delete
- /sla/accounting/error
- /sla/accounting/exists
- /sla/accounting/post
- /sla/journals
- /sla/journals/lines

## /suppliers
- /suppliers
- /suppliers/addresses/{id}
- /suppliers/balance/dashboard/{id}
- /suppliers/balance/dashboard/{supplierNumber}
- /suppliers/balance/invoices/{id}
- /suppliers/balance/invoices/{supplierNumber}
- /suppliers/balance/payment-invoices/{checkId}
- /suppliers/balance/payment-invoices/{id}
- /suppliers/balance/payments/{id}
- /suppliers/balance/payments/{supplierNumber}
- /suppliers/create
- /suppliers/sitelist/{id}
- /suppliers/sites

## /suppliers{id}
- /suppliers{id}

## /support
- /support/dashboard
- /support/tickets
- /support/tickets/{id}
- /support/update

## /tax
- /tax/assignments
- /tax/assignments/delete
- /tax/taxes
- /tax/taxes/bybu
- /tax/taxes/bybu{id}
- /tax/taxes/delete

## /upload-photo
- /upload-photo

## /user-access
- /user-access/{id}

## /users
- /users

## /valuesets
- /valuesets/getvalues
- /valuesets/getvalues/BUIMERC_FIN_GLB_COA_ACCOUNT
- /valuesets/getvalues/BUIMERC_FIN_GLB_COA_CO

## /{CustomerTransactionId}
- /{CustomerTransactionId}/installments

## /{check_id}
- /{check_id}

## /{customerTransactionId}
- /{customerTransactionId}
- /{customerTransactionId}/lines

## /{ep}
- /{ep}

## /{id}
- /{id}
- /{id}/accounting
- /{id}/accounting-status
- /{id}/attachments
- /{id}/attachments/{id}
- /{id}/credits
- /{id}/delete
- /{id}/dff
- /{id}/distributions
- /{id}/installments
- /{id}/installments/notes
- /{id}/installments/{id}
- /{id}/lines
- /{id}/maturity
- /{id}/related-invoices
- /{id}/{id}
- /{id}/{id}/accounting
- /{id}/{revalueId}

