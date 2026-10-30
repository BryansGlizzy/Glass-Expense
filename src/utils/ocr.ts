import Tesseract from 'tesseract.js';

let worker: Tesseract.Worker | null = null;
let isInitializing = false;

export async function getOcrPipeline(onProgress?: (info: any) => void) {
  if (worker) return worker;

  if (isInitializing) {
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (worker) return worker;
  }

  isInitializing = true;
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      // Self-hosted assets (copied by scripts/copy-tesseract-assets.mjs): no third-party CDN, works offline.
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract/core',
      langPath: '/vendor/tesseract/lang',
      gzip: true,
      logger: m => {
        if (onProgress) {
          if (m.status === 'downloading') {
             onProgress({ status: 'downloading', file: 'English Language Data' });
          } else if (m.status === 'recognizing text') {
             onProgress({ status: 'process', progress: m.progress * 100 });
          } else {
             onProgress({ status: 'init' });
          }
        }
      }
    });
    return worker;
  } finally {
    isInitializing = false;
  }
}

export async function runLocalOcr(imageUrl: string, modelId: string, onProgress?: (info: any) => void) {
  // modelId is ignored now as we exclusively use Tesseract for local vision
  const tesseractWorker = await getOcrPipeline(onProgress);
  
  if (!tesseractWorker) throw new Error("Failed to initialize Tesseract worker.");

  const { data } = await tesseractWorker.recognize(imageUrl);
  
  // To keep compatibility with our handleAiScan logic, we wrap the output text
  // in the same generated_text object format expected.
  return { generated_text: data.text };
}

export function parseW2TextLocally(rawText: string) {
  const clean = rawText.replace(/\r/g, '\n');
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  const parsed = {
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

  // EIN regex: XX-XXXXXXX
  const einMatch = clean.match(/\b\d{2}-\d{7}\b/);
  if (einMatch) parsed.employer_ein = einMatch[0];

  // Helper to extract dollar amounts
  const extractAmountAfter = (patterns: RegExp[]): number => {
    for (const pat of patterns) {
      const match = clean.match(pat);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val)) return val;
      }
    }
    return 0;
  };

  parsed.wages_box1 = extractAmountAfter([
    /(?:box\s*1|wages[,\s]+tips[,\s]+other)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*1)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  parsed.fed_withholding_box2 = extractAmountAfter([
    /(?:box\s*2|federal\s+income\s+tax)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*2)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  parsed.ss_wages_box3 = extractAmountAfter([
    /(?:box\s*3|social\s+security\s+wages)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*3)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  parsed.ss_withholding_box4 = extractAmountAfter([
    /(?:box\s*4|social\s+security\s+tax)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*4)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  parsed.medicare_wages_box5 = extractAmountAfter([
    /(?:box\s*5|medicare\s+wages)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*5)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  parsed.medicare_withholding_box6 = extractAmountAfter([
    /(?:box\s*6|medicare\s+tax)[\s\S]{0,30}\$?([0-9,]+\.[0-9]{2})/i,
    /(?:box\s*6)[\s:]*\$?([0-9,]+\.[0-9]{2})/i
  ]);

  // Try to find Employer Name near EIN or top lines
  for (const line of lines) {
    if (line.length > 3 && !/w-2|wage|tax statement|department|treasury|internal revenue|omb no/i.test(line)) {
      if (!/^\d/.test(line) && !line.includes('$')) {
        parsed.employer_name = line;
        break;
      }
    }
  }

  // State code regex (e.g. TX, CA, NY)
  const stateMatch = clean.match(/\b([A-Z]{2})\b\s+\$?[0-9,]+\.[0-9]{2}/);
  if (stateMatch) {
    parsed.state_code = stateMatch[1];
  }

  return parsed;
}
