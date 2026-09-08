import Image from "next/image";
import Link from "next/link";

import { SectionContactCard } from "@/components/ui/section-contact-card";
import {
  Badge,
  Card,
  LinkButton,
  Notice,
  Panel,
} from "@/components/ui/foundation-primitives";
import mensArchive from "@/data/archives/2026-mens-intercollege-cup/competition.json";
import womensArchive from "@/data/archives/2026-womens-intercollege-cup/womens-cup-2026.json";
import { coreCompetitionDirectory, getCoreCompetition } from "@/data/competition-directory";
import { publicSectionContacts } from "@/data/contacts";
import { competitionNavigation } from "@/data/navigation";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";
import type { CoreCompetitionDirectoryEntry } from "@/types/competition-center";

import styles from "./competition-hub.module.css";

type BadgeTone = "info" | "neutral" | "success" | "warning" | "danger";

type CompetitionStatusProps = {
  context: string;
  label: string;
  tone?: BadgeTone;
};

type CompetitionFact = {
  label: string;
  value: string;
};

export type CompetitionSummaryCardProps = {
  actionLabel: string;
  competition: CoreCompetitionDirectoryEntry;
  description: string;
  eyebrow: string;
  facts: readonly CompetitionFact[];
  headingLevel?: 3 | 4;
  image?: {
    alt: string;
    position?: string;
    src: string;
  };
  secondaryStatus?: CompetitionStatusProps;
  status: CompetitionStatusProps;
  variant: "current" | "archive";
};

type ServiceItem = {
  description: string;
  href: string;
  label: string;
};

type ServiceGroup = {
  description: string;
  eyebrow: string;
  id: "data" | "archive" | "official";
  items: readonly ServiceItem[];
  label: string;
};

const currentCompetitions = coreCompetitionDirectory.filter(
  (competition) => competition.semester === "first",
);

function requireCompetition(id: string) {
  const competition = getCoreCompetition(id);
  if (!competition) throw new Error(`Missing competition directory entry: ${id}`);
  return competition;
}

const mensCompetition = requireCompetition("mens-intercollege-cup");
const womensCompetition = requireCompetition("womens-intercollege-cup");

const archiveCards = [
  {
    actionLabel: "查看男子赛事档案",
    competition: mensCompetition,
    description: "进入 2026 年男子院际十一人制赛事的赛果、积分与赛事报道。",
    eyebrow: `${mensCompetition.year} · ${mensCompetition.formatLabel}`,
    facts: [
      { label: "参赛球队", value: `${mensArchive.summary.teams} 支` },
      { label: "比赛记录", value: `${mensArchive.summary.matches} 场` },
    ],
    headingLevel: 4,
    image: {
      alt: "天目湖校区西操场晚霞与足球",
      position: "center bottom",
      src: mensArchive.heroImage,
    },
    secondaryStatus: {
      context: "档案语境",
      label: mensCompetition.badge,
      tone: "neutral",
    },
    status: {
      context: "赛事状态",
      label: mensCompetition.statusLabel,
      tone: "success",
    },
    variant: "archive",
  },
  {
    actionLabel: "查看女子赛事档案",
    competition: womensCompetition,
    description: "进入 2026 年女子院际五人制赛事的赛果、积分与赛事报道。",
    eyebrow: `${womensCompetition.year} · ${womensCompetition.formatLabel}`,
    facts: [
      { label: "参赛球队", value: `${womensArchive.competition.summary.teams} 支` },
      { label: "比赛记录", value: `${womensArchive.competition.summary.matches} 场` },
    ],
    headingLevel: 4,
    image: {
      alt: "2026天目湖校区女足赛事集体合影",
      src: womensIntercollegeCup2026.heroImage,
    },
    secondaryStatus: {
      context: "档案语境",
      label: womensCompetition.badge,
      tone: "neutral",
    },
    status: {
      context: "赛事状态",
      label: womensCompetition.statusLabel,
      tone: "success",
    },
    variant: "archive",
  },
] as const satisfies readonly CompetitionSummaryCardProps[];

