import type { Metadata } from "next";
import "./globals.css";
import "@/styles/layout.css";
import "@/styles/home.css";
import "@/styles/detail-pages.css";
import "@/styles/page-templates.css";
import "@/styles/home-v21.css";
import "@/styles/home-v22.css";
import "@/styles/competition-archive.css";
import "@/styles/functional-pages.css";
import "@/styles/acceptance-upgrade.css";
import "@/styles/v24.css";
import "@/styles/v25.css";
import "@/styles/v26.css";
import "@/styles/v27.css";
import "@/styles/v28.css";
import "@/styles/v28-acceptance.css";
import "@/styles/v28-final-acceptance.css";
import "@/styles/design-foundation.css";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
} from "@/lib/site-metadata";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/rss.xml",
    },
  },
  keywords: [
    "南京航空航天大学",
    "天目湖足球协会",
    SITE_NAME,
    "校园足球",
    "NUAA Tianmuhu Football Association",
  ],
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
