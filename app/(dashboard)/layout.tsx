import { auth } from "@/auth"
import { redirect } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, ChevronUp } from "lucide-react"
import { logout } from "@/app/(auth)/logout/actions"
import { SidebarNav } from "./sidebar-nav"
import { HeaderTitle } from "./header-title"
import { SiteSwitcher } from "./site-switcher"
import { getUserSitesAndSelected } from "@/lib/selected-site"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // Глобальный выбор сайта (cookie) — один селектор в хедере на все вкладки.
  const { sites, selectedId } = await getUserSitesAndSelected(session.user.id)

  const userName = session.user.name ?? "Пользователь"
  const userEmail = session.user.email ?? ""
  const initials = userName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
              В
            </div>
            <span className="font-semibold group-data-[collapsible=icon]:hidden">
              Вебмонитор
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Меню</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarNav />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{userName}</span>
                    <ChevronUp className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  className="w-[--radix-popper-anchor-width]"
                >
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{userName}</span>
                      <span className="text-xs text-muted-foreground">{userEmail}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <form action={logout}>
                    <DropdownMenuItem asChild>
                      <button type="submit" className="w-full cursor-pointer">
                        <LogOut className="mr-2 h-4 w-4" />
                        Выйти
                      </button>
                    </DropdownMenuItem>
                  </form>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <HeaderTitle />
          <SiteSwitcher sites={sites} selectedId={selectedId} />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
