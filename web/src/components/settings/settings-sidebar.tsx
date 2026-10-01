import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SidebarSearchField } from "@/components/sidebar-app/search-field";
import { SETTINGS_GROUPS, type SectionId } from "./sections";

/** Takes the app sidebar's place while settings are open. */
export function SettingsSidebar({ section, onSection, onBack }: { section: SectionId; onSection: (id: SectionId) => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const { isMobile, setOpenMobile, setOpen } = useSidebar();
  const q = query.trim().toLowerCase();

  // ⌘K searches settings here, as it searches threads in the app sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
        search.current?.select();
        requestAnimationFrame(() => document.activeElement !== search.current && search.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, setOpen, setOpenMobile]);

  const groups = SETTINGS_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !q || `${g.title} ${i.label} ${i.keywords}`.toLowerCase().includes(q)),
  })).filter((g) => g.items.length > 0);

  const go = (id: SectionId) => {
    onSection(id);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton icon={ArrowLeft} onClick={onBack}>
              Back to threads
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSearchField
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            } else if (e.key === "Enter" && groups[0]) {
              go(groups[0].items[0].id);
            }
          }}
          placeholder="Search settings…"
        />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.title}>
            <SidebarGroupLabel>{g.title}</SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((i) => (
                <SidebarMenuItem key={i.id}>
                  <SidebarMenuButton icon={i.icon} isActive={section === i.id} onClick={() => go(i.id)}>
                    {i.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        {groups.length === 0 && <div className="px-4 py-2 text-[12px] text-muted-foreground">No settings match “{query.trim()}”.</div>}
      </SidebarContent>
    </Sidebar>
  );
}
