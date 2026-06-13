const https = require('https');

// Αλυσιδωτός συνδυασμός εκπτώσεων -> ενιαίο ποσοστό
function chainDiscounts(arr) {
    if (!Array.isArray(arr)) return 0;
    let p = 1;
    for (const d of arr) {
        const v = parseFloat(d) || 0;
        if (v > 0) p *= (1 - v / 100);
    }
    return Math.round((1 - p) * 10000) / 100;
}

// Διασταύρωση κάθε γραμμής με τη στήλη ΑΞΙΑ. Διορθώνει την έκπτωση αν δεν συμφωνεί.
function reconcileLine(line) {
    const qty = parseFloat(line.qty) || 0;
    const netUnit = parseFloat(line.netUnit) || 0;
    let disc = parseFloat(line.discountPct) || 0;
    const axia = parseFloat(line.lineValue) || 0;
    const flags = [];

    const gross = qty * netUnit;
    if (gross > 0 && axia > 0) {
        const statedAxia = gross * (1 - disc / 100);
        const tol = Math.max(0.05, 0.015 * axia);
        if (Math.abs(statedAxia - axia) > tol) {
            const implied = Math.round((1 - axia / gross) * 10000) / 100;
            if (implied >= -1 && implied <= 100) {
                disc = Math.max(0, implied);
                flags.push('discount_corrected');
            } else {
                flags.push('mismatch');
            }
        }
    } else if (gross <= 0 && (qty || netUnit)) {
        flags.push('check_qty_price');
    }

    return {
        name: line.name || '',
        qty: qty,
        netUnit: netUnit,
        discountPct: disc,
        vat: (line.vat !== undefined && line.vat !== null && line.vat !== '') ? parseFloat(line.vat) : 24,
        lineValue: axia,
        _flags: flags
    };
}

module.exports = async (req, res) => {
    const { k } = req.query;
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }
    if (k !== "demo123") {
        return res.status(403).json({ error: "Unauthorized access" });
    }
    try {
        const { imageBase64, mediaType } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ error: "Missing image data" });
        }
        const PROMPT = `Είσαι ειδικός λογιστής που διαβάζει ελληνικά τιμολόγια χονδρικής. Διάβασε το τιμολόγιο πολύ προσεκτικά. Κάθε εταιρία έχει διαφορετική δομή στηλών.

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ ΕΙΔΟΥΣ συμπλήρωσε:

1. "name": η περιγραφή του προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ / ΕΙΔΟΣ). Αγνόησε barcodes/κωδικούς.

2. "qty": η ποσότητα. Αν υπάρχουν πολλές στήλες ποσότητας (ΠΟΣ., ΤΕΜ., ΜΟΝ.Α, ΜΟΝ.Β), διάλεξε ΕΚΕΙΝΗ που × ΤΙΜΗ δίνει την ΑΞΙΑ. ΜΗΝ επιλέγεις στήλη με 0. Π.χ. αν ΠΟΣ.=20 και ΤΕΜ.=0, σωστή ποσότητα = 20.

3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ) ΠΡΙΝ την έκπτωση. ΟΧΙ η αξία γραμμής.

4. "discounts": ΠΙΝΑΚΑΣ με ΟΛΑ τα ποσοστά έκπτωσης της γραμμής, ξεχωριστά (μην τα συνδυάσεις εσύ).
   Οι στήλες έκπτωσης έχουν διαφορετικά ονόματα: "%ΕΚ","ΕΚ%","ΕΚΠ1","ΕΚΠ2","1η%","2η%","3η%","4η%","ΕΚΠΤΩΣΕΙΣ".
   Βρες ΟΛΕΣ (1 έως 4 στήλες) και βάλε τις τιμές σε array, π.χ. [15, 15] ή [2.20, 18, 3] ή [].
   Σε κάθε γραμμή η έκπτωση μπορεί να είναι σε διαφορετική στήλη — διάβασε κάθε γραμμή ξεχωριστά.

5. "vat": το ποσοστό ΦΠΑ της γραμμής (στήλη ΦΠΑ%, συνήθως 6/13/24).

6. "lineValue": η ΑΞΙΑ της γραμμής μετά τις εκπτώσεις (στήλη ΑΞΙΑ / ΚΑΘ.ΑΞΙΑ). ΚΡΙΣΙΜΟ για επαλήθευση — διάβασέ το προσεκτικά.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ:
- "supplier": επωνυμία ΕΚΔΟΤΗ (όχι του πελάτη).
- "date": ημερομηνία έκδοσης.
- "number": αριθμός παραστατικού.
- "extraCharges": ποσό επιβάρυνσης εκτός ΦΠΑ (π.χ. "ΦΟΡΟΣ ΚΑΦΕ"). Αλλιώς 0.
- "extraChargesLabel": περιγραφή επιβάρυνσης.
- "footerDiscountPct": έκπτωση σε ΟΛΟ το τιμολόγιο (π.χ. "ΜΕΤΡΗΤΟΙΣ 3%"). Αλλιώς 0.

ΣΗΜΑΝΤΙΚΟ:
- Δεκαδικό κόμμα → τελεία (15,26 → 15.26).
- Αγνόησε γραμμές συνόλων/τίτλων/κενές και γραμμές με ποσότητα 0.
- Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown/σχόλια.

Δομή:
{"supplier":"","date":"","number":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","lines":[{"name":"","qty":0,"netUnit":0,"discounts":[],"vat":0,"lineValue":0}]}`;

        const postData = JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            messages: [{
                role: "user",
                content: [
                    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
                    { type: "text", text: PROMPT }
                ]
            }]
        });
        const options = {
            hostname: 'api.anthropic.com',
            port: 443,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.ANTHROPIC_API_KEY,
                'Anthropic-Version': '2023-06-01',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const apiResponse = await new Promise((resolve, reject) => {
            const reqApi = https.request(options, (resApi) => {
                let data = '';
                resApi.on('data', (chunk) => data += chunk);
                resApi.on('end', () => resolve({ status: resApi.statusCode, body: data }));
            });
            reqApi.on('error', (e) => reject(e));
            reqApi.write(postData);
            reqApi.end();
        });
        if (apiResponse.status !== 200) {
            return res.status(200).json({ error: "anthropic_error", details: apiResponse.body });
        }
        const resBody = JSON.parse(apiResponse.body);
        let raw = resBody.content.filter(b => b.type === "text").map(b => b.text).join("");
        raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(raw);

        // --- Server-side επεξεργασία & επαλήθευση ---
        const lines = (parsed.lines || []).map(l => {
            // συνδυασμός εκπτώσεων αλυσιδωτά
            let disc = chainDiscounts(l.discounts);
            // fallback αν το AI έδωσε έτοιμο discountPct
            if ((!l.discounts || l.discounts.length === 0) && l.discountPct) {
                disc = parseFloat(l.discountPct) || 0;
            }
            return reconcileLine({ ...l, discountPct: disc });
        }).filter(l => l.qty > 0);

        return res.status(200).json({
            supplier: parsed.supplier || '',
            date: parsed.date || '',
            number: parsed.number || '',
            footerDiscountPct: parseFloat(parsed.footerDiscountPct) || 0,
            extraCharges: parseFloat(parsed.extraCharges) || 0,
            extraChargesLabel: parsed.extraChargesLabel || '',
            lines: lines
        });
    } catch (err) {
        return res.status(200).json({ error: "crash", details: err.message });
    }
};
