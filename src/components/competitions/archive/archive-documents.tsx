import styles from "./rich-archive.module.css";

export function ArchiveDocuments({ href, source }: { href: string; source: string }) {
  return (
    <section className="cup-archive-section" id="documents" aria-labelledby="archive-documents-title">
      <div className="page-shell">
        <div className="cup-section-heading"><div><p>OFFICIAL DOCUMENT</p><h2 id="archive-documents-title">赛事文件</h2></div><span>赛事组织与竞赛资料</span></div>
        <article className={styles.document}>
          <span className={styles.fileType}>PDF</span>
          <div><h3>赛事秩序册</h3><p>2026男子足球院际杯 · 天目湖校区</p><p>资料来源：{source}。</p></div>
          <div className={styles.documentActions}><a href={href} target="_blank" rel="noopener noreferrer">查看 PDF<span className="sr-only">（新标签页）</span> ↗</a><a href={href} download>下载 PDF ↓</a></div>
        </article>
      </div>
    </section>
  );
}
