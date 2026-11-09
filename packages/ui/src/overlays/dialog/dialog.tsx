import { CloseButton, Content, Description, Title } from "@kobalte/core/dialog"
import {
  type Accessor,
  type ComponentProps,
  createContext,
  type JSXElement,
  type ParentProps,
  Show,
  children,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
} from "solid-js"
import { useDialogLayer } from "../../context/dialog"
import { useI18n } from "../../context/i18n"
import "./dialog.css"

const TEXT_FIELD = [
  'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="file"], [type="color"], [type="image"]):not(:disabled, [readonly])',
  "textarea:not(:disabled, [readonly])",
  '[contenteditable="true"]',
].join(", ")

export interface DialogProps extends ParentProps {
  size?: "normal" | "large" | "x-large"
  variant?: "default" | "settings"
  class?: ComponentProps<"div">["class"]
  containerClass?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  onCloseAutoFocus?: ComponentProps<typeof Content>["onCloseAutoFocus"]
  preventBackdropDismiss?: boolean
  /** Adds a corner drag handle so the user can resize the dialog. */
  resizable?: boolean
  /** Adds a maximize/restore button to the header. The dialog starts resizable when maximizable. */
  maximizable?: boolean
}

interface DialogMaximize {
  maximized: Accessor<boolean>
  toggle: () => void
}

const DialogMaximizeContext = createContext<DialogMaximize>()

/** The maximize state of the enclosing `Dialog`; undefined unless that dialog rendered `maximizable`. */
export function useDialogMaximize() {
  return useContext(DialogMaximizeContext)
}

export interface DialogHeaderProps extends ParentProps {
  closeLabel?: string
  hideClose?: boolean
}

export interface DialogTitleGroupProps {
  title?: JSXElement
  description?: JSXElement
}

export function DialogFooter(props: ParentProps) {
  return <div data-slot="dialog-footer">{props.children}</div>
}

export function DialogBody(props: ParentProps & { class?: ComponentProps<"div">["class"]; style?: ComponentProps<"div">["style"] }) {
  const [local] = splitProps(props, ["class", "style", "children"])

  return (
    <div data-slot="dialog-body" class={local.class} style={local.style}>
      {local.children}
    </div>
  )
}

export function DialogTitle(props: ParentProps) {
  return <Title data-slot="dialog-header-title">{props.children}</Title>
}

export function DialogTitleGroup(props: DialogTitleGroupProps) {
  const title = children(() => props.title)
  const description = children(() => props.description)

  return (
    <div data-slot="dialog-title-group">
      <Show when={title()}>{(t) => <Title data-slot="dialog-title">{t()}</Title>}</Show>
      <Show when={description()}>{(value) => <Description data-slot="dialog-description">{value()}</Description>}</Show>
    </div>
  )
}

export function DialogHeader(props: DialogHeaderProps) {
  const i18n = useI18n()
  const maximize = useDialogMaximize()
  const [local] = splitProps(props, ["closeLabel", "hideClose", "children"])
  const hideClose = () => local.hideClose === true

  return (
    <div data-slot="dialog-header" data-hide-close={hideClose() ? "" : undefined}>
      {local.children}
      <Show when={maximize}>
        {(current) => (
          <button
            type="button"
            data-slot="dialog-maximize-button"
            aria-label={current().maximized() ? i18n.t("ui.dialog.restore") : i18n.t("ui.dialog.maximize")}
            onClick={() => current().toggle()}
          >
            <Show
              when={current().maximized()}
              fallback={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" />
                </svg>
              }
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="5.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" />
                <rect x="3.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" fill="var(--v2-background-bg-layer-01)" />
              </svg>
            </Show>
          </button>
        )}
      </Show>
      <Show when={!hideClose()}>
        <CloseButton data-slot="dialog-close-button" aria-label={local.closeLabel ?? i18n.t("ui.common.close")}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12.4446 3.55469L3.55566 12.4436M3.55566 3.55469L12.4446 12.4436"
              stroke="currentColor"
              stroke-linejoin="round"
            />
          </svg>
        </CloseButton>
      </Show>
    </div>
  )
}

