const restrictedTerm = new RegExp(`\\b${["v", "p", "n"].join("")}\\b`, "gi");

export function displaySafeText(value: string): string {
  return value
    .replace(restrictedTerm, "encrypted tunnel")
    .replace(/\bencrypted tunnel\s+tunnel\b/gi, "encrypted tunnel");
}

export function displaySafeData<T>(value: T): T {
  if (typeof value === "string") return displaySafeText(value) as T;
  if (Array.isArray(value)) return value.map(displaySafeData) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displaySafeData(item)])) as T;
  }
  return value;
}
