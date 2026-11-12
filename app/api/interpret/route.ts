import { handleInterpret, providerStatus } from "@/lib/llm/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Reports whether an LLM is configured, without exposing any key. */
export async function GET() {
  return Response.json(providerStatus(process.env), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "Could not read the request body." }, { status: 400 });
  }
  const result = await handleInterpret(raw, { env: process.env, fetchImpl: fetch, ip: clientIp(req) });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
