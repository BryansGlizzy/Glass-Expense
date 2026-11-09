# GlassExpense — Tax Management & Calculation System (Phase 4)

> **Document Scope**: Definitive technical architecture, mathematical specifications, IRS tax code mappings, database schemas, API contracts, beginner educational blueprints, and audit defense protocols for the GlassExpense Tax System.  
> **Master Architecture Reference**: See [DOCUMENTATION.md](DOCUMENTATION.md) for full project architecture and [API.md](API.md) for general REST API specifications.

---

## 1. Executive Summary & Regulatory Foundations

The **GlassExpense Tax System** bridges the operational gap between daily expense tracking and federal tax compliance. Built for trade contractors, independent freelancers, and small business owners, the system aggregates expenses, mileage, invoices, and W-2 income into an audit-ready tax calculation engine.

### Key Statutory References
The mathematical calculations and deduction categories within GlassExpense adhere strictly to Title 26 of the United States Code (Internal Revenue Code):

- **IRC §162(a)**: Deductibility of all ordinary and necessary expenses paid or incurred in carrying on any trade or business.
- **IRC §274(n)**: Statutory 50% deduction limitation on business meals and entertainment.
- **IRC §280A(c)(5)**: Simplified home office deduction method ($5.00 per square foot, capped at 300 sq ft / $1,500 maximum).
- **IRC §6654**: Underpayment penalty prevention rules and statutory estimated quarterly safe-harbor requirements (90% current year vs. 100%/110% prior year liability).
- **IRC §199A**: Qualified Business Income (QBI) deduction allowing up to a 20% deduction on qualified pass-through business income.
- **IRC §1401 & §1402**: Self-Employment Contributions Act (SECA) imposing 12.4% Social Security and 2.9% Medicare tax on 92.35% of net trade or business profit.
- **IRC §162(l)**: Above-the-line deduction on Form 1040 Schedule 1 for self-employed health insurance premiums.
- **IRC §465**: At-risk rules governing the full deductibility of business net losses against other personal income (Schedule C Line 32a).
- **IRC §461(l) & §172**: Excess business loss thresholds and Net Operating Loss (NOL) carryforward rules.

---

## 2. Multi-Entity Tax Architecture & Comparison

GlassExpense supports three core business entity classifications, tailoring calculations, form outputs, and tax savings projections accordingly.

```
                               ┌────────────────────────────────────────────────────────┐
                               │             Client Invoices & Job Expenses             │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
                                                           ▼
                                            ┌─────────────────────────────┐
                                            │    Schedule C Part I & II   │
                                            │  Gross Profit - Deductions  │
                                            └──────────────┬──────────────┘
                                                           │
                                             Net Business Profit / Loss
                                                           │
                            ┌──────────────────────────────┴──────────────────────────────┐
                            │                                                             │
                            ▼                                                             ▼
              ┌───────────────────────────┐                                 ┌───────────────────────────┐
              │     Sole Prop / SMLLC     │                                 │     S-Corporation (1120-S)│
              └─────────────┬─────────────┘                                 └─────────────┬─────────────┘
                            │                                                             │
              ┌─────────────┴─────────────┐                                 ┌─────────────┴─────────────┐
              ▼                           ▼                                 ▼                           ▼
        Schedule SE                 Form 1040 Sched 1                 Officer W-2 Salary           Schedule K-1
      (15.3% SE Tax)              (Net Profit onto 1040)             (FICA Withholding 7.65%)    (Pass-Through Profit)
              │                           │                                 │                           │
              │                           │                                 │                    (0% SE Tax!)
              └─────────────┬─────────────┘                                 └─────────────┬─────────────┘
                            │                                                             │
                            ▼                                                             ▼
              ┌───────────────────────────┐                                 ┌───────────────────────────┐
              │     Personal Form 1040    │                                 │     Personal Form 1040    │
              │ Total Tax & Refund/Due    │                                 │ W-2 (Line 1a) + Sched E K1│
              └───────────────────────────┘                                 └───────────────────────────┘
```

### Entity Comparison Matrix

