import type { Metadata } from "next";
import Link from "next/link";

import { RefereePage, RefereeResource, RefereeSection } from "@/components/referees/referee-public-layout";
import styles from "@/components/referees/referee-public.module.css";
import { getResourceLibrary } from "@/lib/resource-library";
import { resourceVersionLabels } from "@/data/resource-options";

export const metadata: Metadata = {
  alternates: { canonical: "/referees/resources/competition-rules" },
  title: "竞赛规则",
  description: "集中查阅十一人制、五人制足球竞赛规则及现有规则变更说明。",
};

const ruleGroups = [
  {
    id: "eleven-a-side",
    eyebrow: "ELEVEN-A-SIDE",
    title: "十一人制竞赛规则",
    description: "查阅十一人制足球竞赛规则中文文件及现有规则变更说明。",
  },
  {
    id: "futsal",
    eyebrow: "FUTSAL",
    title: "五人制竞赛规则",
    description: "查阅五人制足球竞赛规则中文文件。",
  },
] as const;

export const dynamic = "force-dynamic";

export default async function CompetitionRulesPage() {
  const resources = await getResourceLibrary();
  return <RefereePage current="/referees/resources/competition-rules" eyebrow="LAWS & RULES" title="竞赛规则" description="集中查阅十一人制、五人制足球竞赛规则及现有规则变更说明。请留意各文件的适用版本。">
    {ruleGroups.map((group) => {
      const files = resources.filter((file) => file.category === "regulations" && (file.playingFormat === "all" || file.playingFormat === group.id));
      return <RefereeSection key={group.id} id={group.id} title={group.title} description={group.description}>
        <ul role="list" className={styles.resourceList}>{files.map((file) => <RefereeResource key={file.id} title={file.title} type={file.fileType}
          actions={<a href={file.href} target="_blank" rel="noopener noreferrer" aria-label={`查看规则文件：${file.title}（新窗口）`}>查看规则文件 ↗</a>}>
          <p>{file.scope} · {file.source}</p><p className={styles.meta}>{resourceVersionLabels[file.versionStatus]}{file.version ? ` · ${file.version}` : ""}</p><p>{file.versionNote}</p>
        </RefereeResource>)}</ul>
      </RefereeSection>;
    })}
    <Link className={styles.textLink} href="/referees#referee-resources">← 返回学习与工作资料</Link>
  </RefereePage>;
}
