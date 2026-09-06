import Image from "next/image";
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
            <p className="footer-intro">
              {associationIdentity.slogan}。我们服务天目湖校园足球，连接赛事、球队、裁判与每一位参与者。
            </p>
          </div>
          <div className="footer-navigation-groups">
            {footerNavigation.map((group) => (
              <nav className="footer-column" aria-label={`页脚${group.label}`} key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
              </nav>
            ))}
          </div>
          <div className="footer-column footer-platforms">
            <h2>官方平台与联系</h2>
            <a className="footer-wechat" href={wechatPlatform.qrImage} target="_blank" rel="noopener noreferrer" aria-label="放大湖区FA微信公众号二维码，将在新标签页打开">
              <Image src={wechatPlatform.qrImage} alt={wechatPlatform.qrAlt} width={66} height={66} />
              <span><strong>{wechatPlatform.label}</strong><small>{wechatPlatform.name} · 点击放大二维码</small></span>
            </a>
            <a href={bilibiliPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往南航校园足球共享视频平台，将在新标签页打开">
              哔哩哔哩 · {bilibiliPlatform.name} ↗
            </a>
            <Link className="footer-douyin" href="/media#douyin">
              <Image src={douyinPlatform.qrImage} alt={douyinPlatform.qrAlt} width={54} height={54} />
              <span>抖音 · {douyinPlatform.name}<small>{douyinPlatform.label} · 查看二维码</small></span>
            </Link>
            <a href={footballChinaPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往足球中国，将在新标签页打开">
              足球中国 · 注册报名平台 ↗
            </a>
            <a href={emailPlatform.href}>联系邮箱 · {emailPlatform.label}</a>
            <div className="footer-emblem">
              <Image src="/brand/nuaa-official-emblem.jpg" alt="南京航空航天大学官方校徽" width={64} height={64} />
              <p><strong>学校归属：南京航空航天大学</strong></p>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 {associationIdentity.formalName} · {associationIdentity.establishedLabel}</p>
        </div>
      </div>
    </footer>
  );
}
