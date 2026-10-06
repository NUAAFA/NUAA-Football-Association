import type { Metadata } from "next";
import Link from "next/link";

import { RefereePage, RefereeResource, RefereeSection } from "@/components/referees/referee-public-layout";
import styles from "@/components/referees/referee-public.module.css";
import { refereeTrainingResources } from "@/data/referee-training-resources";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/resources/training" },
  title: "裁判培训资料",
  description: "裁判员基础培训、五人制专项学习、第四官员工作与比赛分析报告资料。",
};

const resourceLevels = ["基础", "专项", "进阶"] as const;
export default function RefereeTrainingResourcesPage() {
  return <RefereePage current="/referees/resources/training" eyebrow="REFEREE DEVELOPMENT" title="裁判培训资料" description="从基础职责到专项执裁与比赛分析，按学习阶段查阅现有资料。PDF 可在线查看，演示文稿可下载原文件。">
    {resourceLevels.map((level) => <RefereeSection key={level} id={`training-level-${level}`} title={`${level}学习`}>
      <ul role="list" className={styles.resourceList}>{refereeTrainingResources.filter((resource) => resource.level === level).map((resource) => <RefereeResource key={resource.id} title={resource.title} type={resource.fileType}
        actions={<>{resource.previewHref ? <a href={resource.previewHref} rel="noopener noreferrer" target="_blank" aria-label={`在线查看：${resource.title}（新窗口）`}>在线查看 ↗</a> : null}<a download href={resource.fileHref} aria-label={`下载原文件：${resource.title}`}>下载原文件 ↓</a></>}>
        <p>{resource.description}</p><ul role="list" className={styles.tags} aria-label="资料标签">{resource.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
        {resource.versionNote ? <div className={styles.versionNote}><p><strong>版本提示</strong> · {resource.versionNote}</p></div> : null}
      </RefereeResource>)}</ul>
    </RefereeSection>)}
    <Link className={styles.textLink} href="/referees#referee-resources">← 返回学习与工作资料</Link>
  </RefereePage>;
}
