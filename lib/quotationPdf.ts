import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

type Quote = Record<string, unknown>;
type Row = Record<string, unknown>;
type PdfColor = ReturnType<typeof rgb>;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 34;

const colors = {
  ink: rgb(0.08, 0.1, 0.09),
  body: rgb(0.2, 0.23, 0.22),
  muted: rgb(0.41, 0.45, 0.43),
  line: rgb(0.78, 0.81, 0.8),
  accent: rgb(0.08, 0.38, 0.3),
  accentSoft: rgb(0.92, 0.96, 0.94),
  tableHeader: rgb(0.95, 0.96, 0.95),
};

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function money(value: unknown, currency: unknown) {
  const amount = Number(value || 0);
  const formatted = Math.abs(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "- " : ""}${clean(currency, "INR")} ${formatted}`;
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

function splitLongWord(
  word: string,
  font: PDFFont,
  size: number,
  width: number,
) {
  const parts: string[] = [];
  let part = "";
  for (const character of word) {
    const next = `${part}${character}`;
    if (part && font.widthOfTextAtSize(next, size) > width) {
      parts.push(part);
      part = character;
    } else {
      part = next;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const paragraphs = String(text ?? "").split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const rawWord of words) {
      const wordParts =
        font.widthOfTextAtSize(rawWord, size) > width
          ? splitLongWord(rawWord, font, size, width)
          : [rawWord];

      for (const word of wordParts) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
    }
    if (line) lines.push(line);
  }

  return lines.length ? lines : [""];
}

function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let result = text;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}…`, size) > width
  ) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function categoryLabel(value: unknown) {
  return clean(value, "Item")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function generateQuotationPdf(quote: Quote): Promise<Buffer> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const companyName = clean(
    quote.company_legal_name || quote.company_name,
    "Company",
  );
  const companyContact = [
    clean(quote.company_contact_email),
    clean(quote.company_phone_number),
  ]
    .filter(Boolean)
    .join("  |  ");
  const quotationNumber = clean(quote.quotation_number, "Quotation");
  const currency = clean(quote.currency, "INR");

  const rightText = (
    value: string,
    xRight: number,
    baseline: number,
    size: number,
    font: PDFFont,
    color: PdfColor = colors.body,
  ) => {
    page.drawText(value, {
      x: xRight - font.widthOfTextAtSize(value, size),
      y: baseline,
      size,
      font,
      color,
    });
  };

  const drawHeader = () => {
    page.drawText(fit(companyName, bold, 13, 280), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN,
      size: 13,
      font: bold,
      color: colors.accent,
    });
    if (companyContact) {
      page.drawText(fit(companyContact, regular, 7.5, 280), {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - 15,
        size: 7.5,
        font: regular,
        color: colors.muted,
      });
    }

    rightText(
      "QUOTATION",
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - MARGIN - 2,
      20,
      bold,
      colors.ink,
    );
    rightText(
      `${quotationNumber}  |  V${clean(quote.version, "1")}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - MARGIN - 19,
      8,
      regular,
      colors.muted,
    );
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 32 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN - 32 },
      thickness: 1.2,
      color: colors.accent,
    });
  };

  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    drawHeader();
    y = PAGE_HEIGHT - MARGIN - 54;
  };

  const ensure = (height: number) => {
    if (y - height < MARGIN + FOOTER_HEIGHT) addPage();
  };

  const sectionHeading = (label: string) => {
    ensure(26);
    page.drawText(label.toUpperCase(), {
      x: MARGIN,
      y,
      size: 8,
      font: bold,
      color: colors.accent,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 7 },
      end: { x: PAGE_WIDTH - MARGIN, y: y - 7 },
      thickness: 0.45,
      color: colors.line,
    });
    y -= 23;
  };

  const drawLabel = (label: string, x: number, baseline: number) => {
    page.drawText(label.toUpperCase(), {
      x,
      y: baseline,
      size: 7,
      font: bold,
      color: colors.muted,
    });
  };

  const drawWrapped = (
    value: string,
    options: {
      x?: number;
      width?: number;
      size?: number;
      font?: PDFFont;
      color?: PdfColor;
      lineHeight?: number;
    } = {},
  ) => {
    const x = options.x ?? MARGIN;
    const width = options.width ?? CONTENT_WIDTH;
    const size = options.size ?? 9;
    const selectedFont = options.font ?? regular;
    const lineHeight = options.lineHeight ?? size + 3;
    const lines = wrap(value, selectedFont, size, width);
    ensure(lines.length * lineHeight);
    for (const line of lines) {
      page.drawText(line, {
        x,
        y,
        size,
        font: selectedFont,
        color: options.color ?? colors.body,
      });
      y -= lineHeight;
    }
    return lines.length * lineHeight;
  };

  const drawTableFrame = (
    x: number,
    top: number,
    width: number,
    height: number,
    fill?: PdfColor,
  ) => {
    page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      borderWidth: 0.45,
      borderColor: colors.line,
      ...(fill ? { color: fill } : {}),
    });
  };

  addPage();

  const customerName = clean(
    `${clean(quote.first_name)} ${clean(quote.last_name)}`,
    "Customer",
  );
  const customerContact = [
    clean(quote.contact_email),
    clean(quote.contact_phone_number),
  ]
    .filter(Boolean)
    .join("  |  ");
  const projectName = clean(quote.project_name, "Not specified");
  const projectCode = clean(quote.project_code);
  const leftWidth = 292;
  const rightX = MARGIN + 316;

  page.drawText(fit(clean(quote.title, "Customer quotation"), bold, 15, leftWidth), {
    x: MARGIN,
    y,
    size: 15,
    font: bold,
    color: colors.ink,
  });
  y -= 28;

  const detailsTop = y;
  drawLabel("Quotation for", MARGIN, detailsTop);
  page.drawText(fit(customerName, bold, 11, leftWidth), {
    x: MARGIN,
    y: detailsTop - 15,
    size: 11,
    font: bold,
    color: colors.ink,
  });
  if (customerContact) {
    page.drawText(fit(customerContact, regular, 8, leftWidth), {
      x: MARGIN,
      y: detailsTop - 29,
      size: 8,
      font: regular,
      color: colors.muted,
    });
  }
  drawLabel("Project", MARGIN, detailsTop - 52);
  page.drawText(
    fit(
      projectCode ? `${projectName} (${projectCode})` : projectName,
      bold,
      9.5,
      leftWidth,
    ),
    {
      x: MARGIN,
      y: detailsTop - 67,
      size: 9.5,
      font: bold,
      color: colors.body,
    },
  );

  const metadata = [
    ["Issued", date(quote.created_at)],
    ["Valid until", date(quote.valid_until)],
    ["Currency", currency],
  ];
  metadata.forEach(([label, value], index) => {
    const baseline = detailsTop - index * 21;
    drawLabel(label, rightX, baseline);
    rightText(value, PAGE_WIDTH - MARGIN, baseline, 8.5, bold, colors.body);
  });
  y = detailsTop - 91;

  sectionHeading("Quotation details");

  const columns = {
    number: { x: MARGIN, width: 28 },
    description: { x: MARGIN + 28, width: 235 },
    quantity: { x: MARGIN + 263, width: 55 },
    unit: { x: MARGIN + 318, width: 92 },
    amount: { x: MARGIN + 410, width: 101 },
  };

  const drawLineItemHeader = () => {
    const top = y;
    drawTableFrame(MARGIN, top, CONTENT_WIDTH, 25, colors.tableHeader);
    const headerY = top - 16;
    const header = (label: string, x: number, width: number, alignRight = false) => {
      const textWidth = bold.widthOfTextAtSize(label, 7);
      page.drawText(label, {
        x: alignRight ? x + width - 7 - textWidth : x + 7,
        y: headerY,
        size: 7,
        font: bold,
        color: colors.muted,
      });
    };
    header("#", columns.number.x, columns.number.width);
    header("DESCRIPTION", columns.description.x, columns.description.width);
    header("QTY", columns.quantity.x, columns.quantity.width, true);
    header("UNIT PRICE", columns.unit.x, columns.unit.width, true);
    header("AMOUNT", columns.amount.x, columns.amount.width, true);
    y -= 25;
  };

  drawLineItemHeader();
  const lineItems = Array.isArray(quote.line_items)
    ? (quote.line_items as Row[])
    : [];

  lineItems.forEach((item, index) => {
    const description = clean(item.description, "Line item");
    const descriptionLines = wrap(
      description,
      bold,
      8.5,
      columns.description.width - 14,
    );
    const rowHeight = Math.max(38, 19 + descriptionLines.length * 10);
    if (y - rowHeight < MARGIN + FOOTER_HEIGHT) {
      addPage();
      sectionHeading("Quotation details — continued");
      drawLineItemHeader();
    }
    const top = y;
    drawTableFrame(MARGIN, top, CONTENT_WIDTH, rowHeight);
    const baseline = top - 17;
    page.drawText(String(index + 1), {
      x: columns.number.x + 7,
      y: baseline,
      size: 8.5,
      font: regular,
      color: colors.body,
    });
    descriptionLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: columns.description.x + 7,
        y: baseline - lineIndex * 10,
        size: 8.5,
        font: bold,
        color: colors.ink,
      });
    });
    page.drawText(categoryLabel(item.category), {
      x: columns.description.x + 7,
      y: top - rowHeight + 8,
      size: 6.5,
      font: regular,
      color: colors.muted,
    });
    rightText(
      Number(item.quantity || 0).toLocaleString("en-IN"),
      columns.quantity.x + columns.quantity.width - 7,
      baseline,
      8.5,
      regular,
    );
    rightText(
      money(item.unit_price, currency),
      columns.unit.x + columns.unit.width - 7,
      baseline,
      8,
      regular,
    );
    rightText(
      money(item.amount, currency),
      columns.amount.x + columns.amount.width - 7,
      baseline,
      8.5,
      bold,
      colors.ink,
    );
    y -= rowHeight;
  });

  if (!lineItems.length) {
    drawTableFrame(MARGIN, y, CONTENT_WIDTH, 34);
    page.drawText("No line items", {
      x: MARGIN + 7,
      y: y - 20,
      size: 8.5,
      font: regular,
      color: colors.muted,
    });
    y -= 34;
  }

  const taxes = Array.isArray(quote.tax_breakdown)
    ? (quote.tax_breakdown as Row[])
    : [];
  const summaryRows: Array<{
    label: string;
    value: unknown;
    total?: boolean;
    muted?: boolean;
  }> = [
    { label: "Subtotal", value: quote.subtotal },
  ];
  if (Number(quote.discount_amount || 0) !== 0) {
    summaryRows.push({
      label: "Discount",
      value: Number(quote.discount_amount || 0) * -1,
      muted: true,
    });
  }
  taxes.forEach((tax) => {
    summaryRows.push({
      label: `${clean(tax.label, "Tax")} (${clean(tax.rate, "0")}%)`,
      value: tax.amount,
    });
  });
  if (!taxes.length && Number(quote.tax_amount || 0) !== 0) {
    summaryRows.push({ label: "Tax", value: quote.tax_amount });
  }
  summaryRows.push({ label: "Total", value: quote.total_amount, total: true });

  const summaryWidth = 228;
  const summaryX = PAGE_WIDTH - MARGIN - summaryWidth;
  const summaryHeight = summaryRows.reduce(
    (height, row) => height + (row.total ? 34 : 25),
    0,
  );
  ensure(summaryHeight + 20);
  y -= 10;
  let summaryY = y;
  summaryRows.forEach((row) => {
    const rowHeight = row.total ? 34 : 25;
    drawTableFrame(
      summaryX,
      summaryY,
      summaryWidth,
      rowHeight,
      row.total ? colors.accentSoft : undefined,
    );
    const baseline = summaryY - (row.total ? 22 : 16);
    page.drawText(row.label, {
      x: summaryX + 9,
      y: baseline,
      size: row.total ? 10 : 8.5,
      font: row.total ? bold : regular,
      color: row.total ? colors.accent : colors.body,
    });
    rightText(
      money(row.value, currency),
      summaryX + summaryWidth - 9,
      baseline,
      row.total ? 10 : 8.5,
      row.total ? bold : regular,
      row.total ? colors.accent : row.muted ? colors.muted : colors.body,
    );
    summaryY -= rowHeight;
  });
  y = summaryY - 24;

  const paymentPlan = isRecord(quote.payment_plan) ? quote.payment_plan : {};
  const installments = Array.isArray(paymentPlan.installments)
    ? (paymentPlan.installments as Row[])
    : [];

  if (installments.length) {
    sectionHeading(
      `Payment schedule · ${clean(paymentPlan.template_name, "Custom")}`,
    );
    const paymentColumns = [42, 202, 58, 101, 108];
    const paymentLabels = ["#", "MILESTONE", "SHARE", "AMOUNT", "DUE"];
    let x = MARGIN;
    drawTableFrame(MARGIN, y, CONTENT_WIDTH, 24, colors.tableHeader);
    paymentLabels.forEach((label, index) => {
      page.drawText(label, {
        x: x + 7,
        y: y - 15,
        size: 7,
        font: bold,
        color: colors.muted,
      });
      x += paymentColumns[index];
    });
    y -= 24;

    installments.forEach((installment, index) => {
      ensure(36);
      const top = y;
      drawTableFrame(MARGIN, top, CONTENT_WIDTH, 36);
      let columnX = MARGIN;
      const values = [
        String(index + 1),
        clean(installment.label, `Installment ${index + 1}`),
        `${clean(installment.percentage, "0")}%`,
        money(installment.amount, currency),
        installment.due_date
          ? date(installment.due_date)
          : clean(installment.trigger, "On acceptance"),
      ];
      values.forEach((value, valueIndex) => {
        page.drawText(
          fit(value, valueIndex === 1 ? bold : regular, 8, paymentColumns[valueIndex] - 14),
          {
            x: columnX + 7,
            y: top - 21,
            size: 8,
            font: valueIndex === 1 ? bold : regular,
            color: valueIndex === 1 ? colors.ink : colors.body,
          },
        );
        columnX += paymentColumns[valueIndex];
      });
      y -= 36;
    });
    y -= 24;
  }

  if (quote.customer_message) {
    sectionHeading("Message for the customer");
    const messageLines = wrap(
      clean(quote.customer_message),
      regular,
      9,
      CONTENT_WIDTH - 24,
    );
    const messageHeight = Math.max(44, messageLines.length * 12 + 22);
    ensure(messageHeight + 20);
    drawTableFrame(MARGIN, y, CONTENT_WIDTH, messageHeight, colors.accentSoft);
    const startY = y - 18;
    messageLines.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + 12,
        y: startY - index * 12,
        size: 9,
        font: regular,
        color: colors.body,
      });
    });
    y -= messageHeight + 24;
  }

  if (quote.terms_and_conditions) {
    sectionHeading("Terms and conditions");
    drawWrapped(clean(quote.terms_and_conditions), {
      size: 8.5,
      lineHeight: 12,
      color: colors.body,
    });
  }

  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({
      start: { x: MARGIN, y: MARGIN + 23 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 23 },
      thickness: 0.45,
      color: colors.line,
    });
    const footer = companyContact ? `${companyName}  |  ${companyContact}` : companyName;
    pdfPage.drawText(fit(footer, regular, 7, CONTENT_WIDTH - 70), {
      x: MARGIN,
      y: MARGIN + 9,
      size: 7,
      font: regular,
      color: colors.muted,
    });
    const pageNumber = `${index + 1} / ${pages.length}`;
    pdfPage.drawText(pageNumber, {
      x:
        PAGE_WIDTH -
        MARGIN -
        regular.widthOfTextAtSize(pageNumber, 7),
      y: MARGIN + 9,
      size: 7,
      font: regular,
      color: colors.muted,
    });
  });

  document.setTitle(`${quotationNumber} - ${projectName}`);
  document.setAuthor(companyName);
  document.setSubject("Customer quotation");
  document.setCreationDate(new Date());
  return Buffer.from(await document.save());
}
