import type { Metadata } from "next";
import Link from "next/link";
import { skin } from "@/lib/skin";
import { ShowInterestForm } from "@/components/ShowInterestForm";

export const metadata: Metadata = {
  title: skin.register.seoTitle,
  description: skin.register.seoDescription,
};

export default function ShowInterestPage() {
  return (
    <main className="reg">
      <Link href="/" className="back">&larr; back</Link>
      <h1 className="reg-h">{skin.register.heading}</h1>
      <p className="reg-blurb">{skin.register.blurb}</p>
      <ShowInterestForm cta={skin.register.cta} note={skin.register.note} />
    </main>
  );
}
