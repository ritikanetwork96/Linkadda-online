if (typeof window !== 'undefined' && window.location.pathname.endsWith('.js')) {
  window.location.replace('/admin');
}

export const APP_CONFIG = {
  appName: 'Linkadda Admin',
  appSlug: 'linkadda-admin',
  themeKey: 'linkadda_admin_theme',
  sessionKey: 'linkadda_admin_session',
  commandKey: 'linkadda_admin_commands',
  publicBaseUrl: '/',
};

// Legacy config retained for type safety
export const FIREBASE_CONFIG = {};

// RustFS S3-compatible public config (No secrets on frontend!)
export const RUSTFS_CONFIG = {
  endpoint: 'https://rustfs-mi5c.srv1942099.hstgr.cloud',
  bucket: 'linkadda-media',
  region: 'us-east-1',
};

// Supabase public config (Anon Key only — Zero secrets on frontend!)
export const SUPABASE_CONFIG = {
  url: 'https://esxiwfswnbacmpjxqgsn.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDcxODQsImV4cCI6MjEwODE4MzE4NH0.n6XzLxgH5947CK-224Tp57BJmbWZ_rTKi4PK-EW8bNI',
  bucket: 'linkadda-media',
};

export const RTDB_NODES = {
  hero: 'hero',
  categories: 'categories',
  products: 'products',
  events: 'events',
  banner: 'banner',
  faq: 'faq',
  testimonials: 'testimonials',
  settings: 'settings',
  payment: 'payment',
  orders: 'orders',
  analytics: 'analytics',
  media: 'media',
  visitors: 'visitors',
  reviews: 'reviews',
  customers: 'customers',
};

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { key: 'orders', label: 'Orders', icon: 'receipt-text' },
  { key: 'catalog', label: 'Catalog', icon: 'package' },
  { key: 'reviews', label: 'Reviews', icon: 'star' },
  { key: 'media', label: 'Media', icon: 'image-plus' },
  { key: 'hero', label: 'Hero', icon: 'sparkles' },
  { key: 'banner', label: 'Banner', icon: 'badge-percent' },
  { key: 'faq', label: 'FAQ', icon: 'help-circle' },
  { key: 'testimonials', label: 'Testimonials', icon: 'messages-square' },
  { key: 'payment', label: 'Payment', icon: 'credit-card' },
  { key: 'settings', label: 'Settings', icon: 'settings-2' },
  { key: 'screenshots', label: 'Screenshots', icon: 'image' },
  { key: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
];

export const DEFAULT_EMPTY = {
  title: '',
  slug: '',
  description: '',
  category: '',
  priceINR: '',
  priceUSD: '',
  originalPriceINR: '',
  originalPriceUSD: '',
  rating: '4.9',
  reviewsCount: '',
  badge: '',
  image: '',
  images: [],
  galleryImages: [],
  video: '',
  videos: [],
  tiers: [],
  showTrustAssurance: true,
  trustTitle: 'Trust & Discrete Billing Assurance',
  trustPoint1Title: '100% Discrete Billing',
  trustPoint1Desc: 'Your bank statement or UPI app will show a neutral business descriptor. Zero adult keywords or references. 100% anonymous.',
  trustPoint2Title: 'Instant Cloud Access',
  trustPoint2Desc: 'Direct high-speed Mega.nz & Google Drive cloud folders delivered on-screen and via Telegram bot instantly.',
  trustPoint3Title: 'Lifetime Link Replacement',
  trustPoint3Desc: 'If any cloud folder ever gets expired or blocked, our 24/7 VIP helpdesk refreshes your link free forever.',
  trustPoint4Title: '',
  trustPoint4Desc: '',
  showSpecsTable: true,
  specsTitle: 'Pack Specifications',
  specResolution: '4K 2160p Ultra HD (60 FPS HDR)',
  specAudio: 'Original Studio Stereo Clear Audio',
  specDelivery: 'Mega.nz & Google Drive Direct Fast Links',
  specDevices: 'Android, iPhone (iOS), Windows PC, Mac, Smart TV',
  specAccess: 'Lifetime Cloud Access + Free Link Replacement',
  specSupport: '24/7 Instant Telegram VIP Helpdesk',
  specMediaCount: '',
  status: 'active',
  displayOrder: 0,
};
