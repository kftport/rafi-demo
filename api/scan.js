import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
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

        const PROMPT = `Διάβασε αυτό το ελληνικό τιμολόγιο χονδρικής και εξήγαγε τα στοιχεία του.
Επέστρεψε ΜΟΝΟ έγκυρο JSON, χωρίς markdown, χωρίς σχόλια, με αυτή τη δομή:
{"supplier":"","date": "", "number": "", "footerDiscountPct": 0, "extraCharges": 0, "extraChargesLabel":"","lines": [{"name":"","qty":0,"netUnit":0,"vat":0,"discountPct":0}]}
Αν η εικόνα ΔΕΝ είναι τιμολόγιο: {"error":"not_invoice"}`;

        const msg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4096,
            system: "Είσαι σύστημα εξαγωγής δεδομένων από ελληνικά τιμολόγια. Απαντάς μόνο με έγκυρο JSON.",
            messages: [{
                role: "user",
                content: [
                    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
                    { type: "text", text: PROMPT }
                ]
            }]
        });

        let raw = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
        raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        if (s >= 0 && e >= 0) raw = raw.slice(s, e + 1);

        return res.status(200).json(JSON.parse(raw));

    } catch (err) {
        console.error("Anthropic SDK Error:", err);
        return res.status(200).json({ error: "anthropic_error", details: err.message });
    }
}
