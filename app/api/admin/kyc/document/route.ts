import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, UnauthorizedError } from "@/lib/auth/session";

/**
 * GET /api/admin/kyc/document?path=kyc/<userId>/<file>
 *
 * Streams a private KYC document from Vercel Blob to an authenticated admin.
 * Documents are never public: this route is the only way to view them.
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin();
  } catch (err) {
    const status = err instanceof UnauthorizedError ? 403 : 500;
    return NextResponse.json({ error: "Admin access required" }, { status });
  }

  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!/^kyc\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]+$/i.test(path)) {
    return NextResponse.json({ error: "Invalid document path" }, { status: 400 });
  }

  try {
    const result = await get(path, { access: "private", useCache: false });
    if (!result || !result.stream) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${path.split("/").pop()}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[admin/kyc/document]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not load document" }, { status: 500 });
  }
}
