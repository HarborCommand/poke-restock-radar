import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, privateNoStoreHeaders } from "@/lib/http";
import { exportBackup, importBackup } from "@/lib/radar-service";
import { backupImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBackupImportBytes = 5 * 1024 * 1024;

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = user.role === "ADMIN" ? null : NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (adminResponse) return adminResponse;

  return NextResponse.json(await exportBackup(), {
    headers: {
      ...privateNoStoreHeaders,
      "Content-Disposition": `attachment; filename="poke-restock-radar-operational-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > maxBackupImportBytes) {
      return NextResponse.json({ error: "Backup imports are limited to 5 MB." }, { status: 413, headers: privateNoStoreHeaders });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > maxBackupImportBytes) {
      return NextResponse.json({ error: "Backup imports are limited to 5 MB." }, { status: 413, headers: privateNoStoreHeaders });
    }
    const input = backupImportSchema.parse(JSON.parse(raw));
    const result = await importBackup(input);
    await logAudit({
      user,
      action: "backup.operational.imported",
      entityType: "SYSTEM",
      summary: `${user.email} imported an operational backup.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
