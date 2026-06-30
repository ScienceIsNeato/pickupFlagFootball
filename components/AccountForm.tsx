"use client";

import { useActionState } from "react";
import { saveAccount } from "@/app/(app)/account/actions";
import { useSaveToast } from "./useSaveToast";

/** Wraps the whole account grid in one form: the single "Save Changes" button
 *  (top-right) saves display name + location + donation reminder together. The
 *  fields themselves are server-rendered children. Billing buttons inside the
 *  form override the action with their own `formAction`. */
export function AccountForm({ children }: { children: React.ReactNode }) {
  const [state, formAction, pending] = useActionState(saveAccount, null);
  const toast = useSaveToast(state);
  return (
    <>
      <form className="account-form" action={formAction}>
        <div className="acct-save-bar">
          {state && !state.ok && (
            <span className="acct-save-err" role="alert" aria-live="polite">{state.error}</span>
          )}
          <button type="submit" className="acct-save" disabled={pending}>
            {pending ? "saving…" : "Save Changes"}
          </button>
        </div>
        {children}
      </form>
      {toast}
    </>
  );
}
