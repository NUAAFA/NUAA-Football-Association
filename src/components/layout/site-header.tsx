"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { associationIdentity } from "@/data/association";
import { navigationItems, registrationCta } from "@/data/navigation";
import { BrandMark } from "@/components/ui/brand-mark";

type SiteHeaderProps = {
  fixed?: boolean;
  overlay?: boolean;
};

function Brand() {
  return (
    <Link className="brand" href="/" aria-label={`${associationIdentity.formalName}首页`}>
      <BrandMark />
      <span className="brand-copy">
        <strong>{associationIdentity.formalName}</strong>
        <small>{associationIdentity.englishName.toUpperCase()}</small>
      </span>
    </Link>
  );
}

export function SiteHeader({ fixed = false, overlay = false }: SiteHeaderProps) {
  const pathname = usePathname();
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileMenuSummaryRef = useRef<HTMLElement>(null);
  const isCurrent = (href: string) =>
    href === "/" ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;

  useEffect(() => {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
  }, [pathname]);

  function handleMobileMenuKeyDown(event: ReactKeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !mobileMenuRef.current?.open) return;
    event.preventDefault();
    mobileMenuRef.current.open = false;
    mobileMenuSummaryRef.current?.focus();
  }

  function closeMobileMenu() {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
  }

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className={`${overlay ? "site-header site-header-overlay" : "site-header site-header-solid"}${fixed ? " site-header-fixed" : ""}`}>
        <div className="page-shell header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="主导航">
            {navigationItems.map((item) => (
              <Link aria-current={isCurrent(item.href) ? "page" : undefined} key={item.href} href={item.href}>{item.label}</Link>
            ))}
          </nav>
          <Link aria-current={isCurrent(registrationCta.href) ? "page" : undefined} className="header-cta" href={registrationCta.href}>
            {registrationCta.label} <span aria-hidden="true">→</span>
          </Link>
          <details className="mobile-menu" onKeyDown={handleMobileMenuKeyDown} ref={mobileMenuRef}>
            <summary aria-label="切换主导航" ref={mobileMenuSummaryRef}><span /><span /></summary>
            <nav aria-label="移动端主导航">
              <span className="mobile-menu-label">网站导航</span>
              {navigationItems.map((item) => (
                <Link aria-current={isCurrent(item.href) ? "page" : undefined} key={item.href} href={item.href} onClick={closeMobileMenu}>{item.label}<span aria-hidden="true">›</span></Link>
              ))}
              <Link aria-current={isCurrent(registrationCta.href) ? "page" : undefined} href={registrationCta.href} onClick={closeMobileMenu}>{registrationCta.label} <span aria-hidden="true">→</span></Link>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}
