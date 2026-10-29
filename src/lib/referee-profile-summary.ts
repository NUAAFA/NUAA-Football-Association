/** Preview the existing application gates without changing any profile values. */
export function getRefereeRegistrationSummary(input: {
  status: string;
  assignmentEligibility: string;
  mustChangePassword: boolean;
  capabilities: ReadonlyArray<{ format: string; status: string }>;
}) {
  const available = input.capabilities.filter(item => item.status === "TRAINING" || item.status === "READY");
  const counts = {
    eleven: available.filter(item => item.format === "ELEVEN_A_SIDE").length,
    futsal: available.filter(item => item.format === "FUTSAL").length,
  };
  const blocked = (title: string, detail: string) => ({ ...counts, canApply: false, title, detail });
  if (input.status !== "ACTIVE") return blocked("账号未启用，暂不能报名或选派", "请在“公开与账号”中核对账号状态。");
  if (input.assignmentEligibility === "SUSPENDED") return blocked("报名与选派已暂停", "岗位设置仍保留；恢复整体资格后，按对应岗位判断。");
  if (input.assignmentEligibility !== "ELIGIBLE") return blocked("尚未允许报名与选派", "需先将下方整体资格设为“可选派”。");
  if (input.mustChangePassword) return blocked("需先修改初始密码，再报名", "裁判员完成首次改密后，可按下方岗位提交报名；管理员选派仍按岗位审核。");
  if (!counts.eleven && !counts.futsal) return blocked("尚无可报名岗位", "至少将一个对应赛制的岗位设为“培养中”或“可正式选派”。");
  return { ...counts, canApply: true, title: "报名基础条件已满足", detail: "还需比赛开放报名且未截止；提交意向后，由管理员审核并发布正式选派。" };
}
