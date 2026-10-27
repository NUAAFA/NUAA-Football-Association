import Image from "@/components/ui/site-image";
import Link from "next/link";
import type { NewsItem } from "@/types";

export function ArchiveReports({ titleId, description, stories }: { titleId: string; description: string; stories: readonly NewsItem[] }) {
  return (
    <section className="cup-archive-section" id="reports" aria-labelledby={titleId}>
      <div className="page-shell">
        <div className="cup-section-heading">
          <div><p>COMPETITION REPORTS</p><h2 id={titleId}>赛事报道</h2></div><span>{description}</span>
        </div>
        <div className="cup-story-list">
          {stories.map((story, index) => <Link className={index === 0 ? "is-featured" : undefined} href={story.href} key={story.id}>
            <div><Image src={story.image} alt={story.imageAlt} fill sizes={index === 0 ? "(max-width: 760px) 100vw, 50vw" : "(max-width: 760px) 100vw, 260px"} /></div>
            <article><span>{story.category} · {story.dateLabel}</span><h3>{story.title}</h3><p>{story.summary}</p><b>阅读全文 →</b></article>
          </Link>)}
        </div>
      </div>
    </section>
  );
}
