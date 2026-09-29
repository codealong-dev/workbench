import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-[12px] font-medium">
        {label}
        {hint && <span className="truncate font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; autoFocus?: boolean }) {
  return (
    <input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      spellCheck={false}
      className={cn(
        "h-7 w-full rounded-lg bg-surface-3 px-2.5 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3",
        props.mono && "font-mono text-[12px]",
      )}
    />
  );
}
