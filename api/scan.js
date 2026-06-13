const https = require('https');
module.exports = async (req, res) => {
    const { k } = req.query;
    if (k !== "demo123") {
        return res.status(403).json({ error: "Unauthorized access" });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }
    try {
        const { imageBase64, mediaType } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ error: "Missing image data" });
        }
        const PROMPT = `Διάβασε αυτό το ελληνικό τιμολόγιο χονδρικής πολύ προσεκτικά και εξήγαγε τα στοιχεία του.

ΟΔΗΓΙΕΣ ΓΙΑ ΤΙΣ ΓΡΑΜΜΕΣ ΕΙΔΩΝ:
- "name": το όνομα/περιγραφή του προϊόντος
- "qty": τα ΤΕΜΑΧΙΑ (ψάξε στήλη "ΤΕΜ" ή "ΤΕΜ.ΠΟΣ" ή "ΤΕΜΑΧΙΑ" — ΟΧΙ κιβώτια/ΚΙΒ)
- "netUnit": η τιμή ανά ΤΕΜΑΧΙΟ (στήλη "ΤΙΜΗ") — ΟΧΙ η συνολική αξία
- "vat": το ΦΠΑ σε ποσοστό (στήλη "ΦΠΑ" — συνήθως 6, 13, ή 24). Διάβασε προσεκτικά το ΦΠΑ κάθε γραμμής ξεχωριστά από τον πίνακα ΦΠΑ στο κάτω μέρος.
- "discountPct": η έκπτωση σε ποσοστό (στήλη "%ΕΚ" ή "ΕΚ%" ή "ΕΚΠΤΩΣΗ" — π.χ. 20 για 20%)

ΟΔΗΓΙΕΣ ΓΙΑ ΕΠΙΒΑΡΥΝΣΕΙΣ:
- Αν υπάρχει "ΦΟΡΟΣ ΚΑΦΕ", "ΕΠΙΒΑΡ.", "ΕΠΙΒΑΡΥΝΣΗ" στο footer/σύνολα, βάλε το ποσό στο "extraCharges" και την περιγραφή στο "extraChargesLabel"
- "footerDiscountPct": έκπτωση που αφορά ΟΛΟ το τιμολόγιο (όχι ανά γραμμή)

ΓΕΝΙΚΕΣ ΟΔΗΓΙΕΣ:
- Οι αριθμοί χρησιμοποιούν κόμμα ως δεκαδικό (π.χ. 15,26 → 15.26, 20,00 → 20.0)
- Αγνόησε γραμμές που είναι τίτλοι, σύνολα, ή κενές
- Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown, χωρίς σχόλια

Δομή JSON:
{"supplier":"","date":"","number":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","lines":[{"name":"","qty":0,"netUnit":0,"vat":0,"discountPct":0}]}`;

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
        return res.status(200).json(JSON.parse(raw));
    } catch (err) {
        return res.status(200).json({ error: "crash", details: err.message });
    }
};
