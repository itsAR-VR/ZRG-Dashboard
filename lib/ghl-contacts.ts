import { prisma } from "@/lib/prisma";
import { createGHLContact, lookupGHLContact, searchGHLContacts, type GHLContact } from "@/lib/ghl-api";
import { normalizeEmail, normalizePhone } from "@/lib/lead-matching";

export interface EnsureGhlContactIdResult {
  success: boolean;
  ghlContactId?: string;
  linkedExisting?: boolean;
  createdNew?: boolean;
  error?: string;
}

function extractContacts(payload: unknown): GHLContact[] {
  const data = payload as any;
  const candidates: unknown[] =
    (Array.isArray(data?.contacts) && data.contacts) ||
    (Array.isArray(data?.data?.contacts) && data.data.contacts) ||
    (data?.contact ? [data.contact] : []) ||
    (data?.data?.contact ? [data.data.contact] : []) ||
    [];

  return candidates.filter((c): c is GHLContact => !!c && typeof (c as any).id === "string");
}

function pickBestContactId(
  contacts: GHLContact[],
  emailNormalized: string | null,
  phoneNormalized: string | null
): string | null {
  if (contacts.length === 0) return null;

  if (phoneNormalized) {
    const byPhone = contacts.find((c) => normalizePhone(c.phone) === phoneNormalized);
    if (byPhone?.id) return byPhone.id;
  }

  if (emailNormalized) {
    const byEmail = contacts.find((c) => normalizeEmail(c.email) === emailNormalized);
    if (byEmail?.id) return byEmail.id;
  }

  return contacts[0]?.id ?? null;
}

/**
 * Ensure a lead has a `ghlContactId` by resolving an existing contact or creating one.
 * Best-effort: tries lookup/search first to avoid duplicates.
 */
export async function ensureGhlContactIdForLead(
  leadId: string,
  opts: { requirePhone?: boolean; allowCreateWithoutPhone?: boolean } = {}
): Promise<EnsureGhlContactIdResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      ghlContactId: true,
      client: {
        select: {
          ghlLocationId: true,
          ghlPrivateKey: true,
        },
      },
    },
  });

  if (!lead) return { success: false, error: "Lead not found" };
  if (lead.ghlContactId) return { success: true, ghlContactId: lead.ghlContactId, linkedExisting: true };

  const locationId = lead.client.ghlLocationId;
  const privateKey = lead.client.ghlPrivateKey;
  if (!locationId || !privateKey) {
    return { success: false, error: "Workspace is missing GHL configuration" };
  }

  const emailNormalized = normalizeEmail(lead.email);
  const phoneNormalized = normalizePhone(lead.phone);

  if (opts.requirePhone && !phoneNormalized) {
    return { success: false, error: "No phone available to resolve GHL contact" };
  }

  if (!emailNormalized && !phoneNormalized) {
    return { success: false, error: "No email or phone available to resolve GHL contact" };
  }

  // 1) Try lookup endpoint (fast path, if available)
  try {
    const lookup = await lookupGHLContact(
      {
        locationId,
        email: emailNormalized || undefined,
        phone: phoneNormalized || undefined,
      },
      privateKey
    );

    if (lookup.success && lookup.data) {
      const contacts = extractContacts(lookup.data);
      const foundId = pickBestContactId(contacts, emailNormalized, phoneNormalized);
      if (foundId) {
        await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: foundId } });
        return { success: true, ghlContactId: foundId, linkedExisting: true };
      }
    }
  } catch (error) {
    console.warn("[ensureGhlContactIdForLead] lookup failed:", error);
  }

  // 2) Fallback: search endpoint
  try {
    const queries = [
      phoneNormalized,
      emailNormalized,
    ].filter((q): q is string => !!q);

    for (const query of queries) {
      const search = await searchGHLContacts({ locationId, query, limit: 10, skip: 0 }, privateKey);
      if (!search.success || !search.data) continue;

      const contacts = extractContacts(search.data);
      const foundId = pickBestContactId(contacts, emailNormalized, phoneNormalized);
      if (foundId) {
        await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: foundId } });
        return { success: true, ghlContactId: foundId, linkedExisting: true };
      }
    }
  } catch (error) {
    console.warn("[ensureGhlContactIdForLead] search failed:", error);
  }

  // 3) Create new contact (last resort)
  if (!phoneNormalized && !opts.allowCreateWithoutPhone) {
    return { success: false, error: "No phone available to create new GHL contact" };
  }

  const createResult = await createGHLContact(
    {
      locationId,
      firstName: lead.firstName || undefined,
      lastName: lead.lastName || undefined,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      source: "zrg-dashboard",
    },
    privateKey
  );

  const createdId = createResult.data?.contact?.id;
  if (!createResult.success || !createdId) {
    const errorText = createResult.error || "";
    const recovered = errorText.match(/"contactId"\s*:\s*"([^"]+)"/i)?.[1] || null;
    if (recovered) {
      await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: recovered } });
      return { success: true, ghlContactId: recovered, linkedExisting: true };
    }

    return { success: false, error: createResult.error || "Failed to create contact in GHL" };
  }

  await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: createdId } });
  return { success: true, ghlContactId: createdId, createdNew: true };
}
