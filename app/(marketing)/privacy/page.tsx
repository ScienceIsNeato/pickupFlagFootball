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
        <li><strong>your display name</strong> - so other players know who&apos;s coming. your real name isn&apos;t required — a username or nickname works just fine.</li>
        <li><strong>your zip</strong> (required) - to group you with people nearby.</li>
        <li><strong>your home address</strong> (optional) - if you give it, we use it to measure how far games are from you so we only surface ones you&apos;d actually travel to. it is the only thing we use it for.</li>
        <li><strong>what you&apos;re into</strong> - which area(s) you&apos;re interested in and roughly which times work.</li>
      </ul>

      <h2>how we handle your address</h2>
      <p>this is the important part: <strong>we never sell, rent, or give out your address or precise location to anyone</strong> - not other players, not advertisers, not third parties. it stays on our server and is used for exactly one thing: computing the distance from you to a game. the map only ever shows a general area (a neighborhood-sized cell), never your address or an exact point.</p>

      <h2>what we don&apos;t collect</h2>
      <ul>
        <li>payment info - the site is free.</li>
        <li>anything from ad networks or third-party trackers.</li>
      </ul>

      <h2>what other players see</h2>
      <p>when a game is forming, the others in your area see your name and that you&apos;re in. they never see your email, your zip, your address, or how far you are from anything.</p>

      <h2>what we do with it</h2>
      <p>only what the product needs: count interest near you, measure your distance to games, help the group form one, and notify you about it. nothing else. we don&apos;t sell or rent your data, and we don&apos;t share it except where it&apos;s part of the game forming (above).</p>

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
