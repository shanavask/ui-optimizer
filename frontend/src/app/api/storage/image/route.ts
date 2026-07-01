import { GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const gsPath = request.nextUrl.searchParams.get("path");
  if (!gsPath?.startsWith("gs://")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const withoutScheme = gsPath.slice("gs://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex === -1) {
    return NextResponse.json({ error: "Invalid GCS path" }, { status: 400 });
  }
  const bucket = withoutScheme.slice(0, slashIndex);
  const object = withoutScheme.slice(slashIndex + 1);

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token;
  if (!token) {
    return NextResponse.json({ error: "Failed to obtain access token" }, { status: 500 });
  }

  const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
  const response = await fetch(gcsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return new NextResponse(null, { status: response.status });
  }

  const imageData = await response.arrayBuffer();
  return new NextResponse(imageData, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
