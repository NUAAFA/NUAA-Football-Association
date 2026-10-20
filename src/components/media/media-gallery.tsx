"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from "react";

import styles from "@/components/media/media.module.css";
import type { MediaCollectionData } from "@/data/media-collections";

// Keep the approved thumbnail sizing; only the open viewer uses a larger slot.
const photoSizes = "(max-width: 720px) calc((100vw - 48px) / 2), (max-width: 1023px) calc((100vw - 56px) / 2), (max-width: 1100px) calc((100vw - 88px) / 4), (max-width: 1304px) calc((100vw - 112px) / 4), 298px";
const viewerSizes = "(min-width: 560px) and (max-width: 720px) and (max-height: 500px) calc(100vw - 234px), (max-width: 720px) calc(100vw - 50px), (max-width: 1248px) calc(100vw - 274px), 974px";

export function MediaGallery({ collection }: { collection: MediaCollectionData }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLAnchorElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isOpen = selectedIndex !== null;
  const image = selectedIndex === null ? null : collection.images[selectedIndex];
  const titleId = `${collection.id}-viewer-title`;
  const captionId = `${collection.id}-viewer-caption`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;

    const opener = openerRef.current;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const root = document.documentElement;
    const bodyProperties = ["overflow-x", "overflow-y"] as const;
    const savedBody = bodyProperties.map((property) => ({
      property,
      value: body.style.getPropertyValue(property),
      priority: body.style.getPropertyPriority(property),
    }));
    const savedRoot = bodyProperties.map((property) => ({
      property,
      value: root.style.getPropertyValue(property),
      priority: root.style.getPropertyPriority(property),
    }));
    const rootScrollBehavior = root.style.scrollBehavior;

    // Lock both document scrolling surfaces without resetting scrollY. Restore
    // only the inline properties this viewer owns, including on unmount.
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    // The opener can have started the site's smooth anchor/focus scroll. Stop
    // that in-flight movement before the modal takes over the document.
    root.style.scrollBehavior = "auto";
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
      touchStartRef.current = null;
      for (const { property, value, priority } of savedBody) {
        body.style.setProperty(property, value, priority);
      }
      for (const { property, value, priority } of savedRoot) {
        root.style.setProperty(property, value, priority);
      }
      root.style.scrollBehavior = "auto";
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      root.style.scrollBehavior = rootScrollBehavior;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  function openViewer(event: MouseEvent<HTMLAnchorElement>, index: number) {
    const link = event.currentTarget;
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey || link.hasAttribute("target") || link.hasAttribute("download") ||
      typeof dialogRef.current?.showModal !== "function"
    ) return;

    event.preventDefault();
    openerRef.current = link;
    setSelectedIndex(index);
  }

  function closeViewer() {
    dialogRef.current?.close();
  }

  function movePhoto(direction: -1 | 1) {
    setSelectedIndex((index) => index === null ? null : Math.max(0, Math.min(collection.images.length - 1, index + direction)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (!event.currentTarget.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey && event.key !== "Tab") return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      movePhoto(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Tab") {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0) :
        (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next]?.focus({ preventScroll: true });
    }
  }

  function startTouch(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    touchStartRef.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function trackTouch(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start) return;
    if (event.touches.length !== 1 || Math.abs(touch.clientY - start.y) > 24 && Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) {
      touchStartRef.current = null;
    }
  }

  function endTouch(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) movePhoto(dx < 0 ? 1 : -1);
  }

  return (
    <>
      <div className={styles.gallery}>
        {collection.images.map((photo, index) => (
          <figure key={photo.src}>
            <a className={styles.originalLink} href={photo.src} aria-label={`${photo.alt}，查看原图`} onClick={(event) => openViewer(event, index)}>
              <Image src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" sizes={photoSizes} />
            </a>
            <figcaption>{photo.alt}</figcaption>
          </figure>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className={styles.viewer}
        aria-labelledby={titleId}
        aria-describedby={image ? captionId : undefined}
        onKeyDown={handleKeyDown}
        onCancel={(event) => { event.preventDefault(); closeViewer(); }}
        onClose={() => setSelectedIndex(null)}
      >
        {image && selectedIndex !== null ? (
          <div className={styles.viewerLayout}>
            <header className={styles.viewerHeader}>
              <div>
                <h2 id={titleId}>{collection.title}</h2>
                <p aria-live="polite" aria-atomic="true">精选 {selectedIndex + 1} / {collection.images.length}</p>
              </div>
              <button ref={closeRef} type="button" onClick={closeViewer} aria-label="关闭照片查看器">关闭 <span aria-hidden="true">×</span></button>
            </header>
            <div className={styles.viewerStage}>
              <button className={styles.viewerPrevious} type="button" disabled={selectedIndex === 0} onClick={() => movePhoto(-1)} aria-label="上一张精选照片">← 上一张</button>
              <div
                className={styles.viewerImage}
                onTouchStart={startTouch}
                onTouchMove={trackTouch}
                onTouchEnd={endTouch}
                onTouchCancel={() => { touchStartRef.current = null; }}
              >
                <Image key={image.src} src={image.src} alt={image.alt} width={image.width} height={image.height} sizes={viewerSizes} loading="eager" aria-describedby={captionId} />
              </div>
              <button className={styles.viewerNext} type="button" disabled={selectedIndex === collection.images.length - 1} onClick={() => movePhoto(1)} aria-label="下一张精选照片">下一张 →</button>
            </div>
            <footer className={styles.viewerFooter}>
              <p id={captionId}>{image.alt}</p>
              <a href={image.src}>查看原图 <span aria-hidden="true">↗</span></a>
            </footer>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
