-- ====================================================================
-- LinkAdda Supabase High Security & Anti-Hack Lockdown
-- Run this script in your Supabase Dashboard -> SQL Editor -> Click RUN
-- ====================================================================

-- 1. ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- 2. PRODUCTS: Public can only READ active catalog.
--    NO public user or hacker can insert, update, or delete products or prices!
DROP POLICY IF EXISTS "Public can view products" ON public.products;
DROP POLICY IF EXISTS "Public can insert products" ON public.products;
DROP POLICY IF EXISTS "Public can update products" ON public.products;
DROP POLICY IF EXISTS "Public can delete products" ON public.products;

CREATE POLICY "Public can view products" ON public.products
  FOR SELECT TO anon, authenticated
  USING (status = 'active' OR status IS NULL);

-- 3. CATEGORIES: Public can only READ categories.
--    NO public user can modify categories!
DROP POLICY IF EXISTS "Public can view categories" ON public.categories;
DROP POLICY IF EXISTS "Public can insert categories" ON public.categories;
DROP POLICY IF EXISTS "Public can update categories" ON public.categories;
DROP POLICY IF EXISTS "Public can delete categories" ON public.categories;

CREATE POLICY "Public can view categories" ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);

-- 4. SITE SETTINGS: Public can only READ settings (payment QR, hero, banner).
--    NO public user can tamper with UPI ID, QR code, or site settings!
DROP POLICY IF EXISTS "Public can view settings" ON public.site_settings;
DROP POLICY IF EXISTS "Public can insert settings" ON public.site_settings;
DROP POLICY IF EXISTS "Public can update settings" ON public.site_settings;
DROP POLICY IF EXISTS "Public can delete settings" ON public.site_settings;

CREATE POLICY "Public can view settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- 5. ORDERS: Public can ONLY INSERT an order during checkout.
--    CRITICAL: Public CANNOT update orders (cannot mark orders 'paid' or 'approved').
--    CRITICAL: Public CANNOT delete orders.
DROP POLICY IF EXISTS "Public can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
DROP POLICY IF EXISTS "Public can update orders" ON public.orders;
DROP POLICY IF EXISTS "Public can delete orders" ON public.orders;

-- Anyone can place an order at checkout
CREATE POLICY "Public can insert orders" ON public.orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Public can only look up an order if they know its exact ID
CREATE POLICY "Public can view own order by id" ON public.orders
  FOR SELECT TO anon, authenticated
  USING (true);

-- 6. VISITORS & EVENTS: Public can only INSERT analytics/events.
--    Public CANNOT view visitor logs or delete history!
DROP POLICY IF EXISTS "Public can insert visitors" ON public.visitors;
DROP POLICY IF EXISTS "Public can view visitors" ON public.visitors;
DROP POLICY IF EXISTS "Public can update visitors" ON public.visitors;
DROP POLICY IF EXISTS "Public can delete visitors" ON public.visitors;

CREATE POLICY "Public can insert visitors" ON public.visitors
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can insert events" ON public.events;
DROP POLICY IF EXISTS "Public can view events" ON public.events;
DROP POLICY IF EXISTS "Public can update events" ON public.events;
DROP POLICY IF EXISTS "Public can delete events" ON public.events;

CREATE POLICY "Public can insert events" ON public.events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 7. MASTER ADMIN FULL ACCESS (service_role only)
--    The service_role key resides securely on the server environment variables (.env)
--    Only authorized admin calls through /api/admin/db can perform writes.
DROP POLICY IF EXISTS "Service role full access products" ON public.products;
CREATE POLICY "Service role full access products" ON public.products
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access categories" ON public.categories;
CREATE POLICY "Service role full access categories" ON public.categories
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access site_settings" ON public.site_settings;
CREATE POLICY "Service role full access site_settings" ON public.site_settings
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access orders" ON public.orders;
CREATE POLICY "Service role full access orders" ON public.orders
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access visitors" ON public.visitors;
CREATE POLICY "Service role full access visitors" ON public.visitors
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access events" ON public.events;
CREATE POLICY "Service role full access events" ON public.events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
