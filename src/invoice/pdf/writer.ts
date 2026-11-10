import { escapePdfTextWinAnsi, helveticaWidth, type Measure } from './text';

/** Low-level PDF-1.4 builders: the binary writer (objects, xref) and a page content stream (rects, lines, text, images, links). */

export type Rgb = readonly [number, number, number];
export interface RectOptions { fill?: Rgb; stroke?: Rgb; lineWidth?: number }
export interface TextOptions { font?: '/F1' | '/F2'; size?: number; color?: Rgb; align?: 'left' | 'right' | 'center' }

export class PdfBinaryWriter {
  private chunks: Uint8Array[] = [];
  private offset = 0;
  private encoder = new TextEncoder();

  writeBytes(bytes: Uint8Array): number {
    this.chunks.push(bytes);
    const start = this.offset;
    this.offset += bytes.byteLength;
    return start;
  }

  writeString(str: string): number {
    return this.writeBytes(this.encoder.encode(str));
  }

  getOffset(): number {
    return this.offset;
  }

  toUint8Array(): Uint8Array {
    const total = new Uint8Array(this.offset);
    let pos = 0;
    for (const chunk of this.chunks) {
      total.set(chunk, pos);
      pos += chunk.byteLength;
    }
    return total;
  }
}

/** A single page accumulating graphics and text commands. */
export interface PdfLink { x: number; y: number; w: number; h: number; url: string }

export class PageStream {
  commands: string[] = [];
  /** Clickable regions (URI link annotations). */
  links: PdfLink[] = [];
  constructor(public pageNumber: number, private measure: Measure = helveticaWidth, private escape: (s: unknown) => string = escapePdfTextWinAnsi) {}

  drawRect(x: number, y: number, w: number, h: number, { fill, stroke, lineWidth = 0.5 }: RectOptions = {}): void {
    this.commands.push('q');
    if (lineWidth) this.commands.push(`${Number(lineWidth).toFixed(2)} w`);
    if (stroke) this.commands.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
    if (fill) this.commands.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
    this.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (fill && stroke) this.commands.push('B');
    else if (fill) this.commands.push('f');
    else this.commands.push('S');
    this.commands.push('Q');
  }

  /** Rounded rectangle (corner radius r). `dash` makes the outline dashed. */
  drawRoundRect(x: number, y: number, w: number, h: number, r: number, { fill, stroke, lineWidth = 0.5, dash }: RectOptions & { dash?: [number, number] } = {}): void {
    const k = 0.5523 * r; const f = (n: number) => n.toFixed(2);
    this.commands.push('q');
    if (lineWidth) this.commands.push(`${Number(lineWidth).toFixed(2)} w`);
    if (dash) this.commands.push(`[${dash[0]} ${dash[1]}] 0 d`);
    if (stroke) this.commands.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
    if (fill) this.commands.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
    this.commands.push(`${f(x + r)} ${f(y)} m`, `${f(x + w - r)} ${f(y)} l`, `${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c`,
      `${f(x + w)} ${f(y + h - r)} l`, `${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c`,
      `${f(x + r)} ${f(y + h)} l`, `${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c`,
      `${f(x)} ${f(y + r)} l`, `${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c`, 'h');
    this.commands.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.commands.push('Q');
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, stroke: Rgb = [0.8, 0.8, 0.8], lineWidth = 0.5): void {
    this.commands.push('q');
    this.commands.push(`${Number(lineWidth).toFixed(2)} w`);
    this.commands.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
    this.commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    this.commands.push('Q');
  }

  drawText(text: unknown, x: number, y: number, { font = '/F1', size = 9, color = [0, 0, 0], align = 'left' }: TextOptions = {}): void {
    const isBold = font === '/F2';
    const str = String(text ?? '');
    let renderX = x;
    if (align === 'right') renderX = x - this.measure(str, size, isBold);
    else if (align === 'center') renderX = x - this.measure(str, size, isBold) / 2;

    const escaped = this.escape(str);
    this.commands.push('BT');
    this.commands.push(`${font} ${Number(size).toFixed(2)} Tf`);
    this.commands.push(`${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg`);
    this.commands.push(`1 0 0 1 ${renderX.toFixed(2)} ${y.toFixed(2)} Tm`);
    this.commands.push(`(${escaped}) Tj`);
    this.commands.push('ET');
  }

  /** Places an image XObject (declared in the page resources) with its lower-left corner at (x, y). */
  drawImage(name: string, x: number, y: number, w: number, h: number): void {
    this.commands.push('q');
    this.commands.push(`${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`);
    this.commands.push(`/${name} Do`);
    this.commands.push('Q');
  }

  addLink(x: number, y: number, w: number, h: number, url: string): void {
    this.links.push({ x, y, w, h, url });
  }

  getStreamBytes(): Uint8Array {
    return new TextEncoder().encode(this.commands.join('\n') + '\n');
  }
}
