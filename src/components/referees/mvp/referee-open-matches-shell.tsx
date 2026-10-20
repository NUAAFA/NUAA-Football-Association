import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RefereePage } from "@/components/referees/referee-public-layout";
import { RefereeWorkspaceHero } from "@/components/referees/mvp/referee-workspace-hero";
import { RefereeWorkspaceNav } from "@/components/referees/mvp/referee-workspace-nav";

type RefereeOpenMatchesShellProps = {
  children: ReactNode;
  description: string;
  eyebrow: string;
  member: { name: string; publicCode: string } | null;
  title: string;
  workspaceDescription?: string;
};

export function RefereeOpenMatchesShell({
  children,
  description,
  eyebrow,
  member,
  title,
  workspaceDescription,
}: RefereeOpenMatchesShellProps) {
  if (!member) return <RefereePage current="/referees/open-matches" description={description} eyebrow={eyebrow} title={title}>{children}</RefereePage>;
  return <>
    <SiteHeader />
    <main className="functional-page" id="main-content">
      <RefereeWorkspaceHero description={workspaceDescription ?? description} eyebrow={eyebrow} name={member.name} publicCode={member.publicCode} title={title} />
      <RefereeWorkspaceNav />
      <section className="functional-section"><div className="detail-shell">
      {children}
      </div></section>
    </main>
    <SiteFooter />
  </>;
}
