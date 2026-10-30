/**
 * Pure Mathematical Tax Calculation & Schedule C / SE / 1120-S Engine
 * Supports Sole Proprietorships, Single-Member LLCs, and LLC + S-Corp Elections.
 */

export type TaxYear = 2024 | 2025 | 2026;
export type FilingStatus = 'single' | 'mfj' | 'hoh' | 'mfs';
export type EntityType = 'sole_proprietorship' | 'single_member_llc' | 'llc_scorp';
export type VehicleDeductionMethod = 'auto_best' | 'standard_mileage' | 'actual_expenses';

export type ScheduleCLine =
  | 'line_8_advertising'
  | 'line_9_vehicle'
  | 'line_10_commissions'
  | 'line_11_contract_labor'
  | 'line_15_insurance'
  | 'line_17_legal'
  | 'line_18_office'
  | 'line_20_rent'
  | 'line_21_repairs'
  | 'line_22_supplies'
  | 'line_23_taxes'
  | 'line_24a_travel'
  | 'line_24b_meals'
  | 'line_25_utilities'
  | 'line_27a_other'
  | 'line_30_home_office';

export interface ScheduleCLineMeta {
  line: ScheduleCLine;
  lineNumber: string;
  title: string;
  irsDescription: string;
  deductibilityRule: string;
  isFiftyPercentMeal?: boolean;
  examples: string[];
  tooltip: string;
}

