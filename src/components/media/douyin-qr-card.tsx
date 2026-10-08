"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import styles from "@/components/media/media.module.css";
import { douyinPlatform } from "@/data/platforms";

export function DouyinQrCard() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const opener = openerRef.current;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const root = document.documentElement;
    const properties = ["overflow-x", "overflow-y"] as const;
    const savedStyles = [body, root].map((element) => ({
      element,
      properties: properties.map((property) => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      })),
    }));
    const scrollBehavior = root.style.scrollBehavior;

    function restorePage() {
      if (dialog?.open) dialog.close();
      for (const saved of savedStyles) {
        for (const { property, value, priority } of saved.properties) {
          saved.element.style.setProperty(property, value, priority);
        }
      }
      root.style.scrollBehavior = "auto";
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      root.style.scrollBehavior = scrollBehavior;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.scrollBehavior = "auto";
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    try {
      // The native modal top layer makes the rest of the document inert.
      dialog.showModal();
      closeRef.current?.focus({ preventScroll: true });
    } catch (error) {
      restorePage();
      throw error;
    }

    return restorePage;
  }, [open]);

  function openQr(event: MouseEvent<HTMLAnchorElement>) {
    const link = event.currentTarget;
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey || link.hasAttribute("target") || link.hasAttribute("download") ||
      typeof dialogRef.current?.showModal !== "function"
    ) return;

    event.preventDefault();
    openerRef.current = link;
    setOpen(true);
  }

  function closeQr() {
    dialogRef.current?.close();
  }

  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab" || !event.currentTarget.open) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0) :
      (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next]?.focus({ preventScroll: true });
  }

  return (
    <>
      <article className={`${styles.platform} ${styles.douyin}`} id="douyin" aria-labelledby="douyin-title">
        <a className={styles.qrThumbnail} href={douyinPlatform.qrImage} aria-label="放大南航足协抖音二维码，查看原图" onClick={openQr}>
          <Image src={douyinPlatform.qrImage} alt={douyinPlatform.qrAlt} width={698} height={698} sizes="96px" loading="lazy" />
        </a>
        <div>
          <p className={styles.platformKind}>DOUYIN / 官方账号</p>
          <h3 id="douyin-title">{douyinPlatform.name}</h3>
          <p className={styles.platformLabel}>{douyinPlatform.label}</p>
          <p className={styles.platformDescription}>{douyinPlatform.description}</p>
          <a className={styles.platformLink} href={douyinPlatform.qrImage} onClick={openQr}>放大二维码 <span aria-hidden="true">↗</span></a>
        </div>
      </article>
      <dialog
        ref={dialogRef}
        className={styles.qrDialog}
        aria-labelledby="douyin-qr-title"
        aria-describedby={open ? "douyin-qr-help" : undefined}
        onKeyDown={containFocus}
        onCancel={(event) => { event.preventDefault(); closeQr(); }}
        onClose={() => setOpen(false)}
      >
        {open ? (
          <div className={styles.qrDialogLayout}>
            <header className={styles.qrDialogHeader}>
              <h2 id="douyin-qr-title">南航足协抖音二维码</h2>
              <button ref={closeRef} type="button" onClick={closeQr} aria-label="关闭二维码">关闭 <span aria-hidden="true">×</span></button>
            </header>
            <div className={styles.qrDialogImage}>
              <Image src={douyinPlatform.qrImage} alt={douyinPlatform.qrAlt} width={698} height={698} sizes="(max-height: 500px) 200px, (max-width: 600px) calc(100vw - 64px), 480px" loading="eager" />
            </div>
            <footer className={styles.qrDialogFooter}>
              <p id="douyin-qr-help">保存图片后，可在抖音中使用“扫一扫”识别；{douyinPlatform.label}。</p>
              <a href={douyinPlatform.qrImage} target="_blank" rel="noopener noreferrer">打开二维码原图（新窗口）<span aria-hidden="true">↗</span></a>
            </footer>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
