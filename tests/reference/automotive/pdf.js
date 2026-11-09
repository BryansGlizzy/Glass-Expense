/**
 * Automotive Invoice Generator — Client-side PDF-1.4 generator & print module
 * Standalone ES module with zero runtime dependencies.
 */

/**
 * Formats a numeric value into US currency string (e.g. "$1,234.56").
 * @param {number|string} val
 * @returns {string}
 */
export function formatCurrency(val) {
  const num = Number(val) || 0;
  const isNeg = num < -0.00001;
  const abs = Math.abs(num);
  const parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNeg ? '-' : ''}$${parts.join('.')}`;
}

/**
 * Escapes characters for PDF literal strings in parentheses: ( ... )
 * Specifically escapes backslash '\', left paren '(', and right paren ')'.
 * Normalizes newlines and converts non-ASCII characters to safe equivalents or octal escapes.
 * @param {string|number|null|undefined} str
 * @returns {string}
 */
export function escapePdfText(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);

  // Normalize common unicode punctuation to ASCII equivalents
  const normalized = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ');

  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '\\') {
      out += '\\\\';
    } else if (c === '(') {
      out += '\\(';
    } else if (c === ')') {
      out += '\\)';
    } else if (c === '\r') {
      out += '\\r';
    } else if (c === '\n' || c === '\t') {
      out += ' ';
    } else {
      const code = c.charCodeAt(0);
      if (code < 32 || code > 126) {
        if (code >= 128 && code <= 255) {
          out += '\\' + code.toString(8).padStart(3, '0');
        } else {
          out += '?';
        }
      } else {
        out += c;
      }
    }
  }
  return out;
}

/**
 * Approximates text width in points for standard Helvetica and Helvetica-Bold.
 * @param {string} text
 * @param {number} fontSize
 * @param {boolean} isBold
 * @returns {number}
 */
function getTextWidth(text, fontSize, isBold = false) {
  if (!text) return 0;
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      units += 556;
    } else if (ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === '!' || ch === ' ') {
      units += 278;
    } else if (ch === '$') {
      units += 556;
    } else if (ch === '-' || ch === '(' || ch === ')' || ch === '/' || ch === '#') {
      units += 333;
    } else if (ch >= 'A' && ch <= 'Z') {
      units += 667;
    } else {
      units += 500;
    }
  }
  const factor = isBold ? 1.05 : 1.0;
  return (units / 1000) * fontSize * factor;
}

/**
 * Wraps text into multiple lines given a max point width.
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} fontSize
 * @param {boolean} isBold
 * @returns {string[]}
 */
function wrapText(text, maxWidth, fontSize, isBold = false) {
  if (!text) return [];
  const lines = [];
  const rawParagraphs = String(text).split('\n');

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const width = getTextWidth(candidate, fontSize, isBold);
      if (width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

/**
 * Computes fallback totals if totals object is omitted.
 * Matches the project calculation engine contract.
 * @param {object} invoice
 * @returns {object}
 */
export function computeFallbackTotals(invoice) {
  const laborItems = Array.isArray(invoice?.laborItems) ? invoice.laborItems : [];
  const partItems = Array.isArray(invoice?.partItems) ? invoice.partItems : [];
  const settings = invoice?.settings || {};

  const round2 = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;

  const laborSubtotal = round2(
    laborItems.reduce((sum, item) => sum + (Number(item?.hours) || 0) * (Number(item?.rate) || 0), 0)
  );

  const partsSubtotal = round2(
    partItems.reduce((sum, item) => sum + (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0), 0)
  );

  const subtotal = round2(laborSubtotal + partsSubtotal);

  const shopSuppliesRate = Number(settings.shopSuppliesRate ?? 5);
  const shopSuppliesCap = Number(settings.shopSuppliesCap ?? 35);
  const rawSupplies = laborSubtotal * (shopSuppliesRate / 100);
  const shopSuppliesFee = round2(Math.min(rawSupplies, shopSuppliesCap));

  const hazardousWasteFee = round2(Number(settings.hazardousWasteFee) || 0);
  const travelFee = round2(Number(settings.travelFee) || 0);
  const miscFee = round2(Number(settings.miscFee) || 0);

  const discountType = settings.discountType || 'percent';
  const discountVal = Number(settings.discountValue) || 0;
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2(subtotal * (discountVal / 100));
  } else {
    discountAmount = round2(Math.min(discountVal, subtotal));
  }

  const taxLabor = Boolean(settings.taxLabor);
  const taxRate = Number(settings.taxRate ?? 0);
  const baseForTax = taxLabor ? subtotal : partsSubtotal;
  const discountShare = subtotal > 0 ? (baseForTax / subtotal) * discountAmount : 0;
  const taxableAmount = round2(Math.max(0, baseForTax - discountShare));
  const taxAmount = round2(taxableAmount * (taxRate / 100));

  const grandTotal = round2(subtotal - discountAmount + shopSuppliesFee + hazardousWasteFee + travelFee + miscFee + taxAmount);

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
    grandTotal
  };
}

/**
 * Resolves totals ensuring all required fields are populated.
 * @param {object} invoice
 * @param {object} [totals]
 * @returns {object}
 */
function resolveTotals(invoice, totals) {
  const fallback = computeFallbackTotals(invoice);
  if (!totals || typeof totals !== 'object') {
    return fallback;
  }
  const laborSubtotal = totals.laborSubtotal !== undefined ? Number(totals.laborSubtotal) : fallback.laborSubtotal;
  const partsSubtotal = totals.partsSubtotal !== undefined ? Number(totals.partsSubtotal) : fallback.partsSubtotal;
  const subtotal = totals.subtotal !== undefined ? Number(totals.subtotal) : (laborSubtotal + partsSubtotal);
  const shopSuppliesFee = totals.shopSuppliesFee !== undefined ? Number(totals.shopSuppliesFee) : fallback.shopSuppliesFee;
  const hazardousWasteFee = totals.hazardousWasteFee !== undefined ? Number(totals.hazardousWasteFee) : fallback.hazardousWasteFee;
  const travelFee = totals.travelFee !== undefined ? Number(totals.travelFee) : fallback.travelFee;
  const miscFee = totals.miscFee !== undefined ? Number(totals.miscFee) : fallback.miscFee;
  const discountAmount = totals.discountAmount !== undefined ? Number(totals.discountAmount) : fallback.discountAmount;
  const taxableAmount = totals.taxableAmount !== undefined ? Number(totals.taxableAmount) : fallback.taxableAmount;
  const taxAmount = totals.taxAmount !== undefined ? Number(totals.taxAmount) : fallback.taxAmount;
  const grandTotal = totals.grandTotal !== undefined
    ? Number(totals.grandTotal)
    : Math.round((subtotal - discountAmount + shopSuppliesFee + hazardousWasteFee + travelFee + miscFee + taxAmount + Number.EPSILON) * 100) / 100;

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

/**
 * Low-level binary builder for PDF-1.4 documents.
 */
class PdfBinaryWriter {
  constructor() {
    this.chunks = [];
    this.offset = 0;
    this.encoder = new TextEncoder();
  }

  writeBytes(bytes) {
    this.chunks.push(bytes);
    const start = this.offset;
    this.offset += bytes.byteLength;
    return start;
  }

  writeString(str) {
    const bytes = this.encoder.encode(str);
    return this.writeBytes(bytes);
  }

  getOffset() {
    return this.offset;
  }

  toUint8Array() {
    const total = new Uint8Array(this.offset);
    let pos = 0;
    for (const chunk of this.chunks) {
      total.set(chunk, pos);
      pos += chunk.byteLength;
    }
    return total;
  }
}

/**
 * Single page builder accumulating graphics and text commands.
 */
class PageStream {
  constructor(pageNumber) {
    this.pageNumber = pageNumber;
    this.commands = [];
  }

  addRaw(cmd) {
    this.commands.push(cmd);
  }

  drawRect(x, y, w, h, { fill, stroke, lineWidth = 0.5 } = {}) {
    this.commands.push('q');
    if (lineWidth) {
      this.commands.push(`${Number(lineWidth).toFixed(2)} w`);
    }
    if (stroke) {
      this.commands.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
    }
    if (fill) {
      this.commands.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
    }
    this.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (fill && stroke) {
      this.commands.push('B');
    } else if (fill) {
      this.commands.push('f');
    } else {
      this.commands.push('S');
    }
    this.commands.push('Q');
  }

  drawLine(x1, y1, x2, y2, stroke = [0.8, 0.8, 0.8], lineWidth = 0.5) {
    this.commands.push('q');
    this.commands.push(`${Number(lineWidth).toFixed(2)} w`);
    this.commands.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
    this.commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    this.commands.push('Q');
  }

  drawText(text, x, y, { font = '/F1', size = 9, color = [0, 0, 0], align = 'left' } = {}) {
    const isBold = font === '/F2';
    const str = String(text ?? '');
    let renderX = x;
    if (align === 'right') {
      const w = getTextWidth(str, size, isBold);
      renderX = x - w;
    } else if (align === 'center') {
      const w = getTextWidth(str, size, isBold);
      renderX = x - w / 2;
    }

    const escaped = escapePdfText(str);
    this.commands.push('BT');
    this.commands.push(`${font} ${Number(size).toFixed(2)} Tf`);
    this.commands.push(`${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg`);
    this.commands.push(`1 0 0 1 ${renderX.toFixed(2)} ${y.toFixed(2)} Tm`);
    this.commands.push(`(${escaped}) Tj`);
    this.commands.push('ET');
  }

  getStreamBytes() {
    const content = this.commands.join('\n') + '\n';
    return new TextEncoder().encode(content);
  }
}

/**
 * Generates a valid PDF-1.4 binary document from invoice and totals.
 * @param {object} invoice
 * @param {object} [totals]
 * @returns {Uint8Array}
 */
export function generatePdfBytes(invoice = {}, totals) {
  const inv = invoice || {};
  const meta = inv.meta || {};
  const shop = inv.shop || {};
  const customer = inv.customer || {};
  const vehicle = inv.vehicle || {};
  const laborItems = Array.isArray(inv.laborItems) ? inv.laborItems : [];
  const partItems = Array.isArray(inv.partItems) ? inv.partItems : [];
  const notes = inv.notes || {};
  const resolvedTotals = resolveTotals(inv, totals);

  // Document layout geometry
  const pageWidth = 612;
  const pageHeight = 792;
  const leftX = 40;
  const rightX = 572;
  const contentWidth = rightX - leftX; // 532 pt

  // Color palette
  const cDarkNavy = [0.06, 0.09, 0.16];
  const cSlateDark = [0.12, 0.16, 0.23];
  const cSlateMuted = [0.38, 0.44, 0.53];
  const cAccentBlue = [0.12, 0.35, 0.85];
  const cBoxBg = [0.95, 0.96, 0.98];
  const cBoxBorder = [0.85, 0.88, 0.92];
  const cRowAlt = [0.98, 0.99, 1.0];
  const cBorderLine = [0.88, 0.90, 0.93];

  const pages = [];
  let currentPage = new PageStream(1);
  pages.push(currentPage);

  let currentY = 752;

  function checkPageBreak(neededHeight) {
    if (currentY - neededHeight < 60) {
      const nextNum = pages.length + 1;
      currentPage = new PageStream(nextNum);
      pages.push(currentPage);
      currentY = 752;

      // Header on continuation pages
      currentPage.drawText(
        `${shop.name || 'Auto Workshop'} — Invoice ${meta.invoiceNumber || ''} (Page ${nextNum})`,
        leftX,
        currentY,
        { font: '/F2', size: 9, color: cSlateMuted }
      );
      currentPage.drawLine(leftX, currentY - 6, rightX, currentY - 6, cBorderLine, 0.75);
      currentY -= 20;
    }
  }

  // 1. SHOP HEADER & INVOICE METADATA (Top Section)
  // Left: Shop Information
  currentPage.drawText(shop.name || "Future's Automotive", leftX, currentY - 14, {
    font: '/F2',
    size: 15,
    color: cDarkNavy,
  });

  currentPage.drawText(shop.address || '', leftX, currentY - 28, {
    font: '/F1',
    size: 8.5,
    color: cSlateMuted,
  });

  const shopContact = [
    shop.phone ? `Phone: ${shop.phone}` : '',
    shop.email ? `Email: ${shop.email}` : '',
  ].filter(Boolean).join('   |   ');
  currentPage.drawText(shopContact, leftX, currentY - 40, {
    font: '/F1',
    size: 8.5,
    color: cSlateMuted,
  });

  const licenseText = shop.licenseNumber ? `License / ARD #: ${shop.licenseNumber}` : '';
  currentPage.drawText(licenseText, leftX, currentY - 52, {
    font: '/F1',
    size: 8.5,
    color: cSlateMuted,
  });

  // Right: Invoice Metadata
  currentPage.drawText('INVOICE', rightX, currentY - 16, {
    font: '/F2',
    size: 20,
    color: cDarkNavy,
    align: 'right',
  });

  currentPage.drawText(`Invoice #: ${meta.invoiceNumber || 'INV-DRAFT'}`, rightX, currentY - 30, {
    font: '/F2',
    size: 9.5,
    color: cSlateDark,
    align: 'right',
  });

  currentPage.drawText(`Date: ${meta.date || ''}`, rightX, currentY - 42, {
    font: '/F1',
    size: 8.5,
    color: cSlateMuted,
    align: 'right',
  });

  currentPage.drawText(`Due Date: ${meta.dueDate || ''}`, rightX, currentY - 54, {
    font: '/F1',
    size: 8.5,
    color: cSlateMuted,
    align: 'right',
  });

  currentPage.drawText(`Status: ${meta.status || 'Draft'}`, rightX, currentY - 66, {
    font: '/F2',
    size: 8.5,
    color: cAccentBlue,
    align: 'right',
  });

  currentY -= 76;

  // Divider bar
  currentPage.drawLine(leftX, currentY, rightX, currentY, cBorderLine, 1);
  currentY -= 12;

  // 2. CUSTOMER INFO & VEHICLE DETAILS (Two Boxes)
  const boxWidth = 258;
  const boxHeight = 76;
  const leftBoxX = leftX;
  const rightBoxX = 314;

  // Background and borders
  currentPage.drawRect(leftBoxX, currentY - boxHeight, boxWidth, boxHeight, {
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawRect(leftBoxX, currentY - 18, boxWidth, 18, {
    fill: cBoxBg,
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawText('CUSTOMER INFORMATION', leftBoxX + 8, currentY - 13, {
    font: '/F2',
    size: 8.5,
    color: cSlateDark,
  });

  currentPage.drawRect(rightBoxX, currentY - boxHeight, boxWidth, boxHeight, {
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawRect(rightBoxX, currentY - 18, boxWidth, 18, {
    fill: cBoxBg,
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawText('VEHICLE DETAILS', rightBoxX + 8, currentY - 13, {
    font: '/F2',
    size: 8.5,
    color: cSlateDark,
  });

  // Customer lines
  currentPage.drawText(`Name: ${customer.name || '-'}`, leftBoxX + 8, currentY - 30, {
    font: '/F2',
    size: 8.5,
    color: cSlateDark,
  });
  currentPage.drawText(`Phone: ${customer.phone || '-'}`, leftBoxX + 8, currentY - 43, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });
  currentPage.drawText(`Email: ${customer.email || '-'}`, leftBoxX + 8, currentY - 56, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });
  currentPage.drawText(`Address: ${customer.address || '-'}`, leftBoxX + 8, currentY - 69, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });

  // Vehicle lines
  const vehicleSummary = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '-';
  currentPage.drawText(`Vehicle: ${vehicleSummary}`, rightBoxX + 8, currentY - 30, {
    font: '/F2',
    size: 8.5,
    color: cSlateDark,
  });
  currentPage.drawText(`VIN: ${vehicle.vin || '-'}`, rightBoxX + 8, currentY - 43, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });
  const plateAndMileage = `License Plate: ${vehicle.licensePlate || '-'}   Mileage: ${vehicle.mileage ? vehicle.mileage + ' mi' : '-'}`;
  currentPage.drawText(plateAndMileage, rightBoxX + 8, currentY - 56, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });
  const engineAndAdvisor = `Engine: ${vehicle.engine || '-'}   Service Advisor: ${vehicle.serviceAdvisor || '-'}`;
  currentPage.drawText(engineAndAdvisor, rightBoxX + 8, currentY - 69, {
    font: '/F1',
    size: 8,
    color: cSlateMuted,
  });

  currentY -= (boxHeight + 16);

  // 3. ITEMIZED LABOR TABLE
  checkPageBreak(50);
  currentPage.drawText('LABOR SERVICES', leftX, currentY, {
    font: '/F2',
    size: 10,
    color: cDarkNavy,
  });
  currentY -= 6;

  // Labor table header
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, {
    fill: cBoxBg,
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawText('Description', leftX + 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText('Technician', leftX + 240, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText('Hours', leftX + 380, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText('Rate', leftX + 450, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText('Line Total', rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentY -= 16;

  if (laborItems.length === 0) {
    currentPage.drawText('No labor services listed.', leftX + 8, currentY - 12, {
      font: '/F1',
      size: 8,
      color: cSlateMuted,
    });
    currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);
    currentY -= 16;
  } else {
    laborItems.forEach((item, index) => {
      checkPageBreak(20);
      const hours = Number(item.hours) || 0;
      const rate = Number(item.rate) || 0;
      const lineTotal = hours * rate;

      if (index % 2 === 1) {
        currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cRowAlt });
      }
      currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);

      currentPage.drawText(item.description || '-', leftX + 8, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark });
      currentPage.drawText(item.technician || '-', leftX + 240, currentY - 11.5, { font: '/F1', size: 8, color: cSlateMuted });
      currentPage.drawText(hours.toFixed(2), leftX + 380, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatCurrency(rate), leftX + 450, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatCurrency(lineTotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
      currentY -= 16;
    });
  }

  // Labor subtotal line
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText('Labor Subtotal:', leftX + 450, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentPage.drawText(formatCurrency(resolvedTotals.laborSubtotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentY -= 24;

  // 4. ITEMIZED PARTS TABLE
  checkPageBreak(50);
  currentPage.drawText('PARTS & MATERIALS', leftX, currentY, {
    font: '/F2',
    size: 10,
    color: cDarkNavy,
  });
  currentY -= 6;

  // Parts table header
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, {
    fill: cBoxBg,
    stroke: cBoxBorder,
    lineWidth: 0.5,
  });
  currentPage.drawText('Part #', leftX + 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText('Description', leftX + 110, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText('Qty', leftX + 380, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText('Unit Price', leftX + 450, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText('Line Total', rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentY -= 16;

  if (partItems.length === 0) {
    currentPage.drawText('No parts or materials listed.', leftX + 8, currentY - 12, {
      font: '/F1',
      size: 8,
      color: cSlateMuted,
    });
    currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);
    currentY -= 16;
  } else {
    partItems.forEach((item, index) => {
      checkPageBreak(20);
      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const lineTotal = qty * unitPrice;

      if (index % 2 === 1) {
        currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cRowAlt });
      }
      currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);

      currentPage.drawText(item.partNumber || '-', leftX + 8, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark });
      currentPage.drawText(item.description || '-', leftX + 110, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark });
      currentPage.drawText(String(qty), leftX + 380, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatCurrency(unitPrice), leftX + 450, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatCurrency(lineTotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
      currentY -= 16;
    });
  }

  // Parts subtotal line
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText('Parts Subtotal:', leftX + 450, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentPage.drawText(formatCurrency(resolvedTotals.partsSubtotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentY -= 24;

  // 5. TOTALS SUMMARY & NOTES / TERMS SECTION
  checkPageBreak(150);

  const splitY = currentY;
  const leftColWidth = 280;
  const totalsBoxX = 330;
  const totalsBoxWidth = rightX - totalsBoxX; // 242 pt

  // Left Column: Notes & Terms
  let notesY = splitY;
  if (notes.customerNotes) {
    currentPage.drawText('Customer Notes:', leftX, notesY, { font: '/F2', size: 8.5, color: cDarkNavy });
    notesY -= 11;
    const noteLines = wrapText(notes.customerNotes, leftColWidth, 8, false);
    for (const line of noteLines) {
      currentPage.drawText(line, leftX, notesY, { font: '/F1', size: 8, color: cSlateDark });
      notesY -= 10;
    }
    notesY -= 6;
  }

  if (notes.termsAndConditions) {
    currentPage.drawText('Terms & Conditions:', leftX, notesY, { font: '/F2', size: 8.5, color: cDarkNavy });
    notesY -= 11;
    const termLines = wrapText(notes.termsAndConditions, leftColWidth, 7.5, false);
    for (const line of termLines) {
      currentPage.drawText(line, leftX, notesY, { font: '/F1', size: 7.5, color: cSlateMuted });
      notesY -= 9.5;
    }
  }

  // Right Column: Totals Summary
  let totalsY = splitY;
  const totalsRows = [
    { label: 'Labor Subtotal', amount: resolvedTotals.laborSubtotal },
    { label: 'Parts Subtotal', amount: resolvedTotals.partsSubtotal },
    { label: 'Shop Supplies Fee', amount: resolvedTotals.shopSuppliesFee },
    { label: 'Hazardous Waste Fee', amount: resolvedTotals.hazardousWasteFee },
    { label: 'Travel Fee', amount: resolvedTotals.travelFee },
    { label: 'Misc. Fee', amount: resolvedTotals.miscFee },
    { label: 'Discount Amount', amount: resolvedTotals.discountAmount, isDiscount: true },
    { label: 'Tax Amount', amount: resolvedTotals.taxAmount },
  ];

  for (const row of totalsRows) {
    currentPage.drawText(row.label, totalsBoxX + 8, totalsY, {
      font: '/F1',
      size: 8.5,
      color: cSlateDark,
    });
    const prefix = (row.isDiscount && row.amount > 0) ? '-' : '';
    currentPage.drawText(`${prefix}${formatCurrency(row.amount)}`, rightX - 8, totalsY, {
      font: '/F2',
      size: 8.5,
      color: cSlateDark,
      align: 'right',
    });
    totalsY -= 13;
  }

  // Grand Total Highlight Bar
  totalsY -= 2;
  currentPage.drawRect(totalsBoxX, totalsY - 18, totalsBoxWidth, 20, {
    fill: cDarkNavy,
  });
  currentPage.drawText('Grand Total', totalsBoxX + 8, totalsY - 13.5, {
    font: '/F2',
    size: 10,
    color: [1, 1, 1],
  });
  currentPage.drawText(formatCurrency(resolvedTotals.grandTotal), rightX - 8, totalsY - 13.5, {
    font: '/F2',
    size: 11,
    color: [1, 1, 1],
    align: 'right',
  });
  totalsY -= 26;

  // Move currentY past both columns
  currentY = Math.min(notesY, totalsY) - 16;

  // 6. CUSTOMER AUTHORIZATION SIGNATURE LINE
  checkPageBreak(55);
  currentPage.drawLine(leftX, currentY, rightX, currentY, cBorderLine, 0.75);
  currentY -= 18;

  currentPage.drawText(
    'Customer Authorization Signature: _________________________________________    Date: _______________',
    leftX,
    currentY,
    { font: '/F2', size: 8, color: cSlateDark }
  );
  currentY -= 12;

  currentPage.drawText(
    'I hereby authorize the repair work and parts specified above. An express mechanic\'s lien is acknowledged on vehicle to secure amount of repairs.',
    leftX,
    currentY,
    { font: '/F1', size: 7, color: cSlateMuted }
  );

  // 7. FOOTERS ACROSS ALL PAGES
  const totalPages = pages.length;
  pages.forEach((page, idx) => {
    const pageNum = idx + 1;
    page.drawLine(leftX, 32, rightX, 32, cBorderLine, 0.5);
    page.drawText(
      `Future's Automotive  •  ${meta.invoiceNumber || 'Draft'}`,
      leftX,
      22,
      { font: '/F1', size: 7, color: cSlateMuted }
    );
    page.drawText(
      `Page ${pageNum} of ${totalPages}`,
      rightX,
      22,
      { font: '/F1', size: 7, color: cSlateMuted, align: 'right' }
    );
  });

  // 8. ASSEMBLE PDF-1.4 BINARY OUTPUT
  const writer = new PdfBinaryWriter();

  // PDF-1.4 Header with binary comment (bytes > 127)
  writer.writeString('%PDF-1.4\n');
  writer.writeBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageCount = pages.length;
  const totalObjects = 4 + 2 * pageCount;
  const font1Obj = 3 + 2 * pageCount;
  const font2Obj = 4 + 2 * pageCount;

  const offsets = new Array(totalObjects + 1);

  // Object 1: Catalog
  offsets[1] = writer.getOffset();
  writer.writeString(`1 0 obj\n<<\n  /Type /Catalog\n  /Pages 2 0 R\n>>\nendobj\n`);

  // Object 2: Pages root
  offsets[2] = writer.getOffset();
  const pageKids = [];
  for (let i = 0; i < pageCount; i++) {
    pageKids.push(`${3 + 2 * i} 0 R`);
  }
  writer.writeString(`2 0 obj\n<<\n  /Type /Pages\n  /Kids [${pageKids.join(' ')}]\n  /Count ${pageCount}\n>>\nendobj\n`);

  // Objects for each Page and its Contents stream
  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 3 + 2 * i;
    const contentObjId = 4 + 2 * i;
    const pageContent = pages[i].getStreamBytes();

    // Page dictionary
    offsets[pageObjId] = writer.getOffset();
    writer.writeString(
`${pageObjId} 0 obj\n<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 ${pageWidth} ${pageHeight}]\n  /Contents ${contentObjId} 0 R\n  /Resources <<\n    /Font <<\n      /F1 ${font1Obj} 0 R\n      /F2 ${font2Obj} 0 R\n    >>\n    /ProcSet [/PDF /Text]\n  >>\n>>\nendobj\n`
    );

    // Contents stream
    offsets[contentObjId] = writer.getOffset();
    writer.writeString(`${contentObjId} 0 obj\n<<\n  /Length ${pageContent.byteLength}\n>>\nstream\n`);
    writer.writeBytes(pageContent);
    writer.writeString(`endstream\nendobj\n`);
  }

  // Object: Font F1 (Helvetica)
  offsets[font1Obj] = writer.getOffset();
  writer.writeString(
`${font1Obj} 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica\n  /Encoding /WinAnsiEncoding\n>>\nendobj\n`
  );

  // Object: Font F2 (Helvetica-Bold)
  offsets[font2Obj] = writer.getOffset();
  writer.writeString(
`${font2Obj} 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica-Bold\n  /Encoding /WinAnsiEncoding\n>>\nendobj\n`
  );

  // Cross-reference table (xref)
  const xrefOffset = writer.getOffset();
  writer.writeString(`xref\n0 ${totalObjects + 1}\n`);
  writer.writeString(`0000000000 65535 f \n`);
  for (let i = 1; i <= totalObjects; i++) {
    const offStr = String(offsets[i]).padStart(10, '0');
    writer.writeString(`${offStr} 00000 n \n`);
  }

  // Trailer & EOF
  writer.writeString(
`trailer\n<<\n  /Size ${totalObjects + 1}\n  /Root 1 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return writer.toUint8Array();
}

/**
 * Generates invoice PDF bytes and triggers browser file download if DOM is present.
 * @param {object} invoice
 * @param {object} [totals]
 * @param {string} [filename]
 * @returns {{ filename: string, bytes: Uint8Array, blob: Blob|object }}
 */
export function downloadInvoicePdf(invoice, totals, filename) {
  const defaultName = `invoice-${invoice?.meta?.invoiceNumber || 'draft'}.pdf`;
  const resolvedFilename = filename || defaultName;
  const bytes = generatePdfBytes(invoice, totals);

  let blob;
  if (typeof Blob !== 'undefined') {
    blob = new Blob([bytes], { type: 'application/pdf' });
  } else {
    blob = {
      bytes,
      size: bytes.byteLength,
      type: 'application/pdf',
    };
  }

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = resolvedFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }

  return { filename: resolvedFilename, bytes, blob };
}

/**
 * Safely invokes window.print() if available in the current environment.
 * @returns {boolean}
 */
export function printInvoice() {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return true;
  }
  return false;
}