export const SCHEDULE_C_LINE_METADATA: Record<ScheduleCLine, ScheduleCLineMeta> = {
  line_8_advertising: {
    line: 'line_8_advertising',
    lineNumber: 'Line 8',
    title: 'Advertising & Marketing',
    irsDescription: 'Advertising expenses directly related to business activities',
    deductibilityRule: '100% deductible',
    examples: ['Website hosting & domain names', 'Google & Meta advertising', 'Business cards & flyers', 'Branded company merchandise & apparel', 'SEO services & directory listings'],
    tooltip: 'Promoting your business, brand, products, or job services is fully writeable.'
  },
  line_9_vehicle: {
    line: 'line_9_vehicle',
    lineNumber: 'Line 9',
    title: 'Car & Truck Expenses',
    irsDescription: 'Business use of vehicles via standard mileage rate or actual operational costs',
    deductibilityRule: 'Standard mileage rate ($0.70/mi) OR actual gas/repairs, plus 100% parking & tolls',
    examples: ['Business mileage driven to client sites', 'Gasoline & diesel expenditures', 'Oil changes & scheduled vehicle maintenance', 'Commercial auto insurance & registration', 'Jobsite parking & highway tolls'],
    tooltip: 'GlassExpense automatically compares your mileage against actual gas/repairs to pick the highest tax write-off!'
  },
  line_10_commissions: {
    line: 'line_10_commissions',
    lineNumber: 'Line 10',
    title: 'Commissions & Processing Fees',
    irsDescription: 'Fees paid to third parties for sales, merchant processing, or client acquisition',
    deductibilityRule: '100% deductible',
    examples: ['Stripe, Square, and PayPal card processing fees', 'Merchant transaction fees', 'Platform service fees (Upwork, Fiverr)', 'Sales commissions paid to agents'],
    tooltip: 'Every dollar payment processors take from your client payouts is deductible here.'
  },
  line_11_contract_labor: {
    line: 'line_11_contract_labor',
    lineNumber: 'Line 11',
    title: 'Contract Labor',
    irsDescription: 'Payments to non-employee independent contractors and trade helpers',
    deductibilityRule: '100% deductible (Requires 1099-NEC if >= $600 paid in year)',
    examples: ['Subcontractors on construction jobs', 'Freelance software developers & designers', 'Day labor & field hired hands', 'Specialist trade consultants'],
    tooltip: 'Deduct payments to freelancers and subs. Remember to issue a Form 1099-NEC if you pay them $600 or more!'
  },
  line_15_insurance: {
    line: 'line_15_insurance',
    lineNumber: 'Line 15',
    title: 'Insurance (Other than Health)',
    irsDescription: 'Commercial and professional business insurance premiums',
    deductibilityRule: '100% deductible',
    examples: ['General liability insurance', 'Professional liability / Errors & Omissions (E&O)', 'Commercial property coverage', 'Tool & equipment inland marine policies'],
    tooltip: 'Policies that shield your business operations. (Self-employed health insurance is deducted on Form 1040 Schedule 1).'
  },
  line_17_legal: {
    line: 'line_17_legal',
    lineNumber: 'Line 17',
    title: 'Legal & Professional Services',
    irsDescription: 'Professional fees paid to attorneys, CPAs, accountants, and consultants',
    deductibilityRule: '100% deductible',
    examples: ['CPA tax preparation & advice fees', 'Bookkeeping & accounting retainer', 'Attorney legal fees for contracts or IP', 'LLC formation legal fees'],
    tooltip: 'Fees you pay for expert counsel, tax compliance, or bookkeeping.'
  },
  line_18_office: {
    line: 'line_18_office',
    lineNumber: 'Line 18',
    title: 'Office Expense & Software',
    irsDescription: 'Operating supplies, communication tools, and cloud business subscriptions',
    deductibilityRule: '100% deductible',
    examples: ['GlassExpense subscription', 'Zoom, Slack, and Google Workspace', 'Printer paper, ink cartridges, and pens', 'Postage, envelopes, and shipping labels', 'Cloud servers and software development tools'],
    tooltip: 'Your day-to-day administrative supplies and modern cloud subscriptions are fully writeable.'
  },
  line_20_rent: {
    line: 'line_20_rent',
    lineNumber: 'Line 20',
    title: 'Rent or Lease (Vehicles, Machinery, Workspace)',
    irsDescription: 'Rentals of business machinery, construction equipment, storage, or commercial space',
    deductibilityRule: '100% deductible',
    examples: ['Power equipment and tool rentals (Home Depot, Sunbelt)', 'Storage units for tools or job materials', 'Coworking space desk or private office rent', 'Scaffolding, lift, and generator leases'],
    tooltip: 'Rent paid on tools, storage facilities, or business workspaces.'
  },
  line_21_repairs: {
    line: 'line_21_repairs',
    lineNumber: 'Line 21',
    title: 'Repairs & Maintenance',
    irsDescription: 'Maintenance and repair costs to keep tools, computers, and property in working order',
    deductibilityRule: '100% deductible (repairs that do not prolong useful life into capital improvements)',
    examples: ['Power tool servicing and blade sharpening', 'Laptop screen or keyboard repair', 'Office air conditioning or plumbing servicing', 'Work equipment recalibration'],
    tooltip: 'Routine fixing and tuning of existing gear to keep them operating.'
  },
  line_22_supplies: {
    line: 'line_22_supplies',
    lineNumber: 'Line 22',
    title: 'Supplies & Job Materials',
    irsDescription: 'Consumable materials, hardware, and supplies used directly in your trade or jobs',
    deductibilityRule: '100% deductible',
    examples: ['Lumber, screws, pipes, and electrical wiring', 'Paint, primer, sandpaper, and brushes', 'Jobsite tape, safety goggles, and work gloves', 'Consumable parts used on client deliverables'],
    tooltip: 'Direct materials purchased for projects and consumable job supplies.'
  },
  line_23_taxes: {
    line: 'line_23_taxes',
    lineNumber: 'Line 23',
    title: 'Taxes & Licenses',
    irsDescription: 'State and local business taxes, regulatory licensing fees, and permit costs',
    deductibilityRule: '100% deductible',
    examples: ['State LLC annual franchise tax/report fees (e.g. CA $800, DE $300)', 'City business license renewals', 'Trade contractor licensing and certification fees', 'Building permits and inspection fees'],
    tooltip: 'Governmental and municipal fees required to legally practice your business.'
  },
  line_24a_travel: {
    line: 'line_24a_travel',
    lineNumber: 'Line 24a',
    title: 'Business Travel',
    irsDescription: 'Overnight business travel away from your tax home',
    deductibilityRule: '100% deductible',
    examples: ['Airline tickets & baggage fees', 'Train and bus fares', 'Hotels, motels, and Airbnb lodging', 'Rental cars and Uber/Lyft to job locations while traveling'],
    tooltip: 'Transportation and lodging costs incurred while traveling away from home on business.'
  },
  line_24b_meals: {
    line: 'line_24b_meals',
    lineNumber: 'Line 24b',
    title: 'Deductible Business Meals (50% Limit)',
    irsDescription: 'Meals with clients, customers, partners, or while traveling overnight for business',
    deductibilityRule: '50% limitation under IRC §274(n)',
    isFiftyPercentMeal: true,
    examples: ['Dinner with a prospective client to discuss bids', 'Lunch meeting with a subcontractor or partner', 'Meals while traveling away from home on business'],
    tooltip: 'Must have a clear business purpose. The IRS strictly limits meal deductions to 50%.'
  },
  line_25_utilities: {
    line: 'line_25_utilities',
    lineNumber: 'Line 25',
    title: 'Utilities & Communications',
    irsDescription: 'Utility and communications expenses used for business operations',
    deductibilityRule: '100% of dedicated business utilities, or business % of shared utilities',
    examples: ['Jobsite electricity or temporary power hookups', 'Dedicated business cell phone line', 'Business percentage of smartphone bill (e.g. 70%)', 'Business percentage of home internet'],
    tooltip: 'Power and data required to communicate and execute jobs.'
  },
  line_27a_other: {
    line: 'line_27a_other',
    lineNumber: 'Line 27a',
    title: 'Other Business Expenses (Safe Harbor Under $2,500)',
    irsDescription: 'De minimis tangible property election, trade books, courses, and bank fees',
    deductibilityRule: '100% deductible (Safe harbor election under IRC §1.263(a)-1(f))',
    examples: ['Tools, laptops, or equipment costing under $2,500 each', 'Professional trade publications & manuals', 'Continuing education & technical certification courses', 'Bank account monthly maintenance charges'],
    tooltip: 'De Minimis Safe Harbor: Write off equipment costing under $2,500 immediately instead of depreciating over years!'
  },
  line_30_home_office: {
    line: 'line_30_home_office',
    lineNumber: 'Line 30',
    title: 'Business Use of Home (Simplified Method)',
    irsDescription: 'Simplified home office deduction for exclusive and regular business use',
    deductibilityRule: '$5 per square foot up to 300 sq. ft. (Maximum $1,500 deduction)',
    examples: ['Dedicated spare bedroom used exclusively as office', 'Workshop or garage space dedicated to business inventory', '300 sq. ft. = $1,500 maximum direct deduction'],
    tooltip: 'No complicated utility tracking required: get $5 per square foot of dedicated office space!'
  }
};

