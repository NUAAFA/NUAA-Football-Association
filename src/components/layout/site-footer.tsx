import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { associationIdentity } from "@/data/association";
import { footerNavigation } from "@/data/navigation";
import {
  bilibiliPlatform,
  emailPlatform,
  footballChinaPlatform,
  douyinPlatform,
  wechatPlatform,
} from "@/data/platforms";

type SiteFooterProps = {
  homeCompact?: boolean;
};

export function SiteFooter({ homeCompact = false }: SiteFooterProps) {
  return (
    <footer className={`site-footer${homeCompact ? " site-footer-home" : ""}`}>
      <div className="page-shell">
        <div className="footer-main">
          <div>
            <div className="footer-brand">
              <BrandMark />
              <div className="footer-brand-copy">
                <strong>{associationIdentity.formalName}</strong>
                <small>{associationIdentity.englishName.toUpperCase()}</small>
              </div>
            </div>
            <p className="footer-intro">{associationIdentity.slogan}</p>
            <p className="footer-attribution">学校归属：南京航空航天大学</p>
          </div>
          <div className="footer-navigation-groups">
            {footerNavigation.map((group) => (
              <nav className="footer-column" aria-label={`页脚${group.label}`} key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
              </nav>
            ))}
          </div>
          <div className="footer-platforms">
            <h2>官方平台与联系</h2>
            <div className="footer-platform-links">
              <a href={wechatPlatform.qrImage} target="_blank" rel="noopener noreferrer" aria-label="放大湖区FA微信公众号二维码，将在新标签页打开">
                <span>微信 · {wechatPlatform.name}</span><small>查看公众号二维码 ↗</small>
              </a>
              <a href={bilibiliPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往南航校园足球共享视频平台，将在新标签页打开">
                <span>哔哩哔哩 ↗</span><small>校园足球共享视频</small>
              </a>
              <Link href={douyinPlatform.href}>
                <span>抖音 · {douyinPlatform.name}</span><small>查看官方二维码 →</small>
              </Link>
              <a href={footballChinaPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往足球中国，将在新标签页打开">
                <span>足球中国 ↗</span><small>注册与报名入口</small>
              </a>
            </div>
            <a className="footer-email" href={emailPlatform.href}>联系邮箱 · {emailPlatform.label}</a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 {associationIdentity.formalName} · {associationIdentity.establishedLabel}</p>
        </div>
      </div>
    </footer>
  );
}
