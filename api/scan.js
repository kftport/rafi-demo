const https = require('https');

// ---- Υπολογισμός έκπτωσης από τα νούμερα (η δοκιμασμένη λογική) ----
function deriveDiscount(qty, netUnit, lineValue) {
    const gross = qty * netUnit;
    if (gross <= 0) return { disc: 0, bad: true };
    const d = (1 - lineValue / gross) * 100;
    if (d < -0.5 || d > 100) return { disc: 0, bad: true };
    return { disc: Math.round(Math.max(0, d) * 100) / 100, bad: false };
}

// ---- Κλήση Google Document AI ----
function callDocumentAI(imageBase64, mediaType) {
    const projectId = process.env.DOCAI_PROJECT_ID;
    const location = process.env.DOCAI_LOCATION || 'eu';
    const processorId = process.env.DOCAI_PROCESSOR_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    const payload = JSON.stringify({
        rawDocument: {
            content: imageBase64,
            mimeType: mediaType || 'image/jpeg'
        }
    });

    const host = `${location}-documentai.googleapis.com`;
    const path = `/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process?key=${apiKey}`;

    const options = {
        hostname: host,
        port: 443,
        path: path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve, reject) => {
        const r = https.request(options, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
        });
        r.on('error', reject);
        r.write(payload);
        r.end();
    });
}

// ---- Βοηθητικά για ανάγνωση των entities του Document AI ----
function getEntities(doc, type) {
    return (doc.entities || []).filter(e => e.type === type);
}
function num(val) {
    if (val === undefined || val === null) return 0;
    const cleaned = String(val).replace(/[^0-9,.\-]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}
function txt(e) {
    if (!e) return '';
    if (e.normalizedValue && e.normalizedValue.text) return e.normalizedValue.text;
    return e.mentionText || '';
}

// ---- Μετατροπή απάντησης Document AI στη μορφή της εφαρμογής ----
function transformDocAI(doc) {
    // top-level πεδία
    const supplier = txt(getEntities(doc, 'supplier_name')[0]) || '';
    const date = txt(getEntities(doc, 'invoice_date')[0]) || '';
    const number = txt(getEntities(doc, 'invoice_id')[0]) || '';

    const lines = [];
    (doc.entities || []).forEach(e => {
        if (e.type !== 'line_item') return;
        const props = e.properties || [];
        const get = (t) => {
            const p = props.find(x => x.type === t);
            return p ? txt(p) : '';
        };
        const name = get('line_item/description') || get('line_item/product_code') || '';
        const qty = num(get('line_item/quantity')) || 1;
        const unitPrice = num(get('line_item/unit_price'));
        const amount = num(get('line_item/amount'));

        // netUnit = τιμή μονάδας προ έκπτωσης· lineValue = αξία γραμμής μετά
        const netUnit = unitPrice || (amount && qty ? amount / qty : 0);
        const lineValue = amount || (netUnit * qty);

        const { disc, bad } = deriveDiscount(qty, netUnit, lineValue);

        if (qty > 0 && netUnit > 0) {
            lines.push({
                name: name,
                qty: qty,
                netUnit: netUnit,
                discountPct: disc,
                vat: 24,
                lineValue: lineValue,
                _flags: bad ? ['mismatch'] : []
            });
        }
    });

    return {
        supplier: supplier,
        date: date,
        number: number,
        footerDiscountPct: 0,
        extraCharges: 0,
        extraChargesLabel: '',
        lines: lines
    };
}

module.exports = async (req, res) => {
    const { k } = req.query;
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    if (k !== "demo123") return res.status(403).json({ error: "Unauthorized access" });

    try {
        const { imageBase64, mediaType } = req.body;
        if (!imageBase64) return res.status(400).json({ error: "Missing image data" });

        const apiResponse = await callDocumentAI(imageBase64, mediaType);
        if (apiResponse.status !== 200) {
            return res.status(200).json({ error: "anthropic_error", details: apiResponse.body });
        }

        const parsed = JSON.parse(apiResponse.body);
        const doc = parsed.document;
        if (!doc) {
            return res.status(200).json({ error: "crash", details: "No document in response: " + apiResponse.body.slice(0, 500) });
        }

        const result = transformDocAI(doc);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(200).json({ error: "crash", details: err.message });
    }
};
