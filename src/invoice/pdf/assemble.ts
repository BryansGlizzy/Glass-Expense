import { escapePdfText } from './text';
import { PdfBinaryWriter, type PageStream } from './writer';
import type { PdfLogo } from '../logo';

/**
 * Writes finished pages as a PDF-1.4 file: catalog, page tree, a page + content stream per page, the two standard fonts, an optional
 * logo image (/DCTDecode, the JPEG bytes unchanged) and link annotations. Used by the sheet-based writer (sheetPdf.ts). Deterministic: no clock, no randomness.
 */
export function assemblePdf(pages: PageStream[], logo: PdfLogo | null): Uint8Array {
  const pageWidth = 612;
  const pageHeight = 792;
  const writer = new PdfBinaryWriter();

  // PDF-1.4 header with a binary comment (bytes > 127)
  writer.writeString('%PDF-1.4\n');
  writer.writeBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageCount = pages.length;
  const annotCount = pages.reduce((n, p) => n + p.links.length, 0);
  // Object layout: catalog, pages, (page, contents) per page, two fonts, then the optional logo image and link annotations.
  // Without a logo and without links this is exactly the original layout.
  const totalObjects = 4 + 2 * pageCount + (logo ? 1 : 0) + annotCount;
  const font1Obj = 3 + 2 * pageCount;
  const font2Obj = 4 + 2 * pageCount;
  const logoObj = logo ? font2Obj + 1 : 0;
  let nextAnnot = font2Obj + (logo ? 2 : 1);
  const annotIds = pages.map(p => p.links.map(() => nextAnnot++));

  const offsets: number[] = new Array(totalObjects + 1);

  // Object 1: Catalog
  offsets[1] = writer.getOffset();
  writer.writeString(`1 0 obj\n<<\n  /Type /Catalog\n  /Pages 2 0 R\n>>\nendobj\n`);

  // Object 2: Pages root
  offsets[2] = writer.getOffset();
  const pageKids: string[] = [];
  for (let i = 0; i < pageCount; i++) pageKids.push(`${3 + 2 * i} 0 R`);
  writer.writeString(`2 0 obj\n<<\n  /Type /Pages\n  /Kids [${pageKids.join(' ')}]\n  /Count ${pageCount}\n>>\nendobj\n`);

  // A Page object and its Contents stream for each page
  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 3 + 2 * i;
    const contentObjId = 4 + 2 * i;
    const pageContent = pages[i].getStreamBytes();
    const xobject = logo ? `    /XObject <<\n      /Im1 ${logoObj} 0 R\n    >>\n` : '';
    const annots = annotIds[i].length ? `  /Annots [${annotIds[i].map(id => `${id} 0 R`).join(' ')}]\n` : '';

    offsets[pageObjId] = writer.getOffset();
    writer.writeString(
`${pageObjId} 0 obj\n<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 ${pageWidth} ${pageHeight}]\n  /Contents ${contentObjId} 0 R\n  /Resources <<\n    /Font <<\n      /F1 ${font1Obj} 0 R\n      /F2 ${font2Obj} 0 R\n    >>\n${xobject}    /ProcSet [/PDF /Text${logo ? ' /ImageC /ImageB' : ''}]\n  >>\n${annots}>>\nendobj\n`,
    );

    offsets[contentObjId] = writer.getOffset();
    writer.writeString(`${contentObjId} 0 obj\n<<\n  /Length ${pageContent.byteLength}\n>>\nstream\n`);
    writer.writeBytes(pageContent);
    writer.writeString(`endstream\nendobj\n`);
  }

  // Fonts
  offsets[font1Obj] = writer.getOffset();
  writer.writeString(`${font1Obj} 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica\n  /Encoding /WinAnsiEncoding\n>>\nendobj\n`);
  offsets[font2Obj] = writer.getOffset();
  writer.writeString(`${font2Obj} 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica-Bold\n  /Encoding /WinAnsiEncoding\n>>\nendobj\n`);

  // Logo: the JPEG bytes are embedded unchanged (/DCTDecode)
  if (logo) {
    offsets[logoObj] = writer.getOffset();
    writer.writeString(`${logoObj} 0 obj\n<<\n  /Type /XObject\n  /Subtype /Image\n  /Width ${logo.width}\n  /Height ${logo.height}\n  /ColorSpace /${logo.components === 1 ? 'DeviceGray' : 'DeviceRGB'}\n  /BitsPerComponent 8\n  /Filter /DCTDecode\n  /Length ${logo.bytes.byteLength}\n>>\nstream\n`);
    writer.writeBytes(logo.bytes);
    writer.writeString(`\nendstream\nendobj\n`);
  }

  // Link annotations (clickable payment links)
  pages.forEach((p, i) => p.links.forEach((l, k) => {
    const id = annotIds[i][k];
    offsets[id] = writer.getOffset();
    writer.writeString(`${id} 0 obj\n<<\n  /Type /Annot\n  /Subtype /Link\n  /Rect [${l.x.toFixed(2)} ${l.y.toFixed(2)} ${(l.x + l.w).toFixed(2)} ${(l.y + l.h).toFixed(2)}]\n  /Border [0 0 0]\n  /A << /S /URI /URI (${escapePdfText(l.url)}) >>\n>>\nendobj\n`);
  }));

  // Cross-reference table
  const xrefOffset = writer.getOffset();
  writer.writeString(`xref\n0 ${totalObjects + 1}\n`);
  writer.writeString(`0000000000 65535 f \n`);
  for (let i = 1; i <= totalObjects; i++) writer.writeString(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);

  // Trailer & EOF
  writer.writeString(`trailer\n<<\n  /Size ${totalObjects + 1}\n  /Root 1 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return writer.toUint8Array();
}
