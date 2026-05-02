# Inventory Platform — Complete source (part 7 of 10)

Generated: 2026-05-02T06:08:07 UTC

Machine-generated split of `downloads/inventory-platform-complete-source.md`. Each file in the bundle starts with a `### \`path\`` heading followed by a fenced code block — this split only cuts **between** those blocks so fences stay intact.

- **Single-file bundle:** run `pnpm --filter @workspace/scripts export:complete-md`
- **Parts:** `inventory-platform-complete-source-part-NN-of-10.md` (this is part 7)
- **Replication:** Part 1 begins with the original preamble (quickstart + included roots + TOC). Other parts continue body content only.

---

### `artifacts/inventory-portal/src/components/ui/radio-group.tsx` (43 lines)

```typescript
import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-3.5 w-3.5 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }

```

### `artifacts/inventory-portal/src/components/ui/resizable.tsx` (46 lines)

```typescript
"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }

```

### `artifacts/inventory-portal/src/components/ui/scroll-area.tsx` (47 lines)

```typescript
import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }

```

### `artifacts/inventory-portal/src/components/ui/select.tsx` (160 lines)

```typescript
"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}

```

### `artifacts/inventory-portal/src/components/ui/separator.tsx` (30 lines)

```typescript
import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }

```

### `artifacts/inventory-portal/src/components/ui/sheet.tsx` (141 lines)

```typescript
"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

```

### `artifacts/inventory-portal/src/components/ui/sidebar.tsx` (728 lines)

```typescript
"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, VariantProps } from "class-variance-authority"
import { PanelLeftIcon } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-[var(--sidebar-width)] flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-[var(--sidebar-width)] p-0 [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4))]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4)+2px)]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  // Note: Tailwind v3.4 doesn't support "in-" selectors. So the rail won't work perfectly.
  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-background h-8 w-full shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-sidebar-border mx-2 w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline outline-2 outline-transparent outline-offset-2 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}

```

### `artifacts/inventory-portal/src/components/ui/skeleton.tsx` (16 lines)

```typescript
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

export { Skeleton }

```

### `artifacts/inventory-portal/src/components/ui/slider.tsx` (27 lines)

```typescript
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }

```

### `artifacts/inventory-portal/src/components/ui/sonner.tsx` (32 lines)

```typescript
"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

```

### `artifacts/inventory-portal/src/components/ui/spinner.tsx` (20 lines)

```typescript
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2 className={cn("animate-spin text-primary", className)} {...props} />
  );
}

export function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-10 w-10" />
        <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
      </div>
    </div>
  );
}

```

### `artifacts/inventory-portal/src/components/ui/switch.tsx` (28 lines)

```typescript
import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

```

### `artifacts/inventory-portal/src/components/ui/table.tsx` (121 lines)

```typescript
import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

```

### `artifacts/inventory-portal/src/components/ui/tabs.tsx` (54 lines)

```typescript
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

```

### `artifacts/inventory-portal/src/components/ui/textarea.tsx` (23 lines)

```typescript
import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

```

### `artifacts/inventory-portal/src/components/ui/toast.tsx` (128 lines)

```typescript
import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}

```

### `artifacts/inventory-portal/src/components/ui/toaster.tsx` (34 lines)

```typescript
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}

```

### `artifacts/inventory-portal/src/components/ui/toggle-group.tsx` (62 lines)

```typescript
"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
))

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }

```

### `artifacts/inventory-portal/src/components/ui/toggle.tsx` (44 lines)

```typescript
import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }

```

### `artifacts/inventory-portal/src/components/ui/tooltip.tsx` (33 lines)

```typescript
"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

```

### `artifacts/inventory-portal/src/hooks/use-mobile.tsx` (20 lines)

```typescript
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

```

### `artifacts/inventory-portal/src/hooks/use-toast.ts` (192 lines)

```typescript
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }

```

### `artifacts/inventory-portal/src/index.css` (122 lines)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-card-border: hsl(var(--border));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));

  --color-surface:        hsl(var(--surface));
  --color-surface-raised: hsl(var(--surface-raised));
  --color-hover:          hsl(var(--hover));

  --font-sans: 'Inter', sans-serif;
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
}

:root {
  /* Clean light theme */
  --background:    0 0% 97%;
  --foreground:    220 13% 13%;

  --card:          0 0% 100%;
  --card-foreground: 220 13% 13%;

  --popover:       0 0% 100%;
  --popover-foreground: 220 13% 13%;

  --primary:       221 83% 53%;
  --primary-foreground: 0 0% 100%;

  --secondary:     220 14% 96%;
  --secondary-foreground: 220 13% 13%;

  --muted:         220 14% 96%;
  --muted-foreground: 220 9% 46%;

  --accent:        221 83% 53%;
  --accent-foreground: 0 0% 100%;

  --destructive:   0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  --border:        220 13% 91%;
  --input:         220 13% 91%;
  --ring:          221 83% 53%;

  --radius: 0.5rem;

  --surface:       0 0% 100%;
  --surface-raised: 220 14% 97%;
  --hover:         220 14% 96%;
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply font-sans antialiased bg-background text-foreground min-h-screen selection:bg-primary/20 selection:text-foreground;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-display tracking-tight;
  }
}

/* Custom Scrollbar for a premium feel */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  @apply bg-background;
}

::-webkit-scrollbar-thumb {
  @apply bg-border rounded-full border-2 border-solid border-background;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-muted-foreground;
}

/* Glass panel utility */
.glass-panel {
  @apply bg-card/60 backdrop-blur-xl border border-white/5 shadow-2xl shadow-black/40;
}

```

### `artifacts/inventory-portal/src/lib/utils.ts` (7 lines)

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

```

### `artifacts/inventory-portal/src/main.tsx` (6 lines)

```typescript
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

```

### `artifacts/inventory-portal/src/pages/admin.tsx` (417 lines)

