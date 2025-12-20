import { prisma } from "@/lib/prisma";
import { searchGHLContactsAdvanced, upsertGHLContact, type GHLContact } from "@/lib/ghl-api";
import { normalizeEmail } from "@/lib/lead-matching";
import { normalizePhoneDigits, toGhlPhone, toStoredPhone } from "@/lib/phone-utils";

export interface EnsureGhlContactIdResult {
  success: boolean;
  ghlContactId?: string;
  linkedExisting?: boolean;
  createdNew?: boolean;
  error?: string;
}

function pickFirstContact(payload: unknown): (GHLContact & Record<string, unknown>) | null {
  const data = payload as any;
  const contacts: unknown[] =
    (Array.isArray(data?.contacts) && data.contacts) ||
    (Array.isArray(data?.data?.contacts) && data.data.contacts) ||
    [];

  const first = contacts[0] as any;
  if (!first || typeof first.id !== "string") return null;
  return first as GHLContact & Record<string, unknown>;
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
      companyName: true,
      companyWebsite: true,
      timezone: true,
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
  const phoneForGhl = toGhlPhone(lead.phone);
  const phoneNormalized = phoneForGhl ? normalizePhoneDigits(phoneForGhl) : null;

  if (opts.requirePhone && !phoneNormalized) {
    return { success: false, error: "No phone available to resolve GHL contact" };
  }

  if (!emailNormalized && !phoneNormalized) {
    return { success: false, error: "No email or phone available to resolve GHL contact" };
  }

  // 1) Advanced search by email (preferred)
  try {
    if (emailNormalized) {
      const search = await searchGHLContactsAdvanced(
        {
          locationId,
          page: 1,
          pageLimit: 1,
          filters: [{ field: "email", operator: "eq", value: emailNormalized }],
        },
        privateKey
      );

      if (search.success && search.data) {
        const first = pickFirstContact(search.data);
        if (first?.id) {
          await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: first.id } });

          // If we have fresher standard fields, upsert them onto this contact (best-effort, no tags).
          const existingPhone = normalizePhoneDigits(first.phone as any);
          const ourPhone = phoneNormalized;
          const shouldSendPhone = !!ourPhone && (!existingPhone || existingPhone !== ourPhone);

          await upsertGHLContact(
            {
              locationId,
              firstName: lead.firstName || undefined,
              lastName: lead.lastName || undefined,
              email: emailNormalized || undefined,
              phone: shouldSendPhone ? phoneForGhl || undefined : undefined,
              companyName: lead.companyName || undefined,
              website: lead.companyWebsite || undefined,
              timezone: lead.timezone || undefined,
              source: "zrg-dashboard",
            },
            privateKey
          ).catch((err) => console.warn("[ensureGhlContactIdForLead] upsert after search failed:", err));

          // Ensure our stored phone is canonical (best-effort)
          if (lead.phone) {
            const canonical = toStoredPhone(lead.phone);
            if (canonical && canonical !== lead.phone) {
              await prisma.lead.update({ where: { id: leadId }, data: { phone: canonical } });
            }
          }

          return { success: true, ghlContactId: first.id, linkedExisting: true };
        }
      }
    }
  } catch (error) {
    console.warn("[ensureGhlContactIdForLead] advanced search failed:", error);
  }

  // 2) Upsert contact (create/update based on location configuration)
  if (!phoneNormalized && !opts.allowCreateWithoutPhone) {
    return { success: false, error: "No phone available to create new GHL contact" };
  }

  try {
    const upsert = await upsertGHLContact(
      {
        locationId,
        firstName: lead.firstName || undefined,
        lastName: lead.lastName || undefined,
        email: emailNormalized || undefined,
        phone: phoneForGhl || undefined,
        companyName: lead.companyName || undefined,
        website: lead.companyWebsite || undefined,
        timezone: lead.timezone || undefined,
        source: "zrg-dashboard",
      },
      privateKey
    );

    const contactId = upsert.data?.contactId;
    if (!upsert.success || !contactId) {
      return { success: false, error: upsert.error || "Failed to upsert contact in GHL" };
    }

    await prisma.lead.update({ where: { id: leadId }, data: { ghlContactId: contactId } });

    // Ensure our stored phone is canonical (best-effort)
    if (lead.phone) {
      const canonical = toStoredPhone(lead.phone);
      if (canonical && canonical !== lead.phone) {
        await prisma.lead.update({ where: { id: leadId }, data: { phone: canonical } });
      }
    }

    return { success: true, ghlContactId: contactId, createdNew: true };
  } catch (error) {
    console.warn("[ensureGhlContactIdForLead] upsert failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to upsert contact in GHL" };
  }
}
