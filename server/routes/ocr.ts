import type { Express } from 'express';
import fs from 'fs';
import { ValidationError, assertSafeOutboundUrl } from '../security.js';
import { authenticateToken, requireSession, aiLimiter, enforceAiLimits, ocrUpload, removeTempFile } from '../middleware.js';

/**
 * Optional cloud OCR (bring-your-own AI provider). The provider key is stored encrypted in the user's vault, so the
 * browser sends it with each request; the server uses it for that single call and never stores or logs it. The receipt
 * image is held in the OS temp directory only while the request runs. This is the one place where plaintext leaves the
 * device, and only if the user chose a cloud provider — on-device OCR (Tesseract) never contacts the server.
 */
const aiFromRequest = (req: any) => ({
  ai_api_key: typeof req.body?.ai_api_key === 'string' ? req.body.ai_api_key.slice(0, 500) : '',
  ai_base_url: typeof req.body?.ai_base_url === 'string' ? req.body.ai_base_url : '',
  ai_model: typeof req.body?.ai_model === 'string' ? req.body.ai_model.slice(0, 100) : 'gpt-4o-mini',
});

export function registerOcrRoutes(app: Express) {
  // AI OCR
  app.post('/api/ocr', authenticateToken, requireSession, aiLimiter, enforceAiLimits, ocrUpload.single('receipt'), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No receipt image uploaded' });

    const user = aiFromRequest(req);
    if (!user || !user.ai_api_key) { removeTempFile(req.file.path); return res.status(400).json({ error: 'AI settings not configured. Please add your API key in Settings.' }); }

    const filePath = req.file.path;
    const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
    const mimeType = req.file.mimetype;

    try {
      const aiBase = await assertSafeOutboundUrl(user.ai_base_url);
      const response = await fetch(`${aiBase}/chat/completions`, {
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.ai_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: user.ai_model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert OCR and data extraction assistant. Analyze the receipt or invoice image to extract the purchased items and final cost.\n\nRULES:\n1. FIND THE TOTAL: Look for the literal text "Grand Total", "Total", or "Amount Due". Use the value next to it. DO NOT perform any of your own math or calculations.\n2. DESCRIPTION: Extract the names of the main items. Ignore delivery notes, shipping status, or logos.\n3. DATE: Find the transaction date and return it in YYYY-MM-DD format. If not found, do not include the field.\n4. FORMAT: Return ONLY a pure JSON object.\n\nEXAMPLE OUTPUT:\n{\n  "amount": 25.04,\n  "description": "Mazda Gasket and Silicone Sealant",\n  "date": "2023-10-24"\n}'
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract amount and description from this receipt.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        console.error('AI service error', response.status, (await response.text()).slice(0, 500));
        return res.status(502).json({ error: 'The AI provider returned an error.' });
      }

      const data = await response.json() as any;
      const content = data.choices[0].message.content;
      
      let result = { amount: 0, description: '' };
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const resultText = jsonMatch ? jsonMatch[0] : content;
        result = JSON.parse(resultText);
        
        // If the model gave JSON but put junk in the description, filter it
        const descLower = result.description?.toLowerCase() || '';
        if (descLower.includes('package was left') || descLower.includes('delivered')) {
           throw new Error("Junk description detected, falling back to manual parsing");
        }
      } catch (parseErr) {
        // Fallback parsing for transcribing models
        const amountMatch = content.match(/(?:Amount|Total|Cost|Grand Total)[\s:]*\$?([\d,]+(\.\d+)?)/i);
        if (amountMatch) {
          result.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        } else {
          // Aggressive fallback: find largest dollar amount in output
          const matches = [...content.matchAll(/\$([\d,]+(\.\d+)?)/g)];
          if (matches.length > 0) {
              const amounts = matches.map(m => parseFloat(m[1].replace(/,/g, '')));
              result.amount = Math.max(...amounts);
          }
        }
        
        let descLines = [];
        const descMatch = content.match(/(?:Description|Item|Product|Summary)[\s:]*([\s\S]+)/i);
        if (descMatch) {
           descLines = descMatch[1].split('\n').map((l: string) => l.trim()).filter(Boolean);
        } else {
           descLines = content.trim().split('\n').map((l: string) => l.trim()).filter(Boolean);
        }
        
        // Filter out common transcription junk from receipts like Amazon
        const isJunk = (line: string) => {
           const lower = line.toLowerCase();
           return lower.includes('package was left') || 
                  lower.includes('delivered') || 
                  lower.includes('order summary') || 
                  lower.includes('ship to') || 
                  lower.includes('payment method') || 
                  lower.includes('sold by') || 
                  lower.includes('return or replace') || 
                  lower.includes('amount') || 
                  lower.includes('total') || 
                  /^\$[\d.]+$/.test(lower) || 
                  lower.length < 4;
        };
        
        const validLines = descLines.filter(l => !isJunk(l));
        result.description = validLines[0];
        
        if (validLines.length > 1 && !validLines[0]?.toLowerCase().includes('items')) {
           result.description += ' (and other items)';
        }
        
        if (!result.description) {
           result.description = 'Unknown Item';
        }
      }

      // Optionally delete the temporary file after OCR processing
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}

      res.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      console.error('OCR error:', err);
      res.status(500).json({ error: 'Server error during OCR' });
    } finally {
      removeTempFile(filePath);
    }
  });


  // OCR scanner for W-2 forms
  app.post('/api/taxes/w2/ocr', authenticateToken, requireSession, aiLimiter, enforceAiLimits, ocrUpload.single('w2'), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No W-2 document uploaded' });

    const user = aiFromRequest(req);
    if (!user || !user.ai_api_key) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Cloud AI not configured. Please add your API key in Settings or use on-device scanning.' });
    }

    const filePath = req.file.path;
    const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
    const mimeType = req.file.mimetype;

    try {
      const aiBase = await assertSafeOutboundUrl(user.ai_base_url);
      const response = await fetch(`${aiBase}/chat/completions`, {
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.ai_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: user.ai_model,
          messages: [
            {
              role: 'system',
              content: `You are an expert tax form OCR system. Analyze the provided IRS Form W-2 image and extract the numerical values and employer details.
  Return ONLY a valid JSON object matching this schema:
  {
    "employer_name": string,
    "employer_ein": string,
    "wages_box1": number,
    "fed_withholding_box2": number,
    "ss_wages_box3": number,
    "ss_withholding_box4": number,
    "medicare_wages_box5": number,
    "medicare_withholding_box6": number,
    "state_code": string,
    "state_wages_box16": number,
    "state_withholding_box17": number
  }
  RULES:
  1. All box fields should be numbers with up to 2 decimal places (do not include dollar signs or commas).
  2. If a box is empty or missing, set its number to 0.
  3. Clean employer name of IRS labels.`
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract W-2 form data from this image.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
              ]
            }
          ]
        })
      });

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      if (!response.ok) {
        console.error('AI vision service error', response.status, (await response.text()).slice(0, 500));
        return res.status(502).json({ error: 'The AI provider returned an error.' });
      }

      const data = await response.json() as any;
      const content = data.choices[0].message.content;

      let parsed = {
        employer_name: '',
        employer_ein: '',
        wages_box1: 0,
        fed_withholding_box2: 0,
        ss_wages_box3: 0,
        ss_withholding_box4: 0,
        medicare_wages_box5: 0,
        medicare_withholding_box6: 0,
        state_code: '',
        state_wages_box16: 0,
        state_withholding_box17: 0
      };

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Regex fallback
        const box1Match = content.match(/box\s*1[^0-9]*([0-9,]+\.[0-9]{2})/i);
        if (box1Match) parsed.wages_box1 = parseFloat(box1Match[1].replace(/,/g, ''));
      }

      res.json({ success: true, parsed });
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      console.error('W-2 OCR error:', err);
      res.status(500).json({ error: 'Failed to process W-2 OCR' });
    } finally {
      removeTempFile(filePath);
    }
  });


}
