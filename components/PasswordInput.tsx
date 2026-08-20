"use client";

import { useState } from "react";
import { IconEye, IconEyeOff } from "@/components/icons";

/**
 * Password input with a show/hide toggle (audit M64) — on a phone keyboard,
 * typing a password blind is how typos lock people out. Same styling hooks as
 * a bare input; forms pass through whatever props they were already using.
 */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? "text" : "password"} />
      <button
        type="button" className="pw-toggle"
        aria-label={show ? "hide password" : "show password"} aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <IconEyeOff size={17} /> : <IconEye size={17} />}
      </button>
    </span>
  );
}
