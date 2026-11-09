import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { createSignal, onCleanup, Show } from "solid-js"
import { createHomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeUtilityNav } from "./projects/view"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"

export function Home() {
  const mobile = createMediaQuery("(max-width: 767px)")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)

  // Resizable sidebar width with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = createSignal<number>(
    (() => {
      try {
        const saved = localStorage.getItem("opencode.home.sidebar.width")
        if (saved) {
          const val = parseInt(saved, 10)
          if (val >= 200 && val <= 600) return val
        }
      } catch {}
      return 280
    })(),
  )

  let isDragging = false
  let dragStartX = 0
  let initialWidth = 280

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    isDragging = true
    dragStartX = e.clientX
    initialWidth = sidebarWidth()
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDragging) return
      const delta = ev.clientX - dragStartX
      const next = Math.max(200, Math.min(600, initialWidth + delta))
      setSidebarWidth(next)
      try {
        localStorage.setItem("opencode.home.sidebar.width", String(next))
      } catch {}
    }

    const onPointerUp = () => {
      isDragging = false
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  onCleanup(() => {
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
  })

  return (
    <div
      data-slot="home-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile()}>
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
      </Show>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
      >
        <div
          class="flex min-h-full w-full max-md:flex-col"
          style={{
            display: "flex",
            "flex-direction": mobile() ? "column" : "row",
            width: "100%",
            height: "100%",
          }}
        >
          <Show when={!mobile()}>
            <div
              style={{
                width: `${sidebarWidth()}px`,
                "min-width": "200px",
                "max-width": "600px",
                "flex-shrink": 0,
                padding: "24px 0 24px 24px",
              }}
            >
              <HomeProjects projects={projects} scroll={scroll} />
            </div>

            {/* Draggable Divider between Left Panel and Right Panel */}
            <div
              onPointerDown={handlePointerDown}
              class="group relative flex w-3 shrink-0 cursor-col-resize items-center justify-center select-none"
              style={{
                "touch-action": "none",
              }}
              title="按住鼠标拖拽调整左右两边宽度"
            >
              <div class="h-full w-[1px] bg-v2-border-border transition-colors group-hover:w-[2px] group-hover:bg-v2-state-bg-accent" />
            </div>
          </Show>

          <div
            class="min-w-0 flex-1"
            style={{
              padding: mobile() ? "16px 12px" : "24px 24px 24px 12px",
              width: "100%",
            }}
          >
            <HomeSessions sessions={sessions} search={search} scroll={scroll} />
          </div>
        </div>
      </ScrollView>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden">
        <HomeUtilityNav
          class="flex"
          onOpenSettings={projects.utility.settings}
          onOpenHelp={projects.utility.help}
          language={projects.copy.language}
        />
      </div>
    </div>
  )
}
