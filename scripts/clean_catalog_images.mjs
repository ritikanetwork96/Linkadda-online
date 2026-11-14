import fs from 'fs';

const b = JSON.parse(fs.readFileSync('backup_products_and_catalog.json', 'utf8'));
const prods = b.products || b;

const supaUrl = 'https://xazhsjotzoentrkminol.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDU2MTM2NCwiZXhwIjoyMTEwMTM3MzY0fQ.sO_ZTRbmS7XInvK8YE6XEGz37URqzVmxxtsRABCGfHw';
const headers = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

async function run() {
  const res = await fetch(supaUrl + '/rest/v1/products?select=*', { headers });
  const rows = await res.json();
  console.log('Fetched ' + rows.length + ' products from Supabase');

  let updatedCount = 0;
  for (const row of rows) {
    const orig = prods[row.id];
    const origGal = orig?.galleryImages || [];
    const origImgs = orig?.images || [];
    const isSingleImageProduct = origGal.length === 0 && origImgs.length <= 1;

    let patchNeeded = false;
    const patch = {};

    // 1. If product originally had no gallery images, strictly enforce single image
    if (isSingleImageProduct) {
      const curGal = row.gallery_images || [];
      const curImgs = row.images || [];
      const mainCover = row.image || curImgs[0] || '';

      if (curGal.length > 0 || curImgs.length > 1 || (curImgs.length === 1 && curImgs[0] !== mainCover)) {
        patch.gallery_images = [];
        patch.images = mainCover ? [mainCover] : [];
        const d = { ...(row.data || {}) };
        d.galleryImages = [];
        d.images = mainCover ? [mainCover] : [];
        patch.data = d;
        patchNeeded = true;
      }
    } else {
      // 2. Multi-image product: ensure NO duplicates between cover and gallery_images
      const mainCover = row.image || '';
      const cleanImgs = [];
      const seen = new Set();
      if (mainCover) {
        cleanImgs.push(mainCover);
        seen.add(mainCover.split('/').pop().toLowerCase());
      }
      for (const u of (row.images || [])) {
        if (!u) continue;
        const fn = u.split('/').pop().toLowerCase();
        if (!seen.has(fn)) {
          seen.add(fn);
          cleanImgs.push(u);
        }
      }
      const cleanGal = cleanImgs.filter(u => u !== mainCover);
      if (JSON.stringify(cleanImgs) !== JSON.stringify(row.images || []) || JSON.stringify(cleanGal) !== JSON.stringify(row.gallery_images || [])) {
        patch.images = cleanImgs;
        patch.gallery_images = cleanGal;
        const d = { ...(row.data || {}) };
        d.images = cleanImgs;
        d.galleryImages = cleanGal;
        patch.data = d;
        patchNeeded = true;
      }
    }

    if (patchNeeded) {
      patch.updated_at = new Date().toISOString();
      const pRes = await fetch(`${supaUrl}/rest/v1/products?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch)
      });
      if (pRes.ok) {
        updatedCount++;
        console.log('Fixed product images for:', row.id, '|', row.title, '| single:', isSingleImageProduct, '| images:', (patch.images || []).length);
      }
    }
  }
  console.log('Successfully cleaned and deduplicated images for ' + updatedCount + ' products in Supabase!');
}

run().catch(console.error);
