const { createClient } = require('@supabase/supabase-js');

let supabase = null;
const getSupabase = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!supabase) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return supabase;
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed', message: 'Only POST allowed' });

    const sup = getSupabase();
    if (!sup) {
      console.error('Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return res.status(500).json({ error: 'supabase_not_configured', message: 'Λείπουν τα κλειδιά Supabase στο περιβάλλον' });
    }

    const { invoice_ids, heat, shop_name, shop_phone } = req.body || {};
    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return res.status(400).json({ error: 'invalid_payload', message: 'invoice_ids must be a non-empty array' });
    }
    if (typeof heat !== 'string') {
      return res.status(400).json({ error: 'invalid_payload', message: 'heat must be a string' });
    }

    const updatePayload = { heat: String(heat) };
    if (shop_name !== undefined) updatePayload.shop_name = String(shop_name || '');
    if (shop_phone !== undefined) updatePayload.shop_phone = String(shop_phone || '');

    const { error } = await sup
      .from('invoices')
      .update(updatePayload)
      .in('id', invoice_ids);

    if (error) {
      console.error('Supabase update error:', error);
      return res.status(500).json({
        error: 'supabase_update_failed',
        message: error.message || 'Supabase update error',
        details: error.details || error,
        hint: error.hint,
        code: error.code
      });
    }

    return res.status(200).json({ success: true, updated: invoice_ids.length });
  } catch (err) {
    console.error('API /api/update-heat exception:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
};
