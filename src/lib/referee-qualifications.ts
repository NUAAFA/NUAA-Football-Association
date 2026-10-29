export const refereeQualifications = [
  "暂无正式裁判资质",
  "国家三级",
  "国家二级",
  "国家一级",
  "预备国家级",
  "国家级",
  "国际级",
] as const;

export type RefereeQualification = (typeof refereeQualifications)[number];

export function isRefereeQualification(value: string): value is RefereeQualification {
  return refereeQualifications.includes(value as RefereeQualification);
}

export function normalizeRefereeQualification(value?: string) {
  return value && isRefereeQualification(value) ? value : refereeQualifications[0];
}

/** Only registered certificate levels belong in public appointment displays. */
export function getPublicRefereeQualification(value?: string | null) {
  const level = value?.trim();
  return level && isRefereeQualification(level) && level !== refereeQualifications[0] ? level : null;
}

export function formatPublicRefereeName(name: string, level?: string | null) {
  const qualification = getPublicRefereeQualification(level);
  return qualification ? `${name}（${qualification}）` : name;
}
