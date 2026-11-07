// POST /functions/v1/mechanic-app  { action, ... } — the mechanic app at /mechanic/. Public (deploy with --no-verify-jwt): the mechanic's private link token + PIN is the only key.
// All behaviour lives in ../_shared/mechanic-handler.ts (testable in Node); this file only wires the real database, Razorpay and secrets. Needs the same GARAGE_SESSION_SECRET as garage-app (sessions carry their own audience).
import { adminDb, env, json, corsHeaders, sha256Hex, getSetting } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';
import { buildInvoice } from '../_shared/invoice.ts';
import { handleMechanic } from '../_shared/mechanic-handler.ts';

Deno.serve((req) => handleMechanic(req, { db: adminDb(), env, sha256Hex, json, cors: corsHeaders, createPaymentLink, buildInvoice: buildInvoice as any, getSetting }));
