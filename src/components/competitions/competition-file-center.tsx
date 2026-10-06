import Link from "next/link";
import { disciplineDecisions } from "@/data/public-information";
import type { PublicCompetitionFile, PublicFileCategory } from "@/types/competition-center";
import formal from "./formal-services.module.css";
import styles from "./competition-file-center.module.css";

const categoryOrder: readonly { key: PublicFileCategory; label: string; description: string }[] = [
  { key: "regulations", label: "规则与版本", description: "国际足联、中国足协审定或发布的竞赛规则与版本说明。" },
  { key: "guidebooks", label: "秩序册与赛事指南", description: "经协会确认可以公开的赛事组织文件。" },
  { key: "schedules", label: "赛程文件", description: "可下载赛程文件尚未单独提供。" },
  { key: "appointments", label: "裁判选派", description: "裁判选派以官网已发布公示为准。" },
  { key: "discipline", label: "纪律决定", description: "协会提供的公开处罚决定原件。" },
  { key: "notices", label: "赛事通知", description: "可下载通知文件尚未单独提供。" },
];

function originalFileHref(file: PublicCompetitionFile) {
  return disciplineDecisions.find((decision) => decision.id === file.id)?.pdfHref ?? file.href;
}

export function CompetitionFileCenter({ files }: { files: readonly PublicCompetitionFile[] }) {
  return (
    <div className={styles.groups}>
      <nav className={styles.index} aria-label="文件分类">
        {categoryOrder.map((category) => <a key={category.key} href={`#${category.key}`}>{category.label}</a>)}
      </nav>
      {categoryOrder.map((category) => {
        const categoryFiles = files.filter((file) => file.category === category.key);
        return (
          <section id={category.key} key={category.key} className={styles.group} aria-labelledby={`files-${category.key}`}>
            <header className={formal.sectionHeading}><h2 id={`files-${category.key}`}>{category.label}</h2><p>{category.description}</p></header>
            {categoryFiles.length ? (
              <ul className={styles.list}>
                {categoryFiles.map((file) => (
                  <li key={file.id}>
                    <article className={styles.resource}>
                      <div className={styles.copy}>
                        <div className={styles.labels}><span>{file.fileType} · {file.categoryLabel}</span><span data-version-status={file.versionStatus}>{file.versionStatusLabel}</span></div>
                        <h3 id={`file-${file.id}`}>{file.title}</h3>
                        <dl className={styles.facts}>
                          <div><dt>适用范围</dt><dd>{file.scope}</dd></div>
                          <div><dt>来源</dt><dd>{file.source}</dd></div>
                          {file.version ? <div><dt>版本</dt><dd>{file.version}</dd></div> : null}
                          {file.publishedAt && !file.publishedAt.startsWith("版本年份") ? <div><dt>发布日期</dt><dd>{file.publishedAt}</dd></div> : null}
                        </dl>
                        <p className={styles.note}>{file.versionNote}</p>
                      </div>
                      <div className={`${formal.actions} ${styles.actions}`}>
                        <a className="ui-button ui-button-secondary" href={file.href} aria-label={`查看${file.title}${file.category === "discipline" ? "决定网页" : `（${file.fileType}）`}`}>{file.category === "discipline" ? "查看决定" : `查看 ${file.fileType}`}</a>
                        <a className="ui-button ui-button-secondary" href={originalFileHref(file)} download aria-label={`下载${file.title}原文件（${file.fileType}）`}>下载原文件 <span aria-hidden="true">↓</span></a>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : <div className={formal.empty}><strong>暂无公开文件</strong><p>{category.description}</p>{category.key === "appointments" ? <Link className="ui-button ui-button-quiet" href="/referees/assignments">查看裁判选派公示 →</Link> : category.key === "schedules" ? <Link className="ui-button ui-button-quiet" href="/competitions/schedule">查看在线赛程 →</Link> : null}</div>}
          </section>
        );
      })}
    </div>
  );
}
