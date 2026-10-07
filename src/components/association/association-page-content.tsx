import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ShareActions } from "@/components/share/share-actions";
import { BrandMark } from "@/components/ui/brand-mark";
import { LinkButton } from "@/components/ui/foundation-primitives";
import {
  associationDataGovernance,
  associationDevelopmentFacts,
  associationIdentity,
  associationRoleFramework,
  associationScope,
  associationTimeline,
  associationTerms,
  currentAssociationTeam,
} from "@/data/association";
import { ASSOCIATION_EMAIL, bilibiliPlatform, douyinPlatform, wechatPlatform } from "@/data/platforms";

import { MemberDirectory } from "./member-directory";
import styles from "./association.module.css";

const sectionLinks = [
  { href: "#archive-profile-title", label: "基本信息" },
  { href: "#association-current-team-title", label: "组织与现任" },
  { href: "#archive-timeline-title", label: "发展记录" },
  { href: "#association-structure-title", label: "历届成员" },
  { href: "#association-governance-title", label: "赛事服务" },
  { href: "#association-contact-title", label: "官方渠道" },
] as const;

export function AssociationPageContent() {
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main-content">
        <header className={styles.header} data-association-header aria-labelledby="template-page-title">
          <div className={styles.shell}>
            <div className={styles.identity}>
              <BrandMark compact />
              <div>
                <span className={styles.eyebrow}>ASSOCIATION ARCHIVE</span>
                <span className={styles.identityFacts}>{associationScope.representedCampus} · {associationIdentity.establishedLabel}</span>
              </div>
            </div>
            <h1 id="template-page-title">{associationIdentity.formalName}</h1>
            <p className={styles.englishName} lang="en">{associationIdentity.englishName}</p>
            <p className={styles.lead}>因热爱，奔赴绿茵。了解协会身份、工作范围与发展记录。</p>
            <div className={styles.actions}>
              <LinkButton href="/join">加入我们 <span aria-hidden="true">→</span></LinkButton>
              <ShareActions title={associationIdentity.formalName} />
            </div>
          </div>
        </header>

        <nav className={styles.navigation} aria-label="协会页内导航">
          <div className={styles.shell}>
            <span className={styles.navigationLabel}>本页目录</span>
            <ul>{sectionLinks.map((item) => <li key={item.href}><a href={item.href}>{item.label}</a></li>)}</ul>
          </div>
        </nav>

        <div className={`${styles.shell} ${styles.body}`}>
          <div className={styles.overview}>
            <section className={styles.profile} aria-labelledby="archive-profile-title">
              <span className={styles.eyebrow}>BASIC PROFILE</span>
              <h2 id="archive-profile-title">基本信息</h2>
              <p className={styles.scope}>{associationScope.summary}</p>
              <dl>
                <div><dt>正式名称</dt><dd>{associationIdentity.formalName}</dd></div>
                <div><dt>英文名称</dt><dd lang="en">{associationIdentity.englishName}</dd></div>
                <div><dt>成立年份</dt><dd>{associationIdentity.establishedYear}</dd></div>
                <div><dt>服务范围</dt><dd>{associationScope.representedCampus}</dd></div>
                <div><dt>公开邮箱</dt><dd><a href={`mailto:${ASSOCIATION_EMAIL}`}>{ASSOCIATION_EMAIL}</a></dd></div>
              </dl>
            </section>
            <section className={styles.facts} aria-labelledby="archive-stats-title" data-association-facts>
              <span className={styles.eyebrow}>ASSOCIATION DATA</span>
              <h2 id="archive-stats-title">协会概况</h2>
              <div>{associationDevelopmentFacts.map((fact) => <article key={fact.id}><strong>{fact.value}</strong><span>{fact.label}</span><small>{fact.note}</small></article>)}</div>
              <Link className={styles.textLink} href="/competitions">进入赛事中心 <span aria-hidden="true">→</span></Link>
            </section>
          </div>

          <section className={styles.memberSection} aria-labelledby="association-current-team-title">
            <header className={styles.sectionHeading}>
              <span className={styles.eyebrow}>ORGANIZATION & CURRENT TEAM</span>
              <h2 id="association-current-team-title">组织与现任</h2>
            </header>
            <div className={styles.currentLayout}>
              <section aria-labelledby="association-current-directory-title" data-current-members>
                <h3 id="association-current-directory-title">{currentAssociationTeam.label}</h3>
                <p className={styles.termLabel}>{currentAssociationTeam.termNote}</p>
                <MemberDirectory positions={currentAssociationTeam.positions} />
                <small className={styles.recordNote}>{currentAssociationTeam.note}</small>
              </section>
              <section className={styles.roleFramework} aria-labelledby="association-role-framework-title">
                <h3 id="association-role-framework-title">协会岗位框架</h3>
                <ul>{associationRoleFramework.map((role) => <li key={role}>{role}</li>)}</ul>
              </section>
            </div>
          </section>

          <section className={`archive-timeline ${styles.legacySection}`} aria-labelledby="archive-timeline-title"><div><p>TIMELINE</p><h2 id="archive-timeline-title">发展记录</h2><span>记录协会组织建设与校园足球赛事体系的发展历程。</span></div><ol>{associationTimeline.map((entry) => <li key={entry.period}><time>{entry.period}</time><section><h3>{entry.label}</h3><p>{entry.description}</p></section></li>)}</ol></section>

          <section className={styles.memberSection} aria-labelledby="association-structure-title" data-historical-members>
            <header className={styles.sectionHeading}>
              <span className={styles.eyebrow}>MEMBER ARCHIVE</span>
              <h2 id="association-structure-title">历届成员</h2>
              <p className={styles.recordNote}>以下为已公开记录，未列出的任期或岗位不代表不存在。</p>
            </header>
            <div className={styles.termArchive}>
              {associationTerms.map((term, index) => (
                <details className={styles.termDisclosure} key={term.term} open={index === associationTerms.length - 1}>
                  <summary>
                    <h3><span>{term.term}</span><time>{term.academicYear}</time></h3>
                  </summary>
                  <div className={styles.termContent}>
                    {term.positions.length ? <MemberDirectory positions={term.positions} /> : null}
                    {term.unassignedMembers.length ? <><p><strong>岗位信息待补充成员</strong></p><ul>{term.unassignedMembers.map((member) => <li key={member}>{member}</li>)}</ul></> : null}
                    <small className={styles.recordNote}>{term.roleNote}</small>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className={`association-governance ${styles.legacySection}`} aria-labelledby="association-governance-title">
            <article><p>COMPETITION SERVICES</p><h2 id="association-governance-title">赛事服务</h2><ul>{associationDataGovernance.map((item) => <li key={item}>{item}</li>)}</ul></article>
          </section>
          <section className={`association-contact-section ${styles.legacySection}`} aria-labelledby="association-contact-title">
            <div><p>CONTACT US</p><h2 id="association-contact-title">联系我们</h2><span>赛事、裁判、媒体合作与内容纠错可通过以下公开渠道联系。</span></div>
            <dl>
              <div><dt>协会名称</dt><dd>{associationIdentity.formalName}</dd></div>
              <div><dt>服务范围</dt><dd>{associationScope.representedCampus}</dd></div>
              <div><dt>公开邮箱</dt><dd><a href={`mailto:${ASSOCIATION_EMAIL}`}>{ASSOCIATION_EMAIL}</a></dd></div>
              <div><dt>微信公众号</dt><dd>{wechatPlatform.name}</dd></div>
              <div><dt>哔哩哔哩</dt><dd><a href={bilibiliPlatform.href} rel="noopener noreferrer" target="_blank">{bilibiliPlatform.name}</a><small className={styles.platformScope}>{bilibiliPlatform.label}</small></dd></div>
              <div><dt>抖音</dt><dd>{douyinPlatform.name} · {douyinPlatform.label}</dd></div>
              <div><dt>裁判事务</dt><dd><Link href="/referees#referee-contact">进入裁判中心联系区</Link></dd></div>
              <div><dt>赛事事务</dt><dd><Link href="/competitions">进入赛事中心</Link></dd></div>
              <div><dt>新闻投稿与纠错</dt><dd><a href={`mailto:${ASSOCIATION_EMAIL}`}>{ASSOCIATION_EMAIL}</a></dd></div>
            </dl>
          </section>
          <Link className={styles.textLink} href="/">← 返回首页</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
