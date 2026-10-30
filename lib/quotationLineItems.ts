export type ShortlistPricingItem = {
  unit_id: string;
  unit_code?: string | null;
  unit_name?: string | null;
  type_name?: string | null;
  currency?: string | null;
  amount?: number | string | null;
  saleable_area_sqft?: number | string | null;
  price_per_sqft?: number | string | null;
  pricing_components?: Record<string, unknown> | null;
};

export type DerivedQuotationLineItem = {
  unit_id: string;
  category: "base_price" | "other";
  description: string;
  quantity: number;
  unit_price: number;
  unit_of_measure: "sq ft" | null;
  unit_code?: string | null;
  unit_name?: string | null;
  type_name?: string | null;
  currency?: string | null;
};

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function quotationItemsFromShortlist(
  items: ShortlistPricingItem[],
): DerivedQuotationLineItem[] {
  return items.flatMap<DerivedQuotationLineItem>((item) => {
    const description =
      item.unit_name || item.unit_code || item.type_name || "Inventory unit";
    const common = {
      unit_id: item.unit_id,
      unit_code: item.unit_code ?? null,
      unit_name: item.unit_name ?? null,
      type_name: item.type_name ?? null,
      currency: item.currency ?? null,
    };
    const area = finiteNumber(item.saleable_area_sqft);
    const rate = finiteNumber(item.price_per_sqft);

    if (area === null || area <= 0 || rate === null || rate < 0) {
      return [
        {
          ...common,
          category: "base_price" as const,
          description,
          quantity: 1,
          unit_price: finiteNumber(item.amount) ?? 0,
          unit_of_measure: null,
        },
      ];
    }

    const components = Object.entries(item.pricing_components ?? {}).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]) &&
        entry[1] > 0,
    );
    return [
      {
        ...common,
        category: "base_price" as const,
        description: `${description} base price`,
        quantity: area,
        unit_price: rate,
        unit_of_measure: "sq ft" as const,
      },
      ...components.map(([label, amount]) => ({
        ...common,
        category: "other" as const,
        description: label,
        quantity: 1,
        unit_price: amount,
        unit_of_measure: null,
      })),
    ];
  });
}
