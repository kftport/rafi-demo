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
        const PROMPT = `Είσαι ειδικός στην ανάγνωση ελληνικών τιμολογίων χονδρικής. Διάβασε το τιμολόγιο πολύ προσεκτικά. Τα τιμολόγια διαφέρουν ανά εταιρία, οπότε προσάρμοσε την ανάγνωση στη δομή του κάθε τιμολογίου.

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ ΕΙΔΟΥΣ συμπλήρωσε:

1. "name": η περιγραφή του προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ / ΕΙΔΟΣ). Αγνόησε barcodes και κωδικούς.

2.2. "qty": η ΣΥΝΟΛΙΚΗ ΠΟΣΟΤΗΤΑ σε ΤΕΜΑΧΙΑ (το πλήθος των μονάδων, ΟΧΙ συσκευασιών).
   ΠΡΟΣΟΧΗ: Πολλά τιμολόγια έχουν ΔΥΟ ζευγάρια "Μονάδα/Ποσότητα":
   - Πρώτο: η συσκευασία (ΚΙΒ/ΔΕΜΑ) με μικρό αριθμό, π.χ. 1,00
   - Δεύτερο: τα ΤΕΜΑΧΙΑ (ΤΕΜ) με μεγαλύτερο αριθμό, π.χ. 6,00
   Πάντα διάλεξε τα ΤΕΜΑΧΙΑ (το δεύτερο, μεγαλύτερο νούμερο), ΠΟΤΕ τα κιβώτια.
   Διασταύρωσε με το συνολικό "ΣΥΝ.ΠΟΣΟΤΗΤΑ" στο κάτω μέρος του τιμολογίου αν υπάρχει.
   - Αν η στήλη "ΤΕΜ" δείχνει 0, τότε χρησιμοποίησε τη στήλη "ΠΟΣ.".

3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ ή ΤΙΜΗ ΜΟΝ.) ΠΡΙΝ την έκπτωση. ΟΧΙ η αξία/σύνολο γραμμής. Αν υπάρχουν ΤΙΜΗ ΜΟΝ.Α και ΤΙΜΗ ΜΟΝ.Β, διάλεξε αυτή που αντιστοιχεί στα τεμάχια.

4. "discountPct": το ΣΥΝΟΛΙΚΟ ποσοστό έκπτωσης της γραμμής.
   - Αν υπάρχει ΜΙΑ στήλη έκπτωσης (%ΕΚ / ΕΚ%), βάλε αυτήν.
   - Αν υπάρχουν ΠΟΛΛΕΣ στήλες εκπτώσεων (π.χ. "1η%","2η%","3η%","4η%" ή "ΕΚΠ1","ΕΚΠ2"), συνδύασέ τες ΑΛΥΣΙΔΩΤΑ και δώσε το ισοδύναμο συνολικό ποσοστό.
     Παράδειγμα: 18% και 3% δίνουν συνολική έκπτωση 100*(1-(1-0.18)*(1-0.03)) = 20.46
   - Αν δεν υπάρχει έκπτωση, βάλε 0.

5. "vat": το ποσοστό ΦΠΑ της γραμμής (στήλη ΦΠΑ% — συνήθως 6, 13 ή 24). Διάβασε το ΦΠΑ ΚΑΘΕ γραμμής ξεχωριστά.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ ΤΟΥ ΤΙΜΟΛΟΓΙΟΥ:
- "supplier": η επωνυμία του ΕΚΔΟΤΗ (η εταιρία που εκδίδει — όχι ο πελάτης).
- "date": η ημερομηνία έκδοσης.
- "number": ο αριθμός παραστατικού.
- "extraCharges": ποσό επιβάρυνσης εκτός ΦΠΑ (π.χ. "ΦΟΡΟΣ ΚΑΦΕ", "ΕΠΙΒΑΡΥΝΣΕΙΣ"). Αν δεν υπάρχει, 0.
- "extraChargesLabel": περιγραφή της επιβάρυνσης.
- "footerDiscountPct": έκπτωση που εφαρμόζεται σε ΟΛΟ το τιμολόγιο (π.χ. "ΜΕΤΡΗΤΟΙΣ 3%"). Αν δεν υπάρχει, 0.

ΣΗΜΑΝΤΙΚΟ:
- Οι αριθμοί χρησιμοποιούν κόμμα ως δεκαδικό (15,26 → 15.26). Επέστρεψε όλους τους αριθμούς με τελεία.
- Αγνόησε γραμμές συνόλων, τίτλων ή κενές.
- Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown, χωρίς σχόλια.

Δομή:
{"supplier":"","date":"","number":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","lines":[{"name":"","qty":0,"netUnit":0,"discountPct":0,"vat":0}]}`;

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
