const https = require('https');
const { createClient } = require('@supabase/supabase-js');

let supabase = null;
const getSupabase = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!supabase) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return supabase;
};

const fetchOffProduct = (barcode) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'world.openfoodfacts.org',
      path: `/api/v2/product/${encodeURIComponent(barcode)}.json`,
      method: 'GET',
      headers: {
        'User-Agent': 'rafi-app/1.0 (invoice price tool)'
      }
    };

    const req = https.request(options, (resp) => {
      let body = '';
      resp.on('data', (chunk) => { body += chunk; });
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          try {
            const json = JSON.parse(body);
            resolve({ status: 200, body: json });
          } catch (err) {
            reject(new Error(`Invalid JSON from Open Food Facts: ${err.message}`));
          }
          return;
        }

        if (resp.statusCode === 404) {
          resolve({ status: 404, body: null });
          return;
        }

        reject(new Error(`Open Food Facts returned ${resp.statusCode}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Open Food Facts request timeout'));
    });
    req.end();
  });
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed', message: 'Only POST allowed' });
    }

    const sup = getSupabase();
    if (!sup) {
      console.error('Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return res.status(500).json({ error: 'supabase_not_configured', message: 'Λείπουν τα κλειδιά Supabase στο περιβάλλον' });
    }

    const { limit = 20 } = req.query;
    const batchLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 20);

    const { data: barcodeRows, error: barcodeError } = await sup
      .from('invoice_lines')
      .select('barcode')
      .neq('barcode', '')
      .not('barcode', 'is', null)
      .limit(200);

    if (barcodeError) {
      console.error('Supabase invoice_lines query error:', barcodeError);
      return res.status(500).json({
        error: 'supabase_query_failed',
        message: barcodeError.message || 'Failed to query invoice_lines',
        details: barcodeError.details || barcodeError,
        hint: barcodeError.hint,
        code: barcodeError.code
      });
    }

    const uniqueBarcodes = [...new Set((barcodeRows || []).map(row => String(row.barcode || '').trim()).filter(Boolean))];
    if (uniqueBarcodes.length === 0) {
      return res.status(200).json({ checked: 0, found: 0, notFound: 0, errors: [] });
    }

    const { data: existingProducts, error: productsError } = await sup
      .from('products')
      .select('barcode')
      .in('barcode', uniqueBarcodes.slice(0, 200));

    if (productsError) {
      console.error('Supabase products query error:', productsError);
      return res.status(500).json({
        error: 'supabase_query_failed',
        message: productsError.message || 'Failed to query products',
        details: productsError.details || productsError,
        hint: productsError.hint,
        code: productsError.code
      });
    }

    const existingSet = new Set((existingProducts || []).map(row => String(row.barcode || '').trim()));
    const toEnrich = uniqueBarcodes.filter(barcode => !existingSet.has(barcode)).slice(0, batchLimit);

    let checked = 0;
    let found = 0;
    let notFound = 0;
    const errors = [];

    for (const barcode of toEnrich) {
      checked += 1;
      try {
        const response = await fetchOffProduct(barcode);
        const now = new Date().toISOString();
        const row = {
          barcode,
          off_name: '',
          off_brand: '',
          off_category: '',
          off_image_url: '',
          off_found: false,
          enriched_at: now,
          created_at: now
        };

        if (response.status === 200 && response.body && response.body.status === 1) {
          const product = response.body.product || {};
          row.off_name = String(product.product_name || product.generic_name || '').slice(0, 255);
          row.off_brand = String(product.brands || '').slice(0, 255);
          row.off_category = String(product.categories || '').slice(0, 255);
          row.off_image_url = String(product.image_url || '');
          row.off_found = true;

          const { error: insertError } = await sup.from('products').upsert(row, { onConflict: 'barcode' });
          if (insertError) throw insertError;
          found += 1;
          continue;
        }

        const { error: insertError } = await sup.from('products').upsert(row, { onConflict: 'barcode' });
        if (insertError) throw insertError;
        notFound += 1;
      } catch (err) {
        console.error(`Failed enriching barcode ${barcode}:`, err);
        errors.push({ barcode, message: err.message || String(err) });
      }
    }

    return res.status(200).json({ checked, found, notFound, errors });
  } catch (err) {
    console.error('API /api/enrich exception:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
};
