import Image from "next/image";
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
import {
  ASSOCIATION_EMAIL,
  bilibiliPlatform,
  douyinPlatform,
  emailPlatform,
  footballChinaPlatform,
  wechatPlatform,
} from "@/data/platforms";

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

          <section className={`${styles.contentSection} ${styles.timelineSection}`} aria-labelledby="archive-timeline-title" data-development-history>
            <header className={styles.sectionHeading}>
              <span className={styles.eyebrow} lang="en">Development record</span>
              <h2 id="archive-timeline-title">发展记录</h2>
              <p className={styles.sectionIntro}>记录协会组织建设与校园足球赛事体系的发展历程。</p>
            </header>
            <ol className={styles.timelineList} role="list">
              {associationTimeline.map((entry) => (
                <li key={entry.period}>
                  <span className={styles.period}>{entry.period}</span>
                  <div>
                    <h3>{entry.label}</h3>
                    <p>{entry.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={`${styles.memberSection} ${styles.archiveSection}`} aria-labelledby="association-structure-title" data-historical-members>
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

          <section className={styles.contentSection} aria-labelledby="association-governance-title" data-competition-services>
            <header className={styles.sectionHeading}>
              <span className={styles.eyebrow} lang="en">Football services</span>
              <h2 id="association-governance-title">赛事服务</h2>
            </header>
            <div className={styles.serviceLayout}>
              <div>
                <ul className={styles.serviceList}>{associationDataGovernance.map((item) => <li key={item}>{item}</li>)}</ul>
                <div className={styles.serviceLinks}>
                  <Link className={styles.textLink} href="/competitions">进入赛事中心 <span aria-hidden="true">→</span></Link>
                  <Link className={styles.textLink} href="/referees#referee-contact">裁判事务联系 <span aria-hidden="true">→</span></Link>
                </div>
              </div>
              <aside className={styles.participation} aria-labelledby="association-participation-title">
                <h3 id="association-participation-title">{footballChinaPlatform.name}</h3>
                <p>{footballChinaPlatform.label}</p>
                <a className={styles.textLink} href={footballChinaPlatform.href} target={footballChinaPlatform.target} rel={footballChinaPlatform.rel}>
                  {footballChinaPlatform.linkLabel} <span aria-hidden="true">↗</span>
                </a>
                <small>{footballChinaPlatform.scopeNotice}</small>
                <small>外部平台 · HTTP 入口</small>
              </aside>
            </div>
          </section>
          <section className={styles.contentSection} aria-labelledby="association-contact-title" data-official-channels>
            <header className={styles.sectionHeading}>
              <span className={styles.eyebrow} lang="en">Official channels</span>
              <h2 id="association-contact-title">官方渠道</h2>
              <p className={styles.sectionIntro}>赛事、裁判、媒体合作与内容纠错可通过以下公开渠道联系。</p>
            </header>
            <dl className={styles.channels}>
              <div className={styles.channel} data-platform={wechatPlatform.id}>
                <dt>{wechatPlatform.label}</dt>
                <dd>
                  <div className={styles.channelCopy}>
                    <strong className={styles.channelName}>{wechatPlatform.name}</strong>
                    <p>{wechatPlatform.description}</p>
                    <small>在微信中搜索“{wechatPlatform.name}”。</small>
                    <a className={styles.textLink} href={wechatPlatform.qrImage} target="_blank" rel="noopener noreferrer">查看湖区FA二维码原图 <span aria-hidden="true">↗</span></a>
                  </div>
                  <a className={styles.qrLink} href={wechatPlatform.qrImage} target="_blank" rel="noopener noreferrer" aria-label="查看湖区FA微信公众号二维码原图，在新标签页打开">
                    <Image src={wechatPlatform.qrImage} alt={wechatPlatform.qrAlt} width={64} height={64} unoptimized />
                  </a>
                </dd>
              </div>
              <div className={styles.channel} data-platform={douyinPlatform.id}>
                <dt>抖音</dt>
                <dd>
                  <div className={styles.channelCopy}>
                    <strong className={styles.channelName}>{douyinPlatform.name}</strong>
                    <small>{douyinPlatform.label}</small>
                    <p>{douyinPlatform.description}</p>
                    <div className={styles.channelLinks}>
                      <Link className={styles.textLink} href={douyinPlatform.href}>前往抖音频道 <span aria-hidden="true">→</span></Link>
                      <a className={styles.textLink} href={douyinPlatform.qrImage} target="_blank" rel="noopener noreferrer">查看二维码原图 <span aria-hidden="true">↗</span></a>
                    </div>
                  </div>
                  <a className={styles.qrLink} href={douyinPlatform.qrImage} target="_blank" rel="noopener noreferrer" aria-label="查看南航足协抖音号 nuaafa 二维码原图，在新标签页打开">
                    <Image src={douyinPlatform.qrImage} alt={douyinPlatform.qrAlt} width={64} height={64} unoptimized />
                  </a>
                </dd>
              </div>
              <div className={styles.channel} data-platform={bilibiliPlatform.id}>
                <dt>哔哩哔哩 · {bilibiliPlatform.label}</dt>
                <dd>
                  <div className={styles.channelCopy}>
                    <strong className={styles.channelName}>{bilibiliPlatform.name}</strong>
                    <p>{bilibiliPlatform.description}</p>
                    <a className={styles.textLink} href={bilibiliPlatform.href} target={bilibiliPlatform.target} rel={bilibiliPlatform.rel}>{bilibiliPlatform.linkLabel} <span aria-hidden="true">↗</span></a>
                  </div>
                </dd>
              </div>
              <div className={styles.channel} data-platform={emailPlatform.id}>
                <dt>公开邮箱</dt>
                <dd>
                  <div className={styles.channelCopy}>
                    <a className={`${styles.textLink} ${styles.emailLink}`} href={emailPlatform.href}>{emailPlatform.label}</a>
                    <p>{emailPlatform.description}</p>
                  </div>
                </dd>
              </div>
            </dl>
          </section>
          <div className={styles.utility} data-association-utility>
            <Link className={styles.textLink} href="/">← 返回首页</Link>
            <ShareActions title={associationIdentity.formalName} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