| Regulatory Factor | Sole Proprietorship | Single-Member LLC (SMLLC) | LLC with S-Corp Election |
| :--- | :--- | :--- | :--- |
| **Federal Classification** | Individual trade or business | Disregarded Entity (taxed as Sole Prop) | Corporation under Subchapter S |
| **Primary Federal Forms** | Form 1040 + Schedule C + Schedule SE | Form 1040 + Schedule C + Schedule SE | Form 1120-S + Schedule K-1 + Personal 1040 |
| **Statutory Deadlines** | April 15 | April 15 | **March 15 (Corporate)** / April 15 (Personal) |
| **Self-Employment Tax** | 15.3% on 92.35% of net profit | 15.3% on 92.35% of net profit | **0% on K-1 profit distributions**; 15.3% FICA on W-2 salary only |
| **Owner Compensation** | Owner's draws (non-deductible) | Owner's draws (non-deductible) | Reasonable W-2 Officer Salary + Distributions |
| **Business Loss Rules** | Offsets W-2 wages and other income | Offsets W-2 wages and other income | Pass-through loss limited by shareholder basis |
| **Administrative Burden** | Minimal (single tax return) | Low (annual state report/franchise tax) | High (payroll filings, 941s, corporate return) |
| **Ideal Financial Profile** | First-year businesses, net profit < $60k | Liability protection with simple taxes | Consistent net profits exceeding $70k–$80k |

---

## 3. Pure Mathematical Calculation Engine (`taxCalculator.ts`)

The tax engine located in [src/utils/taxCalculator.ts](../src/utils/taxCalculator.ts) is a pure, side-effect-free TypeScript mathematical library.

### 3.1 Federal Progressive Tax Brackets (2024 & 2025)

The engine models progressive tax brackets across all four filing statuses (`single`, `married_joint`, `married_separate`, `head_of_household`):

#### 2025 Tax Year Brackets
- **Standard Deductions**: Single: `$15,000` | Married Filing Jointly: `$30,000` | Married Filing Separately: `$15,000` | Head of Household: `$22,500`

| Bracket Rate | Single Filers | Married Filing Jointly | Married Filing Separately | Head of Household |
| :--- | :--- | :--- | :--- | :--- |
| **10%** | $0 – $11,925 | $0 – $23,850 | $0 – $11,925 | $0 – $17,000 |
| **12%** | $11,925 – $48,475 | $23,850 – $96,950 | $11,925 – $48,475 | $17,000 – $64,850 |
| **22%** | $48,475 – $103,350 | $96,950 – $206,700 | $48,475 – $103,350 | $64,850 – $103,350 |
| **24%** | $103,350 – $197,300 | $206,700 – $394,600 | $103,350 – $197,300 | $103,350 – $197,300 |
| **32%** | $197,300 – $250,525 | $394,600 – $501,050 | $197,300 – $250,525 | $197,300 – $250,500 |
| **35%** | $250,525 – $626,350 | $501,050 – $751,600 | $250,525 – $375,800 | $250,500 – $626,350 |
| **37%** | Over $626,350 | Over $751,600 | Over $375,800 | Over $626,350 |

#### 2024 Tax Year Brackets
- **Standard Deductions**: Single: `$14,600` | Married Filing Jointly: `$29,200` | Married Filing Separately: `$14,600` | Head of Household: `$21,900`

---

### 3.2 Vehicle Deduction Optimization Algorithm

The vehicle optimizer automatically evaluates both allowable IRS methods and selects the greatest tax deduction:

$$\text{Method A (Standard Mileage)} = \text{Business Miles} \times \text{Rate}$$
$$\text{Rate}_{2025} = \$0.70/\text{mile}, \quad \text{Rate}_{2024} = \$0.67/\text{mile}$$

$$\text{Method B (Actual Vehicle Expenses)} = \text{Gasoline} + \text{Repairs/Maintenance} + \text{Auto Insurance} + \text{Depreciation}$$

$$\text{Total Vehicle Deduction} = \max(\text{Method A}, \text{Method B}) + \text{Parking Fees} + \text{Tolls}$$

*Statutory Rule: Parking fees and bridge/highway tolls incurred for business are 100% deductible on top of whichever method is chosen.*

---

### 3.3 Schedule C Gross Profit & Net Business Income

- **Gross Receipts (Part I, Line 1)**:
  $$\text{Gross Receipts} = \text{Tracked Invoiced Revenue} + \text{Additional 1099/Cash Income}$$
- **Gross Profit (Part I, Line 7)**:
  $$\text{Gross Profit} = \max(0, \text{Gross Receipts} - \text{Returns \& Allowances} - \text{Cost of Goods Sold})$$
- **Allowable Deductions (Part II, Line 28)**:
  $$\text{Total Deductions} = \sum \text{Itemized Lines}$$
  - Business Meals (Line 24b) are capped at **50%** under IRC §274(n).
  - Simplified Home Office (Line 30) = $\min(300, \text{Square Footage}) \times \$5.00/\text{sq ft}$.
- **Net Business Profit or Loss (Line 31)**:
  $$\text{Net Business Profit} = \text{Gross Profit} - \text{Total Deductions}$$

