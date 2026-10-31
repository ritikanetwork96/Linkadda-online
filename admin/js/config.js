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

// Cloudflare R2 public config (Fast global CDN, $0 Egress)
export const R2_CONFIG = {
  endpoint: 'https://e251083d3d3878442daf244a17d304e5.r2.cloudflarestorage.com',
  bucket: 'linkadda-shop',
  publicUrl: 'https://pub-81f10c1135f54a719e5d96e8d7896960.r2.dev',
};

// Supabase public config (Anon Key only — Zero secrets on frontend!)
export const SUPABASE_CONFIG = {
  url: 'https://mkttxqwpbostzmfygpzq.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rdHR4cXdwYm9zdHptZnlncHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzODc1NzAsImV4cCI6MjEwODk2MzU3MH0.OP6jOD49M16r4uCUZ8pFOZkCaor0mk-0XZh94pjbSaE',
  bucket: 'linkadda-shop',
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
  { key: 'telegram', label: 'Telegram Bot', icon: 'bot' },
  { key: 'catalog', label: 'Catalog', icon: 'package' },
  { key: 'reviews', label: 'Reviews', icon: 'star' },
  { key: 'media', label: 'Media', icon: 'image-plus' },
  { key: 'hero', label: 'Hero', icon: 'sparkles' },
  { key: 'banner', label: 'All Collections', icon: 'layers' },
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
