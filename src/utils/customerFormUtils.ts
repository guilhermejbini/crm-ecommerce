/**
 * Normaliza o WhatsApp digitado no cadastro manual.
 * Campo vazio permanece vazio: nunca preencher com número fictício.
 */
export function normalizeWhatsappInput(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

/**
 * Campo opcional do cadastro manual: vazio vira undefined (nunca um valor padrão inventado).
 */
export function normalizeOptionalText(raw: string | null | undefined): string | undefined {
  const value = String(raw ?? '').trim();
  return value ? value : undefined;
}

/**
 * Nome para exibição. Ausência de nome continua ausência no dado;
 * "Cliente sem nome" é apenas apresentação e nunca deve ser persistido.
 */
export function displayCustomerName(name: string | null | undefined): string {
  const value = String(name ?? '').trim();
  return value || 'Cliente sem nome';
}