---

### 3.4 Self-Employment Tax (Schedule SE)

Self-employment tax applies when $\text{Net Business Profit} \ge \$400.00$. If net profit is negative (a net loss), self-employment tax is exactly **$0.00**.

1. **Net Earnings Subject to SECA**:
   $$\text{SE Earnings} = \max(0, \text{Net Profit} \times 0.9235)$$

2. **Social Security Wage Cap Reduction**:
   $$\text{Remaining Cap} = \max(0, \text{OASDI Cap} - \text{W-2 Box 3 Wages})$$
   $$\text{OASDI Cap}_{2025} = \$176,100, \quad \text{OASDI Cap}_{2024} = \$168,600$$

3. **Tax Computations**:
   $$\text{Social Security Tax (12.4%)} = \min(\text{SE Earnings}, \text{Remaining Cap}) \times 0.124$$
   $$\text{Medicare Tax (2.9%)} = \text{SE Earnings} \times 0.029$$
   $$\text{Additional Medicare (0.9%)} = \max(0, \text{SE Earnings} + \text{W-2 Wages} - \text{Threshold}) \times 0.009$$
   $$\text{Total SE Tax} = \text{Social Security Tax} + \text{Medicare Tax} + \text{Additional Medicare Tax}$$

4. **Above-the-Line Deduction**:
   $$\text{Schedule 1 Line 15 Deduction} = \frac{\text{Social Security Tax} + \text{Medicare Tax}}{2}$$

---

### 3.5 Form 1040 & Schedule 1 Personal Income Reconciliation

The system reconciles all personal and business income onto Form 1040:

1. **Total Income (Form 1040 Line 9)**:
   $$\text{Total Income} = \text{W-2 Box 1 Wages} + \text{Schedule C Net Profit (positive or negative)}$$
2. **Schedule 1 Adjustments to Income (Line 26)**:
   $$\text{Adjustments} = \text{50% SE Tax} + \text{SE Health Insurance (§162(l))} + \text{Retirement Contributions}$$
3. **Adjusted Gross Income (AGI, Form 1040 Line 11)**:
   $$\text{AGI} = \text{Total Income} - \text{Schedule 1 Adjustments}$$
4. **Qualified Business Income (QBI) Deduction (§199A)**:
   $$\text{QBI Deduction} = \min(0.20 \times \max(0, \text{Net Profit} - \text{50% SE Tax} - \text{SE Health Ins}), 0.20 \times (\text{AGI} - \text{Standard Deduction}))$$
5. **Taxable Income (Form 1040 Line 15)**:
   $$\text{Taxable Income} = \max(0, \text{AGI} - \text{Standard Deduction} - \text{QBI Deduction})$$
6. **Total Federal Tax Liability**:
   $$\text{Total Liability} = \text{Income Tax (via progressive brackets)} + \text{Self-Employment Tax}$$
7. **Net Position (Refund or Balance Due)**:
   $$\text{Net Position} = (\text{W-2 Box 2 Withholding} + \text{Estimated Payments Made}) - \text{Total Liability}$$

---

### 3.6 Statutory Safe Harbor & Form 1040-ES Quarterly Vouchers

Under IRC §6654, taxpayers avoid underpayment penalties if quarterly payments satisfy the statutory safe-harbor minimum:

1. **Rule 1 (Current Year)**: 90% of current year total tax liability.
2. **Rule 2 (Prior Year)**: 100% of prior year total tax liability (increased to **110%** if prior year AGI exceeded $150,000 for married joint filers or $75,000 for single filers).

$$\text{Required Annual Payment} = \min(\text{90% Current Year}, \text{Safe Harbor Prior Year})$$
$$\text{Quarterly Voucher Installment} = \frac{\text{Required Annual Payment}}{4}$$

#### Quarterly Voucher Schedule
- **Voucher 1**: Due **April 15**
- **Voucher 2**: Due **June 15**
- **Voucher 3**: Due **September 15**
- **Voucher 4**: Due **January 15** (following calendar year)

---

## 4. First-Time Beginner Tax Filing Blueprint

For individuals transitioning from W-2 employment to self-employment, filing federal taxes involves unfamiliar concepts. GlassExpense provides an embedded educational blueprint on the **Overview** tab.

### 4.1 Understanding Net Losses (Negative Net Profit)

When allowable business write-offs exceed gross receipts, the business operates at a **Net Loss** (Schedule C Line 31 is negative).

#### The Three Rules of Filing with a Net Loss:

1. **Self-Employment Tax is $0.00**:
   - You only pay the 15.3% SECA tax if your business earns a net profit exceeding $400.
   - If your business loses money, **you owe zero self-employment tax**.

