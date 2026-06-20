import Link from "next/link";
import { Ball } from "./Ball";
import { skin } from "@/lib/skin";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-cols">
        <div className="foot-brand">
          <div className="brand">
            <Ball w={24} h={16} />
            {skin.brandName}
          </div>
          <p className="foot-tagline">{skin.footer.tagline}</p>
          <Link href={skin.donate.url} className="donate">{skin.donate.label}</Link>
        </div>
        <div className="foot-col">
          <div className="foot-h">the site</div>
          <Link href="/#how">how it works</Link>
          <Link href="/faq">faq</Link>
          <Link href="/show-interest">show interest</Link>
        </div>
        <div className="foot-col">
          <div className="foot-h">the project</div>
          <a href={skin.footer.githubUrl}>github</a>
          <Link href="/privacy">privacy</Link>
        </div>
      </div>
      <div className="foot-bar">{skin.footer.note}</div>
    </footer>
  );
}
