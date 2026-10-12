import { NextRequest, NextResponse } from "next/server";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { listCities, listCountries, listStates } from "@/lib/locationCatalog";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const level = request.nextUrl.searchParams.get("level") ?? "countries";
  const countryCode = request.nextUrl.searchParams.get("country")?.trim() ?? "";
  const stateCode = request.nextUrl.searchParams.get("state")?.trim() ?? "";

  let locations;
  if (level === "countries") {
    locations = listCountries();
  } else if (level === "states") {
    if (!countryCode) {
      return NextResponse.json(
        { error: "country is required when listing states" },
        { status: 400 },
      );
    }
    locations = listStates(countryCode);
  } else if (level === "cities") {
    if (!countryCode) {
      return NextResponse.json(
        { error: "country is required when listing cities" },
        { status: 400 },
      );
    }
    locations = listCities(countryCode, stateCode || null);
  } else {
    return NextResponse.json(
      { error: "level must be countries, states, or cities" },
      { status: 400 },
    );
  }

  if (locations === null) {
    return NextResponse.json({ error: "Unknown country" }, { status: 404 });
  }

  const response = NextResponse.json({ locations });
  response.headers.set("Cache-Control", "private, max-age=86400");
  return response;
}
