"use client";

import { useActionState } from "react";
import { updateUsername } from "@/app/(app)/account/actions";
import { useSaveToast } from "./useSaveToast";

/** The "username" card (middle column) — just the display name. */
export function UsernameForm({ displayName }: { displayName: string }) {
  const [state, formAction, pending] = useActionState(updateUsername, null);
  const toast = useSaveToast(state);
  return (
    <>
      <form className="reg-form" action={formAction}>
        <label>
          display name
          <input type="text" name="displayName" placeholder="first name or nickname"
            defaultValue={displayName} autoComplete="given-name" />
        </label>
        {state && !state.ok && <div className="auth-error">{state.error}</div>}
        <button type="submit" className="btn-green" disabled={pending}>
          {pending ? "saving…" : "save name"}
        </button>
      </form>
      {toast}
    </>
  );
}