export interface W2FormInput {
  id: string;
  employer_name: string;
  employer_ein?: string;
  is_scorp_officer_w2?: boolean;
  wages_box1: number;
  fed_withholding_box2: number;
  ss_wages_box3: number;
  ss_withholding_box4: number;
  medicare_wages_box5: number;
  medicare_withholding_box6: number;
  state_code?: string;
  state_wages_box16?: number;
  state_withholding_box17?: number;
}

export interface VehicleDeductionBreakdown {
  methodUsed: 'standard_mileage' | 'actual_expenses';
  milesDriven: number;
  mileageRate: number;
  standardMileageDeduction: number;
  actualGasAndFuel: number;
  actualMaintenance: number;
  actualInsurance: number;
  actualTotal: number;
  parkingAndTolls: number;
  totalVehicleDeduction: number;
  optimalMethod: 'standard_mileage' | 'actual_expenses';
  potentialAdvantage: number;
}

export interface ScheduleCItemSummary {
  line: ScheduleCLine;
  lineNumber: string;
  title: string;
  grossAmount: number;
  deductibleAmount: number;
  transactionCount: number;
  isFiftyPercentMeal: boolean;
  tooltip: string;
}

export interface TaxCalculationInput {
  taxYear: TaxYear;
  filingStatus: FilingStatus;
  entityType: EntityType;
  scorpOfficerSalary?: number;
  w2Forms: W2FormInput[];
  grossBusinessIncome: number;
  additionalGrossIncome?: number;
  returnsAndAllowances?: number;
  costOfGoodsSold?: number;
  expensesByLine: Record<string, { total: number; count: number }>;
  businessMiles?: number;
  vehicleMethod?: VehicleDeductionMethod;
  homeOfficeSqft?: number;
  actualVehicleReceipts?: {
    gas: number;
    maintenance: number;
    insurance: number;
    parkingAndTolls: number;
  };
  selfEmployedHealthInsurance?: number;
  priorYearTaxLiability?: number;
  estimatedPaymentsMade: number;
  retirementContributions: number;
  quarterlyPaymentsMade?: {
    q1?: number;
    q2?: number;
    q3?: number;
    q4?: number;
  };
}

export interface QuarterlyEstimatedVoucher {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  dueDate: string;
  period: string;
  amount: number;
  safeHarborAmount: number;
  paidAmount: number;
  isPaid: boolean;
}

export interface TaxCalculationResult {
  entityType: EntityType;
  taxYear: TaxYear;
  filingStatus: FilingStatus;
  scheduleC: {
    lines: Record<ScheduleCLine, ScheduleCItemSummary>;
    grossRevenue: number;
    additionalGrossIncome: number;
    totalGrossReceipts: number;
    returnsAndAllowances: number;
    costOfGoodsSold: number;
    grossProfit: number;
    grossIncome: number;
    totalAllowableExpenses: number;
    netBusinessProfit: number;
    vehicleBreakdown: VehicleDeductionBreakdown;
    homeOfficeDeduction: number;
  };
  scorpSummary?: {
    officerSalary: number;
    employerFica: number;
    k1OrdinaryIncome: number;
    ficaTaxSavingsVsSoleProp: number;
  };
  selfEmployment: {
    scheduleCNetProfit: number;
    netEarningsSubjectToSE: number;
    oasdiCap: number;
    w2SsWagesOffset: number;
    remainingOasdiCap: number;
    taxableForSS: number;
    ssTax: number;
    medicareTax: number;
    additionalMedicareTax: number;
    totalSETax: number;
    aboveTheLineDeduction: number;
  };
  incomeTax: {
    totalW2Wages: number;
    businessProfit: number;
    grossTotalIncome: number;
    seTaxDeduction: number;
    selfEmployedHealthInsurance: number;
    retirementDeduction: number;
    totalSchedule1Adjustments: number;
    agi: number;
    standardDeduction: number;
    qbiBase: number;
    qbiDeduction: number;
    taxableIncome: number;
    bracketsBreakdown: {
      rate: number;
      min: number;
      max: number;
      taxableInBracket: number;
      taxAmount: number;
    }[];
    federalIncomeTax: number;
    effectiveRate: number;
    marginalRate: number;
  };
  safeHarbor: {
    currentYearTax: number;
    currentYear90Pct: number;
    priorYearTax: number;
    priorYearSafeHarborTarget: number;
    isAgiOver150k: boolean;
    priorYearPercentage: number;
    recommendedQuarterly: number;
  };
  reconciliation: {
    totalFederalTaxLiability: number;
    totalW2FedWithholding: number;
    estimatedPaymentsMade: number;
    totalPaymentsAndCredits: number;
    netPosition: number;
    isRefund: boolean;
    refundOrBalanceAmount: number;
  };
  quarterlyVouchers: QuarterlyEstimatedVoucher[];
  estimatedTaxSavingsFromDeductions: number;
}

