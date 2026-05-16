/* global Tesseract */
importScripts("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");

const PLATFORM_PATTERNS = [
  { value: "Uber Eats", pattern: /\buber\s*eats\b/i },
  { value: "Uber", pattern: /\buber\b/i },
  { value: "DoorDash", pattern: /\bdoor\s*dash\b|\bdasher\b/i },
  { value: "Grubhub", pattern: /\bgrub\s*hub\b|\bgrubhub\b/i },
  { value: "Instacart", pattern: /\binsta\s*cart\b|\binstacart\b/i },
  { value: "GoPuff", pattern: /\bgo\s*puff\b|\bgopuff\b/i },
  { value: "Amazon Flex", pattern: /\bamazon\s*flex\b|\bamazon\b/i },
  { value: "Walmart Spark", pattern: /\bwalmart\s*spark\b|\bspark\b/i },
  { value: "Vcho Driver", pattern: /\bvcho\b|\bveho\b/i }
];

self.onmessage = async (event) => {
  const { type, image, requestId } = event.data || {};
  if (type !== "recognize" || !image) return;

  try {
    const result = await Tesseract.recognize(image, "eng", {
      logger: (progress) => {
        self.postMessage({
          type: "progress",
          requestId,
          progress: normalizeProgress(progress)
        });
      }
    });

    const text = result?.data?.text || "";
    self.postMessage({
      type: "result",
      requestId,
      text,
      parsed: parseGigOfferText(text)
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      message: error?.message || "OCR failed."
    });
  }
};

function normalizeProgress(progress) {
  return {
    status: progress?.status || "processing",
    progress: Number.isFinite(progress?.progress) ? progress.progress : 0
  };
}

function parseGigOfferText(text) {
  const normalized = normalizeText(text);
  const amounts = extractDollarAmounts(normalized);
  const mileage = extractMileage(normalized);
  const platform = extractPlatform(normalized);

  return {
    platform,
    grossAmount: chooseOfferAmount(amounts),
    miles: mileage,
    confidence: calculateConfidence({ amounts, mileage, platform }),
    rawAmounts: amounts
  };
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[|]/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractDollarAmounts(text) {
  const matches = [...text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)];

  return matches
    .map((match) => {
      const whole = match[1].replaceAll(",", "");
      const cents = (match[2] || "00").padEnd(2, "0").slice(0, 2);
      return Number(`${whole}.${cents}`);
    })
    .filter((amount) => Number.isFinite(amount) && amount > 0 && amount < 1000);
}

function chooseOfferAmount(amounts) {
  if (!amounts.length) return null;

  const realisticGigAmounts = amounts.filter((amount) => amount >= 2 && amount <= 250);
  const candidates = realisticGigAmounts.length ? realisticGigAmounts : amounts;
  return Math.max(...candidates);
}

function extractMileage(text) {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i,
    /\b(?:distance|trip|total)\D{0,16}(\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = Number(match?.[1]);
    if (Number.isFinite(value) && value >= 0 && value < 1000) {
      return value;
    }
  }

  return null;
}

function extractPlatform(text) {
  const match = PLATFORM_PATTERNS.find((platform) => platform.pattern.test(text));
  return match?.value || null;
}

function calculateConfidence({ amounts, mileage, platform }) {
  let score = 0;
  if (amounts.length) score += 0.45;
  if (Number.isFinite(mileage)) score += 0.35;
  if (platform) score += 0.2;
  return Math.min(1, score);
}
