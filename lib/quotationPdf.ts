import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

type Quote = Record<string, unknown>;

function money(value: unknown, currency: unknown) {
  return `${String(currency || "INR")} ${Number(value || 0).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function date(value: unknown) {
  if (!value) return "Not specified";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generateQuotationPdf(quote: Quote): Promise<Buffer> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 48;
  let page!: PDFPage;
  let y!: number;

  const addPage = () => {
    page = document.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText(String(quote.company_name || "STHYRA CRM"), {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: rgb(0.12, 0.44, 0.35),
    });
    page.drawLine({
      start: { x: margin, y: y - 12 },
      end: { x: pageSize[0] - margin, y: y - 12 },
      thickness: 0.7,
      color: rgb(0.82, 0.86, 0.84),
    });
    y -= 38;
  };
  const ensure = (height: number) => {
    if (y - height < margin) addPage();
  };
  const text = (
    value: unknown,
    options: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      gap?: number;
    } = {},
  ) => {
    const size = options.size ?? 10;
    const selectedFont = options.font ?? regular;
    const lines = wrap(
      String(value ?? ""),
      selectedFont,
      size,
      options.width ?? pageSize[0] - margin * 2,
    );
    ensure(lines.length * (size + 4));
    for (const line of lines) {
      page.drawText(line, {
        x: options.x ?? margin,
        y,
        size,
        font: selectedFont,
        color: options.color ?? rgb(0.12, 0.15, 0.14),
      });
      y -= size + 4;
    }
    y -= options.gap ?? 0;
  };

  addPage();
  text("QUOTATION", { size: 25, font: bold, gap: 4 });
  text(String(quote.title || quote.quotation_number), {
    size: 13,
    font: bold,
    color: rgb(0.18, 0.26, 0.23),
  });
  text(
    `${String(quote.quotation_number)}  |  Version ${String(quote.version)}  |  Valid until ${date(quote.valid_until)}`,
    { size: 9, color: rgb(0.38, 0.43, 0.41), gap: 12 },
  );

  const customer =
    `${String(quote.first_name || "")} ${String(quote.last_name || "")}`.trim();
  text("PREPARED FOR", { size: 8, font: bold, color: rgb(0.38, 0.43, 0.41) });
  text(customer || "Customer", { size: 13, font: bold });
  text(
    [quote.contact_email, quote.contact_phone_number]
      .filter(Boolean)
      .join("  |  "),
    { size: 9, color: rgb(0.38, 0.43, 0.41), gap: 8 },
  );
  text("PROJECT", { size: 8, font: bold, color: rgb(0.38, 0.43, 0.41) });
  text(`${String(quote.project_name)} (${String(quote.project_code)})`, {
    size: 12,
    font: bold,
    gap: 14,
  });

  text("PRICING", { size: 10, font: bold, gap: 6 });
  const lineItems = Array.isArray(quote.line_items)
    ? (quote.line_items as Array<Record<string, unknown>>)
    : [];
  lineItems.forEach((item, index) => {
    ensure(34);
    const label = `${index + 1}. ${String(item.description || "Line item")}`;
    page.drawText(label.slice(0, 72), {
      x: margin,
      y,
      size: 9,
      font: regular,
      color: rgb(0.12, 0.15, 0.14),
    });
    const amount = money(item.amount, quote.currency);
    page.drawText(amount, {
      x: pageSize[0] - margin - bold.widthOfTextAtSize(amount, 9),
      y,
      size: 9,
      font: bold,
      color: rgb(0.12, 0.15, 0.14),
    });
    y -= 18;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageSize[0] - margin, y },
      thickness: 0.35,
      color: rgb(0.88, 0.9, 0.89),
    });
    y -= 12;
  });

  const summary = [
    ["Subtotal", quote.subtotal],
    ["Discount", Number(quote.discount_amount || 0) * -1],
    ["Tax", quote.tax_amount],
    ["Total", quote.total_amount],
  ] as const;
  ensure(110);
  for (const [label, amount] of summary) {
    const total = label === "Total";
    page.drawText(label, {
      x: 340,
      y,
      size: total ? 12 : 9,
      font: total ? bold : regular,
      color: rgb(0.2, 0.25, 0.23),
    });
    const formatted = money(amount, quote.currency);
    page.drawText(formatted, {
      x:
        pageSize[0] -
        margin -
        (total ? bold : regular).widthOfTextAtSize(formatted, total ? 12 : 9),
      y,
      size: total ? 12 : 9,
      font: total ? bold : regular,
      color: total ? rgb(0.12, 0.44, 0.35) : rgb(0.2, 0.25, 0.23),
    });
    y -= total ? 22 : 17;
  }
  y -= 12;

  const paymentPlan = isRecord(quote.payment_plan) ? quote.payment_plan : {};
  const installments = Array.isArray(paymentPlan.installments)
    ? (paymentPlan.installments as Array<Record<string, unknown>>)
    : [];
  if (installments.length) {
    text(`PAYMENT PLAN — ${String(paymentPlan.template_name || "Custom")}`, {
      size: 10,
      font: bold,
      gap: 5,
    });
    installments.forEach((installment, index) => {
      text(
        `${index + 1}. ${String(installment.label)} — ${String(installment.percentage)}% — ${money(installment.amount, quote.currency)}${installment.due_date ? ` — ${date(installment.due_date)}` : ""}${installment.trigger ? ` — ${String(installment.trigger)}` : ""}`,
        { size: 9, gap: 2 },
      );
    });
    y -= 8;
  }

  const taxes = Array.isArray(quote.tax_breakdown)
    ? (quote.tax_breakdown as Array<Record<string, unknown>>)
    : [];
  if (taxes.length) {
    text("TAX BREAKDOWN", { size: 10, font: bold, gap: 5 });
    taxes.forEach((tax) =>
      text(
        `${String(tax.label)} (${String(tax.rate)}%): ${money(tax.amount, quote.currency)}`,
        { size: 9, gap: 1 },
      ),
    );
    y -= 8;
  }

  if (quote.customer_message) {
    text("MESSAGE", { size: 10, font: bold, gap: 5 });
    text(quote.customer_message, { size: 9, gap: 10 });
  }
  if (quote.terms_and_conditions) {
    text("TERMS AND CONDITIONS", { size: 10, font: bold, gap: 5 });
    text(quote.terms_and_conditions, { size: 8.5, gap: 10 });
  }

  ensure(48);
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageSize[0] - margin, y },
    thickness: 0.6,
    color: rgb(0.82, 0.86, 0.84),
  });
  y -= 18;
  text(
    [
      quote.company_legal_name || quote.company_name,
      quote.company_contact_email,
      quote.company_phone_number,
    ]
      .filter(Boolean)
      .join("  |  "),
    { size: 8, color: rgb(0.38, 0.43, 0.41) },
  );

  document.setTitle(
    `${String(quote.quotation_number)} - ${String(quote.project_name)}`,
  );
  document.setAuthor(String(quote.company_name || "Sthyra CRM"));
  document.setSubject("Customer quotation");
  document.setCreationDate(new Date());
  return Buffer.from(await document.save());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
