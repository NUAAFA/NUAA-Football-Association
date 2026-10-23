import Image from "@/components/ui/site-image";

type GuideScreenshot = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

type OperationArea = {
  id: string;
  title: string;
  audience: string;
  steps: readonly string[];
};

export function NumberedGuideSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="participation-document-steps">
      {steps.map((step, index) => (
        <li key={step}>
          <strong>{String(index + 1).padStart(2, "0")}</strong>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function GuideScreenshotGallery({
  screenshots,
}: {
  screenshots: readonly GuideScreenshot[];
}) {
  return (
    <div className="participation-guide-gallery" aria-label="操作示意图">
      {screenshots.map((screenshot) => (
        <figure key={screenshot.src}>
          <a href={screenshot.src} target="_blank" rel="noopener noreferrer" aria-label={`放大查看：${screenshot.alt}`}>
            <Image
              alt={screenshot.alt}
              height={screenshot.height}
              sizes="(max-width: 767px) 100vw, (max-width: 1100px) 46vw, 520px"
              src={screenshot.src}
              width={screenshot.width}
            />
          </a>
          <figcaption>{screenshot.caption}<span>操作界面示意，以足球中国平台实际版本为准；点击图片可放大查看。</span></figcaption>
        </figure>
      ))}
    </div>
  );
}

export function GuideDownload({ href, fileLabel, label }: { href: string; fileLabel: string; label: string }) {
  return (
    <footer className="participation-guide-download">
      <a href={href} target="_blank" rel="noopener noreferrer">{label} <span aria-hidden="true">↗</span></a>
      <small>{fileLabel}</small>
    </footer>
  );
}

export function OperationAreaList({ areas }: { areas: readonly OperationArea[] }) {
  return (
    <div className="participation-operation-areas">
      {areas.map((area, index) => (
        <section id={`operation-${area.id}`} key={area.id}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{area.title}</h3><small>{area.audience}</small></div></header>
          <ul>{area.steps.map((step) => <li key={step}>{step}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}
