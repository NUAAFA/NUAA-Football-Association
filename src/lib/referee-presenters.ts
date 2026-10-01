import type { AppointmentPositionKey, ApplicationStatus, AppointmentStatus } from "@/generated/prisma-v29/client";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function formatRefereeDateTime(value: Date | null) {
  if (!value) return "时间待定";
  return dateTimeFormatter.format(value).replaceAll("/", "-");
}

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  PENDING: "已提交",
  REVIEWING: "审核中",
  APPROVED: "已通过",
  REJECTED: "未通过",
  NOT_SELECTED: "未入选",
  APPOINTED: "已选派",
  WITHDRAWN: "已撤回",
};

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  WITHDRAWN: "已撤回",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function parsePreferredPositions(value: string): AppointmentPositionKey[] {
  try {
    const result: unknown = JSON.parse(value);
    return Array.isArray(result) ? result.filter((item): item is AppointmentPositionKey => typeof item === "string") : [];
  } catch {
    return [];
  }
}
