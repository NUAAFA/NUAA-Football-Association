import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RefereeMemberLoginForm } from "@/components/referees/mvp/referee-member-login-form";
import { RefereeEmptyState, RefereePage } from "@/components/referees/referee-public-layout";
import styles from "@/components/referees/referee-public.module.css";
import {
  getRefereeMemberConfigurationIssue,
  getRefereeMemberSession,
} from "@/lib/referee-member-auth";
import { ASSOCIATION_EMAIL } from "@/data/platforms";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/login" },
  title: "裁判员登录",
  description: "经协会审核启用账号的裁判员进入个人工作区，查看报名、任务与选派状态。",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function RefereeMemberLoginPage() {
  if (await getRefereeMemberSession()) redirect("/referees/workspace");
  const workspaceAvailable = !getRefereeMemberConfigurationIssue();

  return (
    <RefereePage current="/referees/login" eyebrow="REFEREE SIGN IN" title="裁判员工作区" description="供经协会审核并启用账号的裁判员提交执裁意向，查看个人申请状态和已发布任务。">
      <div className={styles.twoColumns}>
        <section className={styles.panel} aria-labelledby="sign-in-title"><h2 id="sign-in-title">裁判员登录说明</h2><p>访客可直接查看公开名录、开放比赛和正式选派公告；经审核启用账号的裁判员登录后可提交执裁意向并查看个人记录。</p></section>
        <div className={styles.formPanel}>
            {workspaceAvailable ? (
              <RefereeMemberLoginForm />
            ) : (
              <div role="status">
                <RefereeEmptyState title="裁判员工作区暂未开放">
                  裁判员账号申请功能暂未开放。未来将由裁判员自主申请，经协会审核通过后启用账号。如需联系裁判事务，请发送邮件至{" "}
                  <a className={styles.textLink} href={`mailto:${ASSOCIATION_EMAIL}`}>{ASSOCIATION_EMAIL}</a>。
                </RefereeEmptyState>
              </div>
            )}
        </div>
      </div>
    </RefereePage>
  );
}
