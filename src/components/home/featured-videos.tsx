import Image from "@/components/ui/site-image";
import Link from "next/link";
import { featuredVideoNotice, featuredVideos } from "@/data/content";
import { SectionHeading } from "@/components/ui/section-heading";

export function FeaturedVideos() {
  return (
    <section className="section section-space section-grid videos-section" id="media" aria-labelledby="videos-title">
      <div className="page-shell">
        <SectionHeading eyebrow="SHARED VIDEO CHANNEL / 精选视频" title="用影像保存校园足球" description="“南航大足球协会”为南航校园足球共享视频平台，账号由相关校区足球组织共同使用。" id="videos-title" inverted action={<Link className="text-link rankings-link" href="/media">进入影像资料 <span aria-hidden="true">→</span></Link>} />
        <p className="videos-notice">{featuredVideoNotice}</p>
        <div className="videos-grid">
          {featuredVideos.map((video) => (
            <a className="video-card" href={video.href} target="_blank" rel="noopener noreferrer" aria-label={`${video.title}：前往哔哩哔哩主页，将在新标签页打开`} key={video.id}>
              <div className="video-cover">
                <Image src={video.image} alt={video.imageAlt} fill sizes="(max-width: 720px) 100vw, 50vw" />
                <span className="video-play" aria-hidden="true">▶</span><span className="video-badge">{video.badge}</span>
              </div>
              <div className="video-copy"><small>{video.category} · 共享视频平台</small><h3>{video.title}</h3><p>{video.description}</p><span>前往哔哩哔哩主页（新窗口） <b aria-hidden="true">↗</b></span></div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