```typescript
/**
 * Admin Page (route: /admin)
 *
 * Owner-only user management panel. Tabs: Users (add/remove/role-change) and
 * Audit Log (read-only history). All mutations are guarded by requireOwner on
 * the server — any non-owner who reaches this URL will receive 403 from the API.
 */
import { useEffect, useState } from "react";
import {
  useGetAccessList,
  useAddAccessEntry,
  useRemoveAccessEntry,
  useUpdateAccessRole,
  useGetAuditLog,
  getGetAccessListQueryKey,
  getGetAuditLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trash2, Plus, Shield, Mail, Calendar, User as UserIcon,
  Loader2, ClipboardList, Eye, UserCheck, ChevronDown,
} from "lucide-react";
import { FullScreenSpinner } from "@/components/ui/spinner";
import { useLocation } from "wouter";

type Tab = "users" | "audit" | "operations";

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer",
  guest:  "Guest",
  owner:  "Owner",
};

const ROLE_COLORS: Record<string, string> = {
  viewer: "bg-blue-50 text-blue-700 border-blue-200",
  guest:  "bg-gray-50 text-gray-600 border-gray-200",
  owner:  "bg-purple-50 text-purple-700 border-purple-200",
};

function RoleSelector({ email, currentRole, onUpdate }: {
  email: string;
  currentRole: string;
  onUpdate: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = ["viewer", "guest"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${ROLE_COLORS[currentRole] ?? ROLE_COLORS.viewer}`}>
        {ROLE_LABELS[currentRole] ?? currentRole}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-20 w-28 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
            {options.map((role) => (
              <button key={role}
                onClick={() => { setOpen(false); if (role !== currentRole) onUpdate(role); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors font-medium ${role === currentRole ? "text-blue-600 bg-blue-50" : "text-gray-700"}`}>
                {ROLE_LABELS[role]}
                {role === "viewer" && <p className="text-gray-400 font-normal text-xs">Full access</p>}
                {role === "guest"  && <p className="text-gray-400 font-normal text-xs">Price hidden</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  add:         "Added",
  remove:      "Removed",
  role_change: "Role changed",
};

const ACTION_COLORS: Record<string, string> = {
  add:         "bg-green-100 text-green-700",
  remove:      "bg-red-100 text-red-700",
  role_change: "bg-blue-100 text-blue-700",
};

export default function Admin() {
  const queryClient    = useQueryClient();
  const [, setLocation] = useLocation();
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState<"viewer" | "guest">("viewer");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [opsData, setOpsData] = useState<any>(null);
  const [opsError, setOpsError] = useState<string>("");

  const { data: accessList, isLoading, error } = useGetAccessList({
    query: { queryKey: getGetAccessListQueryKey(), retry: false },
  });
  const { data: auditLog,   isLoading: auditLoading } = useGetAuditLog({
    query: {
      queryKey: getGetAuditLogQueryKey(),
      enabled: activeTab === "audit",
      retry: false,
    },
  });

  const addMutation        = useAddAccessEntry();
  const removeMutation     = useRemoveAccessEntry();
  const updateRoleMutation = useUpdateAccessRole();

  if (error) {
    const status = (error as any)?.status;
    if (status === 401 || status === 403) { setLocation("/"); return null; }
  }

  if (isLoading) return <FullScreenSpinner />;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetAccessListQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAuditLogQueryKey() });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) { setErrorMsg("Please enter a valid email address."); return; }
    setErrorMsg("");
    addMutation.mutate(
      { data: { email: newEmail.toLowerCase().trim(), role: newRole } },
      { onSuccess: () => { setNewEmail(""); invalidateAll(); }, onError: (err: any) => setErrorMsg(err.data?.error || "Failed to add user.") }
    );
  };

  const handleRemove = (email: string) => {
    if (!confirm(`Remove access for ${email}?`)) return;
    removeMutation.mutate({ email }, { onSuccess: invalidateAll });
  };

  const handleRoleChange = (email: string, role: string) => {
    updateRoleMutation.mutate(
      { email, data: { role } },
      { onSuccess: invalidateAll }
    );
  };

  useEffect(() => {
    if (activeTab !== "operations") return;
    let cancelled = false;
    async function loadOps() {
      setOpsError("");
      try {
        // Raw fetch: /ops endpoints are operational diagnostics and are not part of the generated OpenAPI hooks.
        const [functionStatus, incidents, deps] = await Promise.all([
          fetch("/api/ops/function-status", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
          fetch("/api/ops/incidents?limit=20", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
          fetch("/api/ops/dependencies", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!cancelled) setOpsData({ functionStatus, incidents, deps });
      } catch (err) {
        if (!cancelled) setOpsError(String(err));
      }
    }
    loadOps();
    return () => { cancelled = true; };
  }, [activeTab]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Access Management
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Control which Google accounts can view the inventory portal.</p>
      </div>

      {/* Add user form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Grant Access</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter Google email address"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              disabled={addMutation.isPending}
            />
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "viewer" | "guest")}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            disabled={addMutation.isPending}>
            <option value="viewer">Viewer — full access</option>
            <option value="guest">Guest — price hidden</option>
          </select>
          <button type="submit"
            disabled={addMutation.isPending || !newEmail}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add User
          </button>
        </form>
        {errorMsg && <p className="text-red-500 text-xs mt-2 font-medium">{errorMsg}</p>}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {([
            { id: "users" as Tab, label: "Users",     icon: <UserCheck className="w-4 h-4" /> },
            { id: "audit" as Tab, label: "Audit Log",  icon: <ClipboardList className="w-4 h-4" /> },
            { id: "operations" as Tab, label: "Operations", icon: <Shield className="w-4 h-4" /> },
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {activeTab === "users" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Added</th>
                  <th className="px-5 py-3">Added By</th>
                  <th className="px-5 py-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accessList?.map((entry) => (
                  <tr key={entry.email} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                          {entry.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800">{entry.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleSelector
                        email={entry.email}
                        currentRole={entry.role}
                        onUpdate={(role) => handleRoleChange(entry.email, role)}
                      />
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(entry.addedAt), "MMM d, yyyy")}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5" />
                        {entry.addedBy}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRemove(entry.email)}
                        disabled={removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center"
                        title="Remove Access">
                        {removeMutation.isPending && (removeMutation.variables as any)?.email === entry.email
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!accessList || accessList.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                      No approved users yet. Add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit log tab */}
        {activeTab === "audit" && (
          <div className="overflow-x-auto">
            {auditLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3">When</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Change</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLog?.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {format(new Date(entry.timestamp), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800 text-xs">{entry.targetEmail}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {entry.action === "role_change"
                          ? <span>{ROLE_LABELS[entry.roleFrom ?? ""] ?? entry.roleFrom} &rarr; {ROLE_LABELS[entry.roleTo ?? ""] ?? entry.roleTo}</span>
                          : entry.action === "add" && entry.roleTo
                            ? <span>as {ROLE_LABELS[entry.roleTo] ?? entry.roleTo}</span>
                            : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{entry.changedBy}</td>
                    </tr>
                  ))}
                  {(!auditLog || auditLog.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No audit log entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "operations" && (
          <div className="p-5 space-y-4">
            {opsError && <div className="text-xs text-red-600">{opsError}</div>}
            {!opsData && !opsError && <div className="text-xs text-gray-500">Loading operations data...</div>}
            {opsData && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Gate Health</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Last check: {opsData?.deps?.checkedAt ? format(new Date(opsData.deps.checkedAt), "MMM d, yyyy HH:mm") : "N/A"}
                    </p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Quarterly DR drill</p>
                    <p className="text-xs text-gray-500 mt-1">Run `pnpm --filter @workspace/scripts dr-drill` and acknowledge.</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700">Allow-list audit</p>
                    <p className="text-xs text-gray-500 mt-1">Audit due every 90 days.</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Recent incidents</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Subsystem</th>
                          <th className="px-3 py-2">Reason</th>
                          <th className="px-3 py-2">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(opsData?.incidents?.incidents ?? []).map((row: any) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">{row.createdAt ? format(new Date(row.createdAt), "MMM d HH:mm") : "—"}</td>
                            <td className="px-3 py-2">{row.subsystem}</td>
                            <td className="px-3 py-2">{row.reason}</td>
                            <td className="px-3 py-2 text-gray-600">{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Role Permissions</p>
        <div className="grid grid-cols-2 gap-1.5 text-xs text-blue-800">
          <div><span className="font-medium">Viewer</span> — sees all data including Your Cost</div>
          <div><span className="font-medium">Guest</span> — sees vehicle info but Your Cost is hidden</div>
        </div>
      </div>

    </div>
  );
}

```

### `artifacts/inventory-portal/src/pages/denied.tsx` (36 lines)

```typescript
import { ShieldAlert } from "lucide-react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

export default function AccessDenied() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-sm text-gray-500 mb-5">
          You don't have permission to view this portal. Contact the owner to request access.
        </p>

        {user && (
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
            <p className="text-sm font-medium text-gray-800">{user.email}</p>
          </div>
        )}

        <a
          href="/api/auth/logout"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Sign out and try another account
        </a>
      </div>
    </div>
  );
}

```

### `artifacts/inventory-portal/src/pages/inventory.tsx` (770 lines)

```typescript
/**
 * Inventory Page (route: /)
 *
 * Main vehicle inventory view. Renders a sortable, searchable table (desktop)
 * or card grid (mobile < 768px). Features: photo gallery with full-screen
 * modal, VIN clipboard copy, Carfax VHR link, Black Book refresh trigger
 * (owner), live cache-status polling every 60 s.
 *
 * Auth: RequireAuth (any authenticated user on access list). Guests see
 * price stripped — enforcement is server-side in routes/inventory.ts.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import {
  useGetInventory,
  useGetCacheStatus,
  useGetVehicleImages,
  useGetMe,
  getGetInventoryQueryKey,
  getGetCacheStatusQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import {
  Search, ExternalLink, FileText, AlertCircle, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, RefreshCw, Camera, X, ChevronLeft,
  ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";
import { FullScreenSpinner } from "@/components/ui/spinner";

type SortKey = "location" | "vehicle" | "vin" | "price" | "km";
type SortDir = "asc" | "desc";

interface Filters {
  yearMin:   string;
  yearMax:   string;
  kmMax:     string;
  priceMin:  string;
  priceMax:  string;
}

const EMPTY_FILTERS: Filters = { yearMin: "", yearMax: "", kmMax: "", priceMin: "", priceMax: "" };

function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function extractYear(vehicle: string): number {
  const y = parseInt(vehicle.trim().split(/\s+/)[0] ?? "0", 10);
  return y > 1900 && y < 2100 ? y : 0;
}

function formatPrice(raw: string | undefined): string {
  if (!raw || raw === "NOT FOUND") return "—";
  const n = parseNum(raw);
  if (!n) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30 inline ml-1" />;
  return dir === "asc"
    ? <ChevronUp   className="w-3.5 h-3.5 text-blue-600 inline ml-1" />
    : <ChevronDown className="w-3.5 h-3.5 text-blue-600 inline ml-1" />;
}

function CopyVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [vin]);
  return (
    <button onClick={handleCopy} title="Click to copy VIN"
      className="group flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
      <span className="font-mono text-xs">{vin}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 shrink-0 transition-opacity" />}
    </button>
  );
}

// Photo gallery modal
function PhotoGallery({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useGetVehicleImages({ vin });
  const urls = data?.urls ?? [];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      onClose();
      if (e.key === "ArrowRight")  setIdx((i) => Math.min(i + 1, urls.length - 1));
      if (e.key === "ArrowLeft")   setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-white rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full shadow hover:bg-gray-100">
          <X className="w-5 h-5 text-gray-700" />
        </button>
        {isLoading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 text-gray-400 animate-spin" /></div>
        ) : urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Camera className="w-10 h-10 mb-2" /><p className="text-sm">No photos available</p>
          </div>
        ) : (
          <>
            <div className="relative bg-black flex items-center justify-center" style={{ height: "420px" }}>
              <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="max-h-full max-w-full object-contain" />
              {urls.length > 1 && (
                <>
                  <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0}
                    className="absolute left-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button onClick={() => setIdx((i) => Math.min(i + 1, urls.length - 1))} disabled={idx === urls.length - 1}
                    className="absolute right-3 p-2 bg-white/80 rounded-full shadow disabled:opacity-30 hover:bg-white transition-colors">
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>
                </>
              )}
            </div>
            {urls.length > 1 && (
              <div className="flex gap-1.5 p-3 overflow-x-auto bg-gray-50">
                {urls.map((url, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-colors ${i === idx ? "border-blue-500" : "border-transparent hover:border-gray-300"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center text-xs text-gray-400 border-t">
              {idx + 1} / {urls.length} photos — VIN: {vin}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ vin, hasPhotos }: { vin: string; hasPhotos?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title={hasPhotos ? "View photos" : "No photos available"}
        className={`p-1.5 rounded transition-colors ${
          hasPhotos
            ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
            : "text-gray-300 cursor-default"
        }`}>
        <Camera className="w-4 h-4" />
      </button>
      {open && <PhotoGallery vin={vin} onClose={() => setOpen(false)} />}
    </>
  );
}

function BbExpandedRow({ bbValues }: { bbValues?: { xclean: number; clean: number; avg: number; rough: number } }) {
  if (!bbValues || (!bbValues.xclean && !bbValues.clean && !bbValues.avg && !bbValues.rough)) return null;
  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";
  const grades = [
    { label: "X-Clean", value: bbValues.xclean, color: "text-emerald-700" },
    { label: "Clean", value: bbValues.clean, color: "text-blue-700" },
    { label: "Average", value: bbValues.avg, color: "text-purple-700" },
    { label: "Rough", value: bbValues.rough, color: "text-orange-700" },
  ];
  return (
    <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center gap-8 animate-in slide-in-from-top-1 duration-150">
      <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide shrink-0">CBB Wholesale</span>
      <div className="flex items-center gap-6">
        {grades.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">{g.label}</span>
            <span className={`text-sm font-semibold ${g.color}`}>{fmt(g.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BbCardDetail({
  bbValues,
  bbAvgWholesale,
}: {
  bbValues?: { xclean: number; clean: number; avg: number; rough: number };
  bbAvgWholesale?: string;
}) {
  const hasGrades = bbValues && (bbValues.xclean || bbValues.clean || bbValues.avg || bbValues.rough);
  const hasAdj    = !!bbAvgWholesale && bbAvgWholesale !== "NOT FOUND";
  if (!hasGrades && !hasAdj) return null;

  const fmt = (v: number) => v ? `$${v.toLocaleString("en-US")}` : "—";

  return (
    <div className="mt-2 rounded-lg border border-purple-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="bg-purple-100 px-3 py-1.5">
        <span className="font-semibold text-purple-800 text-[11px] uppercase tracking-wide">CBB Wholesale</span>
      </div>

      {/* 2-column grade grid: left = X-Clean / Clean, right = Average / Rough */}
      {hasGrades && (
        <div className="grid grid-cols-2 divide-x divide-purple-100 bg-white">
          {/* Left column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">X-Clean</span>
              <span className="font-semibold text-emerald-700">{fmt(bbValues!.xclean)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Clean</span>
              <span className="font-semibold text-blue-700">{fmt(bbValues!.clean)}</span>
            </div>
          </div>
          {/* Right column */}
          <div className="divide-y divide-purple-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Average</span>
              <span className="font-semibold text-purple-700">{fmt(bbValues!.avg)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-gray-500">Rough</span>
              <span className="font-semibold text-orange-700">{fmt(bbValues!.rough)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-width KM-adjusted bar */}
      {hasAdj && (
        <div className="flex items-center justify-between px-3 py-2 bg-purple-700">
          <span className="text-purple-200 font-medium">KM Adjusted</span>
          <span className="font-bold text-white">{formatPrice(bbAvgWholesale)}</span>
        </div>
      )}
    </div>
  );
}

function VehicleCard({ item, showPacCost, showOwnerCols, showBb }: { item: any; showPacCost: boolean; showOwnerCols: boolean; showBb: boolean }) {
  const kmDisplay = item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : null;
  const hasBb = showBb && (item.bbAvgWholesale || item.bbValues);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header: location + icons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{item.location}</span>
        <div className="flex items-center gap-2">
          <PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} />
          {item.carfax && item.carfax !== "NOT FOUND" && (
            <a href={item.carfax} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
              <FileText className="w-4 h-4" />
            </a>
          )}
          {item.website && item.website !== "NOT FOUND" && (
            <a href={item.website} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="Listing">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {/* Line 1: vehicle name */}
        <p className="font-semibold text-gray-900 text-sm leading-snug">{item.vehicle}</p>

        {/* Line 2: VIN  •  KM */}
        <div className="flex items-center gap-2">
          <CopyVin vin={item.vin} />
          {kmDisplay && (
            <>
              <span className="text-gray-300 text-xs">•</span>
              <span className="text-xs text-gray-500 font-medium">{kmDisplay}</span>
            </>
          )}
        </div>

        {/* Owner-only row: Matrix Price + Cost */}
        {showOwnerCols && (
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-gray-400 mb-0.5">Matrix Price</p>
              <p className="font-medium text-gray-700">{formatPrice(item.matrixPrice)}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Cost</p>
              <p className="font-semibold text-red-700">{formatPrice(item.cost)}</p>
            </div>
          </div>
        )}

        {/* Line 3: PAC Cost + Online Price (always shown; PAC Cost hidden for guests/customer view) */}
        <div className="flex gap-4 text-xs">
          {showPacCost && (
            <div>
              <p className="text-gray-400 mb-0.5">PAC Cost</p>
              <p className="font-semibold text-gray-900">{formatPrice(item.price)}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 mb-0.5">Online Price</p>
            <p className="font-medium text-gray-700">{formatPrice(item.onlinePrice)}</p>
          </div>
        </div>

        {/* CBB Wholesale box */}
        {hasBb && (
          <BbCardDetail bbValues={item.bbValues} bbAvgWholesale={item.bbAvgWholesale} />
        )}
      </div>
    </div>
  );
}

// ─── Range input pair ────────────────────────────────────────────────────────
function RangeInputs({
  label, minVal, maxVal, minPlaceholder, maxPlaceholder,
  onMinChange, onMaxChange, prefix = "",
}: {
  label: string; minVal: string; maxVal: string;
  minPlaceholder: string; maxPlaceholder: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={minVal} onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
        <span className="text-gray-300 text-sm">—</span>
        <div className="relative flex-1">
          {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{prefix}</span>}
          <input type="number" value={maxVal} onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className={`w-full ${prefix ? "pl-5" : "pl-2.5"} pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400`} />
        </div>
      </div>
    </div>
  );
}

// ─── Active filter chip ──────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("vehicle");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [filters,     setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [, setLocation]               = useLocation();
  const lastKnownUpdate               = useRef<string | null>(null);

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const isGuest = me?.role === "guest";
  const isOwner = me?.isOwner === true;

  type ViewMode = "owner" | "user" | "customer";
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved === "owner" || saved === "user" || saved === "customer") return saved;
    return "user";
  });
  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (isOwner && !saved) setViewMode("owner");
  }, [isOwner]);
  useEffect(() => { localStorage.setItem("viewMode", viewMode); }, [viewMode]);
  const showOwnerCols = isOwner && viewMode === "owner";
  const showPacCost   = !isGuest && viewMode !== "customer";
  const showBb        = viewMode !== "customer";

  const [expandedBbVin, setExpandedBbVin] = useState<string | null>(null);
  const [bbClicked, setBbClicked] = useState(false);
  const bbCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inventory, isLoading, error, refetch: refetchInventory } = useGetInventory({
    query: { queryKey: getGetInventoryQueryKey(), retry: false },
  });

  const { data: cacheStatus } = useGetCacheStatus({
    query: { queryKey: getGetCacheStatusQueryKey(), refetchInterval: 60_000, retry: false },
  });

  const bbRunning = (cacheStatus as any)?.bbRunning === true || bbClicked;

  const triggerBbRefresh = useCallback(async () => {
    if (bbRunning) return;
    setBbClicked(true);
    if (bbCooldownRef.current) clearTimeout(bbCooldownRef.current);
    bbCooldownRef.current = setTimeout(() => setBbClicked(false), 90_000);
    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      // Raw fetch: /api/refresh-blackbook is in openapi.yaml but the generated
      // hook (usePostRefreshBlackbook) fires immediately on mount; we need manual
      // trigger control, so we call fetch directly with the owner-only credentials.
      await fetch(`${base}/api/refresh-blackbook`, { method: "POST", credentials: "include" });
    } catch (_) {}
  }, [bbRunning]);

  useEffect(() => {
    if (!cacheStatus?.lastUpdated) return;
    if (lastKnownUpdate.current === null) { lastKnownUpdate.current = cacheStatus.lastUpdated; return; }
    if (cacheStatus.lastUpdated !== lastKnownUpdate.current) {
      lastKnownUpdate.current = cacheStatus.lastUpdated;
      refetchInventory();
    }
  }, [cacheStatus?.lastUpdated, refetchInventory]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (error) {
    const status = (error as any)?.response?.status;
    if (status === 401) { setLocation("/login"); return null; }
    if (status === 403) { setLocation("/denied"); return null; }
    return (
      <div className="p-8 text-center rounded-lg border border-red-200 bg-red-50 mt-10 max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900 mb-1">Error loading inventory</h2>
        <p className="text-sm text-gray-500">Please refresh the page or contact support.</p>
      </div>
    );
  }

  if (isLoading) return <FullScreenSpinner />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key: keyof Filters) => (val: string) =>
    setFilters((f) => ({ ...f, [key]: val }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasFilters = Object.values(filters).some(Boolean);

  // Deduplicate by VIN — keep lowest price
  const parseNumericPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || Infinity;
  type Item = NonNullable<typeof inventory>[number];
  const dedupedMap = new Map<string, Item>();
  for (const item of (inventory ?? [])) {
    const existing = dedupedMap.get(item.vin);
    if (!existing || parseNumericPrice(item.price) < parseNumericPrice(existing.price))
      dedupedMap.set(item.vin, item);
  }
  const deduped = Array.from(dedupedMap.values());

  // Derive year min/max from data for placeholders
  const years = deduped.map((i) => extractYear(i.vehicle)).filter(Boolean);
  const dataYearMin = years.length ? Math.min(...years) : 2000;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  const kms   = deduped.map((i) => parseNum(i.km ?? "")).filter(Boolean);
  const dataKmMax = kms.length ? Math.max(...kms) : 300000;
  const prices = deduped.map((i) => parseNum(i.price)).filter(Boolean);
  const dataPriceMax = prices.length ? Math.max(...prices) : 100000;

  // Apply all filters + search
  const filtered = deduped.filter((item) => {
    // Text search
    if (search) {
      const term = search.toLowerCase();
      if (!item.vehicle.toLowerCase().includes(term) &&
          !item.vin.toLowerCase().includes(term) &&
          !item.location.toLowerCase().includes(term)) return false;
    }
    // Year
    const year = extractYear(item.vehicle);
    if (filters.yearMin && year && year < parseInt(filters.yearMin)) return false;
    if (filters.yearMax && year && year > parseInt(filters.yearMax)) return false;
    // KM
    const km = parseNum(item.km ?? "");
    if (filters.kmMax && km && km > parseNum(filters.kmMax)) return false;
    // Price (only for non-guests)
    if (!isGuest) {
      const price = parseNum(item.price);
      if (filters.priceMin && price && price < parseNum(filters.priceMin)) return false;
      if (filters.priceMax && price && price > parseNum(filters.priceMax)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "").toLowerCase();
    const bv = (b[sortKey] ?? "").toLowerCase();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Active filter chips
  const activeChips: { label: string; clear: () => void }[] = [
    ...(filters.yearMin || filters.yearMax ? [{
      label: `Year: ${filters.yearMin || dataYearMin}–${filters.yearMax || dataYearMax}`,
      clear: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })),
    }] : []),
    ...(filters.kmMax ? [{
      label: `KM ≤ ${parseInt(filters.kmMax).toLocaleString("en-US")}`,
      clear: () => setFilter("kmMax")(""),
    }] : []),
    ...(!isGuest && (filters.priceMin || filters.priceMax) ? [{
      label: `PAC Cost: $${filters.priceMin || "0"}–$${filters.priceMax || "∞"}`,
      clear: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })),
    }] : []),
  ];

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-gray-200 bg-white">
      <Search className="w-8 h-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-700 mb-1">No vehicles found</p>
      <p className="text-sm text-gray-400">Try adjusting your search or filters.</p>
      {(search || hasFilters) && (
        <button onClick={() => { setSearch(""); clearFilters(); }}
          className="mt-4 px-4 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Clear all
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header + search + filter toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vehicle Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} {sorted.length === 1 ? "vehicle" : "vehicles"}
              {sorted.length !== deduped.length ? ` of ${deduped.length} total` : ""}
            </p>
            {cacheStatus?.lastUpdated && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {cacheStatus.isRefreshing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</>
                  : <>Updated {timeAgo(cacheStatus.lastUpdated)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                placeholder="Search vehicle, VIN, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}>
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {hasFilters && <span className="bg-white text-blue-600 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeChips.length}</span>}
            </button>
            {!isGuest && (
              <div className="flex items-center gap-2">
                <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
                  {isOwner && (
                    <button onClick={() => setViewMode("owner")}
                      className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "owner" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                      Own
                    </button>
                  )}
                  <button onClick={() => setViewMode("user")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "user" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    User
                  </button>
                  <button onClick={() => setViewMode("customer")}
                    className={`px-2 py-1.5 text-[10px] font-medium leading-none transition-colors ${viewMode === "customer" ? "bg-gray-200 text-gray-700" : "bg-white text-gray-300 hover:text-gray-500"}`}>
                    Cust
                  </button>
                </div>
                {showOwnerCols && (
                  <button
                    onClick={triggerBbRefresh}
                    disabled={bbRunning}
                    title={bbRunning ? "Book value refresh in progress…" : "Refresh Canadian Black Book values"}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-colors shrink-0 ${
                      bbRunning
                        ? "bg-purple-50 text-purple-400 border-purple-200 cursor-not-allowed"
                        : "bg-white text-purple-600 border-purple-200 hover:bg-purple-50"
                    }`}>
                    <RefreshCw className={`w-3 h-3 ${bbRunning ? "animate-spin" : ""}`} />
                    Book Avg
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className={`grid gap-4 ${isGuest ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              <RangeInputs label="Year" minVal={filters.yearMin} maxVal={filters.yearMax}
                minPlaceholder={String(dataYearMin)} maxPlaceholder={String(dataYearMax)}
                onMinChange={setFilter("yearMin")} onMaxChange={setFilter("yearMax")} />
              <RangeInputs label="Max KM" minVal="" maxVal={filters.kmMax}
                minPlaceholder="0" maxPlaceholder={Math.round(dataKmMax / 1000) * 1000 + ""}
                onMinChange={() => {}} onMaxChange={setFilter("kmMax")} />
              {showPacCost && (
                <RangeInputs label="PAC Cost" minVal={filters.priceMin} maxVal={filters.priceMax}
                  minPlaceholder="0" maxPlaceholder={Math.round(dataPriceMax / 1000) * 1000 + ""}
                  onMinChange={setFilter("priceMin")} onMaxChange={setFilter("priceMax")} prefix="$" />
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        sorted.length === 0 ? emptyState : (
          <div className="space-y-3">
            {sorted.map((item, i) => (
              <VehicleCard key={`${item.vin}-${i}`} item={item} showPacCost={showPacCost} showOwnerCols={showOwnerCols} showBb={showBb} />
            ))}
          </div>
        )
      ) : (
        /* Desktop table */
        sorted.length === 0 ? emptyState : (
          <div className="rounded-lg border border-gray-200 overflow-x-auto bg-white shadow-sm">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {[
                { key: "location" as SortKey, label: "Location",   cls: "w-24 shrink-0" },
                { key: "vehicle"  as SortKey, label: "Vehicle",    cls: "flex-1 min-w-[280px]" },
                { key: "vin"      as SortKey, label: "VIN",        cls: "w-40 shrink-0" },
                { key: "km"       as SortKey, label: "KM",         cls: "w-24 shrink-0" },
              ].map((col) => (
                <div key={col.label} className={col.cls}>
                  <button onClick={() => handleSort(col.key)}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                  </button>
                </div>
              ))}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Matrix Price</div>}
              {showOwnerCols && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Cost</div>}
              {showBb && <div className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-purple-500">Book Avg</div>}
              {showPacCost && (
                <div className="w-24 shrink-0">
                  <button onClick={() => handleSort("price")}
                    className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors">
                    PAC Cost<SortIcon active={sortKey === "price"} dir={sortDir} />
                  </button>
                </div>
              )}
              <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Online Price</div>
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">CFX</div>
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Link</div>
            </div>
            <div>
              {sorted.map((item, i) => (
                <div key={`${item.vin}-${i}`}>
                  <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < sorted.length - 1 && expandedBbVin !== item.vin ? "border-b border-gray-100" : ""}`}>
                    <div className="w-24 shrink-0 text-sm text-gray-700 truncate font-medium">{item.location || "—"}</div>
                    <div className="flex-1 min-w-[280px] text-sm text-gray-900 font-medium truncate">{item.vehicle}</div>
                    <div className="w-40 shrink-0"><CopyVin vin={item.vin} /></div>
                    <div className="w-24 shrink-0 text-sm text-gray-600">
                      {item.km ? Number(item.km.replace(/[^0-9]/g, "")).toLocaleString("en-US") + " km" : "—"}
                    </div>
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.matrixPrice ?? "")}</div>}
                    {showOwnerCols && <div className="w-24 shrink-0 text-sm font-medium text-red-700">{formatPrice(item.cost ?? "")}</div>}
                    {showBb && (
                      (item as any).bbValues ? (
                        <button className="w-24 shrink-0 text-sm font-medium text-purple-700 cursor-pointer hover:underline text-left"
                          onClick={() => setExpandedBbVin(expandedBbVin === item.vin ? null : item.vin)}>
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </button>
                      ) : (
                        <div className="w-24 shrink-0 text-sm font-medium text-purple-700">
                          {formatPrice((item as any).bbAvgWholesale ?? "")}
                        </div>
                      )
                    )}
                    {showPacCost && <div className="w-24 shrink-0 text-sm text-gray-700">{formatPrice(item.price)}</div>}
                    <div className="w-28 shrink-0 text-sm text-gray-700">{formatPrice(item.onlinePrice)}</div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.carfax && item.carfax !== "NOT FOUND"
                        ? <a href={item.carfax} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Carfax">
                            <FileText className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                    <div className="w-8 shrink-0 flex justify-center"><PhotoThumb vin={item.vin} hasPhotos={!!item.hasPhotos} /></div>
                    <div className="w-8 shrink-0 flex justify-center">
                      {item.website && item.website !== "NOT FOUND"
                        ? <a href={item.website} target="_blank" rel="noopener noreferrer"
                            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors" title="View Listing">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        : <span className="text-gray-200 text-sm">—</span>}
                    </div>
                  </div>
                  {expandedBbVin === item.vin && <BbExpandedRow bbValues={(item as any).bbValues} />}
                  {(i < sorted.length - 1 || expandedBbVin === item.vin) && expandedBbVin === item.vin && <div className="border-b border-gray-100" />}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

```

### `artifacts/inventory-portal/src/pages/lender-calculator.tsx` (749 lines)

```typescript
/**
 * Lender Calculator Page (route: /calculator)
 *
 * Owner-only deal structuring tool. Fetches CreditApp lender programs,
 * lets the owner enter approval terms (vehicle, BB wholesale, DP, trade, etc.),
 * and runs the calculation engine to show which lenders/tiers can fund the deal.
 * Also displays operational status from /api/ops/function-status (owner only).
 *
 * Auth: RequireAuth. Server enforces owner-only on all /lender-* endpoints.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  useGetMe,
  useGetLenderPrograms,
  useGetLenderStatus,
  useRefreshLender,
  useLenderCalculate,
  getGetMeQueryKey,
  getGetLenderProgramsQueryKey,
  getGetLenderStatusQueryKey,
} from "@workspace/api-client-react";
import type {
  LenderProgram,
  LenderProgramGuide,
  LenderProgramTier,
  LenderCalcResultItem,
  LenderCalculateResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calculator, Car, AlertCircle, Eye, ChevronDown, ChevronUp } from "lucide-react";

function formatCurrency(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatPayment(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const COND_SHORT: Record<string, string> = { extraClean: "XC", clean: "C", average: "A", rough: "R" };

const BINDING_LABEL: Record<string, string> = {
  online: "On",
  advance: "Adv",
  allIn: "AllIn",
  payment: "Pmt",
  pacFloor: "PAC",
  none: "—",
};

interface OpsCheck {
  pass: boolean;
}

interface OpsFunctionStatusResponse {
  inventoryCount: number;
  checks: {
    blackBookUpdatedWithin24Hours: OpsCheck & {
      lastRunAt: string | null;
      running: boolean;
      valuedInventoryCount: number;
    };
    carfaxLookupActivity: OpsCheck & {
      attemptedCount: number;
      foundUrlCount: number;
      notFoundCount: number;
    };
    websiteLinkDiscovery: OpsCheck & {
      foundUrlCount: number;
      notFoundCount: number;
      coveragePct: number;
    };
    lenderProgramsLoaded: OpsCheck & {
      lenderProgramCount: number;
      updatedAt: string | null;
      running: boolean;
      error: string | null;
    };
  };
}

function OpsCheckBadge({ pass }: { pass: boolean }) {
  return (
    <Badge
      variant="outline"
      className={pass ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}
    >
      {pass ? "PASS" : "FAIL"}
    </Badge>
  );
}

function ResultRow({ item, rank, showDP }: { item: any; rank: number; showDP: boolean }) {
  const needsDP = (item.requiredDownPayment ?? 0) > 0;
  const stretched = item.termStretched === true;
  const applied = Number(item.termStretchApplied ?? 0);
  const binding = String(item.bindingSellingConstraint ?? "none");
  let rowBg = "odd:bg-white even:bg-slate-50/40";
  if (needsDP) rowBg = "bg-gray-100/60";
  else if (binding === "pacFloor") rowBg = "bg-rose-50/60";
  else if (binding !== "online" && binding !== "none") rowBg = "bg-blue-50/40";
  else if (stretched && applied === 12) rowBg = "bg-orange-50";
  else if (stretched && applied === 6) rowBg = "bg-amber-50";

  const totalGross = Number(item.totalGross ?? 0);
  const frontEndGross = Number(item.frontEndGross ?? 0);
  const nonCancelable = Number(item.nonCancelableGross ?? 0);
  const cancelable = Number(item.cancelableBackendGross ?? 0);
  const grossTooltip = `Front: ${formatCurrency(frontEndGross)} · Non-cancelable: ${formatCurrency(nonCancelable)} · Cancelable backend: ${formatCurrency(cancelable)}`;

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-blue-50/50`}>
      <td className="px-1.5 py-1.5 text-[11px] text-gray-400 font-semibold text-center">{rank}</td>
      <td className="px-2 py-1.5 text-xs font-semibold text-gray-900">
        <div className="truncate" title={item.vehicle}>
          {item.vehicle}
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-xs text-gray-600 whitespace-nowrap">{item.location}</td>
      <td
        className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap"
        title={
          item.matrixTerm != null
            ? `Matrix ${item.matrixTerm}mo · applied +${applied} → ${item.term}mo${item.termStretchCappedReason ? ` (${item.termStretchCappedReason})` : ""}`
            : undefined
        }
      >
        {item.term}mo
        {item.termStretchCappedReason ? <span className="text-[9px] text-amber-700 ml-0.5 align-super">†</span> : null}
      </td>
      <td className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap">{COND_SHORT[item.conditionUsed] ?? item.conditionUsed}</td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-gray-600">{formatCurrency(item.bbWholesale)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700"
        title={item.onlinePrice != null ? `Online: ${formatCurrency(Number(item.onlinePrice))} · PAC: ${formatCurrency(Number(item.pacCost ?? 0))}` : `PAC: ${formatCurrency(Number(item.pacCost ?? 0))}`}>
        {item.sellingPrice > 0 ? formatCurrency(item.sellingPrice) : "—"}
        <span className="text-[10px] text-gray-400 ml-0.5">
          ({BINDING_LABEL[binding] ?? binding})
        </span>
      </td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-indigo-700">{formatCurrency(item.adminFeeUsed)}</td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.warrantyPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.warrantyCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.gapPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.gapCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700">{formatCurrency(item.totalFinanced)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-green-700">{formatPayment(item.monthlyPayment)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-emerald-700" title={grossTooltip}>
        {formatCurrency(totalGross)}
      </td>
      {showDP && (
        <td className="px-2 py-1.5 text-xs text-right font-semibold text-red-600">
          {needsDP ? formatCurrency(item.requiredDownPayment) : "—"}
        </td>
      )}
    </tr>
  );
}

export default function LenderCalculator() {
  const { data: programsData, isLoading: loadingPrograms, refetch: refetchPrograms } = useGetLenderPrograms({
    query: { queryKey: getGetLenderProgramsQueryKey(), retry: false, refetchOnWindowFocus: false },
  });
  const { data: statusData, refetch: refetchStatus } = useGetLenderStatus({
    query: { queryKey: getGetLenderStatusQueryKey(), retry: false, refetchInterval: 10_000 },
  });
  const { data: meData } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const refreshMutation = useRefreshLender();
  const calcMutation = useLenderCalculate();
  const [opsStatus, setOpsStatus] = useState<OpsFunctionStatusResponse | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);

  const [selectedLender, setSelectedLender] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedTier, setSelectedTier] = useState("");
  const [approvedRate, setApprovedRate] = useState("14.99");
  const [maxPaymentOverride, setMaxPaymentOverride] = useState("");
  const [downPayment, setDownPayment] = useState("0");
  const [tradeValue, setTradeValue] = useState("0");
  const [tradeLien, setTradeLien] = useState("0");
  const [taxRate, setTaxRate] = useState("5");
  const [adminFee, setAdminFee] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [termStretch, setTermStretch] = useState(0);
  const [showAllDP, setShowAllDP] = useState(false);

  const isUserOwner = !!meData?.isOwner;

  const programs: LenderProgram[] = programsData?.programs ?? [];

  const selectedLenderObj = useMemo(
    () => programs.find(p => p.lenderCode === selectedLender),
    [programs, selectedLender],
  );

  const selectedGuide: LenderProgramGuide | undefined = useMemo(
    () => selectedLenderObj?.programs.find(g => g.programId === selectedProgram),
    [selectedLenderObj, selectedProgram],
  );

  const selectedTierObj: LenderProgramTier | undefined = useMemo(
    () => selectedGuide?.tiers.find(t => t.tierName === selectedTier),
    [selectedGuide, selectedTier],
  );

  const calcResults: LenderCalculateResponse | null = calcMutation.data ?? null;

  useEffect(() => {
    if (selectedLenderObj && selectedLenderObj.programs.length === 1 && !selectedProgram) {
      setSelectedProgram(selectedLenderObj.programs[0].programId);
    }
  }, [selectedLenderObj, selectedProgram]);

  useEffect(() => {
    if (selectedTierObj) {
      setApprovedRate(String(selectedTierObj.minRate));
    }
  }, [selectedTierObj]);

  useEffect(() => {
    if (!isUserOwner) return;
    let active = true;

    async function loadOpsStatus() {
      try {
        const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
        const candidates = Array.from(new Set([
          `${base}/api/ops/function-status`,
          "/api/ops/function-status",
          "api/ops/function-status",
        ]));

        let body: OpsFunctionStatusResponse | null = null;
        let lastStatus: number | null = null;

        for (const url of candidates) {
          // Raw fetch: /ops/function-status is not included in openapi.yaml
          // (it's an operational diagnostic endpoint, not part of the public API
          // contract), so no generated hook exists. Candidate list handles
          // Replit dev vs. production base-URL differences.
          const resp = await fetch(url, {
            credentials: "include",
            cache: "no-store",
          });
          if (resp.ok) {
            body = await resp.json() as OpsFunctionStatusResponse;
            break;
          }
          lastStatus = resp.status;
        }

        if (!body) {
          throw new Error(lastStatus === 404
            ? "HTTP 404 (ops route unavailable in current backend runtime)"
            : `HTTP ${lastStatus ?? "unknown"}`);
        }

        if (!active) return;
        setOpsStatus(body);
        setOpsError(null);
      } catch (err) {
        if (!active) return;
        setOpsError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void loadOpsStatus();
    const timer = setInterval(() => void loadOpsStatus(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isUserOwner]);

  const hasCalculated = useRef(false);
  const handleCalculateRef = useRef<() => void>(() => {});

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onSuccess: () => {
        setTimeout(() => { refetchStatus(); refetchPrograms(); }, 2000);
      },
    });
  };

  const handleCalculate = useCallback(() => {
    if (!selectedLender || !selectedProgram || !selectedTier) return;
    const payload: any = {
      lenderCode: selectedLender,
      programId: selectedProgram,
      tierName: selectedTier,
      approvedRate: parseFloat(approvedRate) || 0,
      downPayment: parseFloat(downPayment) || 0,
      tradeValue: parseFloat(tradeValue) || 0,
      tradeLien: parseFloat(tradeLien) || 0,
      taxRate: parseFloat(taxRate) || 5,
      adminFee: parseFloat(adminFee) || 0,
      termStretchMonths: Number(termStretch) as 0 | 6 | 12,
    };
    const pmtOverride = parseFloat(maxPaymentOverride);
    if (pmtOverride > 0) payload.maxPaymentOverride = pmtOverride;
    hasCalculated.current = true;
    calcMutation.mutate({ data: payload });
  }, [selectedLender, selectedProgram, selectedTier, approvedRate, downPayment, tradeValue, tradeLien, taxRate, adminFee, termStretch, maxPaymentOverride, calcMutation]);

  handleCalculateRef.current = handleCalculate;

  useEffect(() => {
    if (!hasCalculated.current) return;
    handleCalculateRef.current();
  }, [termStretch]);

  const handleLenderChange = (code: string) => {
    setSelectedLender(code);
    setSelectedProgram("");
    setSelectedTier("");
  };

  const handleProgramChange = (programId: string) => {
    setSelectedProgram(programId);
    setSelectedTier("");
  };

  const totalPrograms = useMemo(
    () => programs.reduce((sum, p) => sum + p.programs.length, 0),
    [programs],
  );

  const selectClass = "h-9 text-sm font-medium bg-white border-gray-300 shadow-sm";
  const dropdownClass = "max-h-80 bg-white border border-gray-200 shadow-lg";
  const optionClass = "text-sm py-2.5 px-3 cursor-pointer hover:bg-gray-100 focus:bg-gray-100";

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Selector</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {programs.length} lender{programs.length !== 1 ? "s" : ""}, {totalPrograms} program{totalPrograms !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusData && (
            <div className="text-xs text-gray-400">
              {statusData.running ? (
                <span className="text-amber-600 font-medium flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Syncing...
                </span>
              ) : statusData.programsAge ? (
                <span>Updated {new Date(statusData.programsAge).toLocaleDateString()}</span>
              ) : (
                <span className="text-red-500">No data yet</span>
              )}
            </div>
          )}
          {isUserOwner && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshMutation.isPending || statusData?.running}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${statusData?.running ? "animate-spin" : ""}`} />
              Sync Programs
            </Button>
          )}
        </div>
      </div>

      {isUserOwner && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Ops Health</h2>
              {opsStatus && <span className="text-xs text-gray-500">Inventory: {opsStatus.inventoryCount}</span>}
            </div>

            {opsError && (
              <p className="text-xs text-red-600 mb-2">Unable to load ops status: {opsError}</p>
            )}

            {!opsStatus && !opsError && (
              <p className="text-xs text-gray-500">Loading operational checks...</p>
            )}

            {opsStatus && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Black Book &lt; 24h</span>
                    <OpsCheckBadge pass={opsStatus.checks.blackBookUpdatedWithin24Hours.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Last run: {opsStatus.checks.blackBookUpdatedWithin24Hours.lastRunAt
                      ? new Date(opsStatus.checks.blackBookUpdatedWithin24Hours.lastRunAt).toLocaleString()
                      : "none"}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Carfax Activity</span>
                    <OpsCheckBadge pass={opsStatus.checks.carfaxLookupActivity.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Attempts: {opsStatus.checks.carfaxLookupActivity.attemptedCount} · Found: {opsStatus.checks.carfaxLookupActivity.foundUrlCount}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Website Link Discovery</span>
                    <OpsCheckBadge pass={opsStatus.checks.websiteLinkDiscovery.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Coverage: {opsStatus.checks.websiteLinkDiscovery.coveragePct}% · Found: {opsStatus.checks.websiteLinkDiscovery.foundUrlCount}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Lender Programs Loaded</span>
                    <OpsCheckBadge pass={opsStatus.checks.lenderProgramsLoaded.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Programs: {opsStatus.checks.lenderProgramsLoaded.lenderProgramCount}
                    {opsStatus.checks.lenderProgramsLoaded.updatedAt
                      ? ` · Updated ${new Date(opsStatus.checks.lenderProgramsLoaded.updatedAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {programs.length === 0 && !loadingPrograms && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">No lender programs cached</p>
                <p className="text-sm text-amber-700 mt-1">
                  {isUserOwner
                    ? 'Click "Sync Programs" to fetch the latest lender program matrices from CreditApp.'
                    : "No lender programs available. Ask an admin to sync programs."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {programs.length > 0 && (
        <>
          {/* Inputs — horizontal across top */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
                {/* Lender */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Lender</Label>
                  <Select value={selectedLender} onValueChange={handleLenderChange}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {programs.map(p => (
                        <SelectItem key={p.lenderCode} value={p.lenderCode} className={optionClass}>
                          {p.lenderName} ({p.lenderCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Program */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Program</Label>
                  {selectedLenderObj && selectedLenderObj.programs.length === 1 && selectedProgram ? (
                    <div className="h-9 flex items-center px-3 bg-gray-50 border border-gray-200 rounded-md text-sm font-medium text-gray-700 truncate">
                      {selectedLenderObj.programs[0].programTitle}
                    </div>
                  ) : (
                    <Select value={selectedProgram} onValueChange={handleProgramChange} disabled={!selectedLenderObj}>
                      <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className={dropdownClass}>
                        {(selectedLenderObj?.programs ?? []).map(g => (
                          <SelectItem key={g.programId} value={g.programId} className={optionClass}>
                            {g.programTitle} ({g.tiers.length} tier{g.tiers.length !== 1 ? "s" : ""})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tier */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tier</Label>
                  <Select value={selectedTier} onValueChange={setSelectedTier} disabled={!selectedGuide}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {(selectedGuide?.tiers ?? []).map(t => (
                        <SelectItem key={t.tierName} value={t.tierName} className={optionClass}>
                          {t.tierName} ({t.minRate}–{t.maxRate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Approved Rate */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Rate (%)</Label>
                  <Input type="number" step="0.01" value={approvedRate} onChange={e => setApprovedRate(e.target.value)} className="h-9" />
                </div>

                {/* Max Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Max Payment</Label>
                  <Input
                    type="number" step="10"
                    placeholder={selectedTierObj ? `${selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}` : "Optional"}
                    value={maxPaymentOverride} onChange={e => setMaxPaymentOverride(e.target.value)} className="h-9"
                  />
                </div>

                {/* Down Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Down Payment</Label>
                  <Input type="number" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="h-9" />
                </div>
              </div>

              {/* Second row: trade, advanced toggle, View Inventory button */}
              <div className="flex items-end gap-4 mt-3">
                <div className="grid grid-cols-2 gap-3 w-64 flex-shrink-0">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Value</Label>
                    <Input type="number" value={tradeValue} onChange={e => setTradeValue(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Lien</Label>
                    <Input type="number" value={tradeLien} onChange={e => setTradeLien(e.target.value)} className="h-9" />
                  </div>
                </div>

                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 w-56 flex-shrink-0">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tax (%)</Label>
                      <Input type="number" step="0.5" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Admin Fee</Label>
                      <Input type="number" value={adminFee} onChange={e => setAdminFee(e.target.value)} className="h-9" />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors pb-2 whitespace-nowrap"
                >
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAdvanced ? "Less" : "More"}
                </button>

                <div className="flex items-center gap-4 pb-1 ml-2">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="font-medium whitespace-nowrap">Term Exception:</span>
                    {[0, 6, 12].map(v => (
                      <label key={v} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio" name="termStretch" value={v}
                          checked={termStretch === v}
                          onChange={() => setTermStretch(v)}
                          className="w-3 h-3"
                        />
                        <span>{v === 0 ? "None" : `+${v}mo`}</span>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox" checked={showAllDP}
                      onChange={e => setShowAllDP(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="font-medium">Show all + req. DP</span>
                  </label>
                </div>

                <div className="ml-auto flex-shrink-0">
                  <Button
                    onClick={handleCalculate}
                    disabled={!selectedLender || !selectedProgram || !selectedTier || calcMutation.isPending}
                    className="h-9"
                  >
                    {calcMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4 mr-2" />
                    )}
                    View Inventory
                  </Button>
                </div>
              </div>

              {/* Tier info badge */}
              {selectedTierObj && (
                <div className="flex items-center gap-3 mt-2 text-xs text-blue-700">
                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                    {selectedGuide?.programTitle} — {selectedTierObj.tierName}
                  </Badge>
                  <span>Rate: {selectedTierObj.minRate}–{selectedTierObj.maxRate}%</span>
                  <span>Max Pmt: {selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error */}
          {calcMutation.isError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Calculation Error</p>
                    <p className="text-sm text-red-700 mt-1">{String((calcMutation.error as any)?.message || "Unknown error")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results — full width below */}
          {calcResults && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Car className="w-4 h-4" />
                    Results
                    <Badge variant="secondary" className="text-xs ml-1">
                      {(() => {
                        const all = (calcResults.results ?? []) as any[];
                        const dpFree = all.filter(r => !((r.requiredDownPayment ?? 0) > 0)).length;
                        return showAllDP
                          ? `${all.length} vehicles`
                          : `${dpFree} of ${all.length} vehicles · zero down`;
                      })()}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">{calcResults.lender} / {calcResults.program} / {calcResults.tier}</Badge>
                    <Badge variant="outline" className="text-xs">Rate: {approvedRate}%</Badge>
                    {maxPaymentOverride && Number(maxPaymentOverride) > 0 && (
                      <Badge variant="outline" className="text-xs">Pmt Cap: {formatCurrency(Number(maxPaymentOverride))}</Badge>
                    )}
                  </div>
                </div>

                {(() => {
                  const allResults = (calcResults.results ?? []) as any[];
                  const visibleResults = showAllDP
                    ? allResults
                    : allResults.filter(r => !((r.requiredDownPayment ?? 0) > 0));
                  const hiddenDpCount = allResults.length - visibleResults.length;

                  if (visibleResults.length === 0) {
                    return (
                      <div className="text-center py-12 text-gray-400">
                        <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm font-medium">No vehicles qualify at zero down</p>
                        <p className="text-xs mt-1">
                          {hiddenDpCount > 0
                            ? `Toggle "Show all + req. DP" to see ${hiddenDpCount} vehicle${hiddenDpCount !== 1 ? "s" : ""} that need a down payment`
                            : "Try adjusting the max payment or rate"}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-md border border-gray-200 overflow-x-auto">
                      <table className="text-left w-full">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr className="border-b border-gray-200 text-[10px] text-gray-600 uppercase tracking-wide">
                            <th className="w-8 px-1.5 py-2 text-center">#</th>
                            <th className="px-2 py-2" style={{ minWidth: "220px" }}>Vehicle</th>
                            <th className="px-1.5 py-2 whitespace-nowrap">Loc</th>
                            <th className="px-1.5 py-2 text-center whitespace-nowrap">Term</th>
                            <th className="px-1.5 py-2 text-center whitespace-nowrap">Cond</th>
                            <th className="px-1.5 py-2 text-right whitespace-nowrap">BB Val</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Sell Price</th>
                            <th className="px-1.5 py-2 text-right whitespace-nowrap">Admin</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Warranty</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>GAP</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>Financed</th>
                            <th className="px-2 py-2 text-right whitespace-nowrap">Pmt</th>
                            <th className="px-2 py-2 text-right whitespace-nowrap" title="Total gross = front + admin + reserve + warranty profit + GAP profit">Total Gross</th>
                            {showAllDP && <th className="px-2 py-2 text-right whitespace-nowrap">Req. DP</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleResults.map((item: any, idx: number) => (
                            <ResultRow key={item.vin} item={item} rank={idx + 1} showDP={showAllDP} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {!calcResults && !calcMutation.isError && (
            <Card className="border-dashed border-gray-300">
              <CardContent className="py-16">
                <div className="text-center text-gray-400">
                  <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">Select a lender, program, and tier, then click View Inventory</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

```

### `artifacts/inventory-portal/src/pages/login.tsx` (37 lines)

```typescript
import { Car, Lock } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-5">
          <Car className="w-6 h-6 text-white" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">Inventory Portal</h1>
        <p className="text-sm text-gray-500 mb-7">
          Access is restricted to authorized personnel. Sign in with your Google account to continue.
        </p>

        <a
          href="/api/auth/google"
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-200 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-400">
          <Lock className="w-3 h-3" />
          Secure authentication via Google
        </p>
      </div>
    </div>
  );
}

```

### `artifacts/inventory-portal/src/pages/not-found.tsx` (22 lines)

```typescript
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

```

### `artifacts/inventory-portal/src/README.md` (62 lines)

```markdown
# Inventory Portal (Frontend)

React SPA built with Vite, Wouter (routing), React Query, and shadcn/ui components.

## Entry Point

- `main.tsx` — Bootstrap: renders `<App />` into DOM
- `App.tsx` — QueryClient provider, router setup, auth guard

## Pages

| File | Route | Auth | Purpose | Key API Hooks |
|------|-------|------|---------|---------------|
| `pages/login.tsx` | `/login` | None | Google sign-in button | None |
| `pages/denied.tsx` | `/denied` | None | "Access denied" message | None |
| `pages/inventory.tsx` | `/` | Required | Main inventory table with search, filters, photo gallery, cache status | `useGetInventory`, `useGetCacheStatus`, `useGetVehicleImages` |
| `pages/admin.tsx` | `/admin` | Required | User management: add/remove users, change roles, view audit log | `useGetAccessList`, `useAddAccessEntry`, `useUpdateAccessRole`, `useRemoveAccessEntry`, `useGetAuditLog` |
| `pages/lender-calculator.tsx` | `/calculator` | Required | Lender program selector + affordability calculator with results table | `useGetLenderPrograms`, `useGetLenderStatus`, `useRefreshLender`, `useLenderCalculate`, `useGetMe` |
| `pages/not-found.tsx` | `*` | None | 404 page | None |

## Auth Guard

`RequireAuth` component in `App.tsx`:
- Calls `useGetMe()` on mount
- 401 → redirect to `/login`
- 403 → redirect to `/denied`
- Loading → full-screen spinner

**Note on `/admin`:** The `/admin` route is wrapped in `RequireAuth` (not `RequireOwner`) at the UI layer — any authenticated user who passes `RequireAuth` can load the page shell. Owner-only enforcement is applied server-side by `requireOwner` middleware on every `/access`, `/audit-log`, and related API endpoint. Guests and viewers who land on `/admin` will receive 403 responses from the API.

## Component Structure

```
App.tsx
├── Login (public)
├── AccessDenied (public)
├── RequireAuth
│   └── Layout
│       ├── Inventory (home)
│       ├── Admin
│       └── LenderCalculator (wide layout)
└── NotFound
```

## Shared UI

- `components/layout.tsx` — Page shell with navigation header, optional `wide` prop for calculator
- `components/ui/*` — 55 shadcn-style components (button, card, table, select, dialog, etc.)

## API Client

All API hooks come from `@workspace/api-client-react` (generated by Orval from `openapi.yaml`).
Base URL and auth are configured via `setBaseUrl()` in `main.tsx`.

## Hooks

| File | Export | Purpose |
|------|--------|---------|
| `hooks/use-mobile.tsx` | `useIsMobile()` | Responsive breakpoint detection |
| `hooks/use-toast.ts` | `useToast()`, `toast()` | Toast notification state management |
| `lib/utils.ts` | `cn()` | Tailwind class merging utility |

```

### `artifacts/inventory-portal/tsconfig.json` (23 lines)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["esnext", "dom", "dom.iterable"],
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "references": [
    {
      "path": "../../lib/api-client-react"
    }
  ]
}

```

### `artifacts/inventory-portal/vite.config.ts` (87 lines)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH || "/";

/**
 * Replit / local split dev: browser talks to Vite (this port), Express usually runs on another port.
 * Forward same-origin `/api/*` to the API so `fetch("/api/...")` works without CORS or wrong host.
 * Override if your API listens elsewhere: `INVENTORY_DEV_API_ORIGIN=http://127.0.0.1:PORT`
 */
const devApiProxyTarget =
  process.env["INVENTORY_DEV_API_ORIGIN"]?.trim()
  || process.env["VITE_DEV_API_ORIGIN"]?.trim()
  || "http://127.0.0.1:3000";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Replit + some browsers cache dev responses aggressively; avoid "stale UI" confusion
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

```

---

<a id="mockup"></a>
## 14. Mockup sandbox (component preview)

*68 file(s).*

### `artifacts/mockup-sandbox/components.json` (22 lines)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}

```

### `artifacts/mockup-sandbox/index.html` (32 lines)

```html
<!DOCTYPE html>
<!--
  This file is the entry for ALL routes, including /preview/* canvas iframes.
  Fonts are loaded here as non-blocking <link> tags (not CSS @import, which is render-blocking).
-->
<html lang="en" style="height: 100%">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />

    <meta property="og:title" content="Mockup Canvas" />
    <meta property="og:description" content="UI prototyping sandbox with infinite canvas" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Mockup Canvas" />
    <meta name="twitter:description" content="UI prototyping sandbox with infinite canvas" />

    <title>Mockup Canvas</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎨</text></svg>">
    <!-- Non-blocking font bundle: renders with fallback fonts immediately, swaps in when loaded -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" media="print" onload="this.media='all'"
          href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fira+Code:wght@300..700&family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,opsz,wght@0,18..144,300..900;1,18..144,300..900&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Outfit:wght@100..900&family=Oxanium:wght@200..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&family=Roboto:ital,wght@0,100..900;1,100..900&family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&family=Space+Grotesk:wght@300..700&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fira+Code:wght@300..700&family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,opsz,wght@0,18..144,300..900;1,18..144,300..900&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Outfit:wght@100..900&family=Oxanium:wght@200..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&family=Roboto:ital,wght@0,100..900;1,100..900&family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&family=Space+Grotesk:wght@300..700&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"></noscript>
  </head>
  <body style="height: 100%; margin: 0">
    <div id="root" style="height: 100%"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```
