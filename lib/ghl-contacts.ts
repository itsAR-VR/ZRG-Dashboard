import { prisma } from "@/lib/prisma";
import { searchGHLContactsAdvanced, updateGHLContact, upsertGHLContact, type GHLContact } from "@/lib/ghl-api";
import { normalizeEmail } from "@/lib/lead-matching";
import { normalizePhoneDigits, toGhlPhone, toGhlPhoneBestEffort, toStoredPhone } from "@/lib/phone-utils";

export interface EnsureGhlContactIdResult {
  success: boolean;
  ghlContactId?: string;
  linkedExisting?: boolean;
  createdNew?: boolean;
  error?: string;
}

export interface ResolveGhlContactIdResult {
  success: boolean;
  ghlContactId?: string;
  linkedExisting?: boolean;
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
 * Resolve a lead's `ghlContactId` by searching for an existing GHL contact (no create/upsert).
 *
 * Policy: sync/backfill should only search/link/hydrate and must not create contacts implicitly.
 * Creation/upsert is reserved for explicit workflows (e.g. EmailBison Interested, booking, sending SMS).
 */
export async function resolveGhlContactIdForLead(leadId: string): Promise<ResolveGhlContactIdResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      companyName: true,
      enrichmentStatus: true,
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
  if (!emailNormalized) {
    return { success: true, error: "No email available to resolve GHL contact" };
  }

  try {
    const search = await searchGHLContactsAdvanced(
      {
        locationId,
        page: 1,
        pageLimit: 1,
        filters: [{ field: "email", operator: "eq", value: emailNormalized }],
      },
      privateKey
    );

    if (!search.success || !search.data) {
      return { success: false, error: search.error || "Failed to search contacts in GHL" };
    }

    const first = pickFirstContact(search.data);
    if (!first?.id) {
      return { success: true }; // Not found
    }

    const updateData: Record<string, unknown> = { ghlContactId: first.id };

    // Best-effort hydration from the contact record.
    if (!lead.phone && first.phone) {
      updateData.phone = toStoredPhone(first.phone) || first.phone;
    }
    if (!lead.firstName && first.firstName) {
      updateData.firstName = first.firstName;
    }
    if (!lead.lastName && first.lastName) {
      updateData.lastName = first.lastName;
    }
    if (!lead.companyName && (first as any).companyName) {
      updateData.companyName = (first as any).companyName;
    }

    if (updateData.phone && lead.enrichmentStatus !== "not_needed") {
      updateData.enrichmentStatus = "enriched";
      updateData.enrichmentSource = "ghl";
      updateData.enrichedAt = new Date();
    }

    await prisma.lead.update({ where: { id: leadId }, data: updateData });

    return { success: true, ghlContactId: first.id, linkedExisting: true };
  } catch (error) {
    console.warn("[resolveGhlContactIdForLead] search failed:", error instanceof Error ? error.message : error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to search contacts in GHL" };
  }
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
      enrichmentStatus: true,
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
  const defaultCountryCallingCode = (process.env.GHL_DEFAULT_COUNTRY_CALLING_CODE || "1").trim();
  const phoneForGhl =
    toGhlPhone(lead.phone) || toGhlPhoneBestEffort(lead.phone, { defaultCountryCallingCode });
  const phoneNormalized = phoneForGhl ? normalizePhoneDigits(phoneForGhl) : normalizePhoneDigits(lead.phone);

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
          const updateData: Record<string, unknown> = { ghlContactId: first.id };

          // Best-effort hydration from the contact record (fixes cases where webhook payloads omitted fields).
          if (!lead.phone && first.phone) {
            updateData.phone = toStoredPhone(first.phone) || first.phone;
          }
          if (!lead.firstName && first.firstName) {
            updateData.firstName = first.firstName;
          }
          if (!lead.lastName && first.lastName) {
            updateData.lastName = first.lastName;
          }
          if (!lead.companyName && (first as any).companyName) {
            updateData.companyName = (first as any).companyName;
          }

          // If we found a phone, mark enrichment as complete for this lead.
          if (updateData.phone && lead.enrichmentStatus !== "not_needed") {
            updateData.enrichmentStatus = "enriched";
            updateData.enrichmentSource = "ghl";
            updateData.enrichedAt = new Date();
          }

          await prisma.lead.update({ where: { id: leadId }, data: updateData });

          // If we have fresher standard fields, upsert them onto this contact (best-effort, no tags).
          const existingPhone = normalizePhoneDigits(first.phone as any);
          const ourPhone = phoneNormalized;
          const shouldSendPhone = !!ourPhone && (!existingPhone || existingPhone !== ourPhone);

          await updateGHLContact(
            first.id,
            {
              firstName: lead.firstName || undefined,
              lastName: lead.lastName || undefined,
              email: emailNormalized || undefined,
              phone: shouldSendPhone ? phoneForGhl || undefined : undefined,
              companyName: lead.companyName || undefined,
              website: lead.companyWebsite || undefined,
              timezone: lead.timezone || undefined,
              source: "zrg-dashboard",
            },
            privateKey,
            { locationId }
          ).catch((err) =>
            console.warn(
              "[ensureGhlContactIdForLead] update after search failed:",
              err instanceof Error ? err.message : err
            )
          );

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
  if (opts.requirePhone && !phoneNormalized) {
    return { success: false, error: "No phone available to create new GHL contact" };
  }

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

export async function syncGhlContactPhoneForLead(
  leadId: string,
  opts?: { defaultCountryCallingCode?: string }
): Promise<{ success: boolean; updated?: boolean; error?: string }> {
  try {
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
            ghlPrivateKey: true,
            ghlLocationId: true,
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };
    if (!lead.ghlContactId) return { success: true, updated: false };
    if (!lead.client.ghlPrivateKey) return { success: false, error: "Workspace has no GHL API key configured" };

    const defaultCountryCallingCode =
      opts?.defaultCountryCallingCode?.trim() ||
      (process.env.GHL_DEFAULT_COUNTRY_CALLING_CODE || "").trim() ||
      "1";

    const phoneForGhl =
      // Prefer strict E.164 when possible.
      toGhlPhone(lead.phone) ||
      // Best-effort: allow falling back to a workspace default country code (commonly +1).
      toGhlPhoneBestEffort(lead.phone, { defaultCountryCallingCode });

    if (!phoneForGhl) {
      return { success: false, error: "No usable phone number available to sync to GHL contact" };
    }

    const update = await updateGHLContact(
      lead.ghlContactId,
      {
        firstName: lead.firstName || undefined,
        lastName: lead.lastName || undefined,
        email: lead.email ? normalizeEmail(lead.email) || undefined : undefined,
        phone: phoneForGhl,
        companyName: lead.companyName || undefined,
        website: lead.companyWebsite || undefined,
        timezone: lead.timezone || undefined,
        source: "zrg-dashboard",
      },
      lead.client.ghlPrivateKey,
      { locationId: lead.client.ghlLocationId || undefined }
    );

    if (!update.success) {
      return { success: false, error: update.error || "Failed to update GHL contact phone" };
    }

    return { success: true, updated: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to sync phone to GHL contact" };
  }
}
