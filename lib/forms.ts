/** Trim a FormData value to a string ("" when absent). */
export function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
