import type { Metadata } from "next";
import Link from "next/link";

import { RefereePage, RefereeResource, RefereeSection } from "@/components/referees/referee-public-layout";
import styles from "@/components/referees/referee-public.module.css";
import { refereeWorkFiles } from "@/data/referees";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/resources/work-files" },
  title: "裁判工作资料",
  description: "裁判组与比赛官员使用的工作文件下载。",
};

export default function RefereeWorkFilesPage() {
  return <RefereePage current="/referees/resources/work-files" eyebrow="WORK RESOURCES" title="裁判工作资料" description="比赛成绩报告单与裁判报告模板。请根据比赛赛制与文件适用范围选择对应的原始文件。">
    <RefereeSection id="work-files" title="工作文件" description="保留文件原有版本信息；未确认的发布日期按原始资料标注。">
      <ul role="list" className={styles.resourceList}>{refereeWorkFiles.map((file) => <RefereeResource key={file.id} title={file.title} type={file.fileType}
        actions={<>{file.fileType === "PDF" ? <a href={file.href} target="_blank" rel="noopener noreferrer" aria-label={`在线查看：${file.title}（新窗口）`}>在线查看 ↗</a> : null}<a download href={file.href} aria-label={`下载原文件：${file.title}`}>下载原文件 ↓</a></>}>
        <p>{file.scope}</p><dl className={styles.facts}><div><dt>版本</dt><dd>{file.version}</dd></div><div><dt>发布日期</dt><dd>{file.publishedAt}</dd></div><div><dt>来源</dt><dd>{file.source}</dd></div></dl>
      </RefereeResource>)}</ul>
    </RefereeSection>
    <Link className={styles.textLink} href="/referees#referee-resources">← 返回学习与工作资料</Link>
  </RefereePage>;
}
