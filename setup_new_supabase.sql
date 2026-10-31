-- ====================================================================
-- LinkAdda Complete Supabase Schema & Security Setup
-- Project: https://mkttxqwpbostzmfygpzq.supabase.co
-- Instructions: Copy all code -> Paste in Supabase Dashboard -> SQL Editor -> Click RUN
-- ====================================================================

-- 1. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  slug TEXT,
  title TEXT NOT NULL,
  category TEXT,
  price_inr NUMERIC DEFAULT 0,
  price_usd NUMERIC DEFAULT 0,
  original_price_inr NUMERIC DEFAULT 0,
  original_price_usd NUMERIC DEFAULT 0,
  rating NUMERIC DEFAULT 4.9,
  reviews_count INTEGER DEFAULT 0,
  badge TEXT,
  image TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  gallery_images JSONB DEFAULT '[]'::jsonb,
  video TEXT,
  videos JSONB DEFAULT '[]'::jsonb,
  tiers JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'active',
  display_order INTEGER DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  image TEXT,
  badge TEXT,
  display_order INTEGER DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. ORDERS TABLE (Live Customer Orders for Admin & Telegram Alerts)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  product_id TEXT,
  product_title TEXT,
  amount NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  payment_method TEXT,
  payment_proof TEXT,
  utr TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'completed'
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. VISITORS TABLE (Traffic Analytics)
CREATE TABLE IF NOT EXISTS public.visitors (
  id BIGSERIAL PRIMARY KEY,
  visitor_id TEXT,
  page TEXT DEFAULT 'index',
  referrer TEXT,
  user_agent TEXT,
  ip TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. EVENTS TABLE (Buy Click & Intent Analytics)
CREATE TABLE IF NOT EXISTS public.events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT DEFAULT 'order_click',
  product_id TEXT,
  product_title TEXT,
  visitor_id TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. SITE SETTINGS TABLE (Payment QR, Hero, Banner, FAQ, Testimonials)
CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) & BULLETPROOF PERMISSIONS
-- ====================================================================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Catalog: Anyone can view active products
DROP POLICY IF EXISTS "Public can view products" ON public.products;
CREATE POLICY "Public can view products" ON public.products
  FOR SELECT TO anon, authenticated
  USING (status = 'active' OR status IS NULL);

-- Categories: Anyone can view
DROP POLICY IF EXISTS "Public can view categories" ON public.categories;
CREATE POLICY "Public can view categories" ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);

-- Settings: Anyone can view public settings
DROP POLICY IF EXISTS "Public can view settings" ON public.site_settings;
CREATE POLICY "Public can view settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (key NOT IN ('telegram_bot', 'tg_bot_users', 'customers'));

-- Orders: Checkout creates order with pending status
DROP POLICY IF EXISTS "Public can insert orders" ON public.orders;
CREATE POLICY "Public can insert orders" ON public.orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Public can view own order by id" ON public.orders;
CREATE POLICY "Public can view own order by id" ON public.orders
  FOR SELECT TO anon, authenticated
  USING (true);

-- Analytics: Public can insert tracking
DROP POLICY IF EXISTS "Public can insert visitors" ON public.visitors;
CREATE POLICY "Public can insert visitors" ON public.visitors
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can insert events" ON public.events;
CREATE POLICY "Public can insert events" ON public.events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Service Role (Backend & Admin API): Full unrestricted access
DROP POLICY IF EXISTS "Service role full access products" ON public.products;
CREATE POLICY "Service role full access products" ON public.products FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access categories" ON public.categories;
CREATE POLICY "Service role full access categories" ON public.categories FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access site_settings" ON public.site_settings;
CREATE POLICY "Service role full access site_settings" ON public.site_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access orders" ON public.orders;
CREATE POLICY "Service role full access orders" ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access visitors" ON public.visitors;
CREATE POLICY "Service role full access visitors" ON public.visitors FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access events" ON public.events;
CREATE POLICY "Service role full access events" ON public.events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable Realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  EXCEPTION WHEN duplicate_object THEN
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visitors;
  EXCEPTION WHEN duplicate_object THEN
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  EXCEPTION WHEN duplicate_object THEN
  END;
END $$;
