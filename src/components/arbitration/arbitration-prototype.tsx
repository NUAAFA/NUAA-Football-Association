import Link from "next/link";
import { arbitrationGuide, arbitrationPublicNotice, arbitrationResources } from "@/data/arbitration";
import { publicSectionContacts } from "@/data/contacts";
import { FormalPageHeader } from "@/components/competitions/formal-page-header";
import formal from "@/components/competitions/formal-services.module.css";
import styles from "./arbitration.module.css";

function DefinitionSection({ title, items }: { title: string; items: readonly string[] }) {
  return <section className={styles.definition}><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

export function ArbitrationPrototype() {
  const contact = publicSectionContacts.arbitration;
  return (
    <main className={formal.page} id="main-content">
      <FormalPageHeader title="仲裁与申诉" eyebrow="ARBITRATION & APPEALS" description="了解正式异议的适用范围、申请主体、材料要求与处理流程，查阅相关文件并按赛事要求提交。" />
      <div className="page-shell">
        <section className={formal.section} aria-labelledby="arbitration-scope-title">
          <header className={formal.sectionHeading}><h2 id="arbitration-scope-title">申请须知</h2></header>
          <aside className={formal.notice} aria-label="受理边界"><strong>受理边界</strong><p>{arbitrationPublicNotice}</p></aside>
          <div className={styles.definitions}>
            <DefinitionSection title="适用范围" items={arbitrationGuide.scope} />
            <DefinitionSection title="不予受理" items={arbitrationGuide.notAccepted} />
            <DefinitionSection title="申请主体" items={arbitrationGuide.applicants} />
          </div>
          <div className={styles.deadline}><strong>申请时限</strong><p>{arbitrationGuide.deadline}</p></div>
        </section>
        <section className={formal.section} aria-labelledby="arbitration-process-title">
          <header className={formal.sectionHeading}><h2 id="arbitration-process-title">处理流程</h2><p>提交渠道及具体材料要求以对应赛事规程或赛事通知为准。</p></header>
          <ol className={styles.process}>{arbitrationGuide.process.map((step, index) => <li key={step.id}><span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol>
        </section>
        <section className={formal.section} aria-labelledby="arbitration-materials-title">
          <header className={formal.sectionHeading}><h2 id="arbitration-materials-title">准备材料</h2></header>
          <ul className={styles.materials}>{arbitrationGuide.materials.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className={formal.section} aria-labelledby="arbitration-resources-title">
          <header className={formal.sectionHeading}><h2 id="arbitration-resources-title">材料与决定</h2><p>查看申请材料说明、赛事纪律决定与竞赛工作文件。</p></header>
          <ul className={styles.resources}>{arbitrationResources.map((resource) => <li key={resource.title}><div><span>{resource.status}</span><h3>{resource.title}</h3><p>{resource.description}</p></div>{"href" in resource ? <Link className="ui-button ui-button-secondary" href={resource.href === "/referees#referee-downloads" ? "/referees/resources/work-files" : resource.href} aria-label={`查看${resource.title}相关文件`}>查看文件 →</Link> : <strong className={styles.unavailable}>暂无公开文件</strong>}</li>)}</ul>
          <Link className="ui-button ui-button-quiet" href="/competitions/files#regulations">查阅赛事竞赛规则 →</Link>
        </section>
        <section className={formal.section} aria-labelledby="arbitration-submission-title">
          <header className={formal.sectionHeading}><h2 id="arbitration-submission-title">申诉提交</h2></header>
          <div className={styles.submission}>
            <div><p>请将申诉材料发送至南京航空航天大学天目湖足球协会官方邮箱：<strong>{contact.email}</strong>。邮件中请注明对应赛事、球队名称、比赛场次及申诉事项，并按照当届赛事规程、纪律决定或赛事通知要求提交相关材料。</p><a className="ui-button ui-button-secondary" href={`mailto:${contact.email}`}>发送申诉邮件 →</a></div>
            <aside className={styles.contact} aria-label={contact.label}><h3>{contact.label}</h3><p><strong>{contact.name}</strong> · {contact.role}</p><dl><div><dt>咨询 QQ</dt><dd>{contact.qq}</dd></div><div><dt>联系邮箱</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div></dl></aside>
          </div>
        </section>
      </div>
    </main>
  );
}
