import { env } from "cloudflare:workers";
import { createDashboardService, REGIONS } from "../../../lib/dashboard.mjs";
import samples from "../../../samples/dashboard.json";

export const dynamic = "force-dynamic";
// The secret is read only inside the server request path. It is never serialized.
const dashboard = createDashboardService({
  samples,
  configProvider: () => ({ API_KEY: (env as Record<string, unknown>).API_KEY || "" }),
});

export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get("region") || "seoul_all";
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!Object.hasOwn(REGIONS, region)) {
    return Response.json({ error: "지원하지 않는 지역입니다." }, { status: 400, headers });
  }
  try {
    return Response.json(await dashboard(region), { headers });
  } catch {
    return Response.json({ error: "데이터를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  }
}
