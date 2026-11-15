import fs from 'fs';

const R2_ROOT = 'https://pub-81f10c1135f54a719e5d96e8d7896960.r2.dev';
const supaUrl = 'https://xazhsjotzoentrkminol.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDU2MTM2NCwiZXhwIjoyMTEwMTM3MzY0fQ.sO_ZTRbmS7XInvK8YE6XEGz37URqzVmxxtsRABCGfHw';
const headers = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

const restoreMap = {
  'products_yvve61a': 'prod_products_yvve61a_0.jpg',
  'products_9p2lhst': 'prod_products_9p2lhst_0.jpg',
  'products_erh78iu': 'prod_products_erh78iu_0.jpg',
  'products_i688fjt': 'prod_products_i688fjt_0.jpg',
  'products_eiasnjx': 'prod_products_eiasnjx_0.jpg',
  'products_mw38vpu': 'prod_products_mw38vpu_0.jpg',
  'products_qwsxbwe': 'prod_products_qwsxbwe_0.jpg',
  'products_uwq3cdb': 'prod_products_uwq3cdb_0.jpg',
  'products_uk3uc8x': 'prod_products_uk3uc8x_0.jpg',
  'products_z656gy0': 'prod_products_z656gy0_0.jpg',
  'tamil-mallu-premium-pack-12': 'prod_tamil-mallu-premium-pack-12_0.jpg',
  'products_n3egevr': 'prod_products_n3egevr_0.jpg',
  'products_crg7uxn': 'prod_products_crg7uxn_0.jpg',
  'products_ump06mj': 'prod_products_ump06mj_0.jpg',
  'products_7qckmg7': 'prod_products_7qckmg7_0.jpg',
  'products_wu7o2tq': 'prod_products_wu7o2tq_0.jpg',
  'products_yu19xj9': 'prod_products_yu19xj9_0.jpg',
  'products_rm5c1x1': 'prod_products_rm5c1x1_0.jpg',
  'rp-videos-4': 'prod_rp-videos-4_0.jpg',
  'products_1uc6agc': 'prod_products_1uc6agc_0.jpg',
  'products_l7h1p27': 'prod_products_l7h1p27_0.jpg'
};

const fakeImageProducts = [
  'prod_mv5sjeyj_wxq5',
  'prod_mv5ss89d_wa6z',
  'prod_mv5sy9h7_5pjy',
  'products_0xahnev'
];

async function run() {
  const res = await fetch(supaUrl + '/rest/v1/products?select=*', { headers });
  const rows = await res.json();
  console.log('Fetched ' + rows.length + ' products from Supabase');

  let updatedCount = 0;
  for (const row of rows) {
    let patch = null;

    // A. Restore 21 multi-image products
    if (restoreMap[row.id]) {
      const extraImg = `${R2_ROOT}/images/${restoreMap[row.id]}`;
      const curImgs = Array.isArray(row.images) ? [...row.images] : [];
      const curGal = Array.isArray(row.gallery_images) ? [...row.gallery_images] : [];

      if (!curImgs.some(u => u.includes(restoreMap[row.id]))) {
        curImgs.push(extraImg);
      }
      if (!curGal.some(u => u.includes(restoreMap[row.id]))) {
        curGal.push(extraImg);
      }

      patch = {
        images: curImgs,
        gallery_images: curGal,
        data: {
          ...(row.data || {}),
          images: curImgs,
          galleryImages: curGal
        },
        updated_at: new Date().toISOString()
      };
      console.log('Restoring 2nd image for:', row.id, '|', row.title, '-> count:', curImgs.length);
    }

    // B. Clean fake category images from products where they were not added
    if (fakeImageProducts.includes(row.id)) {
      patch = {
        image: '',
        images: [],
        gallery_images: [],
        data: {
          ...(row.data || {}),
          image: '',
          imageUrl: '',
          thumbnail: '',
          images: [],
          galleryImages: []
        },
        updated_at: new Date().toISOString()
      };
      console.log('Clearing fake category image for:', row.id, '|', row.title);
    }

    if (patch) {
      const pRes = await fetch(`${supaUrl}/rest/v1/products?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch)
      });
      if (pRes.ok) updatedCount++;
      else console.error('Failed to patch', row.id, await pRes.text());
    }
  }
  console.log('Total successfully patched products in Supabase:', updatedCount);
}

run().catch(console.error);

