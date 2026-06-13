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
        const PROMPT = `Είσαι ειδικός λογιστής που διαβάζει ελληνικά τιμολόγια χονδρικής. Διάβασε το τιμολόγιο πολύ προσεκτικά. Κάθε εταιρία έχει διαφορετική δομή στηλών — προσάρμοσε την ανάγνωση.

ΓΕΝΙΚΟΣ ΚΑΝΟΝΑΣ ΕΠΑΛΗΘΕΥΣΗΣ: Για κάθε γραμμή, οι αριθμοί πρέπει να βγάζουν νόημα:
ποσότητα × τιμή_μονάδας × (1 - συνολική_έκπτωση) = αξία_γραμμής (η στήλη ΑΞΙΑ)
Χρησιμοποίησε αυτόν τον κανόνα για να ΕΠΙΛΕΞΕΙΣ τις σωστές στήλες και να ελέγξεις τα νούμερά σου.

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ ΕΙΔΟΥΣ:

1. "name": η περιγραφή του προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ / ΕΙΔΟΣ). Αγνόησε barcodes/κωδικούς.

2. "qty": η ποσότητα. ΚΡΙΣΙΜΟ: Αν υπάρχουν πολλές στήλες ποσότητας (π.χ. ΠΟΣ., ΤΕΜ., ΜΟΝ.Α, ΜΟΝ.Β), διάλεξε ΕΚΕΙΝΗ που όταν πολλαπλασιαστεί με την ΤΙΜΗ ΜΟΝΑΔΑΣ δίνει την ΑΞΙΑ της γραμμής (πριν ή μετά την έκπτωση). ΜΗΝ επιλέγεις στήλη που είναι 0. ΜΗΝ μπερδεύεις την ποσότητα με την τιμή.

3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ / ΤΙΜΗ ΜΟΝ.) ΠΡΙΝ την έκπτωση. Είναι αυτή που × qty = αξία. ΟΧΙ η αξία/σύνολο γραμμής.

4. "discountPct": το ΣΥΝΟΛΙΚΟ ποσοστό έκπτωσης της γραμμής, ΠΑΝΤΑ υπολογισμένο ΑΛΥΣΙΔΩΤΑ.
   - Μία στήλη έκπτωσης (%ΕΚ): βάλε αυτήν.
   - Πολλές στήλες (ΕΚΠ1, ΕΚΠ2 ή 1η%,2η%,3η%,4η%): συνδύασέ τες αλυσιδωτά.
     Τύπος: discountPct = 100 * (1 - (1-d1/100)*(1-d2/100)*...)
     Παράδειγμα 3 στήλες 2.20%,18%,3%: 100*(1-0.978*0.82*0.97) = 22.21
     Παράδειγμα 2 στήλες 18%,3%: 100*(1-0.82*0.97) = 20.46
     Παράδειγμα 15% και 15%: 100*(1-0.85*0.85) = 27.75
     ΠΡΟΣΟΧΗ: συμπερίλαβε ΟΛΕΣ τις μη-μηδενικές στήλες έκπτωσης, ακόμα κι αν είναι 3 ή 4.
   - Καμία έκπτωση: 0.
   ΕΠΑΛΗΘΕΥΣΕ: qty × netUnit × (1 - discountPct/100) πρέπει να ισούται με την ΑΞΙΑ της γραμμής.

5. "vat": το ποσοστό ΦΠΑ της γραμμής (στήλη ΦΠΑ%, συνήθως 6/13/24). Διάβασε κάθε γραμμή ξεχωριστά.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ:
- "supplier": επωνυμία ΕΚΔΟΤΗ (όχι του πελάτη).
- "date": ημερομηνία έκδοσης.
- "number": αριθμός παραστατικού.
- "extraCharges": ποσό επιβάρυνσης εκτός ΦΠΑ (π.χ. "ΦΟΡΟΣ ΚΑΦΕ", "ΕΠΙΒΑΡΥΝΣΕΙΣ"). Αλλιώς 0.
- "extraChargesLabel": περιγραφή επιβάρυνσης.
- "footerDiscountPct": έκπτωση σε ΟΛΟ το τιμολόγιο (π.χ. "ΜΕΤΡΗΤΟΙΣ 3%"). Αλλιώς 0.

ΣΗΜΑΝΤΙΚΟ:
- Δεκαδικό κόμμα → τελεία (15,26 → 15.26).
- Αγνόησε γραμμές συνόλων/τίτλων/κενές. ΜΗΝ συμπεριλάβεις γραμμές με ποσότητα 0.
- Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown/σχόλια.

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
