import type { Metadata } from "next";
import Link from "next/link";
import { skin } from "@/lib/skin";

const SUPPORT_EMAIL = (
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@pickupflagfootball.com"
);

export const metadata: Metadata = {
  title: skin.terms.seoTitle,
  description: skin.terms.seoDescription,
};

export default function TermsPage() {
  return (
    <main className="prose">
      <h1>{skin.terms.heading}</h1>
      <p className="updated">last updated {skin.terms.updated}</p>

      <p>
        the short version: {skin.brandName} is a free tool that connects people who
        want to play {skin.activity} nearby. we build the software - the games,
        and everything that happens at them, are yours. playing sports with
        strangers carries real risk, and by using this site you accept that risk
        and agree not to hold us responsible for it. the details:
      </p>

      <h2>what this service is (and isn&apos;t)</h2>
      <p>
        {skin.brandName} is a matching platform. we count interest, deliver
        messages, and keep a schedule. we do <strong>not</strong> organize, run,
        supervise, sponsor, or attend the games; we don&apos;t control the venues;
        and we don&apos;t screen, vet, or background-check anyone. every player,
        captain, and proposer is an independent person acting on their own - nobody
        is our employee, agent, or representative.
      </p>

      <h2>who can use it</h2>
      <p>
        you must be <strong>18 or older</strong> to create an account. by signing
        up you confirm that you are, and that the information you give us is
        accurate.
      </p>

      <h2>assumption of risk</h2>
      <p>
        {skin.activity} is a physical sport. collisions, falls, sprains, broken
        bones, and worse can and do happen - as can risks that come with meeting
        strangers or being at a public venue (weather, field conditions, other
        people, travel to and from). <strong>you participate entirely at your own
        risk.</strong> by creating an account or attending any game found through
        this site, you knowingly and voluntarily assume all risks of injury,
        death, illness, and loss or damage to property, whether caused by other
        players, the venue, or anything else. you&apos;re responsible for judging
        your own fitness to play and for carrying your own health insurance.
      </p>

      <h2>release of liability</h2>
      <p>
        to the maximum extent permitted by law, you release and discharge{" "}
        {skin.brandName}, its maintainers, contributors, and anyone else involved
        in building or operating the project (together, &quot;the project&quot;)
        from any and all claims, demands, damages, and causes of action - known or
        unknown - arising out of or connected with games, meetups, or other
        interactions you find through this site, including claims based on the
        project&apos;s own negligence. you agree not to sue the project over any
        of it, and this release binds your heirs and legal representatives.
      </p>

      <h2>other players are strangers</h2>
      <p>
        we show display names and interest counts - that&apos;s all we know about
        anyone. use the judgment you&apos;d use meeting anyone from the internet:
        public places, daylight, bring a friend. if someone behaves badly at a
        game, that&apos;s between the people involved (and where appropriate, the
        police) - though we do want to hear about it so we can remove accounts.
      </p>

      <h2>venues</h2>
      <p>
        games happen at parks and fields the players pick. we don&apos;t own,
        inspect, or reserve them. permits, local rules, and field conditions are
        the players&apos; responsibility - if a venue requires a permit, getting
        one is on the group, not us.
      </p>

      <h2>your conduct</h2>
      <p>
        keep your account info accurate, don&apos;t impersonate anyone, don&apos;t
        harass people, don&apos;t use the site to spam or scrape, and don&apos;t
        propose games you don&apos;t intend to show up for. we can suspend or
        remove any account at our discretion, particularly for behavior that puts
        other players at risk.
      </p>

      <h2>donations</h2>
      <p>
        the site is free. donations and the $5/month supporter subscription are
        voluntary contributions to keep it running - they buy no features, no
        priority, and no services, and they&apos;re non-refundable except where
        the law says otherwise. subscriptions are billed by stripe and you can
        cancel anytime, which stops future charges.
      </p>

      <h2>the software</h2>
      <p>
        the service is provided <strong>&quot;as is&quot; and &quot;as
        available&quot;, with no warranties of any kind</strong> - no guarantee
        it&apos;s accurate, uninterrupted, or bug-free. a game shown as
        &quot;on&quot; can still fall through; players who said they&apos;re in
        can still flake. the code is open source; the license in the repository
        governs the code itself, these terms govern the hosted service.
      </p>

      <h2>limits on liability</h2>
      <p>
        to the maximum extent permitted by law, the project&apos;s total liability
        to you for anything arising out of the service is limited to the greater
        of the amount you donated in the past 12 months or $20 (usd), and the project is
        not liable for indirect, incidental, special, or consequential damages.
        some places don&apos;t allow certain limitations, so parts of this section
        may not apply to you.
      </p>

      <h2>indemnity</h2>
      <p>
        if your conduct at a game or on the site gets the project sued or fined,
        you agree to defend and indemnify the project against those claims and
        costs.
      </p>

      <h2>governing law</h2>
      <p>
        these terms are governed by the laws of the state of iowa, usa, without
        regard to conflict-of-law rules. if any part of these terms is held
        unenforceable, the rest still stands.
      </p>

      <h2>changes</h2>
      <p>
        if these terms change materially, we&apos;ll update this page and the date
        at the top. continuing to use the site after a change means you accept
        the new terms.
      </p>

      <h2>questions</h2>
      <p>
        email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or open an
        issue on <a href={skin.footer.githubUrl}>github</a>. see also the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </main>
  );
}