2. **Schedule C Line 32a Checkbox ("All investment is at risk")**:
   - If you funded your business using your own savings or personally guaranteed loans, check **Box 32a**.
   - Checking 32a permits the full business loss to flow onto your personal tax return without restriction under IRC §465.

3. **Loss Offsets W-2 Wages to Maximize Your Tax Refund**:
   - If you worked a W-2 job during the same tax year (or your spouse works a W-2 job filing jointly), your business loss flows through **Schedule 1 Line 8** onto **Form 1040 Line 8**.
   - The negative business loss **directly reduces your total personal taxable income**.
   - Because your employer already withheld taxes based on your full W-2 salary, reducing your taxable income means you overpaid federal taxes.
   - **Result**: The IRS issues a **larger cash refund check** directly into your bank account.

```
Example:
- W-2 Job Wages: $45,000 (Taxes Withheld by Employer: $4,200)
- GlassExpense Net Business Loss: -$8,000
- Adjusted Total Income: $45,000 + (-$8,000) = $37,000
- Standard Deduction: -$15,000
- Final Taxable Income: $22,000
- Actual Total Tax Liability: ~$2,200
- Taxes Already Paid (Withholding): $4,200
- Net Refund Received from IRS: $2,000!
```

---

### 4.2 Translation Table: GlassExpense UI to Official Tax Forms

When using tax preparation software (TurboTax, FreeTaxUSA, H&R Block, TaxSlayer) or paper IRS forms, map GlassExpense values as follows:

| GlassExpense Metric | Tax Form Destination | Software Interview Question |
| :--- | :--- | :--- |
| **Gross Receipts** | Schedule C, Line 1 | *"What were your total business income or 1099-NEC payments?"* |
| **Returns & Allowances** | Schedule C, Line 2 | *"Did you have customer refunds, rebates, or chargebacks?"* |
| **Cost of Goods Sold** | Schedule C, Line 4 / Part III | *"What did you spend on raw materials and resale inventory?"* |
| **Vehicle Deduction (Best)**| Schedule C, Line 9 / Part IV | *"Did you use a vehicle for business? Enter total miles or actual expenses."* |
| **Advertising** | Schedule C, Line 8 | *"Advertising, social media marketing, business cards, domains"* |
| **Contract Labor** | Schedule C, Line 11 | *"Payments to 1099 subcontractors or independent specialists"* |
| **Supplies** | Schedule C, Line 22 | *"Job materials, consumable tools, safety gear, office supplies"* |
| **50% Business Meals** | Schedule C, Line 24b | *"Meals with clients or travel meal expenditures (enter 100%; software applies 50%)"* |
| **Other Expenses (Software)**| Schedule C, Line 27a | *"Software subscriptions, cloud hosting, SaaS platforms, memberships"* |
| **Simplified Home Office** | Schedule C, Line 30 | *"Did you maintain a dedicated home office? Enter square footage (max 300)."* |
| **Net Business Profit/Loss**| Schedule C, Line 31 ➔ Sched 1 Line 8 | Form automatically transfers Line 31 into Form 1040 Schedule 1. |
| **W-2 Gross Wages** | Form 1040, Line 1a | *"Enter Box 1 from your Form W-2."* |
| **W-2 Federal Withholding** | Form 1040, Line 25a | *"Enter Box 2 from your Form W-2."* |
| **Quarterly Payments Made** | Form 1040, Line 26 | *"Did you make estimated quarterly tax payments with Form 1040-ES?"* |

---

## 5. Schedule C Categorization Matrix & Heuristic Engine

Expenses in GlassExpense are categorized through a 3-tier hierarchy:
1. **Explicit Expense Override**: Manually set by the user via `expense_tax_mappings`. Overrides are **per user** (`PRIMARY KEY (expense_id, user_id)`): when several members share a job, one member's re-categorisation never changes another member's Schedule C. Only lines listed in `SCHEDULE_C_LINE_METADATA` are accepted.
2. **Tag-Level Mapping**: Configured in `tag_tax_mappings` for custom project tags.
3. **Keyword Heuristic Engine**: Automated pattern matching on receipt descriptions and merchant names.

### IRS Line Taxonomy & Heuristics

