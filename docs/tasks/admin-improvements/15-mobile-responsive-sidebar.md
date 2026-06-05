# Task 15 — Mobile-Responsive Admin Sidebar

**Priority:** P3  
**Effort:** ~4h  
**File:** `artifacts/store/src/pages/admin/AdminLayout.tsx`

---

## Problem

The admin sidebar is a fixed `w-56` element that's always visible. On screens narrower than ~768px:
- The sidebar takes up too much horizontal space
- It overlaps or squeezes the main content area
- No way to dismiss it on mobile
- Admin panel is essentially unusable on phones/tablets

---

## Implementation Plan

### 1. Add mobile sidebar state

```typescript
const [sidebarOpen, setSidebarOpen] = useState(false);
```

On mobile, the sidebar starts hidden. On desktop (md+), it's always visible via CSS.

### 2. Restructure the layout

```tsx
return (
  <div className="admin-theme min-h-screen bg-background text-foreground">

    {/* Mobile overlay — shown when sidebar is open */}
    {sidebarOpen && (
      <div
        className="fixed inset-0 z-30 bg-black/50 md:hidden"
        onClick={() => setSidebarOpen(false)}
      />
    )}

    {/* Sidebar */}
    <aside className={`
      fixed top-0 left-0 h-full z-40 w-56 bg-card border-r border-border
      flex flex-col transition-transform duration-200
      md:translate-x-0 md:relative md:z-auto
      ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
    `}>
      <div className="px-5 py-5 border-b border-border flex items-center justify-between">
        <div>
          <span className="font-bold text-lg text-primary">{storeName}</span>
          <p className="text-xs text-muted-foreground mt-0.5">Admin Panel</p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden p-1.5 rounded hover:bg-muted text-muted-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin"
            ? location === "/admin"
            : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)} // close on navigate (mobile)
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition w-full"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>

    {/* Main content area */}
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Spacer div for desktop sidebar (takes up w-56 when sidebar is in flow) */}
      <div className="hidden md:block w-56 shrink-0" />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <Menu size={20} />
          </button>
          <span className="font-bold text-primary">{storeName}</span>
          <span className="text-xs text-muted-foreground ml-1">Admin</span>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  </div>
);
```

### 3. Close sidebar on route change

Add a `useEffect` to close the sidebar when the URL changes (for mobile navigation):

```typescript
const [location] = useLocation();

useEffect(() => {
  setSidebarOpen(false);
}, [location]);
```

### 4. Make tables horizontally scrollable on mobile

Wrap all `<table>` elements in admin pages in an `overflow-x-auto` container. Most already have this but audit all pages:

```tsx
<div className="overflow-x-auto">
  <table className="w-full min-w-[600px] text-sm">
    ...
  </table>
</div>
```

The `min-w-[600px]` ensures the table doesn't collapse to unreadable column widths — it scrolls horizontally instead.

### 5. Required imports

```typescript
import { Menu, X } from "lucide-react";
```

### 6. Tailwind CSS — ensure `md:` breakpoint variants are active

The layout uses standard Tailwind `md:` (768px+) breakpoints. No Tailwind config changes needed.

---

## Mobile UX flow

1. Admin opens `/admin` on phone
2. Sees top bar with hamburger menu + store name
3. Taps hamburger → sidebar slides in from left
4. Dark overlay appears behind sidebar
5. Admin taps a nav item → navigates + sidebar closes
6. Admin taps overlay → sidebar closes

---

## Affected Pages

After this change, all admin pages inherit the responsive layout because they all render inside `AdminLayout`. No individual page changes needed — except ensuring tables have `overflow-x-auto` wrappers.

---

## Files Changed
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — sidebar state, mobile top bar, responsive CSS
- Minor wrapper updates across admin page table components for `overflow-x-auto`
