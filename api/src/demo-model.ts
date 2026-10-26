import type { z } from "zod";
import { ModelError, type ModelClient } from "./model.ts";

// A stand-in for a language model, so River Bend's AI features work without an API key.
// It is NOT AI: it reads the same prompts a model would, and answers with simple, fixed rules.
// It understands numbers, dollar amounts, and a few phrases, and nothing else. That makes it
// free, fast, and predictable, and also shows exactly what a real model would add.
export class DemoModel implements ModelClient {
  name = "demo rules (not AI)";

  async generateJson<T>({ system, prompt, schema }: { system: string; prompt: string; schema: z.ZodType<T> }) {
    const description = prompt.match(/<event_description>\n([\s\S]*)\n<\/event_description>/)?.[1];
    if (description === undefined) throw new ModelError("The demo model only knows how to plan catering orders");
    return schema.parse(planFromRules(description, menuFromPrompt(system)));
  }

  async generateText({ prompt }: { system: string; prompt: string }) {
    // For FAQ questions: answer with the best-matching entry, word for word.
    const entry = prompt.match(/<entry id="(\d+)">\nQ: [^\n]*\nA: ([^\n]*)/);
    if (!entry) throw new ModelError("The demo model only knows how to answer from FAQ entries");
    return `${entry[2]}\nSources: ${entry[1]}`;
  }
}

type DemoMenuItem = { id: number; name: string; category: string; priceCents: number };

// Reads lines like "- id 4: Burgoo (quart) (side), $9.99" back out of the planner's prompt.
function menuFromPrompt(system: string): DemoMenuItem[] {
  return [...system.matchAll(/^- id (\d+): (.+) \((\w+)\), \$(\d+)\.(\d\d)$/gm)].map((m) => ({
    id: Number(m[1]),
    name: m[2],
    category: m[3],
    priceCents: Number(m[4]) * 100 + Number(m[5]),
  }));
}

function planFromRules(description: string, menu: DemoMenuItem[]) {
  const text = description.toLowerCase();
  const notes: string[] = [];

  // Headcount: numbers just before words like "people", "adults", or "kids", added together.
  const counts = [...text.matchAll(/(\d+)\s+(?:\w+\s+)?(people|adults?|kids|children|guests|coworkers|folks|ppl)/g)];
  const kids = counts.filter((m) => /kid|child/.test(m[2])).reduce((sum, m) => sum + Number(m[1]), 0);
  const adults = counts.filter((m) => !/kid|child/.test(m[2])).reduce((sum, m) => sum + Number(m[1]), 0);
  const headcount = adults + kids > 0 ? adults + kids : null;
  const people = headcount ?? 20;
  if (headcount === null) notes.push("You didn't say how many people, so this assumes about 20.");

  const budgetMatch = text.match(/\$\s?(\d[\d,]*)/);
  const budgetCents = budgetMatch ? Number(budgetMatch[1].replaceAll(",", "")) * 100 : null;

  const noPork = /no pork|don'?t eat pork|without pork/.test(text);
  const allowed = menu.filter((m) => !(noPork && /pork/i.test(m.name)));
  if (noPork) notes.push("Left out items with pork in the name.");

  // House portion guidance, from the prompt: 1/3 lb per adult, 1/4 lb per child, a quart of a
  // side per 6, a pan of pudding per 12, a gallon of tea per 10.
  const meatPounds = Math.ceil(adults * (1 / 3) + kids * 0.25 || people / 3);
  const meats = allowed.filter((m) => m.category === "meat").slice(0, people >= 20 ? 2 : 1);
  const sides = allowed.filter((m) => m.category === "side").slice(0, 2);
  const items: { menuItemId: number; quantity: number; reason: string }[] = [];
  meats.forEach((m) => {
    items.push({ menuItemId: m.id, quantity: Math.ceil(meatPounds / meats.length), reason: `About 1/3 lb of meat per adult, shared across ${meats.length} meat${meats.length > 1 ? "s" : ""}.` });
  });
  for (const s of sides) items.push({ menuItemId: s.id, quantity: Math.max(1, Math.ceil(people / 12)), reason: "Two sides, a quart per 6 people between them." });
  const dessert = allowed.find((m) => m.category === "dessert");
  if (dessert && people >= 12) items.push({ menuItemId: dessert.id, quantity: Math.ceil(people / 12), reason: "A pan feeds about 12." });
  const drink = allowed.find((m) => m.category === "drink");
  if (drink) items.push({ menuItemId: drink.id, quantity: Math.ceil(people / 10), reason: "A gallon serves about 10." });

  // Over budget: drop drinks, then dessert. The rules can't do anything cleverer than that.
  const price = (id: number) => menu.find((m) => m.id === id)!.priceCents;
  const total = () => items.reduce((sum, i) => sum + i.quantity * price(i.menuItemId), 0);
  for (const category of ["drink", "dessert"]) {
    if (budgetCents === null || total() <= budgetCents) break;
    const index = items.findIndex((i) => menu.find((m) => m.id === i.menuItemId)!.category === category);
    if (index >= 0) {
      items.splice(index, 1);
      notes.push(`Removed the ${category} to get closer to your budget.`);
    }
  }
  if (budgetCents !== null && total() > budgetCents) notes.push("This is still over your budget; please call us to talk options.");

  return { headcount, items, notes: notes.join(" ") };
}
