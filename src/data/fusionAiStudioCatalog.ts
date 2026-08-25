// Auto-generated from oracle/fusion-ai-studio (branch release-26C, analyzed 2026-08-25).
// Every sample workflow in Oracle's AI Agent Studio repository, with the
// business objects it references and the web services those objects call.
// verdict: 'public'   = documented Fusion REST, callable from our stack today
//          'caution'  = undocumented Redwood/search/OTBI API - works, unsupported
//          'internal' = BOSS/platform API for the Fusion agentic framework only
//          'mixed'    = uses both public and internal services
//          'none'     = pure LLM/code logic, no external service

export interface StudioWorkflow {
  module: string;
  area: string;
  name: string;
  description: string;
  businessObjects: string[];
  services: string[];
  verdict: 'public' | 'caution' | 'internal' | 'mixed' | 'none';
}

export const STUDIO_WORKFLOWS: StudioWorkflow[] = [
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Accounting Exceptions",
    "description": "Identifies accounting exceptions that can block period close, summarizes exception categories by ledger and period, drills into affected transactions, and supports corrective actions such as reviewing transaction details or submitting the related accounting process.",
    "businessObjects": [
      "Accounting Exceptions ESS Jobs",
      "Accounting Exceptions Lookup"
    ],
    "services": [
      "/api/boss/extraction/extract",
      "/fscmRestApi/resources/11.13.18.05/erpintegrations"
    ],
    "verdict": "mixed"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Clearing Account Balances",
    "description": "Monitors clearing account insights for the selected ledger, highlights unreconciled or unusual clearing balances, and lets users drill into balances, journals, and supporting transactions to understand and resolve close risks.",
    "businessObjects": [
      "Chart of Accounts Details",
      "Execute BOSS Query Helper",
      "Insights List",
      "Insight Review Actions",
      "Period Expression Resolver"
    ],
    "services": [
      "/api/boss/data/objects/ora/erpCore/sensorPolicies/v1/$en-US/sensorInsightRecipients/$views/sensorInsightList",
      "/api/boss/data/objects/ora/erpCore/structure/v1/generalLedgerAccounts/$actions/getChartOfAccountDetails",
      "/api/boss/extraction/extract",
      "/api/erp/erpaggregatedataservice/api/v2/av/extract",
      "/api/erp/erpdatainsightssignal/insights/resolvePeriodExpression",
      "/api/erp/erpdatainsightssignal/v1/data/insights/insightActions"
    ],
    "verdict": "internal"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Controls and Compliance",
    "description": "Surfaces controls and compliance insights for ledger close, prioritizes policy exceptions and audit risks, supports review or dismissal of flagged issues, and provides drilldowns into journals, balances, and supporting details.",
    "businessObjects": [
      "Chart of Accounts Details",
      "Execute BOSS Query Helper",
      "Insights List",
      "Insight Review Actions",
      "Period Expression Resolver"
    ],
    "services": [
      "/api/boss/data/objects/ora/erpCore/sensorPolicies/v1/$en-US/sensorInsightRecipients/$views/sensorInsightList",
      "/api/boss/data/objects/ora/erpCore/structure/v1/generalLedgerAccounts/$actions/getChartOfAccountDetails",
      "/api/boss/extraction/extract",
      "/api/erp/erpaggregatedataservice/api/v2/av/extract",
      "/api/erp/erpdatainsightssignal/insights/resolvePeriodExpression",
      "/api/erp/erpdatainsightssignal/v1/data/insights/insightActions"
    ],
    "verdict": "internal"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Ledger Closure Workflow",
    "description": "Orchestrates the Ledger Close Workspace by loading application context, routing app message hints, invoking the period status, accounting exceptions, controls compliance, clearing account, and variance workflows in parallel, and rendering an executive close summary.",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Ledger Insights Context Workflow",
    "description": "This workflow identifies the user\u2019s preferred default ledger and available ledger access, then initializes or switches the active ledger context based on the specified ledger to ensure all subsequent operations are performed in the correct financial context.",
    "businessObjects": [
      "Fetch Accounting Periods",
      "General Standard Lookups",
      "Ledger Lookup",
      "Ledger Open Periods",
      "Ledger Preference Settings"
    ],
    "services": [
      "/api/boss/data/objects/ora/erpCore/structure/v1/accountingPeriods",
      "/api/boss/extraction/extract",
      "/api/rwdinfra/config/v1/preferences",
      "/fscmRestApi/resources/11.13.18.05/standardLookupsLOV"
    ],
    "verdict": "mixed"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Ledger Insights Query Helper",
    "description": "Builds a Journals BV journal-line drilldown query payload from an analytic-view request using chart-of-accounts metadata, ledger information, and configured field aliases.",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Ledger Switch Workflow",
    "description": "Manages ledger context selection for the Ledger Close Workspace by reading the current application context, listing ledgers available to the signed-in user, validating selection or refresh requests, and returning the updated ledger context for the app.",
    "businessObjects": [
      "Ledger Lookup"
    ],
    "services": [
      "/api/boss/extraction/extract"
    ],
    "verdict": "internal"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Period Status",
    "description": "Retrieves and displays period status for General Ledger and the Payables and Receivables subledgers for the selected ledger and accounting period.",
    "businessObjects": [
      "Period Status"
    ],
    "services": [
      "/api/boss/extraction/extract"
    ],
    "verdict": "internal"
  },
  {
    "module": "FIN",
    "area": "ledger-insights",
    "name": "Variance Analysis",
    "description": "Analyzes significant balance variances for the selected ledger and period, ranks variance insights by business impact, and supports drilldowns into balances and review or dismissal actions.",
    "businessObjects": [
      "Execute BOSS Query Helper",
      "Insights List",
      "Insight Review Actions",
      "Period Expression Resolver"
    ],
    "services": [
      "/api/boss/data/objects/ora/erpCore/sensorPolicies/v1/$en-US/sensorInsightRecipients/$views/sensorInsightList",
      "/api/boss/extraction/extract",
      "/api/erp/erpaggregatedataservice/api/v2/av/extract",
      "/api/erp/erpdatainsightssignal/insights/resolvePeriodExpression",
      "/api/erp/erpdatainsightssignal/v1/data/insights/insightActions"
    ],
    "verdict": "internal"
  },
  {
    "module": "HCM",
    "area": "absences",
    "name": "My Upcoming Absences",
    "description": "This workflow displays the list of existing absences for the employee.",
    "businessObjects": [
      "Absence Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/absences/action/findByAdvancedSearchQuery"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "absences",
    "name": "My Team Upcoming Absences",
    "description": "Displays upcoming absence summaries and absence type charts for a line manager's direct reports.",
    "businessObjects": [
      "Absence Details",
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2",
      "/hcmRestApi/resources/11.13.18.05/absences/action/findByAdvancedSearchQuery"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "benefits",
    "name": "Benefits Person Life Events",
    "description": "This workflow displays the count of unique people by life event status, with each person counted only once.",
    "businessObjects": [
      "Benefits Person Life Event Status Aggregations"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/benefitPersonAggregations"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "career-development",
    "name": "My Career Development Tasks",
    "description": "Fetches open career development tasks assigned to the logged-in person and displays them as a message list with activity name, journey name, person context, required marker, and due or overdue badge.",
    "businessObjects": [
      "Career Development Tasks"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/workerJourneyTasks"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "career-development",
    "name": "My Current Learning",
    "description": "Displays the logged-in learner's current learning assignments with their status, due or completion date, and course details.",
    "businessObjects": [
      "Learning Searches"
    ],
    "services": [
      "/hcmRestApi/indexSearch/learningRecordAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearnerAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearningItemAggregations",
      "/hcmRestApi/indexSearch/learningRecordSearches",
      "/hcmRestApi/indexSearch/myLearningAssignmentSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "career-development",
    "name": "My Self Developing Skills",
    "description": "Fetches skills currently under development for the logged-in person and displays them as a multi-record widget with skill name, current proficiency, required proficiency, and endorsement count.",
    "businessObjects": [
      "Career development skills lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/talentPersonPublicSkills"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "compensation",
    "name": "Direct Reports Below Compa Ratio",
    "description": "Displays direct reports with compa ratios below 100",
    "businessObjects": [
      "My Team Compensation Details Lookup",
      "LoggedIn Employee Context"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV",
      "/hcmRestApi/resources/11.13.18.05:9/myTeamDetails/action/findByObject"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "compensation",
    "name": "Team Overdue Salary Reviews",
    "description": "Displays the direct reports, whose next salary review date has passed, helping compensation teams prioritize overdue review follow-up and maintain timely pay governance.",
    "businessObjects": [
      "My Team Compensation Details Lookup",
      "LoggedIn Employee Context"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV",
      "/hcmRestApi/resources/11.13.18.05:9/myTeamDetails/action/findByObject"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Attrition Advisor",
    "description": "Handles natural-language attrition questions by invoking the Smart Answers Expert workflow, validating the returned result, and formatting the response for display.",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Attrition Summary",
    "description": "Retrieves and summarizes recent attrition metrics, including active worker counts and attrition percentage, for display in the attrition analysis experience.",
    "businessObjects": [
      "HR Attrition Analytic Reports",
      "HR Attrition Person Searches"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Smart Answers Expert",
    "description": "Converts a user's attrition analysis request into a safe OTBI logical SQL query, executes it, and returns the result data with metadata for downstream workflows.",
    "businessObjects": [
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Top Leavers by Job",
    "description": "Shows attrition across the organization by grouping leavers by job role, enabling job and manager-level drilldown, suggesting active employees with similar attrition risk patterns, and surfacing corrective actions alongside those suggestions.",
    "businessObjects": [
      "HR Attrition All Reports",
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Top Leavers by Location",
    "description": "Shows attrition across the organization by grouping leavers by location, enabling location and manager-level drilldown, suggesting active employees with similar attrition risk patterns, and surfacing corrective actions alongside those suggestions.",
    "businessObjects": [
      "HR Attrition All Reports",
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Top Leavers By Manager",
    "description": "Shows attrition across the logged-in employee\u2019s reporting hierarchy by grouping leavers under each manager, enabling manager-level drilldown, suggesting active employees with similar attrition risk patterns, and surfacing corrective actions alongside those suggestions.",
    "businessObjects": [
      "HR Attrition All Reports",
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Top Leavers by Reason",
    "description": "Shows attrition across the logged-in employee\u2019s reporting hierarchy by grouping leavers by reason, enabling reason-level drilldown, surfacing manager-wise and employee-level views, suggesting active employees with similar attrition risk patterns, and presenting corrective actions where applicable.",
    "businessObjects": [
      "HR Attrition All Reports",
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "employment",
    "name": "Top Leavers by Tenure",
    "description": "Shows attrition across the organization by grouping leavers by tenure band, enabling tenure and manager-level drilldown, suggesting active employees with similar attrition risk patterns, and surfacing corrective actions alongside those suggestions.",
    "businessObjects": [
      "HR Attrition All Reports",
      "HR Attrition Analytic Reports"
    ],
    "services": [
      "/crmRestApi/biResources/11.13.18.05/sawSession/logon",
      "/crmRestApi/biResources/11.13.18.05/sqlQuery",
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Team Document Records Near Expiry",
    "description": "Helps you monitor document records in your team that are expiring within the next 30 days by displaying the employee name, document type, document name, and expiration date.",
    "businessObjects": [
      "Document Records Expiring Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/latest/documentRecords"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker About Me",
    "description": "Agentic App compatible workflow that retrieves talent-profile information for the person in the app context, or for the current logged-in user when no person is selected. It shows the person's About Me information, including Expertise, Tags, and Interests, and answers questions concisely using only the available talent-profile data.",
    "businessObjects": [
      "Talent Person Profiles"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/talentPersonProfiles"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Address Details of Worker",
    "description": "Returns the addresses for a worker using person identifier first, or person number when person identifier is not provided.",
    "businessObjects": [
      "HCM GHR Worker Contact Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}",
      "/hcmRestApi/resources/11.13.18.05/workers"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Assignment History",
    "description": "A workflow agent that takes person id or assignment id and returns assignment history update records. When person id is provided, it resolves the worker primary assignment from assignment rows before fetching assignment history.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Employment Information",
    "description": "Returns assignment and employment information for the supplied person identifier.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Card",
    "description": "Agentic App compatible workflow that retrieves employment and contact information for the person in the app context, or for the current logged-in user when no person is selected. It provides a concise summary of the person's name, role, organization, manager, work location, email, phone, communication accounts, and office address when available.",
    "businessObjects": [
      "HCM GHR Employment",
      "HCM GHR Worker Contact Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}",
      "/hcmRestApi/resources/11.13.18.05/workers"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Business Unit",
    "description": "Returns the number of workers associated with the supplied business unit name.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Department",
    "description": "Returns the number of workers associated with the supplied department name.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Grade",
    "description": "A workflow agent that takes a grade as input and returns the count of employees with that grade.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Job",
    "description": "Returns the number of workers associated with the supplied job code or job name. When both inputs are provided, the workflow uses job code first.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Location",
    "description": "A workflow agent that takes a location as input and returns the count of employees at that location.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Number of Workers by Position",
    "description": "A workflow agent that takes a position as input and returns the count of employees with that position.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Count of Workers by Location, Job, Position, Grade and Business Unit",
    "description": "Agent team which gives count of Workers by Location, Job, Position, Grade and Business Unit",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Count of Workers by Grade",
    "description": "Returns worker counts grouped by grade for the supplied manager person identifier.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Count of Workers by Job",
    "description": "Returns worker counts grouped by job for the supplied manager person identifier.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Count of Workers by Location",
    "description": "Returns worker counts grouped by location for the supplied manager person identifier.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Directs",
    "description": "Agentic App compatible workflow that retrieves direct reports for the person in the app context, or for the current logged-in user when no person is selected. It shows each direct report's name and assignment, direct and total report counts, and the reporting hierarchy. It also answers questions using only the available reporting data and lets users select a direct report or view additional reports.",
    "businessObjects": [
      "HCM GHR Employment",
      "Person Direct Reports V2",
      "HCM GHR Worker Contact Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}",
      "/hcmRestApi/resources/11.13.18.05/workers"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Document Record Expiry",
    "description": "Retrieves document records for the logged-in user that are due to expire within the next 30 days, displaying the document type, document name, expiration date, and expiry date.",
    "businessObjects": [
      "Document Records Expiring Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/latest/documentRecords"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Email Details of Worker",
    "description": "Returns the email addresses for a worker using person identifier first, or person number when person identifier is not provided.",
    "businessObjects": [
      "HCM GHR Worker Contact Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}",
      "/hcmRestApi/resources/11.13.18.05/workers"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers by Business Unit",
    "description": "Lists workers associated with the supplied business unit identifier or business unit name. When both inputs are provided, the workflow uses business unit identifier first.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers by Department",
    "description": "Lists workers associated with the supplied department name.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers by Grade",
    "description": "A workflow agent that takes a grade as input and lists all workers associated with that grade.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers by Job",
    "description": "Lists workers associated with the supplied job identifier, job code, or job name. When multiple job inputs are provided, the workflow uses job identifier first, then job code, then job name.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers By Location",
    "description": "A workflow agent that takes a work location as input and lists all workers assigned to that location.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Workers by Position",
    "description": "A workflow agent that takes a position as input and lists all workers associated with that position.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "List of Workers by Location, Job, Position, Grade and Business Unit",
    "description": "A workflow agent that takes Location, Job, Grade, Department, Position and Business Unit as input and returns the list of workers associated with the given input",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Manager Information",
    "description": "A workflow agent that takes person id and returns manager information.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Manager Hierarchy",
    "description": "A workflow agent that takes person id and returns manager hierarchy till top person.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Phone Details of Worker",
    "description": "Returns the phone numbers for a worker using person identifier first, or person number when person identifier is not provided.",
    "businessObjects": [
      "HCM GHR Worker Contact Details"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}",
      "/hcmRestApi/resources/11.13.18.05/workers"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Representatives",
    "description": "Agentic App compatible workflow that retrieves representatives for the person in the app context, or for the current logged-in user when no person is selected. It shows each representative's name, responsibility, and image when available. It also answers questions using only the available representative data and lets users select a representative or view the complete representative list.",
    "businessObjects": [
      "HCM GHR Employment",
      "Representatives Search V2"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}/child/assignments/{assignmentId}/child/representatives"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Search",
    "description": "Worker Search is an Ask Oracle compatible workflow for worker, representative, About Me, and feedback lookups. It supports `Query` and `InvokeAction` modes and handles `PersonDetails`, `PersonRepresentatives`, and `PersonAbout` intents using the selected person from `OraAppContext`, with a current logged-in user fallback.\n\nFor worker search, it supports person name, phone number, work email, location, city, country, department, position, job, manager, team, organization, direct reports, all reports, time range, time zone, current user, combined filters, local-time filtering, grouped facets, paging, retry after removing the latest filter, unresolved terms, and no-result handling.\n\nWorker results show display name, job, assignment, department, location, person image, and clickable actions. Representative search resolves the selected person's primary assignment, returns representatives, filters by responsibility, supports benefits, human resources, and payroll requests, and displays representative name, responsibility name, responsibility type, and image. `PersonAbout` retrieves talent-profile data for About Me summaries and person notes for feedback summaries.\n\nIn `InvokeAction`, `selectFacet` applies selected facets and refreshes the relevant result, `selectPerson` refreshes the app with the selected person's context, and `showMore` retrieves the next page while preserving filters and context.",
    "businessObjects": [
      "HCM GHR Employment",
      "Person Notes V2",
      "HCM GHR Worker Search",
      "Representatives Search V2",
      "Talent Person Profiles"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2",
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{personId}/child/assignments/{assignmentId}/child/representatives",
      "/hcmRestApi/resources/11.13.18.05/talentPersonProfiles"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Seniority Information",
    "description": "Returns seniority information for workers in the supplied manager person identifier hierarchy.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Seniority Information of Worker",
    "description": "Returns seniority information for the supplied person identifier.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker By Name",
    "description": "A workflow agent that takes a worker\u2019s name or partial name as input and returns the matching worker record.",
    "businessObjects": [
      "HCM GHR Worker Search"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerAggregationsV2",
      "/hcmRestApi/redwood/11.13.18.05/workerSearchesV2"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "human-resources",
    "name": "Worker Location Weather",
    "description": "Agentic App compatible workflow that retrieves the work location for the person in the app context, or for the current logged-in user when no person is selected. It shows the worker's location, current weather, timezone, and local time, with helpful weather and day-or-night icons when available.",
    "businessObjects": [
      "HCM GHR Employment"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/employmentAssignmentHistoryDetails",
      "/hcmRestApi/resources/11.13.18.05/employmentSeniorityDatesAll",
      "/hcmRestApi/resources/11.13.18.05/employmentTeamSeniorityDates",
      "/hcmRestApi/resources/11.13.18.05/personNotesV2",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{managerPersonId}/child/assignments/{managerAssignmentId}/child/directReports"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Add To Collection",
    "description": "This agent workflow takes information regarding a new task from the user and creates a new task in user collections through the business object",
    "businessObjects": [
      "Journey Task Collections"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/journeyTaskCollections"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Display Insights",
    "description": "Retrieves tasks from the user's Journey Task Collection and task-status aggregations, generates task deep links, and renders the highest-priority open tasks as an insights message list.",
    "businessObjects": [
      "Collection Task Aggregations",
      "Journey Task Collections"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskAggregations",
      "/hcmRestApi/resources/11.13.18.05/journeyTaskCollections"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Overdue Onboarding Team Journeys",
    "description": "Fetches Enterprise Onboarding and Onboarding team journeys, renders the top journey records as a message list with person image, person name, journey name, person number, and an alert badge for overdue task count for review by manager.",
    "businessObjects": [
      "Journey Searches and Aggregation"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Overdue Onboarding Team Journeys Tasks",
    "description": "Fetches overdue Enterprise Onboarding and Onboarding team journey tasks, filters them to the top five tasks, enriches each task with due-date timing details, and renders them as a message list with task name, journey name, owner details, and overdue status for review by manager.",
    "businessObjects": [
      "Journey Searches and Aggregation"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Overdue Team Journey Tasks",
    "description": "Fetches overdue team journey tasks, filters them to the top five tasks, enriches each task with due-date timing details, and renders them as a message list with task name, journey name, owner details, and overdue status for review by manager. If overdue tasks are not present then presents the open tasks which are due ordered by end date.",
    "businessObjects": [
      "Journey Searches and Aggregation"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Overdue Team Journeys",
    "description": "Fetches overdue team journeys, renders the top journey records as a message list with person image, person name, journey name, person number, and an alert badge for overdue task count, and provides navigation to the Team Journeys page for viewing more journeys for review by manager.",
    "businessObjects": [
      "Journey Searches and Aggregation"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "journeys",
    "name": "Team Journey Aggregation Chart",
    "description": "Displays team journey category distribution as a pie chart using aggregation data from the Worker Journey business object, with absolute category counts shown below the chart for easy comparison for review by manager.",
    "businessObjects": [
      "Journey Searches and Aggregation"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/workerJourneyTaskSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "learning",
    "name": "Team Learning Item Recommendations",
    "description": "Displays recommended learning items for a manager audience to assign for the team.",
    "businessObjects": [
      "Learning Item Searches Lookup",
      "WLF Recommendation Aggregations Lookup"
    ],
    "services": [
      "/hcmRestApi/indexSearch/learningItemSearches",
      "/hcmRestApi/redwood/11.13.18.05/wlfRecommendationAggregations"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "learning",
    "name": "Team Learning Status",
    "description": "Displays the summary of a team's learning progress by status in a pie chart to the line manager",
    "businessObjects": [
      "Learning Searches"
    ],
    "services": [
      "/hcmRestApi/indexSearch/learningRecordAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearnerAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearningItemAggregations",
      "/hcmRestApi/indexSearch/learningRecordSearches",
      "/hcmRestApi/indexSearch/myLearningAssignmentSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "learning",
    "name": "Team Overdue Learners",
    "description": "Displays the list of learners having overdue learning assignments in a line manager's team",
    "businessObjects": [
      "Learning Searches"
    ],
    "services": [
      "/hcmRestApi/indexSearch/learningRecordAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearnerAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearningItemAggregations",
      "/hcmRestApi/indexSearch/learningRecordSearches",
      "/hcmRestApi/indexSearch/myLearningAssignmentSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "learning",
    "name": "Team Overdue Learning Items",
    "description": "Displays the list of overdue learning items assigned to a line manager's team members",
    "businessObjects": [
      "Learning Searches"
    ],
    "services": [
      "/hcmRestApi/indexSearch/learningRecordAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearnerAggregations",
      "/hcmRestApi/indexSearch/learningRecordLearningItemAggregations",
      "/hcmRestApi/indexSearch/learningRecordSearches",
      "/hcmRestApi/indexSearch/myLearningAssignmentSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "recruiting",
    "name": "Expired Job Requisition Assistant",
    "description": "It helps monitor open phase requisitions whose postings have expired and guides recruiters to take immediate action.",
    "businessObjects": [
      "Expired Job Requisitions"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/recruitingUIJobRequisitions/action/findByAdvancedSearchQuery"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Bottom Talent Advisor",
    "description": "Represents employees who need assistance, coaching, or development support to improve readiness and succession potential.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Compensation Advisor",
    "description": "Shows compensation position for direct reports so managers can review salary, quartile, and quintile context.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Compensation Analysis",
    "description": "Shows salary history for the selected worker assignment.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Compensation Details Lookup",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/compensationInfoSalaries",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Fetch Compensation Details",
    "description": "Fetches compensation details for the manager's direct reports as of the requested date.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Compensation Details Lookup",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/compensationInfoSalaries",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Fetch Performers",
    "description": "Fetches direct-report talent ratings so workflows can identify both top performers and employees needing assistance.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup",
      "Talent Ratings Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/talentRatings",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Impact of Loss Advisor",
    "description": "Retrieves impact of loss details of direct reports, so that managers can assess the business impact if the employee were lost, highlighting criticality, coverage gaps, and potential disruption.",
    "businessObjects": [
      "LoggedIn Employee Context"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Impact of Loss Analysis",
    "description": "Displays the impact assessment if the worker were lost, highlighting business criticality and coverage gaps.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Potential Succession Candidates",
    "description": "Finds potential successor candidates for a selected employee by comparing role requirements and candidate context.",
    "businessObjects": [
      "Direct Reports Context",
      "LoggedIn Employee Context",
      "Job Competencies Lookup",
      "Skills and Competencies Lookup",
      "Talent Ratings Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject",
      "/hcmRestApi/resources/11.13.18.05/talentModelProfiles/{pProfileId}/child/competencySections",
      "/hcmRestApi/resources/11.13.18.05/talentPersonProfiles",
      "/hcmRestApi/resources/11.13.18.05/talentRatings",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Risk Of Loss Advisor",
    "description": "Assesses the likelihood that the employee may leave or become unavailable, helping identify retention risk and succession exposure.",
    "businessObjects": [
      "LoggedIn Employee Context"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Risk of Loss Analysis",
    "description": "Shows the risk-of-loss assessment for the worker, helping identify how likely it is that this person could leave or become unavailable.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Succession Analysis",
    "description": "Shows a selected worker's succession readiness, plan coverage, candidate count, and supporting talent context.",
    "businessObjects": [
      "Employee Tree Context",
      "LoggedIn Employee Context",
      "Compensation Details Lookup",
      "Succession Details Lookup",
      "Talent Ratings Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/compensationInfoSalaries",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{pPersonId}/child/assignments/{pAssignmentId}",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/talentRatings",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Succession Overview Advisor",
    "description": "Provides the main succession planning summary for an employee, combining readiness, risk, impact, and successor information into one overview.",
    "businessObjects": [
      "Employee Tree Context",
      "LoggedIn Employee Context",
      "SuccessionOrgCharts createPayloadInfo",
      "Compensation Details Lookup",
      "Succession Details Lookup",
      "Succession Plan Creation",
      "Talent Ratings Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/compensationInfoSalaries",
      "/hcmRestApi/resources/11.13.18.05/employmentAttributes/action/retrieveEmploymentPublicAttributes",
      "/hcmRestApi/resources/11.13.18.05/gradesLov",
      "/hcmRestApi/resources/11.13.18.05/jobsLov",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{pPersonId}/child/assignments/{pAssignmentId}",
      "/hcmRestApi/resources/11.13.18.05/publicWorkers/{pRoleHolderAId}",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/talentRatings",
      "/hcmRestApi/resources/11.13.18.05/talentSuccessionPlans/{pPlanId}/action/populateIncumbentsForPlan",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Succession Overview Agent Team",
    "description": "Fetches manager-scoped succession, readiness, risk-of-loss, and impact-of-loss data for direct reports.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "succession-management",
    "name": "Top Talent Advisor",
    "description": "Represents employees who are performing strongly and are well-positioned for succession planning or future advancement.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Succession Details Lookup"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{assigmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/successionOrgCharts/{pAssignmentId}/child/directReports",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "talent-management",
    "name": "Team Unscheduled Check-Ins",
    "description": "Identifies team members for a logged-in user with last checkin date more that 30 days ago and displays recent check-in status of employees , performance, and potential to help prioritize unscheduled check-ins.",
    "businessObjects": [
      "LoggedIn Employee Context",
      "Team Unscheduled Check-In"
    ],
    "services": [
      "/hcmRestApi/resources/11.13.18.05/myTeamDetails/action/findByObject",
      "/hcmRestApi/resources/11.13.18.05/workerAssignmentsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "HCM",
    "area": "time-and-labor",
    "name": "Team Under Reported Time Cards",
    "description": "Shows the list of people who reported less hours in their timecard than their scheduled hours.",
    "businessObjects": [
      "Time Card Searches Lookup"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/timeCardSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "time-and-labor",
    "name": "Time Card Exception Summary",
    "description": "Shows time card exception types, counts, aggregate scheduled hours, reported hours, and absence hours with row actions for detail drilldown.",
    "businessObjects": [
      "Time Card Exception Aggregations Lookup",
      "Time Card Exception Searches Lookup"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/timeCardAggregations",
      "/hcmRestApi/redwood/11.13.18.05/timeCardSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "HCM",
    "area": "time-and-labor",
    "name": "Time Card Status Aggregation",
    "description": "Displays the distribution of line manager team's time card statuses and missing person time cards for the last 30 days in a pie chart.",
    "businessObjects": [
      "Missing Person Time Card Aggregations Lookup",
      "Time Card Status Aggregations Lookup"
    ],
    "services": [
      "/hcmRestApi/redwood/11.13.18.05/timeCardAggregations",
      "/hcmRestApi/resources/11.13.18.05/timeCards/action/getAggregations"
    ],
    "verdict": "caution"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "Compliance Checklist",
    "description": "Provides an overview of active compliance checklist items.",
    "businessObjects": [
      "Compliance Checklist"
    ],
    "services": [
      "/fscmRestApi/applcoreApi/search/v1/fa-prc-compliancechecklists/complianceChecklistSearch/search"
    ],
    "verdict": "caution"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "My Recent Purchase Requisitions",
    "description": "Shows purchase requisition activity for the logged-in user over the past 30 days.",
    "businessObjects": [
      "My Requisitions"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05/purchaseRequisitions"
    ],
    "verdict": "public"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "Purchase Agreement Status Distribution",
    "description": "Shows the distribution of purchase agreements across different statuses in a chart.",
    "businessObjects": [
      "Purchase Agreements"
    ],
    "services": [
      "/fscmRestApi/applcoreApi/search/v1/fa-prc-pa",
      "/fscmRestApi/procurement/11.13.18.05/agreementAggregations",
      "/fscmRestApi/procurement/11.13.18.05/agreementSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "Purchase Agreements",
    "description": "Provides an overview of the logged-in user\u2019s purchase agreements and their current status over the past 30 days.",
    "businessObjects": [
      "Purchase Agreements"
    ],
    "services": [
      "/fscmRestApi/applcoreApi/search/v1/fa-prc-pa",
      "/fscmRestApi/procurement/11.13.18.05/agreementAggregations",
      "/fscmRestApi/procurement/11.13.18.05/agreementSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "Purchase Order Status Distribution",
    "description": "Shows the distribution of purchase orders across different statuses in a chart.",
    "businessObjects": [
      "Manage Purchase Orders"
    ],
    "services": [
      "/fscmRestApi/applcoreApi/search/v1/fa-prc-po",
      "/fscmRestApi/procurement/11.13.18.05/orderAggregations",
      "/fscmRestApi/procurement/11.13.18.05/orderSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "PRC",
    "area": "purchasing",
    "name": "Purchase Orders",
    "description": "Provides an overview of the logged-in user\u2019s purchase orders and their current status over the past 30 days.",
    "businessObjects": [
      "Manage Purchase Orders"
    ],
    "services": [
      "/fscmRestApi/applcoreApi/search/v1/fa-prc-po",
      "/fscmRestApi/procurement/11.13.18.05/orderAggregations",
      "/fscmRestApi/procurement/11.13.18.05/orderSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "SCM",
    "area": "cost-management",
    "name": "Inventory Valuation Comparison Advisor",
    "description": "Compares inventory values across reporting periods, highlighting changes in asset, expense, and consigned inventory.",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "SCM",
    "area": "cost-management",
    "name": "Period Validation Exceptions Advisor",
    "description": "Shows validation exceptions for the selected accounting period, helping identify cost accounting issues that require attention.",
    "businessObjects": [
      "Period Validation Exceptions Advisor"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05:9/costAccountingPeriodEndValidations",
      "/fscmRestApi/resources/11.13.18.05:9/costAccountingPeriods",
      "/fscmRestApi/resources/11.13.18.05:9/costOrganizationsLOV"
    ],
    "verdict": "public"
  },
  {
    "module": "SCM",
    "area": "inventory",
    "name": "Inventory Organization Context Switcher",
    "description": "Inventory Context Switching is a workflow that allows users to switch the selected organization and view or perform inventory-related actions within that organization\u2019s context. This ensures the displayed inventory data and transactions are relevant to the chosen organization.",
    "businessObjects": [
      "Fetch Default Organization",
      "Inventory Organizations List"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05/profileValues/INV_DEFAULT_ORG_ID",
      "/fscmRestApi/resources/latest/inventoryAccessibleOrganizations/{ProfileOptionValue}"
    ],
    "verdict": "public"
  },
  {
    "module": "SCM",
    "area": "inventory",
    "name": "Inventory Item Shortage Monitor",
    "description": "Identifies inventory items that are experiencing shortages in the user's default Organization. Assists warehouse managers and inventory planners by retrieving and summarizing item shortages.",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "SCM",
    "area": "inventory",
    "name": "Inventory Item Stockout Monitor",
    "description": "Identifies inventory items that are stocked out in the user's default Organization. Assists warehouse managers and inventory planners by retrieving and summarizing item stockouts .",
    "businessObjects": [],
    "services": [],
    "verdict": "none"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Maintenance Material Readiness",
    "description": "Review organization-wide material readiness by identifying item shortages, available quantities, and the affected maintenance work orders that may be delayed due to insufficient materials.",
    "businessObjects": [
      "Material Work Order Assignment Sequences"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05/workOrderAssignmentSequences"
    ],
    "verdict": "public"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Maintenance Material Shortage",
    "description": "Analyze material shortages for selected maintenance work orders by showing required items, shortage quantities, and availability details needed to support timely work order execution.",
    "businessObjects": [
      "Shortage Units of Measure",
      "Material Item Assignment Summaries",
      "On Hand Qty by Item"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05/materialAssignmentSummaries",
      "/fscmRestApi/resources/11.13.18.05/onhandQuantityDetails",
      "/fscmRestApi/resources/11.13.18.05/unitsOfMeasure"
    ],
    "verdict": "public"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Work Execution Open Exceptions",
    "description": "Monitor open production exceptions by reviewing unresolved manufacturing issues, severity, and related work execution details so teams can prioritize actions and reduce operational disruption.",
    "businessObjects": [
      "Open Production Exceptions"
    ],
    "services": [
      "/fscmRestApi/resources/11.13.18.05/productionExceptionsV2"
    ],
    "verdict": "public"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Current Work Orders",
    "description": "Work orders that are actively in progress or ready for execution within the selected organization.",
    "businessObjects": [
      "Maintenance Work Order Searches By Filters"
    ],
    "services": [
      "/fscmRestApi/scm/redwood/11.13.18.05/maintenanceWorkOrderSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Future Work Orders",
    "description": "Work orders scheduled for upcoming execution, helping teams prepare resources, materials, and timelines in advance.",
    "businessObjects": [
      "Maintenance Work Order Searches By Filters"
    ],
    "services": [
      "/fscmRestApi/scm/redwood/11.13.18.05/maintenanceWorkOrderSearches"
    ],
    "verdict": "caution"
  },
  {
    "module": "SCM",
    "area": "maintenance",
    "name": "Overdue Work Orders",
    "description": "Work orders that have passed their planned completion date and require attention to reduce delay and backlog.",
    "businessObjects": [
      "Maintenance Work Order Searches By Filters"
    ],
    "services": [
      "/fscmRestApi/scm/redwood/11.13.18.05/maintenanceWorkOrderSearches"
    ],
    "verdict": "caution"
  }
];
