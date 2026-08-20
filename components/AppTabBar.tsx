"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMap, IconCalendar, IconUser } from "@/components/icons";
import { ChatUnreadDot } from "@/components/ChatUnreadDot";

/**
 * Phone navigation shell (redesign decision A1, docs/design/mobile-redesign.md).
 * A persistent bottom tab bar — map / my games / account — shown only at phone
 * widths (CSS-gated); desktop keeps the header links. This replaces the fixed
 * legal-links footer on phones, which gave a rostered player no route to their
 * own games (audit M2): the primary destinations get the persistent bar, the
 * legal links move behind /account.
 *
 * The unread-chat badge rides the my-games tab — on phones this is the only
 * always-visible chat notification surface (audit M12).
 */
export function AppTabBar({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/play", label: "map", icon: IconMap, show: true, dot: false },
    { href: "/my-games", label: "my games", icon: IconCalendar, show: loggedIn, dot: true },
    { href: "/account", label: "account", icon: IconUser, show: true, dot: false },
  ].filter((t) => t.show);

  return (
    <nav className="tabbar" aria-label="primary">
      {tabs.map(({ href, label, icon: Icon, dot }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={`tabbar-tab${active ? " tabbar-tab--on" : ""}`}
            aria-current={active ? "page" : undefined}>
            <span className="tabbar-icon">
              <Icon size={22} />
              {dot && <ChatUnreadDot />}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
