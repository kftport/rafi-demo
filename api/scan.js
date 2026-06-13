const https = require('https');

function chainDiscounts(arr) {
    if (!Array.isArray(arr)) return 0;
    let p = 1;
    for (const d of arr) {
        const v = parseFloat(d) || 0;
        if (v > 0) p *= (1 - v / 100);
    }
    return Math.round((1 - p) * 10000) / 100;
}

function lineNet(l) {
    return (parseFloat(l.qty) || 0) * (parseFloat(l.netUnit) || 0) * (1 - chainDiscounts(l.discounts) / 100);
}

function findProblems(parsed) {
    const bad = [];
    (parsed.lines || []).forEach((l, i) => {
        const qty = parseFloat(l.qty) || 0;
        const net = parseFloat(l.netUnit) || 0;
        const av = parseFloat(l.lineValue) || 0;
        if (qty <= 0) return;
        const gross = qty * net;
        if (gross > 0 && av > 0) {
            const exp = gross * (1 - chainDiscounts(l.discounts) / 100);
            if (Math.abs(exp - av) > Math.max(0.03, 0.02 * av)) bad.push(i + 1);
        } else if (net <= 0) {
            bad.push(i + 1);
        }
    });
    return bad;
}

function totalsMismatch(parsed) {
    const invNet = parseFloat(parsed.totalNet) || 0;
    if (invNet <= 0) return false;
    let net = 0;
    (parsed.lines || []).forEach(l => { net += lineNet(l); });
    return Math.abs(net - invNet) > Math.max(0.15, 0.013 * invNet);
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

const BASE_PROMPT = `Είσαι ειδικός λογιστής που διαβάζει ελληνικά τιμολόγια χονδρικής με ΜΕΓΙΣΤΗ ακρίβεια. Κάθε εταιρία έχει διαφορετική δομή στηλών.

ΠΡΟΣΟΧΗ ΣΤΑ ΔΕΚΑΔΙΚΑ: διάβασε τις τιμές ΑΚΡΙΒΩΣ με όλα τα δεκαδικά (π.χ. 1.53 και ΟΧΙ 1.6). Μην στρογγυλοποιείς.

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ:
1. "name": περιγραφή προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ/ΕΙΔΟΣ). Αγνόησε barcodes/κωδικούς.
2. "qty": η ποσότητα. Αν υπάρχουν πολλές στήλες (ΠΟΣ.,ΤΕΜ.,ΜΟΝ.Α,ΜΟΝ.Β), διάλεξε ΕΚΕΙΝΗ που × ΤΙΜΗ δίνει την ΑΞΙΑ. ΜΗΝ διαλέγεις στήλη με 0.
3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ) ΠΡΙΝ την έκπτωση, με όλα τα δεκαδικά. ΟΧΙ η αξία.
4. "discounts": ΠΙΝΑΚΑΣ με ΟΛΑ τα ποσοστά έκπτωσης ξεχωριστά. Στήλες: "%ΕΚ","ΕΚ%","ΕΚΠ1","ΕΚΠ2","1η%","2η%","3η%","4η%". Βάλε τα σε array π.χ. [15,15] ή [2.20,18,3] ή []. Κάθε γραμμή ξεχωριστά.
5. "vat": ποσοστό ΦΠΑ γραμμής (6/13/24).
6. "lineValue": η ΑΞΙΑ της γραμμής μετά τις εκπτώσεις (στήλη ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ). ΚΡΙΣΙΜΟ — διάβασέ το προσεκτικά.

ΑΥΤΟΕΛΕΓΧΟΣ: για κάθε γραμμή, qty × netUnit × (1 - συνολική έκπτωση) ΠΡΕΠΕΙ να ισούται με lineValue. Αν δεν βγαίνει, ξαναδιάβασε τα νούμερα μέχρι να συμφωνούν.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ:
- "supplier": επωνυμία ΕΚΔΟΤΗ (όχι πελάτη).
- "date": ημερομηνία έκδοσης.
- "number": αριθμός παραστατικού.
- "extraCharges": επιβάρυνση εκτός ΦΠΑ (π.χ. ΦΟΡΟΣ ΚΑΦΕ). Αλλιώς 0.
- "extraChargesLabel": περιγραφή επιβάρυνσης.
- "footerDiscountPct": έκπτωση σε όλο το τιμολόγιο (π.χ. ΜΕΤΡΗΤΟΙΣ 3%). Αλλιώς 0.
- "totalNet": η ΣΥΝΟΛΙΚΗ ΚΑΘΑΡΗ ΑΞΙΑ (προ ΦΠΑ) όπως τυπώνεται στα σύνολα (ΚΑΘΑΡΗ ΑΞΙΑ / ΑΞΙΑ ΜΕΤΑ ΕΚΠΤ / ΣΥΝ.ΚΑΘ.ΑΞΙΑ). Για επαλήθευση.

ΣΗΜΑΝΤΙΚΟ:
- Δεκαδικό κόμμα → τελεία.
- Αγνόησε γραμμές συνόλων/τίτλων/κενές και ποσότητα 0.
- ΜΟΝΟ έγκυρο JSON, χωρίς markdown/σχόλια.

Δομή:
{"supplier":"","date":"","number":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","totalNet":0,"lines":[{"name":"","qty":0,"netUnit":0,"discounts":[],"vat":0,"lineValue":0}]}`;

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

        let problems = findProblems(parsed);
        let totalsOff = totalsMismatch(parsed);

        // Αν κάτι δεν επαληθεύεται -> 2η ανάγνωση με Sonnet (ακριβέστερο)
        if (problems.length > 0 || totalsOff) {
            let retryPrompt = BASE_PROMPT + `\n\nΠΡΟΣΟΧΗ: Σε προηγούμενη ανάγνωση κάποιες γραμμές ΔΕΝ επαληθεύτηκαν (qty × τιμή × (1-έκπτωση) δεν έβγαζε την ΑΞΙΑ τους`;
            if (problems.length > 0) retryPrompt += `, π.χ. γραμμές ${problems.join(', ')}`;
            if (totalsOff) retryPrompt += `, και το άθροισμα των γραμμών δεν συμφωνούσε με τη συνολική καθαρή αξία`;
            retryPrompt += `). Ξαναδιάβασε ΟΛΟ το τιμολόγιο πιο προσεκτικά — ιδιαίτερα τιμές, ποσότητες και εκπτώσεις — ώστε κάθε γραμμή να επαληθεύεται και το άθροισμα να συμφωνεί με τα σύνολα.`;

            const retry = await callClaude("claude-sonnet-4-6", retryPrompt, imageBase64, mediaType);
            if (retry.status === 200) {
                try {
                    const reparsed = parseResponse(retry);
                    const newProblems = findProblems(reparsed);
                    if (newProblems.length <= problems.length) {
                        parsed = reparsed;
                        problems = newProblems;
                    }
                } catch (e) { /* κράτα την 1η ανάγνωση */ }
            }
        }

        const lines = (parsed.lines || []).map((l, idx) => {
            let disc = chainDiscounts(l.discounts);
            if ((!l.discounts || l.discounts.length === 0) && l.discountPct) disc = parseFloat(l.discountPct) || 0;
            const flags = problems.includes(idx + 1) ? ['mismatch'] : [];
            return {
                name: l.name || '',
