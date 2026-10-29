export function requiredTextError(value: string, field: string): string | null {
  return value.trim() ? null : `Informe ${field}.`;
}
