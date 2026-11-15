import fs from 'fs';

const supaUrl = 'https://xazhsjotzoentrkminol.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDU2MTM2NCwiZXhwIjoyMTEwMTM3MzY0fQ.sO_ZTRbmS7XInvK8YE6XEGz37URqzVmxxtsRABCGfHw';
const headers = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

// Safe deduplicator: only removes true duplicates of the same exact filename, never deletes real gallery images
async function run() {
  const res = await fetch(supaUrl + '/rest/v1/products?select=*', { headers });
  const rows = await res.json();
  console.log('Fetched ' + rows.length + ' products from Supabase');

  let updatedCount = 0;
  for (const row of rows) {
    const mainCover = String(row.image || '').trim();
    const cleanImgs = [];
    const seen = new Set();

    if (mainCover) {
      cleanImgs.push(mainCover);
      seen.add(mainCover.split('?')[0].split('/').pop().toLowerCase());
    }

    for (const u of (row.images || [])) {
      if (!u) continue;
      const fn = String(u).split('?')[0].split('/').pop().toLowerCase();
      if (!seen.has(fn)) {
        seen.add(fn);
        cleanImgs.push(u);
      }
    }

    for (const u of (row.gallery_images || [])) {
      if (!u) continue;
      const fn = String(u).split('?')[0].split('/').pop().toLowerCase();
      if (!seen.has(fn)) {
        seen.add(fn);
        cleanImgs.push(u);
      }
    }

    const cleanGal = cleanImgs.filter(u => u !== mainCover);

    if (JSON.stringify(cleanImgs) !== JSON.stringify(row.images || []) || JSON.stringify(cleanGal) !== JSON.stringify(row.gallery_images || [])) {
      const patch = {
        images: cleanImgs,
        gallery_images: cleanGal,
        data: {
          ...(row.data || {}),
          images: cleanImgs,
          galleryImages: cleanGal
        },
        updated_at: new Date().toISOString()
      };

      const pRes = await fetch(`${supaUrl}/rest/v1/products?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch)
      });
      if (pRes.ok) {
        updatedCount++;
        console.log('Safe deduplicated for:', row.id, '|', row.title, '| images:', cleanImgs.length);
      }
    }
  }
  console.log('Finished safe verification. Cleaned ' + updatedCount + ' products.');
}

run().catch(console.error);
