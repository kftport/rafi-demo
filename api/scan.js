const https = require('https');

function getAnthropicApiKey() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
        throw new Error("ANTHROPIC_API_KEY not set in environment variables");
    }
    return key;
}

// Utility: Validate image data
function validateImageData(imageBase64) {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
        return { valid: false, error: "Image data missing or invalid" };
    }
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
    if (imageBase64.length > MAX_IMAGE_SIZE * 1.33) { // base64 adds 33% overhead
        return { valid: false, error: "Image too large (max 5MB)" };
    }
    return { valid: true };
}

// Utility: Validate token
function validateToken(token) {
    const VALID_TOKENS = (process.env.API_TOKENS || "demo123").split(',');
    return VALID_TOKENS.includes(token);
}

function deriveDiscount(qty, netUnit, lineValue) {
    const gross = qty * netUnit;
    if (gross <= 0) return { disc: 0, bad: true };
    const d = (1 - lineValue / gross) * 100;
    if (d < -0.5 || d > 100) return { disc: 0, bad: true };
    return { disc: Math.round(Math.max(0, d) * 100) / 100, bad: false };
}

function applyDiscountsToGross(gross, discounts) {
    if (!Array.isArray(discounts)) return gross;
    let result = gross;
    discounts.forEach(discount => {
        const pct = parseFloat(discount);
        if (!Number.isFinite(pct)) return;
        result *= 1 - pct / 100;
    });
    return Math.round(result * 100) / 100;
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
        hostname: 'api.anthropic.com', 
        port: 443, 
        path: '/v1/messages', 
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': getAnthropicApiKey(),
            'Anthropic-Version': '2023-06-01',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000 // ✅ Add timeout
    };
    return new Promise((resolve, reject) => {
        const r = https.request(options, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
        });
        r.on('error', reject);
        r.on('timeout', () => {
            r.destroy();
            reject(new Error("API request timeout"));
        });
        r.write(postData);
        r.end();
    });
}

function parseResponse(apiResponse) {
    let resBody;
    try {
        resBody = JSON.parse(apiResponse.body);
    } catch (e) {
        throw new Error(`Invalid JSON from API: ${e.message}`);
    }

    // ✅ Validate response structure
    if (!resBody.content || !Array.isArray(resBody.content)) {
        throw new Error("API response missing or invalid 'content' field");
    }

    const textContent = resBody.content.filter(b => b.type === "text");
    if (textContent.length === 0) {
        throw new Error("No text content in API response");
    }

    let raw = textContent.map(b => b.text).join("");
    raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error("Failed to find JSON object in Claude's response");
    }

    raw = raw.slice(firstBrace, lastBrace + 1).trim();
    
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Failed to parse Claude's JSON response: ${e.message}`);
    }

    return parsed;
}

function buildLines(parsed) {
    if (!Array.isArray(parsed.lines)) {
        console.warn("⚠️ 'lines' is not an array, defaulting to empty");
        parsed.lines = [];
    }

    return parsed.lines.map(l => {
        const qty = parseFloat(l.qty) || 0;
        const netUnit = parseFloat(l.netUnit) || 0;
        let lineValue = parseFloat(l.lineValue) || 0;
        let discounts = l.discounts;
        if (!Array.isArray(discounts) && typeof discounts === 'string') {
            try {
                discounts = JSON.parse(discounts);
            } catch (e) {
                discounts = [];
            }
        }
        if (!Array.isArray(discounts)) {
            discounts = [];
        }

        const gross = qty * netUnit;
        const expectedFromDiscounts = gross > 0 ? applyDiscountsToGross(gross, discounts) : lineValue;
        const { disc: formulaDiscount, bad: formulaBad } = deriveDiscount(qty, netUnit, lineValue);
        const { disc: discountChainDiscount } = deriveDiscount(qty, netUnit, expectedFromDiscounts);
        const discountMismatch = discounts.length > 0 && Math.abs(formulaDiscount - discountChainDiscount) > 2;
        if (discountMismatch) {
            lineValue = expectedFromDiscounts;
        }

        const { disc, bad } = deriveDiscount(qty, netUnit, lineValue);
        return {
            name: String(l.name || '').trim(),
            qty: qty,
            netUnit: netUnit,
            discountPct: disc,
            discounts: discounts,
            vat: (l.vat !== undefined && l.vat !== null && l.vat !== '') ? parseFloat(l.vat) : 24,
            lineValue: lineValue,
            productCode: String(l.productCode || ''),
            barcode: String(l.barcode || ''),
            _flags: bad ? ['mismatch'] : []
        };
    }).filter(l => l.qty > 0);
}

