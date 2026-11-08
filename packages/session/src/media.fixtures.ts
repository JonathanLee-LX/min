/** Tiny magic-byte fixtures. Not valid images/PDFs beyond the header. */

export const PNG_SIG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

export const JPEG_SIG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

export const GIF_SIG = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0,
]);

export const WEBP_SIG = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
]);

export const PDF_SIG = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

export const SVG_XML = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
);

export const EMPTY = new Uint8Array();

export const README_TXT = new TextEncoder().encode("hello from file");

export const ZIP_SIG = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

export const OLE_SIG = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

export function withPngHeader(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_SIG.slice(0, 8));
  return bytes;
}

export function withPdfHeader(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PDF_SIG);
  return bytes;
}
