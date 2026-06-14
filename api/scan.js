const https = require('https');

function deriveDiscount(qty, netUnit, lineValue) {
    const gross = qty * netUnit;
    if (gross <= 0) return { disc: 0, bad: true };
    const d = (1 - lineValue / gross) * 100;
    if (d < -0.5 || d > 100) return { disc: 0, bad: true };
    return { disc: Math.round(Math.max(0, d) * 100) / 100, bad: false };
}

function callClaude(model, promptText, imageBase64, mediaType) {
    const postData = JSON.stringify({
        model: model,
        max_tokens: 8192,
        messages: [{
            role: "user",
            content: [
                { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
                { type: "text", text: promptText }
            ]
        }]
    });
    const options = {
        hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.ANTHROPIC_API_KEY,
            'Anthropic-Version': '2023-06-01',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    return new Promise((resolve, reject) => {
        const r = https.request(options, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
        });
        r.on('error', reject);
        r.write(postData);
        r.end();
    });
}

function parseResponse(apiResponse) {
    const resBody = JSON.parse(apiResponse.body);
    let raw = resBody.content.filter(b => b.type === "text").map(b => b.text).join("");
    raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(raw);
}

function buildLines(parsed) {
    return (parsed.lines || []).map(l => {
        const qty = parseFloat(l.qty) || 0;
        const netUnit = parseFloat(l.netUnit) || 0;
        const lineValue = parseFloat(l.lineValue) || 0;
        const { disc, bad } = deriveDiscount(qty, netUnit, lineValue);
        return {
            name: l.name || '',
            qty: qty,
            netUnit: netUnit,
            discountPct: disc,
            vat: (l.vat !== undefined && l.vat !== null && l.vat !== '') ? parseFloat(l.vat) : 24,
            lineValue: lineValue,
            _flags: bad ? ['mismatch'] : []
        };
    }).filter(l => l.qty > 0);
}

function totalsMismatch(lines, parsed) {
    const invNet = parseFloat(parsed.totalNet) || 0;
    if (invNet <= 0) return false;
    let net = 0;
    lines.forEach(l => { net += l.netUnit * l.qty * (1 - l.discountPct / 100); });
    return Math.abs(net - invNet) > Math.max(0.20, 0.02 * invNet);
}

const BASE_PROMPT = `Διαβάζεις ελληνικά τιμολόγια χονδρικής. Διάβασε ΜΟΝΟ τα παρακάτω, με μέγιστη ακρίβεια. ΜΗΝ ασχοληθείς με τις στήλες εκπτώσεων — δεν τις χρειάζομαι.

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ ΠΡΟΪΟΝΤΟΣ διάβασε 4 νούμερα:
1. "name": η περιγραφή του προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ/ΕΙΔΟΣ). Αγνόησε barcodes/κωδικούς.
2. "qty": η ΠΟΣΟΤΗΤΑ σε τεμάχια. Αν υπάρχουν πολλές στήλες ποσότητας (ΠΟΣ.,ΤΕΜ.,ΜΟΝ.Α,ΜΟΝ.Β), διάλεξε ΕΚΕΙΝΗ που × ΤΙΜΗ πλησιάζει την ΑΞΙΑ. ΜΗΝ διαλέγεις στήλη με 0.
3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ), με ΟΛΑ τα δεκαδικά ακριβώς (π.χ. 1.53 όχι 1.6). Τιμή ΠΡΙΝ την έκπτωση.
4. "lineValue": η ΑΞΙΑ της γραμμής ΜΕΤΑ τις εκπτώσεις (στήλη ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ). Το πιο σημαντικό — διάβασέ το πολύ προσεκτικά.
5. "vat": το ποσοστό ΦΠΑ της γραμμής (στήλη ΦΠΑ%, συνήθως 6/13/24).

ΕΛΕΓΧΟΣ: για κάθε γραμμή, το lineValue πρέπει να είναι ≤ qty × netUnit. Αν δεις lineValue μεγαλύτερο, ξαναδιάβασε.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ:
- "supplier": επωνυμία ΕΚΔΟΤΗ (όχι του πελάτη).
- "date": ημερομηνία έκδοσης.
- "number": αριθμός παραστατικού.
- "extraCharges": ποσό επιβάρυνσης εκτός ΦΠΑ (π.χ. ΦΟΡΟΣ ΚΑΦΕ). Αλλιώς 0.
- "extraChargesLabel": περιγραφή επιβάρυνσης.
- "footerDiscountPct": έκπτωση σε όλο το τιμολόγιο (π.χ. ΜΕΤΡΗΤΟΙΣ 3%). Αλλιώς 0.
- "totalNet": η ΣΥΝΟΛΙΚΗ ΚΑΘΑΡΗ ΑΞΙΑ προ ΦΠΑ (ΚΑΘΑΡΗ ΑΞΙΑ/ΑΞΙΑ ΜΕΤΑ ΕΚΠΤ/ΣΥΝ.ΚΑΘ.ΑΞΙΑ).

ΣΗΜΑΝΤΙΚΟ:
- Δεκαδικό κόμμα → τελεία (15,26 → 15.26).
- Διάβασε ΟΛΕΣ τις γραμμές — μην παραλείψεις καμία.
- Αγνόησε γραμμές συνόλων/τίτλων/κενές και ποσότητα 0.
- ΜΟΝΟ έγκυρο JSON, χωρίς markdown/σχόλια.

Δομή:
{"supplier":"","date":"","number":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","totalNet":0,"lines":[{"name":"","qty":0,"netUnit":0,"lineValue":0,"vat":0}]}`;

module.exports = async (req, res) => {
    const { k } = req.query;
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    if (k !== "demo123") return res.status(403).json({ error: "Unauthorized access" });

    try {
        const { imageBase64, mediaType } = req.body;
        if (!imageBase64) return res.status(400).json({ error: "Missing image data" });

        // 1η ανάγνωση με Haiku (φθηνό)
        let apiResponse = await callClaude("claude-haiku-4-5-20251001", BASE_PROMPT, imageBase64, mediaType);
        if (apiResponse.status !== 200) return res.status(200).json({ error: "anthropic_error", details: apiResponse.body });
        let parsed = parseResponse(apiResponse);
        let lines = buildLines(parsed);

        const problemCount = lines.filter(l => l._flags.length > 0).length;

        // Αν κάτι δεν επαληθεύεται -> 2η ανάγνωση με Opus (ισχυρό)
        if (problemCount > 0 || totalsMismatch(lines, parsed)) {
            try {
                const retryPrompt = BASE_PROMPT + "\n\nΠΡΟΣΟΧΗ: σε προηγούμενη ανάγνωση κάποιες γραμμές δεν έβγαζαν νόημα ή το άθροισμα δεν συμφωνούσε με τα σύνολα. Ξαναδιάβασε ΟΛΟ το τιμολόγιο πολύ προσεκτικά — ιδιαίτερα τιμή μονάδας και αξία γραμμής — και βεβαιώσου ότι δεν παρέλειψες καμία γραμμή.";
                const retry = await callClaude("claude-opus-4-1-20250805", retryPrompt, imageBase64, mediaType);
                if (retry.status === 200) {
                    const reparsed = parseResponse(retry);
                    const relines = buildLines(reparsed);
                    const reproblems = relines.filter(l => l._flags.length > 0).length;
                    if (reproblems <= problemCount) {
                        parsed = reparsed;
                        lines = relines;
                    }
                }
            } catch (e) { /* κράτα την 1η ανάγνωση */ }
        }

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