const [schedule, standings, scorers, history, files, arbitration] = competitionNavigation;

const serviceGroups = [
  {
    description: "从已发布信息进入赛程、积分与公开射手数据。",
    eyebrow: "MATCH CENTRE",
    id: "data",
    items: [
      { ...schedule, description: "查看已发布的比赛安排与赛果。" },
      { ...standings, description: "查看现有联赛与小组积分记录。" },
      { ...scorers, label: "射手记录", description: "查看已有的公开射手数据。" },
    ],
    label: "比赛数据",
  },
  {
    description: "先直接进入已经形成专题内容的赛事，也可继续按年份浏览历史入口。",
    eyebrow: "COMPETITION ARCHIVES",
    id: "archive",
    items: [{ ...history, description: "按年份查找既有赛事记录与档案入口。" }],
    label: "赛事档案",
  },
  {
    description: "查阅竞赛文件，或进入赛事争议处理与申诉说明。",
    eyebrow: "OFFICIAL SERVICES",
    id: "official",
    items: [
      { ...files, description: "查阅现有竞赛规程、手册与通知。" },
      { ...arbitration, label: "仲裁与申诉", description: "查看赛事争议处理与申诉说明。" },
    ],
    label: "官方服务",
  },
] as const satisfies readonly ServiceGroup[];

