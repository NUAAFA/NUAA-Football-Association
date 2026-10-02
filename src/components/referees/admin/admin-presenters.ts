const shanghaiInputFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function toShanghaiDateTimeInput(value: Date | null | undefined) {
  return value ? shanghaiInputFormatter.format(value).replace(" ", "T") : "";
}

export const applicationWindowLabels: Record<string, string> = { OPEN: "报名开放", CLOSED: "报名关闭" };

export const auditActionLabels: Record<string, string> = {
  APPOINTMENT_CREATED: "创建选派", APPOINTMENT_DRAFT_SAVED: "保存选派草稿",
  APPOINTMENT_PUBLISHED: "发布选派", APPOINTMENT_REPUBLISHED: "重新发布选派",
  APPOINTMENT_WITHDRAWN: "撤回选派", APPOINTMENT_COMPLETED: "完成选派",
  APPOINTMENT_CANCELLED: "取消选派", APPOINTMENT_CONFLICT_OVERRIDE: "覆盖选派冲突",
  REFEREE_ACCOUNT_CREATED: "创建裁判员", REFEREE_ACCOUNT_UPDATED: "更新裁判员",
  REFEREE_PASSWORD_RESET: "重置裁判员密码", MATCH_CREATED: "创建比赛", MATCH_UPDATED: "更新比赛",
  MATCH_DELETED: "删除比赛",
  COLLEGE_CREATED: "创建学院", COLLEGE_CODE_MAPPING_UPDATED: "更新学院代码映射",
  TEAM_AFFILIATIONS_UPDATED: "更新球队组织关联", REFEREE_AVAILABILITY_ADMIN_CREATED: "代录可执裁时间",
  REFEREE_AVAILABILITY_ADMIN_DELETED: "删除可执裁时间", APPOINTMENT_CONFLICT_REPORT_RESOLVED: "处理冲突报告",
  ADMIN_ACCOUNT_CREATED: "创建管理员", ADMIN_ACCOUNT_STATUS_UPDATED: "更新管理员状态",
  ADMIN_PASSWORD_CHANGED: "管理员修改密码", ADMIN_PASSWORD_RESET: "重置管理员密码",
  ADMIN_ACCOUNT_DELETED: "删除管理员",
};
