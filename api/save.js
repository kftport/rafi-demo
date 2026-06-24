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

    const body = req.body || {};
    const {
      supplier,
      customerName,
      customerVat,
      customerAddress,
      customerPhone,
      invoice_number,
      invoice_date,
      total_net,
      footer_discount_pct,
      extra_charges,
      extra_charges_label,
      shop_name,
      shop_phone,
      heat,
      markup_used,
      owner,
      lines
    } = body;

    if (!supplier || !invoice_number || !invoice_date || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Missing required invoice fields or lines' });
    }

    const invoicePayload = {
      supplier: String(supplier),
      customer_name: String(customerName || ''),
      customer_vat: String(customerVat || ''),
      customer_address: String(customerAddress || ''),
      customer_phone: String(customerPhone || ''),
      invoice_number: String(invoice_number),
      invoice_date: String(invoice_date),
      total_net: parseFloat(total_net) || 0,
      footer_discount_pct: parseFloat(footer_discount_pct) || 0,
      extra_charges: parseFloat(extra_charges) || 0,
      extra_charges_label: String(extra_charges_label || ''),
      shop_name: String(shop_name || ''),
      shop_phone: String(shop_phone || ''),
      heat: String(heat || ''),
      markup_used: parseFloat(markup_used) || 0,
      owner: String(owner || '')
    };

    const { data: insertedInvoice, error: invoiceError } = await sup
      .from('invoices')
      .insert(invoicePayload)
      .select('id')
      .single();

    if (invoiceError) {
      console.error('Supabase invoice insert error:', invoiceError);
      return res.status(500).json({
        error: 'supabase_insert_failed',
        message: invoiceError.message || 'Supabase insert error',
        details: invoiceError.details || invoiceError,
        hint: invoiceError.hint,
        code: invoiceError.code
      });
    }

    const invoiceId = insertedInvoice.id;
    const lineItems = lines.map(line => ({
      invoice_id: invoiceId,
      name: String(line.name || ''),
      qty: parseFloat(line.qty) || 0,
      net_unit: parseFloat(line.netUnit ?? line.net_unit) || 0,
      discount_pct: parseFloat(line.discountPct ?? line.discount_pct) || 0,
      vat: parseFloat(line.vat) || 0,
      line_value: parseFloat(line.lineValue ?? line.line_value) || 0,
      product_code: String(line.productCode || line.product_code || ''),
      barcode: String(line.barcode || '')
    }));

    const { error: linesError } = await sup.from('invoice_lines').insert(lineItems);
    if (linesError) {
      console.error('Supabase invoice_lines insert error:', linesError);
      await sup.from('invoices').delete().eq('id', invoiceId);
      return res.status(500).json({
        error: 'supabase_insert_failed',
        message: linesError.message || 'Supabase insert lines error',
        details: linesError.details || linesError,
        hint: linesError.hint,
        code: linesError.code
      });
    }

    return res.status(200).json({ success: true, invoice_id: invoiceId });
  } catch (err) {
    console.error('API /api/save exception:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
};
