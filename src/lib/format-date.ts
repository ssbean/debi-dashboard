export function formatDate(date: string | Date, timezone: string): string {
  return new Date(date).toLocaleString("en-US", { timeZone: timezone });
}

export function formatDateShort(date: string | Date, timezone: string): string {
  return new Date(date).toLocaleDateString("en-US", { timeZone: timezone });
}
