import { Check, X } from "lucide-react";
import { PASSWORD_RULES } from "../lib/password";

/** Live password requirements — each rule turns green as it's met. */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} className="pwRules" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.id} className={ok ? "pwRule pwRule--ok" : "pwRule"} data-ok={ok}>
            {ok ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
            <span>{rule.label}</span>
            <span className="srOnly">{ok ? " — done" : " — still needed"}</span>
          </li>
        );
      })}
    </ul>
  );
}
