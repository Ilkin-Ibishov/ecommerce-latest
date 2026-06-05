# Admin Analytics Dashboard

## What & Why
The admin dashboard currently shows placeholder stats with no real data. The owner has no visibility into revenue, top-selling products, order trends, or traffic without going into Supabase directly. A real analytics dashboard is the single most requested feature by e-commerce operators — it turns a tool into a business instrument.

## Done looks like
- Admin Dashboard (`/admin`) shows live KPI cards: total revenue (this month), total orders, average order value, and pending orders count — all with a vs-last-month delta
- A 30-day revenue line chart shows daily revenue trend
- "Top Products" table shows the 5 best-selling products by revenue this month (name, units sold, revenue)
- "Recent Orders" table shows the last 10 orders with status badges (already partially exists; made accurate)
- "Orders by Status" donut chart shows the breakdown of order statuses
- All charts are built with Recharts (already a dependency) and match the yellow brand palette
- Data is fetched directly from Supabase on the frontend using the admin client (no new API routes needed)

## Out of scope
- Customer acquisition / traffic analytics (would need external tool like Umami)
- Export to CSV / Excel
- Custom date range picker (30-day window only for now)

## Steps
1. **Data queries** — In `DashboardPage`, write Supabase queries for: total revenue + order count this month vs last month, daily revenue for last 30 days (group by created_at date), top 5 products by revenue (join order_items → products → product_translations), orders grouped by status
2. **KPI cards** — Replace the placeholder stat cards with real data; show a green/red delta percentage vs. last month; add a loading skeleton
3. **Revenue line chart** — Use `Recharts` `LineChart` to plot daily revenue for the past 30 days; format AZN on the Y axis; add a tooltip showing exact date + revenue
4. **Orders by status donut** — Use `Recharts` `PieChart` to show order status breakdown with the brand yellow for "delivered" and muted colours for others
5. **Top products table** — Render a clean table with product thumbnail, name, units sold, and total revenue; link each row to the product edit page

## Relevant files
- `artifacts/store/src/pages/admin/DashboardPage.tsx`
- `artifacts/store/src/pages/admin/AdminLayout.tsx`
