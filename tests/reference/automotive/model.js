const DEFAULT_TERMS =
  "All parts and labor warranted for 12 months or 12,000 miles, whichever comes first.";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

let idSequence = 0;

function createId(prefix) {
  idSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cloneItems(items) {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

export function createEmptyInvoice(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const now = new Date();
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 14);

  const date = now.toISOString().slice(0, 10);
  const dueDate = due.toISOString().slice(0, 10);
  const base = {
    meta: {
      invoiceNumber: `INV-${date.slice(0, 4)}-1001`,
      date,
      dueDate,
      status: "Draft",
    },
    shop: {
      name: "Future's Automotive",
      address: "742 Evergreen Terrace, Bay 4, Springfield",
      phone: "(555) 019-2834",
      email: "service@futuresautomotive.example",
      licenseNumber: "ARD-994821",
    },
    customer: {
      name: "",
      phone: "",
      email: "",
      address: "",
    },
    vehicle: {
      year: "",
      make: "",
      model: "",
      vin: "",
      licensePlate: "",
      mileage: "",
      engine: "",
      serviceAdvisor: "",
    },
    laborItems: [],
    partItems: [],
    settings: {
      taxRate: 8.25,
      taxLabor: false,
      discountType: "percent",
      discountValue: 0,
      shopSuppliesRate: 5,
      shopSuppliesCap: 35,
      hazardousWasteFee: 0,
      travelFee: 0,
      miscFee: 0,
    },
    notes: {
      customerNotes: "",
      termsAndConditions: DEFAULT_TERMS,
    },
  };

  return {
    ...base,
    ...source,
    meta: { ...base.meta, ...(source.meta || {}) },
    shop: { ...base.shop, ...(source.shop || {}) },
    customer: { ...base.customer, ...(source.customer || {}) },
    vehicle: { ...base.vehicle, ...(source.vehicle || {}) },
    laborItems: cloneItems(source.laborItems),
    partItems: cloneItems(source.partItems),
    settings: { ...base.settings, ...(source.settings || {}) },
    notes: { ...base.notes, ...(source.notes || {}) },
  };
}

export function addLaborItem(invoice, item = {}) {
  const laborItem = {
    description: "",
    technician: "",
    hours: 0,
    rate: 0,
    ...item,
    id: item.id || createId("labor"),
  };

  return {
    ...invoice,
    laborItems: [...cloneItems(invoice.laborItems), laborItem],
  };
}

export function updateLaborItem(invoice, id, patch = {}) {
  return {
    ...invoice,
    laborItems: cloneItems(invoice.laborItems).map((item) =>
      item.id === id ? { ...item, ...patch, id: item.id } : item,
    ),
  };
}

export function removeLaborItem(invoice, id) {
  return {
    ...invoice,
    laborItems: cloneItems(invoice.laborItems).filter((item) => item.id !== id),
  };
}

export function addPartItem(invoice, item = {}) {
  const partItem = {
    partNumber: "",
    description: "",
    quantity: 0,
    unitPrice: 0,
    ...item,
    id: item.id || createId("part"),
  };

  return {
    ...invoice,
    partItems: [...cloneItems(invoice.partItems), partItem],
  };
}

export function updatePartItem(invoice, id, patch = {}) {
  return {
    ...invoice,
    partItems: cloneItems(invoice.partItems).map((item) =>
      item.id === id ? { ...item, ...patch, id: item.id } : item,
    ),
  };
}

export function removePartItem(invoice, id) {
  return {
    ...invoice,
    partItems: cloneItems(invoice.partItems).filter((item) => item.id !== id),
  };
}

export const SERVICE_PRESETS = {
  oilChange: {
    name: "Synthetic Oil & Filter Change",
    laborItems: [
      {
        description: "Synthetic oil and filter change",
        technician: "Lube Technician",
        hours: 0.6,
        rate: 95,
      },
    ],
    partItems: [
      {
        partNumber: "FSO-5W30",
        description: "Full-synthetic 5W-30 motor oil",
        quantity: 5,
        unitPrice: 9.5,
      },
      {
        partNumber: "OF-1042",
        description: "Premium engine oil filter",
        quantity: 1,
        unitPrice: 12.99,
      },
      {
        partNumber: "DPG-14",
        description: "Drain plug gasket",
        quantity: 1,
        unitPrice: 0.75,
      },
    ],
  },
  frontBrakes: {
    name: "Front Brake Pad & Rotor Service",
    laborItems: [
      {
        description: "Replace front brake pads and rotors; inspect calipers",
        technician: "Brake Technician",
        hours: 2,
        rate: 125,
      },
    ],
    partItems: [
      {
        partNumber: "BP-CF1847",
        description: "Ceramic front brake pad set",
        quantity: 1,
        unitPrice: 89.99,
      },
      {
        partNumber: "BR-980647",
        description: "Coated front brake rotor",
        quantity: 2,
        unitPrice: 74.5,
      },
      {
        partNumber: "BHW-1847",
        description: "Stainless brake hardware kit",
        quantity: 1,
        unitPrice: 24.99,
      },
    ],
  },
  alignment: {
    name: "4-Wheel Alignment",
    laborItems: [
      {
        description: "Four-wheel computerized alignment and steering inspection",
        technician: "Alignment Technician",
        hours: 1.5,
        rate: 120,
      },
    ],
    partItems: [],
  },
  diagnostic: {
    name: "OBD-II Diagnostic Scan",
    laborItems: [
      {
        description: "OBD-II scan, code analysis, and diagnostic report",
        technician: "Diagnostic Technician",
        hours: 1,
        rate: 135,
      },
    ],
    partItems: [],
  },
  batteryReplacement: {
    name: "Battery Replacement",
    laborItems: [
      {
        description: "Battery test, replacement, and charging-system check",
        technician: "Service Technician",
        hours: 0.7,
        rate: 95,
      },
    ],
    partItems: [
      {
        partNumber: "BAT-48AGM",
        description: "AGM automotive battery",
        quantity: 1,
        unitPrice: 219.99,
      },
      {
        partNumber: "BTC-PROTECT",
        description: "Battery terminal protection kit",
        quantity: 1,
        unitPrice: 8.99,
      },
    ],
  },
  acService: {
    name: "A/C System Service",
    laborItems: [
      {
        description: "A/C evacuation, leak inspection, and refrigerant recharge",
        technician: "HVAC Technician",
        hours: 1.5,
        rate: 135,
      },
    ],
    partItems: [
      {
        partNumber: "R134A-12OZ",
        description: "R-134a refrigerant, 12 oz",
        quantity: 2,
        unitPrice: 18,
      },
      {
        partNumber: "AC-UV-DYE",
        description: "A/C ultraviolet leak-detection dye",
        quantity: 1,
        unitPrice: 12.5,
      },
      {
        partNumber: "AC-ORING-KIT",
        description: "A/C O-ring service kit",
        quantity: 1,
        unitPrice: 14.99,
      },
    ],
  },
};

const PRESET_ALIASES = {
  oil: "oilChange",
  syntheticoilfilterchange: "oilChange",
  brakes: "frontBrakes",
  brakeservice: "frontBrakes",
  frontbrakepadrotorservice: "frontBrakes",
  wheelalignment: "alignment",
  "4wheelalignment": "alignment",
  obdiidiagnosticscan: "diagnostic",
  obd2diagnosticscan: "diagnostic",
  battery: "batteryReplacement",
  ac: "acService",
  acsystemservice: "acService",
};

function resolvePresetKey(presetKey) {
  if (Object.prototype.hasOwnProperty.call(SERVICE_PRESETS, presetKey)) {
    return presetKey;
  }

  const normalized = String(presetKey ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return PRESET_ALIASES[normalized] || normalized;
}

export function applyServicePreset(invoice, presetKey) {
  const preset = SERVICE_PRESETS[resolvePresetKey(presetKey)];
  if (!preset) {
    return invoice;
  }

  let updated = invoice;
  for (const item of preset.laborItems) {
    updated = addLaborItem(updated, item);
  }
  for (const item of preset.partItems) {
    updated = addPartItem(updated, item);
  }
  return updated;
}

export function calculateTotals(invoice) {
  const laborItems = Array.isArray(invoice?.laborItems) ? invoice.laborItems : [];
  const partItems = Array.isArray(invoice?.partItems) ? invoice.partItems : [];
  const settings = invoice?.settings || {};

  const laborSubtotal = roundCurrency(
    laborItems.reduce(
      (sum, item) => sum + asNumber(item.hours) * asNumber(item.rate),
      0,
    ),
  );
  const partsSubtotal = roundCurrency(
    partItems.reduce(
      (sum, item) => sum + asNumber(item.quantity) * asNumber(item.unitPrice),
      0,
    ),
  );
  const subtotal = roundCurrency(laborSubtotal + partsSubtotal);
  const shopSuppliesFee = roundCurrency(
    Math.min(
      laborSubtotal * (asNumber(settings.shopSuppliesRate) / 100),
      asNumber(settings.shopSuppliesCap),
    ),
  );
  const hazardousWasteFee = roundCurrency(asNumber(settings.hazardousWasteFee));
  const travelFee = roundCurrency(asNumber(settings.travelFee));
  const miscFee = roundCurrency(asNumber(settings.miscFee));
  const discountValue = asNumber(settings.discountValue);
  const discountAmount = roundCurrency(
    settings.discountType === "fixed"
      ? Math.min(discountValue, subtotal)
      : subtotal * (discountValue / 100),
  );
  const taxableBase = settings.taxLabor ? subtotal : partsSubtotal;
  const discountShare =
    subtotal > 0 ? discountAmount * (taxableBase / subtotal) : 0;
  const taxableAmount = roundCurrency(Math.max(0, taxableBase - discountShare));
  const taxAmount = roundCurrency(
    taxableAmount * (asNumber(settings.taxRate) / 100),
  );
  const grandTotal = roundCurrency(
    subtotal -
      discountAmount +
      shopSuppliesFee +
      hazardousWasteFee +
      travelFee +
      miscFee +
      taxAmount,
  );

  return {
    laborSubtotal,
    partsSubtotal,
    subtotal,
    shopSuppliesFee,
    hazardousWasteFee,
    travelFee,
    miscFee,
    discountAmount,
    taxableAmount,
    taxAmount,
    grandTotal,
  };
}

export function validateVin(vin) {
  const normalized = String(vin ?? "").trim().toUpperCase();

  if (!normalized) {
    return { valid: false, reason: "VIN is required." };
  }
  if (normalized.length !== 17) {
    return { valid: false, reason: "VIN must be exactly 17 characters." };
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) {
    return {
      valid: false,
      reason: "VIN may contain only letters and digits, excluding I, O, and Q.",
    };
  }
  return { valid: true };
}

export function formatCurrency(amount) {
  return currencyFormatter.format(asNumber(amount));
}

export function createSampleInvoice() {
  let invoice = createEmptyInvoice({
    meta: { status: "Approved" },
    customer: {
      name: "Jordan Taylor",
      phone: "(555) 014-7782",
      email: "jordan.taylor@example.com",
      address: "318 Willow Creek Drive, Springfield",
    },
    vehicle: {
      year: "2021",
      make: "Honda",
      model: "Accord",
      vin: "1HGCV1F34MA012345",
      licensePlate: "8VIN123",
      mileage: "48250",
      engine: "1.5L Turbo I4",
      serviceAdvisor: "Sam Rivera",
    },
    settings: { hazardousWasteFee: 3.5 },
    notes: {
      customerNotes: "Rotate tires and inspect fluid levels during service.",
    },
  });

  invoice = addLaborItem(invoice, {
    description: "Synthetic oil and filter change",
    technician: "Alex Chen",
    hours: 0.6,
    rate: 95,
  });
  invoice = addLaborItem(invoice, {
    description: "Tire rotation and multi-point inspection",
    technician: "Alex Chen",
    hours: 0.5,
    rate: 95,
  });
  invoice = addPartItem(invoice, {
    partNumber: "FSO-5W30",
    description: "Full-synthetic 5W-30 motor oil",
    quantity: 5,
    unitPrice: 9.5,
  });
  invoice = addPartItem(invoice, {
    partNumber: "OF-1042",
    description: "Premium engine oil filter",
    quantity: 1,
    unitPrice: 12.99,
  });

  return invoice;
}