export function CompetitionStatus({ context, label, tone = "info" }: CompetitionStatusProps) {
  return (
    <span className={styles.status} aria-label={`${context}：${label}`}>
      <span className={styles.statusContext}>{context}</span>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

export function CompetitionPageHeader({ competitions }: { competitions: readonly CoreCompetitionDirectoryEntry[] }) {
  return (
    <header className={styles.pageHeader}>
      <div className={`detail-shell ${styles.pageHeaderInner}`}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.eyebrow}>TIANMUHU COMPETITIONS</span>
          <h1>赛事中心</h1>
          <p>查看正在筹备的校园赛事、比赛数据与已完成赛季档案，并前往赛事文件和仲裁服务。</p>
        </div>
        <Panel className={styles.headerStatusPanel}>
          <span className={styles.panelEyebrow}>CURRENT STATUS</span>
          <strong>当前 / 筹备赛事</strong>
          <ul>
            {competitions.map((competition) => (
              <li key={competition.id}>
                <span>{competition.shortName}</span>
                <CompetitionStatus context="赛事状态" label={competition.statusLabel} tone="warning" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </header>
  );
}

export function CompetitionSummaryCard({
  actionLabel,
  competition,
  description,
  eyebrow,
  facts,
  headingLevel = 3,
  image,
  secondaryStatus,
  status,
  variant,
}: CompetitionSummaryCardProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";

  return (
    <Card className={`${styles.summaryCard} ${styles[`${variant}Card`]}`} interactive>
      {image ? (
        <div className={styles.cardImage}>
          <Image
            alt={image.alt}
            fill
            sizes="(max-width: 900px) calc(100vw - 4rem), (max-width: 1240px) 44vw, 34rem"
            src={image.src}
            style={{ objectPosition: image.position }}
          />
        </div>
      ) : null}
      <div className={styles.cardBody}>
        <header className={styles.cardHeader}>
          <span className={styles.cardEyebrow}>{eyebrow}</span>
          <div className={styles.cardStatuses}>
            <CompetitionStatus {...status} />
            {secondaryStatus ? <CompetitionStatus {...secondaryStatus} /> : null}
          </div>
        </header>
        <Heading>{competition.name}</Heading>
        <p className={styles.cardDescription}>{description}</p>
        <dl className={styles.factGrid}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt><span className={styles.factLabel}>{fact.label}</span></dt>
              <dd><span className={styles.factValue}>{fact.value}</span></dd>
            </div>
          ))}
        </dl>
        <LinkButton className={styles.cardAction} href={competition.detailHref} tone={variant === "archive" ? "primary" : "secondary"}>
          {actionLabel} <span aria-hidden="true">→</span>
        </LinkButton>
      </div>
    </Card>
  );
}

function ServiceRouteLink({ item }: { item: ServiceItem }) {
  return (
    <Link className={styles.serviceRouteLink} href={item.href}>
      <span>
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export function CompetitionServiceNav({ archives, groups }: {
  archives: readonly CompetitionSummaryCardProps[];
  groups: readonly ServiceGroup[];
}) {
  return (
    <nav aria-labelledby="competition-service-title" className={styles.serviceNavigation}>
      {groups.map((group) => (
        <section className={styles.serviceGroup} data-group={group.id} key={group.id}>
          <div className={styles.serviceGroupHeader}>
            <div>
              <span>{group.eyebrow}</span>
              <h3>{group.label}</h3>
              <p>{group.description}</p>
            </div>
            {group.id === "archive" ? (
              <LinkButton href={group.items[0].href} tone="quiet">
                历届赛事 <span aria-hidden="true">→</span>
              </LinkButton>
            ) : null}
          </div>

          {group.id === "archive" ? (
            <div className={styles.archiveGrid}>
              {archives.map((archive) => (
                <CompetitionSummaryCard key={archive.competition.id} {...archive} />
              ))}
            </div>
          ) : (
            <ul className={styles.serviceRouteList}>
              {group.items.map((item) => (
                <li key={item.href}><ServiceRouteLink item={item} /></li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}

function currentCompetitionCard(competition: CoreCompetitionDirectoryEntry, index: number) {
  return {
    actionLabel: "进入赛事详情",
    competition,
    description: competition.summary,
    eyebrow: `${String(index + 1).padStart(2, "0")} / ${competition.eventType} · ${competition.formatLabel}`,
    facts: [
      { label: "组队方式", value: competition.teamFormation },
      { label: "当前阶段", value: competition.stageLabel },
      { label: "时间状态", value: competition.matchWindow },
    ],
    secondaryStatus: {
      context: "下一安排",
      label: competition.nextMatch.label,
      tone: "neutral" as const,
    },
    status: {
      context: "赛事状态",
      label: competition.statusLabel,
      tone: "warning" as const,
    },
    variant: "current" as const,
  } satisfies CompetitionSummaryCardProps;
}

export function CompetitionHub() {
  return (
    <main className={styles.page} id="main-content">
      <CompetitionPageHeader competitions={currentCompetitions} />

      <section className={styles.currentSection} aria-labelledby="current-competitions-title">
        <div className="detail-shell">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>NOW / PREPARING</span>
              <h2 id="current-competitions-title">当前与筹备赛事</h2>
            </div>
            <p>新生杯与天目湖五人制联赛正在筹备；日期、场地与正式赛程以赛事后续发布为准。</p>
          </div>
          <div className={styles.currentGrid}>
            {currentCompetitions.map((competition, index) => (
              <CompetitionSummaryCard key={competition.id} {...currentCompetitionCard(competition, index)} />
            ))}
          </div>
          <Notice className={styles.pendingNotice} title="待正式发布" tone="warning">
            <p>报名时间、比赛日期、比赛场地、参赛规模及具体赛程尚未全部正式发布。请以赛事组委会后续公告和正式竞赛文件为准。</p>
          </Notice>
        </div>
      </section>

      <section className={styles.serviceSection} aria-labelledby="competition-service-title">
        <div className="detail-shell">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>SERVICE ROUTES</span>
              <h2 id="competition-service-title">赛事服务航线</h2>
            </div>
            <p>先看比赛数据，再进入已完成赛季；历史、文件与仲裁服务按用途归组。</p>
          </div>
          <CompetitionServiceNav archives={archiveCards} groups={serviceGroups} />
        </div>
      </section>

      <section className={styles.contactSection} aria-label="赛事联系">
        <div className="detail-shell">
          <SectionContactCard
            contact={publicSectionContacts.competitions}
            note="如需确认赛事发布、文件或服务入口，请联系赛事中心负责人。"
          />
        </div>
      </section>
    </main>
  );
}