// IRS Constants by Year
export const STANDARD_MILEAGE_RATES: Record<TaxYear, number> = {
  2024: 0.67,
  2025: 0.70, // IRS Notice 2025-05
  2026: 0.72  // Statutory projection
};

export const OASDI_WAGE_CAPS: Record<TaxYear, number> = {
  2024: 168600,
  2025: 176100,
  2026: 181800
};

export const STANDARD_DEDUCTIONS: Record<TaxYear, Record<FilingStatus, number>> = {
  2024: { single: 14600, mfj: 29200, hoh: 21900, mfs: 14600 },
  2025: { single: 15000, mfj: 30000, hoh: 22500, mfs: 15000 },
  2026: { single: 15700, mfj: 31400, hoh: 23500, mfs: 15700 }
};

interface Bracket {
  rate: number;
  upTo: number;
}

export const FEDERAL_TAX_BRACKETS: Record<TaxYear, Record<FilingStatus, Bracket[]>> = {
  2024: {
    single: [
      { rate: 0.10, upTo: 11600 },
      { rate: 0.12, upTo: 47150 },
      { rate: 0.22, upTo: 100525 },
      { rate: 0.24, upTo: 191950 },
      { rate: 0.32, upTo: 243725 },
      { rate: 0.35, upTo: 609350 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfj: [
      { rate: 0.10, upTo: 23200 },
      { rate: 0.12, upTo: 94300 },
      { rate: 0.22, upTo: 201050 },
      { rate: 0.24, upTo: 383900 },
      { rate: 0.32, upTo: 487450 },
      { rate: 0.35, upTo: 731200 },
      { rate: 0.37, upTo: Infinity }
    ],
    hoh: [
      { rate: 0.10, upTo: 16550 },
      { rate: 0.12, upTo: 63100 },
      { rate: 0.22, upTo: 100500 },
      { rate: 0.24, upTo: 191950 },
      { rate: 0.32, upTo: 243700 },
      { rate: 0.35, upTo: 609350 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfs: [
      { rate: 0.10, upTo: 11600 },
      { rate: 0.12, upTo: 47150 },
      { rate: 0.22, upTo: 100525 },
      { rate: 0.24, upTo: 191950 },
      { rate: 0.32, upTo: 243725 },
      { rate: 0.35, upTo: 365600 },
      { rate: 0.37, upTo: Infinity }
    ]
  },
  2025: {
    single: [
      { rate: 0.10, upTo: 11925 },
      { rate: 0.12, upTo: 48475 },
      { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 },
      { rate: 0.32, upTo: 250525 },
      { rate: 0.35, upTo: 626350 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfj: [
      { rate: 0.10, upTo: 23850 },
      { rate: 0.12, upTo: 96950 },
      { rate: 0.22, upTo: 206700 },
      { rate: 0.24, upTo: 394600 },
      { rate: 0.32, upTo: 501050 },
      { rate: 0.35, upTo: 751600 },
      { rate: 0.37, upTo: Infinity }
    ],
    hoh: [
      { rate: 0.10, upTo: 17000 },
      { rate: 0.12, upTo: 64850 },
      { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 },
      { rate: 0.32, upTo: 250500 },
      { rate: 0.35, upTo: 626350 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfs: [
      { rate: 0.10, upTo: 11925 },
      { rate: 0.12, upTo: 48475 },
      { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 },
      { rate: 0.32, upTo: 250525 },
      { rate: 0.35, upTo: 375800 },
      { rate: 0.37, upTo: Infinity }
    ]
  },
  2026: {
    single: [
      { rate: 0.10, upTo: 12250 },
      { rate: 0.12, upTo: 49800 },
      { rate: 0.22, upTo: 106200 },
      { rate: 0.24, upTo: 202800 },
      { rate: 0.32, upTo: 257500 },
      { rate: 0.35, upTo: 643800 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfj: [
      { rate: 0.10, upTo: 24500 },
      { rate: 0.12, upTo: 99600 },
      { rate: 0.22, upTo: 212400 },
      { rate: 0.24, upTo: 405600 },
      { rate: 0.32, upTo: 515000 },
      { rate: 0.35, upTo: 772500 },
      { rate: 0.37, upTo: Infinity }
    ],
    hoh: [
      { rate: 0.10, upTo: 17500 },
      { rate: 0.12, upTo: 66650 },
      { rate: 0.22, upTo: 106200 },
      { rate: 0.24, upTo: 202800 },
      { rate: 0.32, upTo: 257500 },
      { rate: 0.35, upTo: 643800 },
      { rate: 0.37, upTo: Infinity }
    ],
    mfs: [
      { rate: 0.10, upTo: 12250 },
      { rate: 0.12, upTo: 49800 },
      { rate: 0.22, upTo: 106200 },
      { rate: 0.24, upTo: 202800 },
      { rate: 0.32, upTo: 257500 },
      { rate: 0.35, upTo: 386250 },
      { rate: 0.37, upTo: Infinity }
    ]
  }
};

/**
 * Calculates progressive piecewise income tax across IRS brackets.
 */
function calculateProgressiveTax(
  taxableIncome: number,
  brackets: Bracket[]
): {
  tax: number;
  breakdown: { rate: number; min: number; max: number; taxableInBracket: number; taxAmount: number }[];
  marginalRate: number;
} {
  if (taxableIncome <= 0) {
    return { tax: 0, breakdown: [], marginalRate: brackets[0]?.rate || 0.10 };
  }

  let totalTax = 0;
  let lowerBound = 0;
  let marginalRate = brackets[0]?.rate || 0.10;
  const breakdown: { rate: number; min: number; max: number; taxableInBracket: number; taxAmount: number }[] = [];

  for (const b of brackets) {
    if (taxableIncome > lowerBound) {
      const taxableInThisBracket = Math.min(taxableIncome, b.upTo) - lowerBound;
      const bracketTax = taxableInThisBracket * b.rate;
      totalTax += bracketTax;
      marginalRate = b.rate;

      breakdown.push({
        rate: b.rate,
        min: lowerBound,
        max: b.upTo === Infinity ? -1 : b.upTo,
        taxableInBracket: Math.round(taxableInThisBracket * 100) / 100,
        taxAmount: Math.round(bracketTax * 100) / 100
      });

      lowerBound = b.upTo;
      if (taxableIncome <= b.upTo) break;
    } else {
      break;
    }
  }

  return { tax: Math.round(totalTax * 100) / 100, breakdown, marginalRate };
}

/**
 * Main Pure Mathematical Tax Calculator Engine
 */
export function calculateTaxLiability(input: TaxCalculationInput): TaxCalculationResult {
  const {
    taxYear,
    filingStatus,
    entityType,
    scorpOfficerSalary = 0,
    w2Forms = [],
    grossBusinessIncome,
    expensesByLine = {},
    businessMiles = 0,
    vehicleMethod = 'auto_best',
    homeOfficeSqft = 0,
    actualVehicleReceipts = { gas: 0, maintenance: 0, insurance: 0, parkingAndTolls: 0 },
    estimatedPaymentsMade = 0,
    retirementContributions = 0
  } = input;

  // 1. Vehicle Deduction Optimization (Standard Mileage vs Actual Gas & Maintenance)
  const mileageRate = STANDARD_MILEAGE_RATES[taxYear] || 0.70;
  const standardMileageDeduction = Math.round(businessMiles * mileageRate * 100) / 100;

  // Tracked vehicle expenses from categories or passed receipts
  const rawVehicleExpense = expensesByLine['line_9_vehicle']?.total || 0;
  const actualGas = actualVehicleReceipts.gas || 0;
  const actualMaint = actualVehicleReceipts.maintenance || 0;
  const actualIns = actualVehicleReceipts.insurance || 0;
  const parkingAndTolls = actualVehicleReceipts.parkingAndTolls || 0;
  const actualTotal = Math.max(rawVehicleExpense, actualGas + actualMaint + actualIns);

  const optimalMethod: 'standard_mileage' | 'actual_expenses' =
    standardMileageDeduction >= actualTotal ? 'standard_mileage' : 'actual_expenses';

  let chosenMethod = optimalMethod;
  if (vehicleMethod === 'standard_mileage') chosenMethod = 'standard_mileage';
  if (vehicleMethod === 'actual_expenses') chosenMethod = 'actual_expenses';

  const baseVehicleDeduction = chosenMethod === 'standard_mileage' ? standardMileageDeduction : actualTotal;
  const totalVehicleDeduction = Math.round((baseVehicleDeduction + parkingAndTolls) * 100) / 100;
  const potentialAdvantage = Math.abs(Math.round((standardMileageDeduction - actualTotal) * 100) / 100);

  const vehicleBreakdown: VehicleDeductionBreakdown = {
    methodUsed: chosenMethod,
    milesDriven: businessMiles,
    mileageRate,
    standardMileageDeduction,
    actualGasAndFuel: actualGas,
    actualMaintenance: actualMaint,
    actualInsurance: actualIns,
    actualTotal,
    parkingAndTolls,
    totalVehicleDeduction,
    optimalMethod,
    potentialAdvantage
  };

  // 2. Simplified Home Office Deduction ($5/sq ft up to 300 sq ft)
  const homeOfficeDeduction = Math.min(300, Math.max(0, homeOfficeSqft)) * 5;

  // 3. Schedule C Itemized Breakdown
  const lines: Record<ScheduleCLine, ScheduleCItemSummary> = {} as any;
  let totalAllowableExpenses = 0;

  for (const lineKey of Object.keys(SCHEDULE_C_LINE_METADATA) as ScheduleCLine[]) {
    const meta = SCHEDULE_C_LINE_METADATA[lineKey];
    let grossAmount = 0;
    let count = 0;

    if (lineKey === 'line_9_vehicle') {
      grossAmount = totalVehicleDeduction;
      count = expensesByLine[lineKey]?.count || (businessMiles > 0 ? 1 : 0);
    } else if (lineKey === 'line_30_home_office') {
      grossAmount = homeOfficeDeduction;
      count = homeOfficeSqft > 0 ? 1 : 0;
    } else {
      grossAmount = expensesByLine[lineKey]?.total || 0;
      count = expensesByLine[lineKey]?.count || 0;
    }

    // Apply 50% limitation on meals (Line 24b)
    const deductibleAmount = meta.isFiftyPercentMeal
      ? Math.round(grossAmount * 0.50 * 100) / 100
      : Math.round(grossAmount * 100) / 100;

    lines[lineKey] = {
      line: lineKey,
      lineNumber: meta.lineNumber,
      title: meta.title,
      grossAmount,
      deductibleAmount,
      transactionCount: count,
      isFiftyPercentMeal: !!meta.isFiftyPercentMeal,
      tooltip: meta.tooltip
    };

    totalAllowableExpenses += deductibleAmount;
  }
  totalAllowableExpenses = Math.round(totalAllowableExpenses * 100) / 100;

  // Schedule C Part I: Gross Income & Profit
  const additionalGross = Math.max(0, Number(input.additionalGrossIncome) || 0);
  const returnsAndAllowances = Math.max(0, Number(input.returnsAndAllowances) || 0);
  const costOfGoodsSold = Math.max(0, Number(input.costOfGoodsSold) || 0);

  const totalGrossReceipts = Math.round((grossBusinessIncome + additionalGross) * 100) / 100;
  const grossProfit = Math.max(0, Math.round((totalGrossReceipts - returnsAndAllowances - costOfGoodsSold) * 100) / 100);
  const grossIncome = grossProfit;

  // Schedule C Part III: Net Business Profit
  const netBusinessProfit = Math.round((grossIncome - totalAllowableExpenses) * 100) / 100;

  // 4. W-2 Aggregation (Third-party & S-Corp Officer)
  let totalW2WagesBox1 = 0;
  let totalW2WithholdingBox2 = 0;
  let totalW2SsWagesBox3 = 0;

  for (const w of w2Forms) {
    totalW2WagesBox1 += w.wages_box1 || 0;
    totalW2WithholdingBox2 += w.fed_withholding_box2 || 0;
    totalW2SsWagesBox3 += w.ss_wages_box3 || 0;
  }

  // 5. Entity-Specific Processing (Sole Prop / LLC vs. LLC + S-Corp)
  const isSCorp = entityType === 'llc_scorp';
  let scorpSummary: TaxCalculationResult['scorpSummary'];
  let netEarningsSubjectToSE = 0;
  let ssTax = 0;
  let medicareTax = 0;
  let additionalMedicareTax = 0;
  let totalSETax = 0;
  let aboveTheLineDeduction = 0;
  let qbiBase = 0;
  let businessProfitForAGI = 0;

  const oasdiCap = OASDI_WAGE_CAPS[taxYear] || 176100;

  if (isSCorp) {
    // S-Corporation Election (Form 1120-S)
    const officerSalary = Math.max(0, scorpOfficerSalary);
    const employerFica = Math.round(officerSalary * 0.0765 * 100) / 100;
    const k1OrdinaryIncome = Math.round((netBusinessProfit - officerSalary - employerFica) * 100) / 100;

    netEarningsSubjectToSE = 0;
    ssTax = 0;
    medicareTax = 0;
    additionalMedicareTax = 0;
    totalSETax = 0;
    aboveTheLineDeduction = 0;

    qbiBase = Math.max(0, k1OrdinaryIncome);
    businessProfitForAGI = k1OrdinaryIncome;

    const solePropNetProfit = netBusinessProfit;
    const solePropSEEarnings = solePropNetProfit > 400 ? solePropNetProfit * 0.9235 : 0;
    const remainingCapHypothetical = Math.max(0, oasdiCap - totalW2SsWagesBox3);
    const hypotheticalSolePropSETax =
      Math.min(solePropSEEarnings, remainingCapHypothetical) * 0.124 +
      solePropSEEarnings * 0.029;
    const scorpFicaPaid = officerSalary * 0.153;
    const ficaTaxSavings = Math.max(0, Math.round((hypotheticalSolePropSETax - scorpFicaPaid) * 100) / 100);

    scorpSummary = {
      officerSalary,
      employerFica,
      k1OrdinaryIncome,
      ficaTaxSavingsVsSoleProp: ficaTaxSavings
    };
  } else {
    // Sole Proprietorship & Single-Member LLC (Schedule C & Schedule SE)
    businessProfitForAGI = netBusinessProfit;

    if (netBusinessProfit >= 400) {
      netEarningsSubjectToSE = Math.round(netBusinessProfit * 0.9235 * 100) / 100;

      const remainingOasdiCap = Math.max(0, oasdiCap - totalW2SsWagesBox3);
      const taxableForSS = Math.min(netEarningsSubjectToSE, remainingOasdiCap);
      ssTax = Math.round(taxableForSS * 0.124 * 100) / 100;

      medicareTax = Math.round(netEarningsSubjectToSE * 0.029 * 100) / 100;

      let addlMedicareThreshold = 200000;
      if (filingStatus === 'mfj') addlMedicareThreshold = 250000;
      if (filingStatus === 'mfs') addlMedicareThreshold = 125000;

      const combinedMedicareEarnings = totalW2WagesBox1 + netEarningsSubjectToSE;
      if (combinedMedicareEarnings > addlMedicareThreshold) {
        const excess = combinedMedicareEarnings - addlMedicareThreshold;
        additionalMedicareTax = Math.round(excess * 0.009 * 100) / 100;
      }

      totalSETax = Math.round((ssTax + medicareTax + additionalMedicareTax) * 100) / 100;
      aboveTheLineDeduction = Math.round(totalSETax * 0.50 * 100) / 100;
    }

    qbiBase = Math.max(0, netBusinessProfit - aboveTheLineDeduction);
  }

  const remainingOasdiCap = Math.max(0, oasdiCap - totalW2SsWagesBox3);

  // 6. Adjusted Gross Income (AGI) & Deductions
  const seHealthInsurance = Math.max(0, Number(input.selfEmployedHealthInsurance) || 0);
  const retirementDeduction = Math.max(0, Number(retirementContributions) || 0);
  const totalSchedule1Adjustments = Math.round((aboveTheLineDeduction + seHealthInsurance + retirementDeduction) * 100) / 100;

  const grossTotalIncome = Math.round((totalW2WagesBox1 + businessProfitForAGI) * 100) / 100;
  const agi = Math.max(
    0,
    Math.round((grossTotalIncome - totalSchedule1Adjustments) * 100) / 100
  );

  const standardDeduction = STANDARD_DEDUCTIONS[taxYear]?.[filingStatus] || 15000;
  const taxableIncomeBeforeQbi = Math.max(0, agi - standardDeduction);

  // QBI Deduction (§199A: 20% of lesser of QBI Base or Taxable Income before QBI)
  const qbiDeduction = Math.round(0.20 * Math.min(qbiBase, taxableIncomeBeforeQbi) * 100) / 100;
  const taxableIncome = Math.max(0, Math.round((taxableIncomeBeforeQbi - qbiDeduction) * 100) / 100);

  // 7. Progressive Federal Income Tax Calculation
  const brackets = FEDERAL_TAX_BRACKETS[taxYear]?.[filingStatus] || FEDERAL_TAX_BRACKETS[2025].single;
  const { tax: federalIncomeTax, breakdown: bracketsBreakdown, marginalRate } = calculateProgressiveTax(
    taxableIncome,
    brackets
  );

  const effectiveRate = taxableIncome > 0 ? Math.round((federalIncomeTax / taxableIncome) * 1000) / 10 : 0;

  // 8. Total Liability & Withholding Reconciliation
  const totalFederalTaxLiability = Math.round((federalIncomeTax + totalSETax) * 100) / 100;
  const totalPaymentsAndCredits = Math.round((totalW2WithholdingBox2 + estimatedPaymentsMade) * 100) / 100;
  const netPosition = Math.round((totalFederalTaxLiability - totalPaymentsAndCredits) * 100) / 100;
  const isRefund = netPosition < 0;
  const refundOrBalanceAmount = Math.abs(netPosition);

  // 9. Safe Harbor & Form 1040-ES Quarterly Estimated Tax Installments
  const priorTax = Math.max(0, Number(input.priorYearTaxLiability) || 0);
  const isAgiOver150k = agi > (filingStatus === 'mfs' ? 75000 : 150000);
  const priorYearPercentage = isAgiOver150k ? 1.10 : 1.00;
  const priorYearSafeHarborTarget = Math.round(priorTax * priorYearPercentage * 100) / 100;
  const currentYear90Pct = Math.round(totalFederalTaxLiability * 0.90 * 100) / 100;

  const netDueAfterW2 = Math.max(0, totalFederalTaxLiability - totalW2WithholdingBox2);
  const quarterlyAmount = Math.round((netDueAfterW2 / 4) * 100) / 100;

  let recommendedQuarterly = Math.round((currentYear90Pct / 4) * 100) / 100;
  if (priorTax > 0) {
    recommendedQuarterly = Math.round((Math.min(currentYear90Pct, priorYearSafeHarborTarget) / 4) * 100) / 100;
  }

  const qPayments = input.quarterlyPaymentsMade || {};
  const q1Paid = Number(qPayments.q1) || 0;
  const q2Paid = Number(qPayments.q2) || 0;
  const q3Paid = Number(qPayments.q3) || 0;
  const q4Paid = Number(qPayments.q4) || 0;

  const quarterlyVouchers: QuarterlyEstimatedVoucher[] = [
    {
      quarter: 'Q1',
      dueDate: `April 15, ${taxYear}`,
      period: 'January 1 – March 31',
      amount: quarterlyAmount,
      safeHarborAmount: recommendedQuarterly,
      paidAmount: q1Paid,
      isPaid: q1Paid >= quarterlyAmount && quarterlyAmount > 0
    },
    {
      quarter: 'Q2',
      dueDate: `June 15, ${taxYear}`,
      period: 'April 1 – May 31',
      amount: quarterlyAmount,
      safeHarborAmount: recommendedQuarterly,
      paidAmount: q2Paid,
      isPaid: q2Paid >= quarterlyAmount && quarterlyAmount > 0
    },
    {
      quarter: 'Q3',
      dueDate: `September 15, ${taxYear}`,
      period: 'June 1 – August 31',
      amount: quarterlyAmount,
      safeHarborAmount: recommendedQuarterly,
      paidAmount: q3Paid,
      isPaid: q3Paid >= quarterlyAmount && quarterlyAmount > 0
    },
    {
      quarter: 'Q4',
      dueDate: `January 15, ${taxYear + 1}`,
      period: 'September 1 – December 31',
      amount: quarterlyAmount,
      safeHarborAmount: recommendedQuarterly,
      paidAmount: q4Paid,
      isPaid: q4Paid >= quarterlyAmount && quarterlyAmount > 0
    }
  ];

  // 10. Estimated Tax Savings From Tracked Deductions
  const combinedMarginalRate = marginalRate + (isSCorp ? 0 : 0.153);
  const estimatedTaxSavingsFromDeductions = Math.round(totalAllowableExpenses * combinedMarginalRate * 100) / 100;

  return {
    entityType,
    taxYear,
    filingStatus,
    scheduleC: {
      lines,
      grossRevenue: grossBusinessIncome,
      additionalGrossIncome: additionalGross,
      totalGrossReceipts,
      returnsAndAllowances,
      costOfGoodsSold,
      grossProfit,
      grossIncome,
      totalAllowableExpenses,
      netBusinessProfit,
      vehicleBreakdown,
      homeOfficeDeduction
    },
    scorpSummary,
    selfEmployment: {
      scheduleCNetProfit: netBusinessProfit,
      netEarningsSubjectToSE,
      oasdiCap,
      w2SsWagesOffset: totalW2SsWagesBox3,
      remainingOasdiCap,
      taxableForSS: Math.min(netEarningsSubjectToSE, remainingOasdiCap),
      ssTax,
      medicareTax,
      additionalMedicareTax,
      totalSETax,
      aboveTheLineDeduction
    },
    incomeTax: {
      totalW2Wages: totalW2WagesBox1,
      businessProfit: businessProfitForAGI,
      grossTotalIncome,
      seTaxDeduction: aboveTheLineDeduction,
      selfEmployedHealthInsurance: seHealthInsurance,
      retirementDeduction,
      totalSchedule1Adjustments,
      agi,
      standardDeduction,
      qbiBase,
      qbiDeduction,
      taxableIncome,
      bracketsBreakdown,
      federalIncomeTax,
      effectiveRate,
      marginalRate
    },
    safeHarbor: {
      currentYearTax: totalFederalTaxLiability,
      currentYear90Pct,
      priorYearTax: priorTax,
      priorYearSafeHarborTarget,
      isAgiOver150k,
      priorYearPercentage,
      recommendedQuarterly
    },
    reconciliation: {
      totalFederalTaxLiability,
      totalW2FedWithholding: totalW2WithholdingBox2,
      estimatedPaymentsMade,
      totalPaymentsAndCredits,
      netPosition,
      isRefund,
      refundOrBalanceAmount
    },
    quarterlyVouchers,
    estimatedTaxSavingsFromDeductions
  };
}