function checkTotals(lines, parsed) {
    const invNet = parseFloat(parsed.totalNet) || 0;
    if (invNet <= 0) return { mismatch: false, gap: 0, invNet: 0 };
    let net = 0;
    lines.forEach(l => { net += l.netUnit * l.qty * (1 - l.discountPct / 100); });
    const gap = Math.round((invNet - net) * 100) / 100;
    const mismatch = Math.abs(gap) > Math.max(0.20, 0.02 * invNet);
    return { mismatch, gap, invNet };
}

function normalizeTotalNet(parsed, lines) {
    const originalTotalNet = parseFloat(parsed.totalNet) || 0;
    const lineValuesSum = Math.round(lines.reduce((sum, l) => sum + l.lineValue, 0) * 100) / 100;
    if (lineValuesSum > 0 && originalTotalNet > lineValuesSum * 1.1) {
        console.log(`SCAN v2-discounts fallback: totalNet (${originalTotalNet}) exceeds sum(lineValue) (${lineValuesSum}) by more than 10%, replacing totalNet with line sum.`);
        parsed.totalNet = lineValuesSum;
        return lineValuesSum;
    }
    return originalTotalNet;
}

const BASE_PROMPT = `Διαβάζεις ελληνικά τιμολόγια χονδρικής. Διάβασε ΜΟΝΟ τα παρακάτω, με μέγιστη ακρίβεια. Επίστρεψε ΜΟΝΟ το JSON, χωρίς καμία εισαγωγική ή επεξηγηματική πρόταση πριν ή μετά. ΜΗΝ ασχοληθείς με τις στήλες εκπτώσεων — δεν τις χρειάζομαι.

ΕΞΑΙΡΕΤΙΚΑ ΣΗΜΑΝΤΙΚΟ (ΔΙΑΒΑΣΕ ΠΡΩΤΑ ΑΥΤΟ): Η στήλη με τίτλο "ΑΞΙΑ" ή "ΚΑΘ.ΑΞΙΑ" (η στήλη ΜΕΤΑ τις εκπτώσεις) είναι Η ΠΗΓΗ ΤΗΣ ΑΞΙΑΣ κάθε γραμμής. ΠΡΟΣΔΙΟΡΙΣΕ ΠΟΛΥ ΠΡΟΣΕΚΤΙΚΑ ΑΥΤΟΝ ΤΟΝ ΑΡΙΘΜΟ ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ — ΜΗΝ τον μαντέψεις ή μην τον υπολογίσεις αποκλειστικά από qty×netUnit.

ΑΝ ΥΠΑΡΧΟΥΝ ΔΥΟ ΣΤΗΛΕΣ ΑΞΙΑΣ σε μια γραμμή (μια πριν τις εκπτώσεις και μια τελική μέσα στο μπλοκ "ΕΚΠΤΩΣΕΙΣ" μετά τις στήλες ποσοστών έκπτωσης) διάλεξε ΠΑΝΤΑ τη ΜΙΚΡΟΤΕΡΗ / ΤΕΛΙΚΗ αξία μετά τις εκπτώσεις για το "lineValue". Αν qty × τιμή ισούται με την αξία που διάβασες αλλά στη γραμμή υπάρχουν ποσοστά έκπτωσης, τότε διάβασες λάθος στήλη — πάρε την τελική αξία.

Αν υπάρχει ορατός αριθμός στην στήλη ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ, αυτός ο αριθμός πρέπει να απαντηθεί ως "lineValue".

ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ ΠΡΟΪΟΝΤΟΣ διάβασε 6 πεδία με προτεραιότητα:
1. "name": η περιγραφή του προϊόντος (στήλη ΠΕΡΙΓΡΑΦΗ/ΕΙΔΟΣ). Αγνόησε barcodes/κωδικούς.
2. "qty": η ΠΟΣΟΤΗΤΑ σε τεμάχια. Αν υπάρχουν πολλές στήλες ποσότητας (ΠΟΣ.,ΤΕΜ.,ΜΟΝ.Α,ΜΟΝ.Β), διάλεξε ΕΚΕΙΝΗ που × ΤΙΜΗ πλησιάζει την ΑΞΙΑ. ΜΗΝ διαλέγεις στήλη με 0.
3. "netUnit": η ΤΙΜΗ ΜΟΝΑΔΑΣ (στήλη ΤΙΜΗ), με ΟΛΑ τα δεκαδικά ακριβώς (π.χ. 1.53 όχι 1.6). Τιμή ΠΡΙΝ την έκπτωση.
4. "lineValue": η ΑΞΙΑ της γραμμής ΜΕΤΑ τις εκπτώσεις (στήλη ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ). ΠΡΟΤΙΜΑ τον αριθμό ΠΟΥ ΕΜΦΑΝΙΖΕΤΑΙ ΣΤΗΝ ΣΤΗΛΗ ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ — ακόμα κι αν διαφέρει από qty×netUnit λόγω εκπτώσεων/στρογγυλοποιήσεων. Διαβάσε το πολύ προσεκτικά και επέστρεψέ το ΑΚΡΙΒΩΣ όπως εμφανίζεται.
5. "discounts": λίστα με τα ποσοστά έκπτωσης της γραμμής, με τη σειρά που εμφανίζονται στην στήλη έκπτωσης (π.χ. [2.20, 18, 3]). Αν δεν υπάρχουν εκπτώσεις, βάλε [] και όχι null.
6. "vat": το ποσοστό ΦΠΑ της γραμμής (στήλη ΦΠΑ%, συνήθως 6/13/24).
7. "productCode": ο κωδικός είδους του προμηθευτή από τη στήλη "ΚΩΔΙΚΟΣ" — αν δεν υπάρχει, βάλε "".
8. "barcode": το barcode/EAN του προϊόντος (8-13 ψηφία) — αν δεν υπάρχει, βάλε "".

ΕΠΙΠΛΕΟΝ ΕΛΕΓΧΟΣ: μετά που θα έχεις διαβάσει ΟΛΕΣ τις γραμμές, υπολόγισε το άθροισμα των "lineValue". Αυτό το άθροισμα ΠΡΕΠΕΙ να ισούται ΑΚΡΙΒΩΣ (ή μέσα σε πολύ μικρό στρογγυλοποιητικό περιθώριο) με το "totalNet" που βλέπεις στο τιμολόγιο. Αν δεν ισούται, ΕΠΑΝΑΔΙΑΒΑΣΕ ΟΛΟ ΤΟ ΤΙΜΟΛΟΓΙΟ και διόρθωσε τα "lineValue" ώστε το άθροισμα να συμφωνεί με το "totalNet". Μην επιχειρήσεις να «διορθώσεις» τις γραμμές με βάση υπολογισμούς — προτίμησε πάντα την τιμή που εμφανίζεται στην στήλη ΑΞΙΑ/ΚΑΘ.ΑΞΙΑ.

ΕΠΙΠΛΕΟΝ ΒΟΗΘΗΤΙΚΟΣ ΚΑΝΟΝΑΣ: αν qty × τιμή ισούται με την αξία που διάβασες αλλά στην ίδια γραμμή υπάρχουν ποσοστά έκπτωσης, τότε διάβασες την προ-έκπτωσης στήλη και πρέπει να διαλέξεις την τελική αξία μετά τις εκπτώσεις.

ΕΛΕΓΧΟΣ: για κάθε γραμμή, το lineValue πρέπει να είναι ≤ qty × netUnit. Αν δεις lineValue μεγαλύτερο, ξαναδιάβασε και επιβεβαίωσε την στήλη ΑΞΙΑ.

ΓΙΑ ΤΟ ΣΥΝΟΛΟ:
- "supplier": επωνυμία ΕΚΔΟΤΗ (όχι του πελάτη).
- "date": ημερομηνία έκδοσης.
- "number": αριθμός παραστατικού.
- "extraCharges": ποσό επιβάρυνσης εκτός ΦΠΑ (π.χ. ΦΟΡΟΣ ΚΑΦΕ). Αλλιώς 0.
- "extraChargesLabel": περιγραφή επιβάρυνσης.
- "footerDiscountPct": έκπτωση σε όλο το τιμολόγιο (π.χ. ΜΕΤΡΗΤΟΙΣ 3%). Αλλιώς 0.
- "totalNet": η ΣΥΝΟΛΙΚΗ ΚΑΘΑΡΗ ΑΞΙΑ προ ΦΠΑ (ΚΑΘΑΡΗ ΑΞΙΑ/ΑΞΙΑ ΜΕΤΑ ΕΚΠΤ/ΣΥΝ.ΚΑΘ.ΑΞΙΑ). Διάβασέ το πολύ προσεκτικά — χρησίμεύει για επαλήθευση.

ΣΗΜΑΝΤΙΚΟ: το "totalNet" πρέπει να είναι ΠΑΝΤΑ η ποσότητα προ ΦΠΑ, όχι το τελικό σύνολο με ΦΠΑ. Αν στο τιμολόγιο υπάρχει ξεχωριστό νούμερο "ΠΡΟ Φ.Π.Α." ή "ΚΑΘΑΡΗ ΑΞΙΑ", αυτό πρέπει να διαβαστεί ως "totalNet". Το "ΣΥΝΟΛΟ" ή "ΠΛΗΡΩΤΕΟ" που περιλαμβάνει ΦΠΑ ΔΕΝ ΠΡΕΠΕΙ να χρησιμοποιηθεί για "totalNet".

Αν το νούμερο που διάβασες για "totalNet" είναι μεγαλύτερο και μοιάζει να περιλαμβάνει ΦΠΑ, διάλεξε το μικρότερο προ-ΦΠΑ νούμερο.

ΣΗΜΑΝΤΙΚΟ:
- Δεκαδικό κόμμα → τελεία (15,26 → 15.26).
- Διάβασε και επέστρεψε ΚΑΘΕ γραμμή του τιμολογίου ΑΥΤΟΥΣΙΑ, με τη σειρά που εμφανίζεται. ΑΠΑΓΟΡΕΥΕΤΑΙ να παραλείψεις, να ενώσεις ή να αγνοήσεις γραμμή για ΟΠΟΙΟΝΔΗΠΟΤΕ λόγο.
- Αν δύο ή περισσότερες γραμμές είναι ΠΑΝΟΜΟΙΟΤΥΠΕΣ (ίδια περιγραφή, ποσότητα, τιμή, αξία), επέστρεψέ τες ΟΛΕΣ ξεχωριστά. ΜΗΝ τις θεωρήσεις διπλότυπο και ΜΗΝ τις συγχωνεύσεις — το τιμολόγιο μπορεί νόμιμα να έχει την ίδια χρέωση πολλές φορές. Η δουλειά σου είναι πιστή αντιγραφή, όχι έλεγχος ή διόρθωση.
- Το άθροισμα των αξιών (lineValue) όλων των γραμμών πρέπει να ισούται με το totalNet. Αν δεν βγαίνει, μάλλον παρέλειψες γραμμή — ξαναέλεγξε.
- Αγνόησε ΜΟΝΟ γραμμές συνόλων/τίτλων/κενές και ποσότητα 0.
- ΜΟΝΟ έγκυρο JSON, χωρίς markdown/σχόλια.

Δομή:
{"supplier":"","date":"","number":"","customerName":"","customerVat":"","customerAddress":"","customerPhone":"","footerDiscountPct":0,"extraCharges":0,"extraChargesLabel":"","totalNet":0,"lines":[{"name":"","qty":0,"netUnit":0,"lineValue":0,"discounts":[],"vat":0,"productCode":"","barcode":""}]} `;

