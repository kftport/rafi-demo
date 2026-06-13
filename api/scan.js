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
        const PROMPT = `Διάβασε αυτό το ελληνικό τιμολόγιο χονδρικής προσεκτικά.

ΚΡΙΣΙΜΕΣ ΟΔΗΓΙΕΣ:
- Το πεδίο "qty" είναι τα ΤΕΜΑΧΙΑ (όχι τα κιβώτια). Ψάξε τη στήλη "ΤΕΜ" ή "ΤΕΜ.ΠΟΣ" ή "ΤΕΜΑΧΙΑ".
- Το πεδίο "netUnit" είναι η ΤΙΜΗ ανά τεμάχιο (στήλη "ΤΙΜΗ"), ΟΧΙ η καθαρή αξία.
- Το πεδίο "discountPct" είναι το ποσοστό έκπτωσης (στήλη "%ΕΚ" ή "ΕΚΠΤΩΣΗ").
- Αν υπάρχει "ΦΟΡΟΣ ΚΑΦΕ" ή "ΕΠΙΒΑΡΥΝΣΗ" στο footer, βάλτο στο "extraCharges".
- Αγνόησε γραμμές που είναι τίτλοι, σύνολα, ή κενές.
- Οι αριθμοί χρησιμοποιούν κόμμα ως δεκαδικό (π.χ. 15,26 = 15.26).

Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown, χωρίς σχόλια, με αυτή τη δομή:
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
