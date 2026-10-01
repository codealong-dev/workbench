import { createContext, useContext, useRef, type ReactNode } from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";

// Settings building blocks: a page, its titled sections, and lists of rows
// that share one fluid hover highlight (the same one menus and the sidebar use).

export function SettingsPage({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-9 px-6 pt-10 pb-20">
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-[13px] text-pretty text-muted-foreground">{description}</p>}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection(props: { title: ReactNode; description?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5", props.className)}>
      <div className="flex min-h-7 items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium">{props.title}</h2>
          {props.description && <p className="mt-0.5 text-[12px] text-pretty text-muted-foreground">{props.description}</p>}
        </div>
        {props.aside && <div className="flex shrink-0 items-center gap-1">{props.aside}</div>}
      </div>
      {props.children}
    </section>
  );
}

const Register = createContext<((index: number, el: HTMLElement | null) => void) | undefined>(undefined);

/** A card of rows; hovering slides one highlight between them. */
export function SettingsList({ children, className, ...aria }: { children: ReactNode; className?: string; role?: string; "aria-label"?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { gapClick: false });
  return (
    <div
      ref={ref}
      {...aria}
      className={cn("relative flex flex-col rounded-xl bg-surface-3 p-1 shadow-surface-2", className)}
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseLeave={hover.handlers.onMouseLeave}
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      <Register.Provider value={hover.registerItem}>{children}</Register.Provider>
    </div>
  );
}

export interface SettingsRowProps {
  /** Position in the list, for the hover highlight. */
  index: number;
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
  /** Right side: a switch, a value, a check. */
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** For option rows: "checkbox" or "radio", with `checked`. */
  role?: "checkbox" | "radio";
  checked?: boolean;
  tooltip?: string;
}

export function SettingsRow({ index, icon: Icon, title, description, trailing, onClick, disabled, role, checked, tooltip }: SettingsRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  // disabled rows sit out of the highlight
  useRegisterFluidHoverItem(useContext(Register), disabled ? undefined : index, ref);
  const interactive = !!onClick && !disabled;

  return (
    <div
      ref={ref}
      role={role}
      aria-checked={role ? !!checked : undefined}
      aria-disabled={disabled || undefined}
      title={tooltip}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(e) => {
        if (!interactive || e.target !== e.currentTarget) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 outline-none transition-opacity duration-160 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
        interactive && "cursor-pointer",
        disabled && "opacity-45",
      )}
    >
      {Icon && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-1 text-muted-foreground shadow-surface-1">
          <Icon size={15} strokeWidth={1.5} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        {description && <span className="block text-[12px] text-pretty text-muted-foreground">{description}</span>}
      </span>
      {trailing}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-surface-1 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground shadow-surface-1">{children}</kbd>;
}
