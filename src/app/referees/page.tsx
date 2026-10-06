import type { Metadata } from "next";
import { RefereeHub } from "@/components/referees/referee-hub";

export const metadata: Metadata = {
  alternates: { canonical: "/referees" },
  title: "裁判中心",
  description: "天目湖校园足球裁判名录、执裁意向、选派公示、历史记录与竞赛规则入口。",
};

export const dynamic = "force-dynamic";

export default function RefereesPage() {
  return <RefereeHub />;
}
