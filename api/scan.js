export default async function handler(req, res) {
    // 1. Ελαφρύς φραγμός ασφαλείας μέσω token στο URL (Ενότητα 11)
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

        // Το έτοιμο prompt εξαγωγής από την προδιαγραφή (Ενότητα 6)
        const PROMPT = `Διάβασε αυτό το ελληνικό τιμολόγιο χονδρικής και εξήγαγε τα στοιχεία του.
Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown, χωρίς σχόλια, με αυτή τη δομή:
{"supplier":"","date": "", "number": "", "footerDiscountPct": 0, "extraCharges": 0, "extraChargesLabel":"","lines": [{"name":"","qty":0,"netUnit":0,"vat":0,"discountPct":0}]}

Κανόνες:
- netUnit = καθαρή τιμή ΜΟΝΑΔΑΣ ΜΕΤΑ τις εκπτώσεις γραμμής, ΧΩΡΙΣ ΦΠΑ. Αν η ΚΑΘ.ΑΞΙΑ γραμμής είναι π.χ. 73.25 για 6 τεμάχια, τότε netUnit = 12.21. Σε ευρώ με τελεία.
- vat = συντελεστής ΦΠΑ της γραμμής: 24, 13, 6 ή 0.
- discountPct = ποσοστό έκπτωσης γραμμής (μόνο πληροφοριακά), 0 αν καμία.
- footerDiscountPct = συνολική έκπτωση τζίρου/πληρωμής, 0 αν καμία.
- extraCharges = ΑΘΡΟΙΣΜΑ τυχόν επιβαρύνσεων/φόρων ΕΚΤΟΣ ΦΠΑ, σε ευρώ (π.χ. "ΕΠΙΒΑΡ. - ΦΟΡΟΣ ΚΑΦΕ", "ΕΙΣΦΟΡΑ ΑΝΑΚΥΚΛΩΣΗΣ", "ΕΠΙΒΑΡΥΝΣΗ"). 0 αν δεν υπάρχουν.
- extraChargesLabel = σύντομη περιγραφή (π.χ. "φόρος καφέ"), αν καμία.

ΑΓΝΟΗΣΕ τελείως: ΠΡΟΗΓ. ΥΠΟΛΟΙΠΟ, ΝΕΟ ΥΠΟΛΟΙΠΟ, υπόλοιπα λογαριασμού καθώς δεν είναι κόστος αυτού του τιμολογίου.
Αν κάτι δεν φαίνεται, βάλε την καλύτερη εκτίμηση. Χωρίς σύμβολα νομίσματος.
Αν η εικόνα ΔΕΝ είναι τιμολόγιο, επέστρεψε ακριβώς αυτό: {"error":"not_invoice"}`;

        // Κλήση στο Anthropic API με το μοντέλο Claude 3.5 Sonnet (Ενότητα 5)
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY, // Διαβάζεται από τις ρυθμίσεις του Vercel
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet-20241022", // Χρήση του τρέχοντος σταθερού Sonnet μοντέλου
                max_tokens: 4096,
                system: "Είσαι σύστημα εξαγωγής δεδομένων από ελληνικά τιμολόγια. Απαντάς μόνο με έγκυρο JSON.",
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mediaType || "image/jpeg",
                                data: imageBase64
                            }
                        },
                        {
                            type: "text",
                            text: PROMPT
                        }
                    ]
                }]
            })
        });

        const data = await response.json();
        
        if (!data.content || data.content.length === 0) {
            throw new Error("Empty response from Anthropic");
        }

        // Καθαρισμός του raw text από τυχόν Markdown backticks που μπορεί να επιστρέψει το LLM
        let raw = data.content.filter(b => b.type === "text").map(b => b.text).join("");
        raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        if (s >= 0 && e >= 0) {
            raw = raw.slice(s, e + 1);
        }

        // Επιστροφή των καθαρών δεδομένων JSON πίσω στο κινητό
        return res.status(200).json(JSON.parse(raw));

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "read_failed" });
    }
}
