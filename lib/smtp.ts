export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const fallbackGoogleUser = process.env.EMAIL_USER?.trim();
  const fallbackGooglePassword = process.env.GOOGLE_APP_PASSWORD?.replace(
    /\s/g,
    "",
  );
  const user = process.env.SMTP_USER?.trim() || fallbackGoogleUser;
  const pass = process.env.SMTP_PASSWORD || fallbackGooglePassword;
  const usingGoogleFallback = Boolean(
    !process.env.SMTP_HOST && fallbackGoogleUser && fallbackGooglePassword,
  );
  const host =
    process.env.SMTP_HOST?.trim() ||
    (usingGoogleFallback ? "smtp.gmail.com" : undefined);
  const port = Number(process.env.SMTP_PORT || 587);
  const from =
    process.env.SMTP_FROM?.trim() ||
    (fallbackGoogleUser ? `Sthyra CRM <${fallbackGoogleUser}>` : undefined);

  if (
    !host ||
    !user ||
    !pass ||
    !from ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user,
    pass,
    from,
  };
}