| Schedule C Line | Line Description | Statutory Limitations & Inclusions | Default Heuristic Keyword Triggers |
| :--- | :--- | :--- | :--- |
| **Line 8** | Advertising & Marketing | Business cards, online ads, website domains, branding | `ad`, `marketing`, `facebook ads`, `google ads`, `billboard`, `flyer`, `domain` |
| **Line 9** | Vehicle & Truck Expenses | Gas, auto repair, oil, insurance, or IRS standard mileage | `gas`, `fuel`, `oil change`, `auto repair`, `mechanic`, `tires`, `car insurance` |
| **Line 10** | Commissions & Fees | Merchant processing fees, referral payments | `stripe fee`, `paypal fee`, `square fee`, `brokerage`, `commission` |
| **Line 11** | Contract Labor | Payments to independent 1099 contractors | `subcontractor`, `laborer`, `contractor`, `freelancer`, `temp` |
| **Line 13** | Depreciation & §179 | Heavy machinery, equipment assets > $2,500 | `depreciation`, `section 179`, `capital equipment` |
| **Line 14** | Employee Benefit Programs | Health plans and education for non-owner employees | `employee health`, `group plan`, `staff benefit` |
| **Line 15** | Insurance (Other than Health)| General liability, professional errors & omissions (E&O) | `liability insurance`, `commercial insurance`, `bop`, `worker's comp` |
| **Line 16a/b**| Mortgage / Business Interest| Interest on commercial mortgages or business loans | `loan interest`, `credit card interest`, `line of credit interest` |
| **Line 17** | Legal & Professional Services| CPA fees, bookkeeping, legal counsel, compliance | `legal`, `lawyer`, `cpa`, `accountant`, `bookkeeper`, `attorney` |
| **Line 18** | Office Expense | Stationery, printer ink, postage, office supplies | `postage`, `stamps`, `office depot`, `staples`, `pens`, `printer ink` |
| **Line 20a/b**| Rent or Lease (Vehicles/Machinery/Office)| Commercial rent, scaffolding rentals, vehicle leasing | `rent`, `lease`, `equipment rental`, `storage unit`, `sunbelt`, `united rentals` |
| **Line 21** | Repairs & Maintenance | Building maintenance, tool sharpening, equipment upkeep | `repair`, `maintenance`, `servicing`, `plumber`, `electrician` |
| **Line 22** | Supplies | Materials consumed on jobs, safety gear, small tools | `supplies`, `hardware`, `home depot`, `lowes`, `fastenal`, `grainger`, `harbor freight` |
| **Line 23** | Taxes & Licenses | State business licenses, permits, local trade fees | `permit`, `city license`, `state filing`, `trade license`, `inspection fee` |
| **Line 24a** | Travel | Airfare, lodging, rideshare during overnight business trips | `hotel`, `motel`, `airbnb`, `flight`, `airline`, `uber`, `lyft`, `car rental` |
| **Line 24b** | Deductible Business Meals | Meals with clients or business partners (Capped at 50%) | `restaurant`, `dinner`, `lunch`, `coffee`, `starbucks`, `cafe`, `meal`, `doordash` |
| **Line 25** | Utilities | Commercial electricity, job site water, business phone | `electric`, `water`, `trash`, `cell phone`, `verizon`, `at&t`, `t-mobile`, `internet` |
| **Line 26** | Wages (Less Employment Credits)| W-2 salaries paid to non-owner employees | `payroll`, `employee wages`, `hourly staff` |
| **Line 27a** | Other Expenses / Software SaaS| Cloud subscriptions, business software, dues | `software`, `github`, `adobe`, `aws`, `digitalocean`, `subscription`, `saas` |
| **Line 30** | Simplified Home Office | Simplified deduction: $\min(300, \text{sq ft}) \times \$5$ | Calculated automatically from user profile settings |

---

## 6. Database Schema & Data Models

The tax subsystem extends SQLite in [db.ts](../server/db.ts) with four specialized relational tables:

