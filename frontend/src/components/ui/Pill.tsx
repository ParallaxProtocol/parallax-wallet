import type { HTMLAttributes, ReactNode, Ref } from "react";
import { TONE_WASH, type Tone } from "./tone";

/**
 * Pill is a small capsule label beside a name or a value: a state, a kind,
 * a count. It takes a ref and handlers, so a Tooltip can wrap it.
 */
export function Pill({
  tone = "neutral",
  className = "",
  children,
  ref,
  ...rest
}: { tone?: Tone; className?: string; children: ReactNode; ref?: Ref<HTMLSpanElement> } & Omit<
  HTMLAttributes<HTMLSpanElement>,
  "className" | "children"
>) {
  return (
    <span ref={ref} className={`badge ${tone === "neutral" ? "" : TONE_WASH[tone]} ${className}`} {...rest}>
      {children}
    </span>
  );
}
