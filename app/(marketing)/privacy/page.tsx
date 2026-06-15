import type { Metadata } from "next";
import { skin } from "@/lib/skin";

export const metadata: Metadata = {
  title: skin.privacy.seoTitle,
  description: skin.privacy.seoDescription,
};

export default function PrivacyPage() {
  return (
    <main className="prose">
      <h1>{skin.privacy.heading}</h1>
      <p className="updated">last updated {skin.privacy.updated}</p>

      <p>
        {skin.brandName} is a free, open source project. the short version: we collect
        the least we can to connect you with players near you, we don&apos;t sell it, and
        you can delete it whenever you want.
      </p>

      <h2>what we collect</h2>
      <ul>
        <li><strong>your email</strong> - to tell you when a game is forming or happening in your area.</li>
        <li><strong>your name</strong> - so other players know who&apos;s coming.</li>
        <li><strong>your zip and city</strong> - to group you with people nearby. that&apos;s the only location we ask for.</li>
        <li><strong>what you&apos;re into</strong> - which area(s) you&apos;re interested in and roughly which times work.</li>
      </ul>

      <h2>what we don&apos;t collect</h2>
      <ul>
        <li>your street address or precise gps location.</li>
        <li>payment info - the site is free.</li>
        <li>anything from ad networks or third-party trackers.</li>
      </ul>

      <h2>what other players see</h2>
      <p>when a game is forming, the others in your area see your name and that you&apos;re in. they do not see your email or your zip.</p>

      <h2>what we do with it</h2>
      <p>only what the product needs: count interest near you, help the group form a game, and notify you about it. nothing else. we don&apos;t sell or rent your data, and we don&apos;t share it except where it&apos;s part of the game forming (above).</p>

      <h2>gear links</h2>
      <p>the gear page links to amazon and are affiliate links. if you click one, amazon&apos;s own privacy policy covers what happens on their site. the affiliate cut helps cover server costs.</p>

      <h2>email</h2>
      <p>we only email you about games and interest in your areas. you can opt out anytime.</p>

      <h2>your control</h2>
      <p>you can update or delete your info anytime from your account, and deleting your account removes your data.</p>

      <h2>changes</h2>
      <p>if this policy changes, we&apos;ll update this page and the date at the top.</p>

      <h2>questions</h2>
      <p>open an issue on <a href={skin.footer.githubUrl}>github</a> - the whole thing is in the open.</p>

      <p className="prose-note">this is a plain-language draft and not legal advice; it should get a proper review before launch.</p>
    </main>
  );
}
