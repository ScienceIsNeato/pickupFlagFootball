import type { Metadata } from "next";
import { skin } from "@/lib/skin";

const SUPPORT_EMAIL = (
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@pickupflagfootball.com"
);

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
        you can ask us to delete it.
      </p>

      <h2>what we collect</h2>
      <ul>
        <li>
          <strong>your email</strong> - to tell you when a game is forming or happening
          in your area, and to sign you in.
        </li>
        <li>
          <strong>your display name</strong> - so other players know who&apos;s coming. your
          real name isn&apos;t required - a username or nickname works just fine.
        </li>
        <li>
          <strong>your zip</strong> (required) - to group you with people nearby.
        </li>
        <li>
          <strong>your home address</strong> (optional) - if you give it, we use it to
          measure how far games are from you so we only surface ones you&apos;d actually
          travel to. it is the only thing we use it for.
        </li>
        <li>
          <strong>what you&apos;re into</strong> - which area(s) you&apos;re interested in,
          your availability, game RSVPs, and captain status when applicable.
        </li>
        <li>
          <strong>optional google sign-in</strong> - if you use google to log in, we get
          your email and may show your google profile picture. we don&apos;t get your google
          password.
        </li>
        <li>
          <strong>optional support status</strong> - if you start a donation subscription,
          we store that you&apos;re a supporter and stripe&apos;s customer id so billing
          stays in sync. we never see or store your card number.
        </li>
      </ul>

      <h2>how we handle your address</h2>
      <p>
        this is the important part:{" "}
        <strong>
          we never sell, rent, or give out your address or precise location to anyone
        </strong>{" "}
        - not other players, not advertisers, not third parties. it stays on our server
        and is used for exactly one thing: computing the distance from you to a game. the
        map only ever shows a general area (a neighborhood-sized cell), never your address
        or an exact point.
      </p>

      <h2>what we don&apos;t collect</h2>
      <ul>
        <li>payment card numbers - stripe handles checkout; we only get billing status back.</li>
        <li>anything from ad networks or third-party trackers.</li>
      </ul>

      <h2>what other players see</h2>
      <p>
        when a game is forming, the others in your area see your name and that you&apos;re
        in. they never see your email, your zip, your address, or how far you are from
        anything.
      </p>

      <h2>what we do with it</h2>
      <p>
        only what the product needs: count interest near you, measure your distance to
        games, help the group form one, and notify you about it. nothing else. we
        don&apos;t sell or rent your data, and we don&apos;t share it except where
        it&apos;s part of the game forming (above) or with the service providers below.
      </p>

      <h2>email</h2>
      <p>
        we only email you about games and interest in your areas. every message includes
        a way to say you&apos;re not interested in that site or area. you can also update
        your account settings.
      </p>

      <h2>cookies and sign-in</h2>
      <p>
        we use authentication cookies to keep you signed in and to protect sign-in
        requests (session plus short-lived security cookies from our auth provider).
        that&apos;s it - no ad cookies, no analytics cookies.
      </p>

      <h2>who helps us run the site</h2>
      <ul>
        <li>
          <strong>neon</strong> - hosts our postgres database (your account and game data).
        </li>
        <li>
          <strong>brevo</strong> - sends transactional email on our behalf.
        </li>
        <li>
          <strong>stripe</strong> - processes optional donations if you choose to
          subscribe.
        </li>
        <li>
          <strong>google</strong> - optional sign-in only, if you pick that method.
        </li>
        <li>
          <strong>google cloud</strong> - hosts the web app.
        </li>
      </ul>
      <p>
        each provider has its own privacy policy for the slice they handle. we only send
        them what they need to do their job.
      </p>

      <h2>your control</h2>
      <p>
        you can update your profile, location, and travel preferences anytime from your
        account page. to delete your account and associated data, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address on the
        account and we&apos;ll remove it.
      </p>

      <h2>changes</h2>
      <p>if this policy changes, we&apos;ll update this page and the date at the top.</p>

      <h2>questions</h2>
      <p>
        email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or open an issue on{" "}
        <a href={skin.footer.githubUrl}>github</a> - the whole thing is in the open.
      </p>
    </main>
  );
}