```sql
-- 1. User Tax Profile & Quarterly Payments
CREATE TABLE IF NOT EXISTS tax_settings (
  user_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  entity_type TEXT DEFAULT 'sole_proprietorship', -- 'sole_proprietorship', 'llc_single_member', 'llc_scorp'
  filing_status TEXT DEFAULT 'single',             -- 'single', 'married_joint', 'married_separate', 'head_of_household'
  business_miles REAL DEFAULT 0,
  vehicle_deduction_method TEXT DEFAULT 'auto_best', -- 'auto_best', 'standard_mileage', 'actual_expenses'
  home_office_sqft REAL DEFAULT 0,
  scorp_officer_salary REAL DEFAULT 0,
  estimated_tax_payments_made REAL DEFAULT 0,
  retirement_contributions REAL DEFAULT 0,
  additional_gross_income REAL DEFAULT 0,
  returns_and_allowances REAL DEFAULT 0,
  cost_of_goods_sold REAL DEFAULT 0,
  self_employed_health_insurance REAL DEFAULT 0,
  prior_year_tax_liability REAL DEFAULT 0,
  q1_payment_made REAL DEFAULT 0,
  q2_payment_made REAL DEFAULT 0,
  q3_payment_made REAL DEFAULT 0,
  q4_payment_made REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tax_year)
);

-- 2. Ingested W-2 Wage Statements
CREATE TABLE IF NOT EXISTS w2_forms (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  employer_name TEXT NOT NULL,
  wages_box1 REAL NOT NULL,
  fed_withholding_box2 REAL NOT NULL,
  ss_wages_box3 REAL DEFAULT 0,
  ss_tax_box4 REAL DEFAULT 0,
  medicare_wages_box5 REAL DEFAULT 0,
  medicare_tax_box6 REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_w2_forms_user_year ON w2_forms(user_id, tax_year);

-- 3. Tag-to-Schedule-C Line Mappings
CREATE TABLE IF NOT EXISTS tag_tax_mappings (
  tag_id TEXT PRIMARY KEY,
  schedule_c_line TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Granular Per-Expense Overrides
CREATE TABLE IF NOT EXISTS expense_tax_mappings (
  expense_id TEXT NOT NULL,
  user_id TEXT NOT NULL,                 -- overrides are scoped per user
  schedule_c_line TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (expense_id, user_id),
  FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_tax_mappings_user ON expense_tax_mappings(user_id, expense_id);
```

---

## 7. Backend REST API Specifications

All endpoints are registered in [server.ts](../server/index.ts) and require a valid Bearer JWT header.

### 7.1 `GET /api/taxes/profile?year=YYYY`
Fetches the user's active tax configuration, filing status, ingested W-2s, and tag mappings for the specified tax year.

#### Response (200 OK)
```json
{
  "settings": {
    "user_id": "7931ab9c-b9b9-40c3-a8de-4bbb39919e32",
    "tax_year": 2025,
    "entity_type": "sole_proprietorship",
    "filing_status": "single",
    "business_miles": 1250,
    "vehicle_deduction_method": "auto_best",
    "home_office_sqft": 150,
    "scorp_officer_salary": 0,
    "additional_gross_income": 0,
    "returns_and_allowances": 0,
    "cost_of_goods_sold": 0,
    "self_employed_health_insurance": 0,
    "prior_year_tax_liability": 4500,
    "q1_payment_made": 500,
    "q2_payment_made": 0,
    "q3_payment_made": 0,
    "q4_payment_made": 0
  },
  "w2Forms": [],
  "accessibleJobs": [{ "id": "job-1", "title": "Downtown Glazing" }],
  "tagMappings": [{ "tag_id": "tag-materials", "schedule_c_line": "line_22_supplies" }],
  "availableTags": [{ "id": "tag-materials", "name": "Materials", "color": "#10b981" }]
}
```

---

### 7.2 `POST /api/taxes/profile`
Persists user tax settings, safe-harbor baseline, and quarterly payment receipts.

#### Request Body
```json
{
  "year": 2025,
  "entity_type": "sole_proprietorship",
  "filing_status": "single",
  "business_miles": 1500,
  "vehicle_deduction_method": "auto_best",
  "home_office_sqft": 200,
  "scorp_officer_salary": 0,
  "additional_gross_income": 1200,
  "returns_and_allowances": 150,
  "cost_of_goods_sold": 350,
  "self_employed_health_insurance": 1200,
  "prior_year_tax_liability": 3800,
  "q1_payment_made": 800,
  "q2_payment_made": 800,
  "q3_payment_made": 0,
  "q4_payment_made": 0
}
```

---

### 7.3 `GET /api/taxes/calculate?year=YYYY`
Executes complete tax calculation across all accessible jobs (including archived jobs within the date range). Returns Schedule C breakdown, Schedule SE, Form 1040 reconciliation, safe-harbor analysis, quarterly vouchers, and itemized transaction lists.

