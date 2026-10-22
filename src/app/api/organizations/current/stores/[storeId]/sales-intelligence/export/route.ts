import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { periodRequestFromSearch } from "@/modules/intelligence/application/intelligence-service";
import {
  datasetFromSearch,
  granularityFromSearch,
} from "@/modules/sales-intelligence/application/query";
import { getSalesExport } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { NO_STORE, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * CSV export of the same snapshot the dashboard renders.
 *
 * `?dataset=summary|trends|anomalies` chooses the section; every dataset goes
 * through the identical service call, so tenant filtering, period resolution,
 * currency rules, and coverage semantics cannot diverge between screen and file.
 * The body is UTF-8 with a BOM so Arabic headers open correctly in Excel.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const { filename, csv } = await getSalesExport(
    getDb(),
    context,
    storeId,
    periodRequestFromSearch(search),
    datasetFromSearch(search),
    granularityFromSearch(search),
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
