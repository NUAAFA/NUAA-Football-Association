import Link from "next/link";

import { LinkButton } from "@/components/ui/foundation-primitives";
import { refereeContact } from "@/data/contacts";
import { refereeLearningEntries } from "@/data/referees";
import { refereeRecruitment } from "@/data/referee-recruitment";
import { getPublicUpcomingAppointments } from "@/lib/referee-public";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { RefereeEmptyState, RefereePage, RefereeSection } from "./referee-public-layout";
import styles from "./referee-public.module.css";

export async function RefereeHub() {
  const appointments = await getPublicUpcomingAppointments();
  return (
    <RefereePage current="/referees" eyebrow="REFEREE CENTRE" title="裁判中心"
      description="查询校园足球裁判名录与正式选派，查阅竞赛规则、培训资料和比赛工作文件。已启用账号的裁判员可登录工作区处理个人执裁事务。"
      actions={<><LinkButton href="/referees/assignments">查看选派公告</LinkButton><LinkButton href="/referees/login" tone="secondary">裁判员登录</LinkButton></>}
      headerAside={
        <aside className={styles.headerContact} id="referee-contact" aria-labelledby="referee-contact-title">
          <h2 id="referee-contact-title">裁判事务联系</h2>
          <p className={styles.contactName}><strong>{refereeContact.name}</strong><span>{refereeContact.role}</span></p>
          <ul role="list" className={styles.contactScope} aria-label="咨询范围">
            {refereeContact.responsibilities.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <dl className={styles.contactChannels}>
            <div><dt>公开邮箱</dt><dd><a className={styles.contactEmail} href={`mailto:${refereeContact.email}`}>{refereeContact.email}</a></dd></div>
            <div><dt>咨询 QQ</dt><dd><span className={styles.contactValue}>{refereeContact.qq}</span></dd></div>
          </dl>
        </aside>
      }>
      <RefereeSection id="current-assignments" title="当前选派公告" description="协会正式发布的未来比赛裁判组选派；调整以最新公告为准。"
        action={<Link id="referee-affair-assignments" className={styles.textLink} href="/referees/assignments">全部选派公告 →</Link>}>
        {appointments.length ? <ul role="list" className={styles.serviceList}>{appointments.slice(0, 2).map((item) => <li key={item.id}>
          <Link href="/referees/assignments"><div><h3>{item.match.homeTeam.name} vs {item.match.awayTeam.name}</h3><p>{item.match.competition.name} · {formatRefereeDateTime(item.match.kickoff)}</p></div><span aria-hidden="true">→</span></Link>
        </li>)}</ul> : <RefereeEmptyState title="当前暂无未来比赛的已发布选派。">后续选派将在此公布，可前往历史记录查阅已公开的选派档案。</RefereeEmptyState>}
      </RefereeSection>
      <RefereeSection id="public-information" title="公开裁判信息" description="了解裁判队伍，查看开放场次与历史选派。">
        <ul role="list" className={styles.serviceList}>
          <li id="referee-affair-directory"><Link href="/referees/directory"><div><h3>裁判员名录</h3><p>经协会确认公开的裁判员编号、姓名、登记赛制与公开简介。</p></div><span aria-hidden="true">→</span></Link></li>
          <li><Link href="/referees/open-matches"><div><h3>公开场次</h3><p>查看比赛及岗位需求；经审核启用账号后可提交执裁意向。</p></div><span aria-hidden="true">→</span></Link></li>
          <li><Link href="/referees/history"><div><h3>历史选派记录</h3><p>查阅已结束比赛的公开裁判组与岗位记录。</p></div><span aria-hidden="true">→</span></Link></li>
        </ul>
      </RefereeSection>
      <RefereeSection id="referee-resources" title="学习与工作资料" description="从竞赛规则到比赛报告，按用途查阅现有正式资料。">
        <ul role="list" className={styles.serviceList}>{refereeLearningEntries.map((entry) => <li key={entry.id}><Link href={entry.href}><div><h3>{entry.title}</h3><p>{entry.description}</p></div><span aria-hidden="true">→</span></Link></li>)}</ul>
      </RefereeSection>
      <section className={styles.panel} id="referee-affair-join" aria-labelledby="join-title">
        <h2 id="join-title">加入裁判队伍</h2><p>招新群状态：{refereeRecruitment.statusLabel}。查看现有招募流程与准入申请说明，后续安排以协会通知为准。</p>
        <Link className={styles.textLink} href="/referees/recruitment">了解参与流程 →</Link>
      </section>
    </RefereePage>
  );
}
