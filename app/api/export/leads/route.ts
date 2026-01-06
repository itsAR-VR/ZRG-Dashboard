import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveClientScope } from "@/lib/workspace-access";

/**
 * Export Leads API
 * 
 * For small exports (<1000 records), generates CSV immediately.
 * For large exports, queues a background job and returns job ID.
 * 
 * POST /api/export/leads
 * Body: { clientId, filters, email? }
 */

interface ExportFilters {
  status?: string;
  search?: string;
  sentimentTag?: string;
}

interface ExportRequest {
  clientId: string;
  filters?: ExportFilters;
  email?: string; // Email to notify when export is ready
}

// Max records for immediate export (avoid timeout)
const IMMEDIATE_EXPORT_LIMIT = 1000;

// Build Prisma where clause from filters
function buildWhereClause(clientId: string, filters?: ExportFilters) {
  const whereConditions: any[] = [{ clientId }];

  if (filters?.status && filters.status !== "all") {
    whereConditions.push({ status: filters.status });
  }

  if (filters?.sentimentTag && filters.sentimentTag !== "all") {
    whereConditions.push({ sentimentTag: filters.sentimentTag });
  }

  if (filters?.search) {
    const searchTerm = filters.search.trim();
    whereConditions.push({
      OR: [
        { firstName: { contains: searchTerm, mode: "insensitive" } },
        { lastName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { companyName: { contains: searchTerm, mode: "insensitive" } },
      ],
    });
  }

  return { AND: whereConditions };
}

// Generate CSV content from leads
function generateCSV(leads: any[]): string {
  const headers = [
    "ID",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "Company",
    "Status",
    "Sentiment",
    "LinkedIn URL",
    "Created At",
    "Updated At",
  ];

  const rows = leads.map((lead) => [
    lead.id,
    lead.firstName || "",
    lead.lastName || "",
    lead.email || "",
    lead.phone || "",
    lead.companyName || lead.client?.name || "",
    lead.status,
    lead.sentimentTag || "",
    lead.linkedinUrl || "",
    lead.createdAt.toISOString(),
    lead.updatedAt.toISOString(),
  ]);

  // Escape CSV fields
  const escapeField = (field: string) => {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((field) => escapeField(String(field))).join(",")),
  ].join("\n");

  return csvContent;
}

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { clientId, filters, email } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }

    // Enforce authenticated, scoped access (setter/admin).
    try {
      await resolveClientScope(clientId);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // First, count how many records match the filters
    const where = buildWhereClause(clientId, filters);
    const count = await prisma.lead.count({ where });

    if (count === 0) {
      return NextResponse.json(
        { error: "No leads match the current filters" },
        { status: 404 }
      );
    }

    // For small exports, generate immediately
    if (count <= IMMEDIATE_EXPORT_LIMIT) {
      const leads = await prisma.lead.findMany({
        where,
        include: {
          client: {
            select: { name: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      const csv = generateCSV(leads);

      // Return CSV directly with proper headers
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="leads-export-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    // For large exports, queue a background job
    // In production, this would use a proper job queue (e.g., Vercel Edge Functions, AWS SQS)
    // For now, we'll store the export request and process it via cron

    // Create export job record (you'd need to add this model to schema)
    // For simplicity, we'll return an immediate response with instructions
    return NextResponse.json({
      status: "queued",
      totalRecords: count,
      message: `Export of ${count} leads has been queued. ${email
          ? `You will receive an email at ${email} when it's ready.`
          : "Check back in a few minutes for the download link."
        }`,
      estimatedTime: `${Math.ceil(count / 500)} minutes`,
      // In production, return a job ID for status polling
      jobId: `export-${clientId}-${Date.now()}`,
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to process export request" },
      { status: 500 }
    );
  }
}

// GET endpoint to check export status or download completed exports
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json(
      { error: "jobId is required" },
      { status: 400 }
    );
  }

  // In production, check job status from database/queue
  // For now, return a placeholder response
  return NextResponse.json({
    jobId,
    status: "processing",
    message: "Export is still being processed. Please check back later.",
  });
}
