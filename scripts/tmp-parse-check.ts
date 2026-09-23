import { parseReviewText } from "../src/domain/review/parse";

const lines = parseReviewText("显卡  某卡 12,999\n电源  某电源 ¥1,299.5");
for (const l of lines) {
  console.log(JSON.stringify({ cat: l.category, name: l.name, price: l.priceCents, skipped: l.skipped, reason: l.skipReason }));
}
