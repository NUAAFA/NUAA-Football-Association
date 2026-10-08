import Image from "next/image";
import Link from "next/link";

import { RefereeAdmissionForm } from "@/components/referees/referee-admission-form";
import { Badge } from "@/components/ui/foundation-primitives";
import { refereeRecruitment } from "@/data/referee-recruitment";
import { RefereePage, RefereeSection } from "./referee-public-layout";
import styles from "./referee-public.module.css";

export function RefereeRecruitment() {
  return <RefereePage current="/referees/recruitment" eyebrow="JOIN THE OFFICIALS" title="成为校园足球裁判员" description="了解加入天目湖裁判团队的现有流程、招新群安排与裁判准入申请。培训及后续安排以协会正式通知为准。">
    <div className={styles.twoColumns}>
      <RefereeSection id="recruitment-steps" title="招募流程" description="扫码进群 → 查看要求并提交报名表 → 资格审核 → 裁判培训">
        <ol role="list" className={styles.steps}>{refereeRecruitment.steps.map((step) => <li key={step.id}><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol>
      </RefereeSection>
      <aside className={styles.panel} aria-labelledby="recruitment-group-title">
        <h2 id="recruitment-group-title">招新群入口</h2><Badge tone="neutral">{refereeRecruitment.statusLabel}</Badge>
        {refereeRecruitment.qrImage ? <Image src={refereeRecruitment.qrImage} alt={refereeRecruitment.qrAlt} width={260} height={260} /> : null}
        <dl className={styles.groupFacts}><div><dt>群名称</dt><dd>{refereeRecruitment.groupName}</dd></div><div><dt>适用年度</dt><dd>{refereeRecruitment.academicYear}</dd></div><div><dt>开放 / 有效期</dt><dd>{refereeRecruitment.validUntil}</dd></div><div><dt>咨询邮箱</dt><dd><a className={styles.textLink} href={`mailto:${refereeRecruitment.fallbackContact}`}>{refereeRecruitment.fallbackContact}</a></dd></div></dl>
        <p role="note">{refereeRecruitment.notice}</p>
      </aside>
    </div>
    <RefereeSection id="recruitment-application" title="提交裁判准入申请" description="提交申请后由协会审核；审核通过后才会创建或关联裁判员账号。本表用于申请加入裁判队伍，具体招募与培训安排以正式通知为准。">
      <div className={styles.formPanel}><RefereeAdmissionForm /></div>
    </RefereeSection>
    <RefereeSection id="application-notes" title="报名与后续安排" description="招新群尚未开放，招募报名与培训安排以协会正式通知为准。上方准入申请用于申请加入裁判队伍，提交后由协会审核；已有启用账号的裁判员可直接登录工作区，查看个人任务与执裁安排。">
      <Link className={styles.textLink} href="/referees/login">已有启用账号？前往裁判员登录 →</Link>
    </RefereeSection>
  </RefereePage>;
}
