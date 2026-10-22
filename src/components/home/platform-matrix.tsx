import Image from "@/components/ui/site-image";
import {
  bilibiliPlatform,
  emailPlatform,
  footballChinaPlatform,
  wechatPlatform,
} from "@/data/platforms";
import { SectionHeading } from "@/components/ui/section-heading";

export function PlatformMatrix() {
  return (
    <section className="section platforms-section" aria-labelledby="platforms-title">
      <div className="page-shell">
        <SectionHeading eyebrow="OFFICIAL CHANNELS / 官方平台矩阵" title="找到正确入口，获取可靠信息" description="公众号、共享视频、竞赛管理平台与协会邮箱各自承担不同服务，请认准平台说明。" id="platforms-title" />
        <div className="platforms-grid">
          <article className="platform-card platform-wechat">
            <div className="platform-card-head"><span>WECHAT</span><small>{wechatPlatform.label}</small></div>
            <div className="wechat-content">
              <a className="qr-link" href={wechatPlatform.qrImage} target="_blank" rel="noopener noreferrer" aria-label="在新标签页放大湖区FA微信公众号二维码">
                <Image className="qr-image" src={wechatPlatform.qrImage} alt={wechatPlatform.qrAlt} width={260} height={260} />
                <span>{wechatPlatform.interactionLabel} <b aria-hidden="true">↗</b></span>
              </a>
              <div><h3>{wechatPlatform.name}</h3><p>{wechatPlatform.description}</p><small>手机端可点击放大后长按识别</small></div>
            </div>
          </article>

          <div className="platform-side-grid">
            <a className="platform-card platform-link-card" href={bilibiliPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往南航大足球协会哔哩哔哩主页，将在新标签页打开">
              <div className="platform-card-head"><span>BILIBILI</span><small>外部平台 ↗</small></div><h3>{bilibiliPlatform.name}</h3><strong>{bilibiliPlatform.label}</strong><p>{bilibiliPlatform.description}</p><b>{bilibiliPlatform.linkLabel} →</b>
            </a>
            <a className="platform-card platform-link-card" href={footballChinaPlatform.href} target="_blank" rel="noopener noreferrer" aria-label="前往足球中国注册报名，将在新标签页打开">
              <div className="platform-card-head"><span>FOOTBALL CHINA</span><small>外部平台 · HTTP ↗</small></div><h3>{footballChinaPlatform.name}</h3><strong>{footballChinaPlatform.label}</strong><p>{footballChinaPlatform.description}</p><small>{footballChinaPlatform.scopeNotice}</small><b>{footballChinaPlatform.linkLabel} →</b>
            </a>
            <a className="platform-card platform-email" href={emailPlatform.href}>
              <div className="platform-card-head"><span>EMAIL</span><small>协会联系渠道</small></div><h3>{emailPlatform.name}</h3><strong>{emailPlatform.label}</strong><p>{emailPlatform.description}</p><b>{emailPlatform.linkLabel} →</b>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
