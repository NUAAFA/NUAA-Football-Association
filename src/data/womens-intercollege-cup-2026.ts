import {
  ASSOCIATION_CONTENT_OWNER,
  ASSOCIATION_ORGANIZATION_ID,
} from "@/data/association";
import archiveData from "@/data/archives/2026-womens-intercollege-cup/womens-cup-2026.json";
import type { ArchiveGalleryImage, NewsItem } from "@/types";

const sharedMetadata = {
  campus: "tianmuhu",
  organizationId: ASSOCIATION_ORGANIZATION_ID,
  contentOwner: ASSOCIATION_CONTENT_OWNER,
  dataSource: "local",
} as const;

const imageRoot = "/images/competitions/2026-womens-intercollege-cup";

export const womensCupGallery = [
  { src: `${imageRoot}/01-match-action-touchline.jpg`, alt: "女足院际杯球员在边线附近争夺球权", width: 1620, height: 1080 },
  { src: `${imageRoot}/02-match-action-dribble.jpg`, alt: "女足院际杯球员带球推进", width: 1620, height: 1080 },
  { src: `${imageRoot}/03-captains-and-referees.jpg`, alt: "参赛队长与裁判员赛前合影", width: 1702, height: 1276 },
  { src: `${imageRoot}/04-pre-match-players.jpg`, alt: "女足院际杯参赛球员赛前列队", width: 1706, height: 1279 },
  { src: `${imageRoot}/05-sunset-match-action.jpg`, alt: "晚霞下进行的女足院际杯比赛", width: 1706, height: 1279 },
  { src: `${imageRoot}/06-best-goalkeeper-award.jpg`, alt: "赛事最佳门将奖项颁发现场", width: 1620, height: 1080 },
  { src: `${imageRoot}/07-golden-glove-trophies.jpg`, alt: "女足院际杯金手套奖杯与证书", width: 1620, height: 1080 },
  { src: `${imageRoot}/08-golden-glove-portrait.jpg`, alt: "赛事最佳门将许京俏获奖留影", width: 720, height: 541 },
  { src: `${imageRoot}/09-mvp-award.jpg`, alt: "赛事MVP赵晨希获奖留影", width: 720, height: 479 },
  { src: `${imageRoot}/10-blue-team-player.jpg`, alt: "身穿蓝色球衣的参赛球员赛场留影", width: 961, height: 1439 },
  { src: `${imageRoot}/11-blue-team-photo.jpg`, alt: "女足院际杯蓝色球衣队伍合影", width: 1620, height: 1080 },
  { src: `${imageRoot}/12-match-kick-in.jpg`, alt: "女足院际杯球员在边线恢复比赛", width: 1620, height: 1080 },
  { src: `${imageRoot}/13-trophy-and-medals.jpg`, alt: "女足院际杯奖杯与奖牌陈列", width: 961, height: 1441 },
  { src: `${imageRoot}/14-runner-up-team.jpg`, alt: "经济与管理学院亚军队伍合影", width: 1620, height: 1080 },
  { src: `${imageRoot}/15-champion-team.jpg`, alt: "人文自动化外国语联队冠军合影", width: 1923, height: 1280 },
  { src: `${imageRoot}/16-event-group-photo.jpg`, alt: "2026天目湖校区女足赛事集体合影", width: 1923, height: 1280 },
] as const satisfies readonly ArchiveGalleryImage[];

export const officialWomensCupNews: readonly NewsItem[] = [
  {
    ...sharedMetadata,
    id: "2026-womens-intercollege-cup-closing",
    category: "比赛战报",
    dateLabel: "2026-06-22 16:53",
    title: archiveData.competition.sourceArticleTitle,
    summary: "2026天目湖校区女足赛事圆满收官，人文外国语自动化联队获得冠军，三类个人奖项同步揭晓。",
    image: `${imageRoot}/16-event-group-photo.jpg`,
    imageAlt: "2026天目湖校区女足赛事集体合影",
    href: "/news/2026-womens-intercollege-cup-closing",
    dataStatus: "confirmed",
    badge: "官方来源",
    source: archiveData.competition.sourceArticlePublisher,
  },
];

export type WomensCupArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: readonly string[] };

export const womensCupArticle = {
  id: "2026-womens-intercollege-cup-closing",
  blocks: [
    {
      type: "paragraph",
      text: "2026天目湖校区女足赛事圆满落幕。各参赛队伍在绿茵场上展现了球技、协作与青春活力，为校园足球留下了鲜明的女足篇章。",
    },
    {
      type: "heading",
      text: "赛事名次",
    },
    {
      type: "paragraph",
      text: "校级官方账号报道显示，人文外国语自动化联队获得冠军，并在决赛中以2:0战胜经济与管理学院；致和-致慧-致元联队获得季军。完整8场赛果、积分榜和裁判选派信息可在赛事档案查看。",
    },
    {
      type: "heading",
      text: "个人奖项",
    },
    {
      type: "list",
      items: [
        "赛事MVP（金球奖）：赵晨希",
        `赛事最佳射手（金靴奖）：${archiveData.awards.topScorers.join("、")}（${archiveData.scorers.scope}，各1球，并列获奖）`,
        "赛事最佳门将（金手套奖）：许京俏",
      ],
    },
    {
      type: "heading",
      text: "铿锵绽放，延续校园足球热度",
    },
    {
      type: "paragraph",
      text: "本届赛事让更多校园女足球员在正式比赛氛围中彼此交流、协作并展示风采。赛场照片记录了比赛、颁奖和团队合影，也呈现出天目湖校区校园足球持续生长的参与氛围。",
    },
  ] as readonly WomensCupArticleBlock[],
} as const;

export const womensIntercollegeCup2026 = {
  ...archiveData,
  podium: [
    { rank: 1, team: archiveData.awards.champion, note: "决赛2:0获胜" },
    { rank: 2, team: archiveData.awards.runnerUp },
    { rank: 3, team: archiveData.awards.thirdPlace },
  ],
  awardList: [
    { award: "赛事MVP（金球奖）", recipient: archiveData.awards.mvp },
    { award: "赛事最佳射手（金靴奖）", recipient: archiveData.awards.topScorers.join("、"), note: `仅统计${archiveData.scorers.scope}，两人各进1球` },
    { award: "赛事最佳门将（金手套奖）", recipient: archiveData.awards.bestGoalkeeper },
  ],
  heroImage: `${imageRoot}/16-event-group-photo.jpg`,
  gallery: womensCupGallery,
  news: officialWomensCupNews[0],
} as const;

export function getWomensCupNewsItem(id: string) {
  return officialWomensCupNews.find((item) => item.id === id);
}

export function getWomensCupArticle(id: string) {
  return womensCupArticle.id === id ? womensCupArticle : undefined;
}
