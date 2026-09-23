/**
 * Builds a wa.me chat link from whatever an admin entered in Footer
 * Management for the WhatsApp channel — either a bare phone number or a
 * full link (the document that introduced footer contact links
 * explicitly allows either, calling it a "number/link" field). Extracted
 * here because this exact logic was independently duplicated in
 * footer.tsx and Profile.tsx before a third consumer (the floating chat
 * button) needed it too.
 */
export function whatsappHref(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://wa.me/${trimmed.replace(/[^\d]/g, "")}`;
}