module.exports = async (req, res) => {
    const { k } = req.query;
    
    // ✅ FIXED: Proper error codes
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "method_not_allowed", message: "Only POST allowed" });
    }

    if (!validateToken(k)) {
        return res.status(403).json({ error: "unauthorized", message: "Invalid or missing token" });
    }

    try {
        const { imageBase64, mediaType } = req.body;
        
        // ✅ Validate image
        const imgValidation = validateImageData(imageBase64);
        if (!imgValidation.valid) {
            return res.status(400).json({ error: "invalid_image", message: imgValidation.error });
        }

        // 1η ανάγνωση με Sonnet
        let apiResponse;
        try {
            apiResponse = await callClaude("claude-sonnet-4-6", BASE_PROMPT, imageBase64, mediaType);
        } catch (e) {
            return res.status(500).json({ 
                error: "anthropic_request_failed", 
                message: e.message 
            });
        }

        // ✅ FIXED: Check API status properly
        if (apiResponse.status !== 200) {
            return res.status(500).json({ 
                error: "anthropic_error", 
                message: `Anthropic API returned ${apiResponse.status}`,
                details: apiResponse.body 
            });
        }

        let parsed;
        try {
            parsed = parseResponse(apiResponse);
        } catch (e) {
            return res.status(400).json({ 
                error: "parse_error", 
                message: "Failed to parse Claude response",
                details: e.message 
            });
        }

        let lines = buildLines(parsed);
        let totalNet = normalizeTotalNet(parsed, lines);

        let problemCount = lines.filter(l => l._flags.length > 0).length;
        let totals = checkTotals(lines, parsed);

        // Αν κάτι δεν επαληθεύεται ή το άθροισμα δεν κλείνει -> Opus
        if (problemCount > 0 || totals.mismatch) {
            try {
                const retryPrompt = BASE_PROMPT + "\n\nΠΡΟΣΟΧΗ: ΣΤΗΝ ΠΡΟΗΓΟΥΜΕΝΗ ΑΝΑΓΝΩΣΗ ΤΟ ΑΘΡΟΙΣΜΑ ΤΩΝ `lineValue` ΔΕΝ ΣΥΜΦΩΝΟΥΣΕ ΜΕ ΤΟ `totalNet`. ΠΡΟΣΟΧΗ: ΠΡΟΤΙΜΗΣΕ ΠΑΝΤΑ ΤΟΝ ΟΡΘΟ ΑΡΙΘΜΟ ΠΟΥ ΕΜΦΑΝΙΖΕΤΑΙ ΣΤΗΝ ΣΤΗΛΗ 'ΑΞΙΑ'/'ΚΑΘ.ΑΞΙΑ' ΓΙΑ ΚΑΘΕ ΓΡΑΜΜΗ. ΞΑΝΑΔΙΑΒΑΣΕ ΟΛΟ ΤΟ ΤΙΜΟΛΟΓΙΟ ΚΑΙ ΕΠΙΒΕΒΑΙΩΣΕ ΟΤΙ ΤΟ ΑΘΡΟΙΣΜΑ ΤΩΝ `lineValue` ΙΣΟΥΤΑΙ ΜΕ ΤΟ `totalNet`. ΕΠΙΣΗΣ: ΜΗΝ ΣΥΓΧΩΝΕΥΕΙΣ ΠΑΝΟΜΟΙΟΤΥΠΕΣ ΓΡΑΜΜΕΣ — ΕΠΙΣΤΡΕΨΕ ΤΙΣ ΟΛΕΣ ΞΕΧΩΡΙΣΤΑ.";
                const retry = await callClaude("claude-opus-4-8", retryPrompt, imageBase64, mediaType);
                if (retry.status === 200) {
                    try {
                        const reparsed = parseResponse(retry);
                        const relines = buildLines(reparsed);
                        const reTotals = checkTotals(relines, reparsed);
                        const reproblems = relines.filter(l => l._flags.length > 0).length;
                        const betterTotals = Math.abs(reTotals.gap) < Math.abs(totals.gap);
                        if (betterTotals || relines.length > lines.length || reproblems < problemCount) {
                            parsed = reparsed;
                            lines = relines;
                            totalNet = normalizeTotalNet(parsed, lines);
                            problemCount = reproblems;
                            totals = reTotals;
                        }
                    } catch (e) {
                        console.warn("⚠️ Retry parsing failed, keeping first result:", e.message);
                    }
                }
            } catch (e) {
                console.warn("⚠️ Retry with Opus failed, keeping first result:", e.message);
            }
        }

        // ✅ FIXED: Return proper 200 only on success
        return res.status(200).json({
            supplier: parsed.supplier || '',
            customerName: parsed.customerName || '',
            customerVat: parsed.customerVat || '',
            customerAddress: parsed.customerAddress || '',
            customerPhone: parsed.customerPhone || '',
            date: parsed.date || '',
            number: parsed.number || '',
            footerDiscountPct: parseFloat(parsed.footerDiscountPct) || 0,
            extraCharges: parseFloat(parsed.extraCharges) || 0,
            extraChargesLabel: parsed.extraChargesLabel || '',
            totalNet: totalNet,
            totalsGap: totals.mismatch ? totals.gap : 0,
            lines: lines
        });

    } catch (err) {
        // ✅ FIXED: Return 500, not 200
        return res.status(500).json({ 
            error: "internal_server_error", 
            message: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
};