#### Key Response Structure
```json
{
  "success": true,
  "calculation": {
    "year": 2025,
    "filingStatus": "single",
    "entityType": "sole_proprietorship",
    "scheduleC": {
      "grossReceipts": 45200.00,
      "returnsAndAllowances": 150.00,
      "costOfGoodsSold": 350.00,
      "grossProfit": 44700.00,
      "totalDeductions": 12430.50,
      "netBusinessProfit": 32269.50,
      "lines": {
        "line_8_advertising": { "total": 450.00, "count": 2 },
        "line_9_vehicle": { "total": 1050.00, "count": 1 },
        "line_22_supplies": { "total": 8500.00, "count": 14 },
        "line_24b_meals_deductible": { "total": 380.50, "count": 6 },
        "line_30_home_office": { "total": 1000.00, "count": 1 }
      }
    },
    "vehicle": {
      "businessMiles": 1500,
      "mileageRate": 0.70,
      "standardMileageDeduction": 1050.00,
      "actualExpensesDeduction": 820.00,
      "chosenMethod": "standard_mileage",
      "bestDeduction": 1050.00
    },
    "scheduleSE": {
      "netSubjectToSE": 29799.88,
      "socialSecurityTax": 3695.19,
      "medicareTax": 864.20,
      "additionalMedicareTax": 0.00,
      "totalSelfEmploymentTax": 4559.39,
      "deductiblePortionOn1040": 2279.69
    },
    "form1040": {
      "totalW2Wages": 0.00,
      "scheduleCNetProfit": 32269.50,
      "grossIncome": 32269.50,
      "aboveTheLineDeductions": 3479.69,
      "adjustedGrossIncome": 28789.81,
      "standardDeduction": 15000.00,
      "qbiDeduction": 5757.96,
      "taxableIncome": 8031.85,
      "federalIncomeTax": 803.19,
      "totalFederalTaxLiability": 5362.58,
      "estimatedTaxPaymentsMade": 1600.00,
      "netTaxDue": 3762.58,
      "estimatedRefund": 0.00
    },
    "form1040ES": {
      "currentYearLiability": 5362.58,
      "priorYearLiability": 3800.00,
      "annualSafeHarborTarget": 3800.00,
      "quarterlyInstallmentTarget": 950.00,
      "vouchers": [
        { "quarter": "Q1", "dueDate": "April 15, 2025", "amount": 950.00, "paid": 800.00, "status": "Underpaid" },
        { "quarter": "Q2", "dueDate": "June 15, 2025", "amount": 950.00, "paid": 800.00, "status": "Underpaid" },
        { "quarter": "Q3", "dueDate": "September 15, 2025", "amount": 950.00, "paid": 0.00, "status": "Due" },
        { "quarter": "Q4", "dueDate": "January 15, 2026", "amount": 950.00, "paid": 0.00, "status": "Due" }
      ]
    }
  },
  "transactions": [...],
  "jobBreakdown": [...],
  "totalReceiptsCount": 23
}
```

---

### 7.4 `POST /api/taxes/reassign-expense`
Reassigns an individual expense to an official Schedule C line.
- **Request**: `{ "expense_id": "exp-123", "schedule_c_line": "line_18_office" }`
- **Behavior**: Upserts into `expense_tax_mappings`. If `schedule_c_line === 'auto'`, deletes the override and restores heuristic tagging.

### 7.5 `POST /api/taxes/reassign-expenses-batch`
Executes multiple reassignments in a single atomic SQLite transaction.
- **Request**: `{ "assignments": [{ "expense_id": "exp-1", "schedule_c_line": "line_22_supplies" }, { "expense_id": "exp-2", "schedule_c_line": "line_8_advertising" }] }`
- **Response**: `{ "success": true, "reassignedCount": 2 }`

### 7.6 `GET /api/taxes/unclaimed-suggestions?year=YYYY`
Scans expenses lacking attached tags and manual overrides (`et.tag_id IS NULL AND etm.expense_id IS NULL`). Matches merchant names and keywords against common deductible categories.
- **Response**:
```json
{
  "suggestions": [
    {
      "expenseId": "exp-45",
      "description": "Home Depot - Sheetrock and Screws",
      "amount": 284.50,
      "date": "2025-03-12",
      "jobTitle": "Highland Remodel",
      "suggestedLine": "line_22_supplies",
      "lineTitle": "Supplies & Job Materials (Line 22)",
      "reason": "Matches merchant keywords: home depot",
      "estimatedTaxSavings": 43.53
    }
  ]
}
```

---

## 8. Frontend Tax Center Architecture (`TaxCenter.tsx`)

The frontend Tax Center is located in [src/pages/TaxCenter.tsx](../src/pages/TaxCenter.tsx).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                TAX CENTER HEADER & CONTROLS                            │
│  [ Tax Year: 2025 ▼ ]  [ Status: Single ▼ ]  [ Entity: Sole Prop ▼ ]  [ Job Filter ▼ ] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                  HERO METRIC CARDS                                     │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────────────┐ │
│  │ Est. Refund / Due     │ │ Schedule C Deductions │ │ Adjusted Gross Income (AGI)   │ │
│  │  +$1,450.00 (Refund!) │ │  $14,820.00 (24 Items)│ │  $32,400.00 (Effective 11.2%) │ │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  💡 DEDUCTION DISCOVERY BANNER: Found 6 untagged write-offs ($840 value). [Review]    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  [ Overview ]  [ Schedule C & Write-Offs ]  [ Sole Prop Forms ]  [ 1040-ES ]  [ Export]│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Tab Breakdown

