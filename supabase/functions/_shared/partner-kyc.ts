// Partner onboarding rules (pure, no I/O). Used by the partner-onboard Edge Function and tested in tests/partner-onboard.test.mjs.
// Documents are images or PDFs in the private 'kyc' bucket. No identity number is ever typed in or stored: only files.

export type PartnerKind = 'garage' | 'mechanic';

/** Document types per partner kind. A garage does not submit KYC for its mechanics (agreement clause 2) and signs the agreement online. */
export const DOC_TYPES: Record<PartnerKind, string[]> = {
  garage: ['aadhaar_front', 'aadhaar_back', 'pan', 'garage_photo', 'shop_licence', 'signed_agreement'],   // signed_agreement here is only an optional stamped scan; the agreement itself is signed online
  mechanic: ['mechanic_photo', 'aadhaar_front', 'aadhaar_back', 'pan', 'signed_agreement'],
};

/** What must exist before submit. `min` is how many files of that type are needed. */
export const REQUIRED: Record<PartnerKind, { type: string; min: number }[]> = {
  garage: [
    { type: 'aadhaar_front', min: 1 }, { type: 'aadhaar_back', min: 1 }, { type: 'pan', min: 1 }, { type: 'garage_photo', min: 3 },
  ],
  mechanic: [
    { type: 'mechanic_photo', min: 1 }, { type: 'aadhaar_front', min: 1 }, { type: 'aadhaar_back', min: 1 }, { type: 'pan', min: 1 }, { type: 'signed_agreement', min: 1 },
  ],
};

/** Types that can hold several files. Every other type keeps only the latest file. */
export const MULTI: Record<string, number> = { garage_photo: 6 };

export const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export const isKind = (k: unknown): k is PartnerKind => k === 'garage' || k === 'mechanic';
export const isDocType = (kind: PartnerKind, t: unknown): boolean => typeof t === 'string' && DOC_TYPES[kind].includes(t);

/** Validates an upload request. Returns the file extension to use, or an error in plain words. */
export function checkUpload(kind: PartnerKind, docType: unknown, contentType: unknown, size: unknown): { ok: true; ext: string } | { ok: false; error: string } {
  if (!isDocType(kind, docType)) return { ok: false, error: 'This document is not needed.' };
  const ext = EXT[String(contentType ?? '').toLowerCase()];
  if (!ext) return { ok: false, error: 'Upload a photo (JPG, PNG, WebP) or a PDF.' };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'The file looks empty. Try again.' };
  if (n > MAX_BYTES) return { ok: false, error: 'The file is too big. Keep it under 8 MB.' };
  if (docType === 'signed_agreement' && ext !== 'pdf') return { ok: false, error: 'The signed agreement must be one PDF.' };
  return { ok: true, ext };
}

/** Storage path for a new file: <kind>/<partner id>/<type>-<random>.<ext>. */
export function docPath(kind: PartnerKind, partnerId: string, docType: string, random: string, ext: string): string {
  return `${kind}/${partnerId}/${docType}-${random}.${ext}`;
}

/** A path is valid for this partner only if it has exactly our prefix and a safe file name. */
export function pathOk(kind: PartnerKind, partnerId: string, path: unknown): boolean {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `${kind}/${partnerId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[a-z_]+-[a-z0-9]{8,40}\.(jpg|png|webp|pdf)$/.test(path.slice(prefix.length));
}

/** What is still missing, given the documents already uploaded (counts per type, rejected files do not count). */
export function missing(kind: PartnerKind, counts: Record<string, number>): { type: string; need: number }[] {
  return REQUIRED[kind].filter((r) => (counts[r.type] ?? 0) < r.min).map((r) => ({ type: r.type, need: r.min - (counts[r.type] ?? 0) }));
}

export const canSubmit = (kind: PartnerKind, counts: Record<string, number>): boolean => missing(kind, counts).length === 0;

/** Counts accepted or waiting documents per type (rejected ones must be uploaded again). */
export function countDocs(docs: { doc_type: string; status: string }[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const d of docs) if (d.status !== 'rejected') c[d.doc_type] = (c[d.doc_type] ?? 0) + 1;
  return c;
}

/** Plain-words label for each document, for the onboarding page and the Admin screen. */
export const DOC_LABEL: Record<string, string> = {
  aadhaar_front: 'Aadhaar, front', aadhaar_back: 'Aadhaar, back', pan: 'PAN card', garage_photo: 'Garage photos', shop_licence: 'Shop or trade licence (if you have one)',
  mechanic_photo: 'Mechanic photo', mechanic_aadhaar_front: 'Mechanic Aadhaar, front', mechanic_aadhaar_back: 'Mechanic Aadhaar, back', mechanic_pan: 'Mechanic PAN card',
  signed_agreement: 'Signed agreement (one PDF)',
};
