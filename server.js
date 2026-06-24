require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const scanHandler = require('./api/scan');

const app = express();
const port = process.env.PORT || 3000;

console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY =", process.env.SUPABASE_SERVICE_KEY ? '***' : undefined);
let supabase = null;
const getSupabase = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!supabase) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return supabase;
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/scan', (req, res, next) => {
  Promise.resolve(scanHandler(req, res)).catch(next);
});

app.post('/api/save', async (req, res, next) => {
  try {
    const sup = getSupabase();
    if (!sup) {
      console.error('Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return res.status(500).json({ error: 'supabase_not_configured', message: 'Λείπουν τα κλειδιά Supabase στο περιβάλλον' });
    }

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
    } = req.body;

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
    next(err);
  }
});

app.post('/api/update-heat', async (req, res, next) => {
  try {
    const { invoice_ids, heat, shop_name, shop_phone } = req.body;
    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return res.status(400).json({ error: 'invalid_payload', message: 'invoice_ids must be a non-empty array' });
    }
    if (typeof heat !== 'string') {
      return res.status(400).json({ error: 'invalid_payload', message: 'heat must be a string' });
    }

    const sup = getSupabase();
    if (!sup) {
      console.error('Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return res.status(500).json({ error: 'supabase_not_configured', message: 'Λείπουν τα κλειδιά Supabase στο περιβάλλον' });
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
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Resource not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
