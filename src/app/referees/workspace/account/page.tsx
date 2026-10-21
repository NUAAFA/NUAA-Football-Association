import { BeijingDayRefresh } from "@/components/referees/admin/beijing-day-refresh";
import { getEffectiveRefereeGrade } from "@/lib/referee-grade";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RefereePasswordForm } from "@/components/referees/mvp/referee-password-form";
import { RefereeWorkspaceHero } from "@/components/referees/mvp/referee-workspace-hero";
import { RefereeWorkspaceNav } from "@/components/referees/mvp/referee-workspace-nav";
import { getRefereeMemberSession } from "@/lib/referee-member-auth";

export const metadata: Metadata = {
  title: "裁判员账号与密码设置",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const trainingLabels = {
  PENDING_ASSESSMENT: "待考察",
  IN_TRAINING: "培训中",
  QUALIFIED: "考察通过",
} as const;

const eligibilityLabels = {
  NOT_ELIGIBLE: "不可选派",
  ELIGIBLE: "可选派",
  SUSPENDED: "暂停选派",
} as const;

export default async function RefereeAccountPage() {
  const session = await getRefereeMemberSession();
  if (!session) redirect("/referees/login");
  return (
    <>
      <BeijingDayRefresh /><SiteHeader />
      <main className="functional-page" id="main-content">
        <RefereeWorkspaceHero description="查看账号状态并维护登录密码。" eyebrow="ACCOUNT SETTINGS" name={session.referee.name} publicCode={session.referee.publicCode} title="账号与密码设置" />
        <RefereeWorkspaceNav />
        <section className="functional-section">
          <div className="detail-shell referee-account-settings">
            <article>
              <h2>账号状态</h2>
              <dl>
                <div><dt>登录账号</dt><dd>{session.referee.studentId}</dd></div>
                <div><dt>裁判员编号</dt><dd>{session.referee.publicCode}</dd></div>
                <div><dt>培训状态</dt><dd>{trainingLabels[session.referee.trainingStatus]}</dd></div>
                <div><dt>正式选派资格</dt><dd>{eligibilityLabels[session.referee.assignmentEligibility]}</dd></div>
                <div><dt>当前年级 · 北京时间</dt><dd>{getEffectiveRefereeGrade(new Date(), session.referee).grade ?? "学籍待核实"} · {getEffectiveRefereeGrade(new Date(), session.referee).source}</dd></div>
                <div><dt>密码状态</dt><dd>{session.referee.mustChangePassword ? "须修改初始密码" : "已设置"}</dd></div>
              </dl>
            </article>
            <article>
              <h2>修改密码</h2>
              <RefereePasswordForm requiredChange={session.referee.mustChangePassword} />
            </article>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
