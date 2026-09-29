export function isKnockoutPlaceholder(value: string) {
  const text = value.normalize("NFKC").replace(/\s+/g, "");
  return /^[A-Z]组第(?:\d+|[一二三四五六七八])(?:名)?$/i.test(text) || /^(?:第?[\d+]+场|某场).*(?:胜|负)(?:者|方)?$/.test(text);
}
export function validMatchNumber(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99999;
}