1. **Tax Overview & Progressive Brackets**:
   - Progressive bracket staircase illustrating marginal vs. effective tax rates.
   - Statutory deductions summary (Standard deduction and QBI §199A deduction).
   - **First-Time Self-Employed Tax Filing Blueprint**: Interactive 3-way toggle (Sole Prop, LLC, S-Corp) explaining forms to file, live numbers, and net loss mechanics.

2. **Schedule C & Write-Offs**:
   - **Part I Gross Income Adjustments**: Tracked revenue, cash/1099 additions, returns & allowances, and COGS.
   - **Vehicle Optimizer**: Side-by-side comparison of Method A ($0.70/mi) vs. Method B (Actual Expenses) with parking/tolls addition.
   - **Interactive Line Accordion**: Expandable categories listing each itemized expense, transaction date, job, amount, receipt preview button, and category reassignment dropdown.

3. **Sole Proprietor Tax Forms Hub**:
   - **Digital Schedule C**: Fully formatted digital reproduction of Form 1040 Schedule C Part I, Part II, Part III with calculated line values.
   - **Digital Schedule SE**: Line-by-line self-employment tax worksheet with OASDI cap limits.
   - **Digital Form 1040 & Schedule 1**: Personal income reconciliation, health insurance deduction (§162(l)), and tax liability tally.
   - **Digital Form 1040-ES**: Safe-harbor target calculator and 4 quarterly vouchers with payment inputs.

4. **W-2 Ingestion & Management**:
   - Drag-and-drop OCR scanner for paper W-2 wage statements.
   - Manual modal entry for Box 1 wages, Box 2 withholding, and FICA withholdings.

5. **Form 1040-ES Quarterly Vouchers**:
   - Statutory safe-harbor analysis (90% current year vs 100%/110% prior year).
   - 4 installment vouchers with direct IRS Direct Pay links and payment inputs.

6. **IRS Submission Package & Audit Ledger**:
   - **"Export CSV"**: Formatted spreadsheet export for CPAs and bookkeepers.
   - **"Preview Tax Package"**: Modal displaying full filing summary with line-by-line totals.
   - **"Print Tax Package"**: High-contrast, clean printable layout targeted via `#printable-tax-area` print CSS.
   - **Receipt Audit Defense Gallery**: Zero-knowledge in-browser decryption of attached receipt images.

---

## 9. IRS Audit Defense & Zero-Knowledge Verification

GlassExpense adheres to strict IRS audit defense standards (Revenue Procedure 98-25 and IRS Publication 583) without compromising user privacy:

1. **Zero-Knowledge Security**:
   - Receipt files are encrypted on the client device with AES-GCM-256 before upload.
   - The server never possesses plaintext receipt files or user encryption keys.

2. **In-Browser Decryption for Audits**:
   - In the **IRS Submission Package & Audit Ledger**, the client uses the user's Master Key to unwrap job encryption keys directly in browser memory.
   - Decrypted receipts render as temporary object URLs in an inline audit gallery.

3. **Audit Ledger Completeness**:
   - Every deductible transaction includes: Date, Merchant/Description, Project/Client Name, Schedule C Line Item, Deductible Amount, and Verified Receipt Timestamp.
   - The ledger can be printed or exported as a PDF package containing all receipt images alongside the Schedule C line reconciliation.

---

## Income from invoices and sales tax collected

Invoice totals alone **never** count as income. Income is created only when you press **Record payment** on a final invoice, which adds an income entry to the job (with an id derived from the invoice and payment, so two devices cannot post it twice). The Tax Center already sums income entries, so these payments flow into gross receipts like any other income.

- **No tax on the invoice:** the income entry equals the payment.
- **Tax on the invoice:** the tax portion of each payment, `round(payment × tax ÷ grand total, 2)`, is split out. By default the income entry is the payment **minus** that portion (money owed to the state is not your revenue); a per-user setting (Settings → Invoices → Sales tax) books the full payment instead if your accountant wants gross receipts. Example: $100 + 6% tax = $106; paying $106 books $100 income and $6 tax collected; paying $53 first books $50 and $3.
- The tax collected per payment is stored on the invoice and can be summed per period for remittance (`salesTaxCollected` in `src/invoice/salestax.ts`).

This is bookkeeping logic, not tax advice. Users who charge sales tax should confirm the treatment with their accountant.
