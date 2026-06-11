"use client";

import { useState } from "react";
import { useLab } from "./LabProvider";

export function PasswordField() {
  const { password, setPassword } = useLab();
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const invalid = touched && password.length === 0;

  return (
    <div className="pw">
      <label className="pw-label" htmlFor="lab-pw">
        Password <span className="req">required</span>
      </label>
      <div className={`pw-box${invalid ? " invalid" : ""}`}>
        <input
          id="lab-pw"
          className="pw-input mono"
          type={show ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="any length — no restrictions"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="pw-toggle"
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? "hide" : "show"}
        </button>
      </div>
      {invalid && <p className="pw-error">A password is required.</p>}
    </div>
  );
}