const MIN_RESIZE_WIDTH = 480
const MIN_RESIZE_HEIGHT = 400

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    "size",
    "variant",
    "class",
    "containerClass",
    "classList",
    "fit",
    "children",
    "onCloseAutoFocus",
    "preventBackdropDismiss",
    "resizable",
    "maximizable",
  ])

  const layer = useDialogLayer()
  createEffect(() => layer?.setBackdropDismiss(!local.preventBackdropDismiss))

  const maximizable = () => local.maximizable === true
  const resizable = () => local.resizable === true || maximizable()

  let container: HTMLDivElement | undefined
  const [maximized, setMaximized] = createSignal(false)
  const [resizing, setResizing] = createSignal(false)
  // The inline size the dialog had before it was maximized; empty strings mean the CSS default size.
  let restored: { width: string; height: string } | undefined
  // Active drag listeners, removed by cleanup if the dialog unmounts mid-drag.
  let dragging: { move: (event: MouseEvent) => void; up: () => void } | undefined

  onCleanup(() => {
    if (!dragging) return
    document.removeEventListener("mousemove", dragging.move)
    document.removeEventListener("mouseup", dragging.up)
    dragging = undefined
  })

  const toggleMaximize = () => {
    if (!container) return
    if (maximized()) {
      if (restored?.width) {
        container.style.width = restored.width
        container.style.height = restored.height
      } else {
        container.style.width = ""
        container.style.height = ""
      }
      container.style.marginLeft = ""
      container.style.marginTop = ""
      restored = undefined
      setMaximized(false)
      return
    }
    restored = { width: container.style.width, height: container.style.height }
    container.style.width = "calc(100vw - 24px)"
    container.style.height = "calc(100vh - max(44px, env(titlebar-area-height, 44px)) - 24px)"
    container.style.marginTop = "calc(max(44px, env(titlebar-area-height, 44px)) + 8px)"
    container.style.marginLeft = ""
    setMaximized(true)
  }

  const startResize = (event: MouseEvent) => {
    if (!container || maximized() || dragging) return
    event.preventDefault()
    event.stopPropagation()
    // Pin the top-left corner while dragging: with the pinned margins, auto margins on the other
    // sides absorb the flex centering space, so the dialog grows toward the bottom-right instead
    // of around its center.
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: container.offsetWidth,
      height: container.offsetHeight,
      left: container.offsetLeft,
      top: container.offsetTop,
    }
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "nwse-resize"
    setResizing(true)

    const move = (moveEvent: MouseEvent) => {
      if (!container) return
      const width = Math.max(MIN_RESIZE_WIDTH, start.width + moveEvent.clientX - start.x)
      const height = Math.max(MIN_RESIZE_HEIGHT, start.height + moveEvent.clientY - start.y)
      container.style.width = `${width}px`
      container.style.height = `${height}px`
      container.style.marginLeft = `${start.left}px`
      container.style.marginTop = `${start.top}px`
    }
    const up = () => {
      setResizing(false)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", up)
      dragging = undefined
    }
    dragging = { move, up }
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
  }

  return (
    <div
      data-component="dialog-v2"
      data-variant={local.variant === "settings" ? "settings" : undefined}
      data-fit={local.fit ? true : undefined}
      data-size={local.size || "normal"}
    >
      <div data-slot="dialog-container" class={local.containerClass} data-maximized={maximized() ? "" : undefined} ref={(el) => (container = el)}>
        <Content
          data-slot="dialog-content"
          onCloseAutoFocus={local.onCloseAutoFocus}
          onPointerDownOutside={(event) => {
            if (local.preventBackdropDismiss) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            const target = event.target

            if (layer?.container && target instanceof Node && !layer.container.contains(target)) event.preventDefault()
          }}
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
          onOpenAutoFocus={(e) => {
            const content = e.currentTarget

            if (!(content instanceof HTMLElement)) return
            // Kobalte would focus the first tabbable element, usually the close button, which Escape already covers.
            e.preventDefault()
            // Kobalte attaches its focus trap after this event, so focusing now would leave the trap with no element
            // to return to. Deferring, as Kobalte's own autofocus does, also lets children that focus themselves on
            // mount keep that focus.
            setTimeout(() => {
              const autofocus = content.querySelector<HTMLElement>("[autofocus]")
              const active = document.activeElement

              const kept =
                active instanceof HTMLElement &&
                active !== content &&
                content.contains(active) &&
                !active.closest('[data-slot="dialog-close-button"]')
                  ? active
                  : undefined

              const field = Array.from(content.querySelectorAll<HTMLElement>(TEXT_FIELD)).find(
                (element) => element.getClientRects().length > 0,
              )

              const target = autofocus ?? kept ?? field ?? content
              target.focus({ preventScroll: true })
            })
          }}
        >
          {maximizable() ? (
            <DialogMaximizeContext.Provider value={{ maximized, toggle: toggleMaximize }}>
              {local.children}
            </DialogMaximizeContext.Provider>
          ) : (
            local.children
          )}
        </Content>
        <Show when={resizable()}>
          <div
            data-slot="dialog-resize-handle"
            data-resizing={resizing() ? "" : undefined}
            onMouseDown={startResize}
            aria-hidden="true"
          />
        </Show>
      </div>
    </div>
  )
}
