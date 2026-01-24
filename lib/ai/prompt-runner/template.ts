import "server-only";

export function substituteTemplateVars(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const text = String(value ?? "");
    out = out.replaceAll(`{${key}}`, text);
    out = out.replaceAll(`{{${key}}}`, text);
  }
  return out;
}
