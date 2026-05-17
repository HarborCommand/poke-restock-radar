import type { Probability, Rating, StorePredictionDTO, StoreVisitResult } from "@/types/radar";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const confirmedRestockResults = new Set<StoreVisitResult>(["stock_seen", "bought_product"]);
const positiveVisitResults = new Set<StoreVisitResult>(["stock_seen", "bought_product", "vendor_spotted"]);

export function currency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(2));
}

export function calculateCardProfit(raw: number, graded: number, feeRate: number, gradingCost: number, shippingCost = 0) {
  return currency(graded * (1 - feeRate) - raw - gradingCost - shippingCost) ?? 0;
}

export function calculateMaxRawBuyPrice(graded: number, feeRate: number, gradingCost: number, shippingCost = 0, targetProfit = 0) {
  return currency(graded * (1 - feeRate) - gradingCost - shippingCost - targetProfit) ?? 0;
}

export function rateCard(psa9Profit: number, psa10Profit: number, minimumProfitTarget = 8): Rating {
  if (psa9Profit >= minimumProfitTarget && psa10Profit >= Math.max(35, minimumProfitTarget * 2)) return "BUY";
  if (psa10Profit > minimumProfitTarget || psa9Profit > 0) return "WATCH";
  return "AVOID";
}

export function daysBetween(from: Date, to: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((end - start) / msPerDay);
}

export function daysUntil(date: Date, now = new Date()) {
  return daysBetween(now, date);
}

function parseRestockDays(value: string) {
  const normalized = new Map(dayNames.map((day) => [day.toLowerCase(), day]));
  return value
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean)
    .map((day) => normalized.get(day.toLowerCase()) ?? day)
    .filter((day, index, days) => days.indexOf(day) === index);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function topEntries(values: string[], limit = 2) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function timeWindowFor(date: Date) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 9) return "6:00 AM - 9:00 AM";
  if (hour >= 9 && hour < 12) return "9:00 AM - 12:00 PM";
  if (hour >= 12 && hour < 15) return "12:00 PM - 3:00 PM";
  if (hour >= 15 && hour < 18) return "3:00 PM - 6:00 PM";
  if (hour >= 18 && hour < 21) return "6:00 PM - 9:00 PM";
  return "Off-hours";
}

function nextTrackedDay(days: string[], now: Date) {
  if (!days.length) return null;
  const todayIndex = now.getDay();
  let best: { day: string; distance: number } | null = null;
  for (const day of days) {
    const index = dayNames.findIndex((name) => name.toLowerCase() === day.toLowerCase());
    if (index < 0) continue;
    const distance = (index - todayIndex + 7) % 7;
    if (!best || distance < best.distance) best = { day, distance };
  }
  return best;
}

function averageRestockInterval(restockDates: Date[]) {
  if (restockDates.length < 2) return null;
  const gaps: number[] = [];
  for (let index = 1; index < restockDates.length; index += 1) {
    const gap = daysBetween(restockDates[index - 1], restockDates[index]);
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return null;
  return Number((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(1));
}

function calculateOverdueScore(daysSinceLastConfirmedRestock: number | null, averageRestockIntervalDays: number | null) {
  if (daysSinceLastConfirmedRestock === null) return 0;
  if (!averageRestockIntervalDays) return daysSinceLastConfirmedRestock >= 7 ? 8 : 0;
  const ratio = daysSinceLastConfirmedRestock / averageRestockIntervalDays;
  if (ratio >= 1.6) return 25;
  if (ratio >= 1.25) return 18;
  if (ratio >= 0.9) return 10;
  return 0;
}

export function predictStoreRestock(input: {
  typicalRestockDays: string;
  typicalRestockTimeWindow: string;
  confidenceScore: number;
  sightings: Array<{ seenAt: Date; resultType?: StoreVisitResult | string | null }>;
  now?: Date;
}): StorePredictionDTO {
  const now = input.now ?? new Date();
  const restockDays = parseRestockDays(input.typicalRestockDays);
  const today = dayNames[now.getDay()];
  const tomorrow = dayNames[(now.getDay() + 1) % 7];
  const isToday = restockDays.includes(today);
  const isTomorrow = restockDays.includes(tomorrow);
  const normalizedSightings = input.sightings.map((sighting) => ({
    seenAt: sighting.seenAt,
    resultType: (sighting.resultType || "stock_seen") as StoreVisitResult
  }));
  const confirmedSightings = normalizedSightings
    .filter((sighting) => confirmedRestockResults.has(sighting.resultType))
    .sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime());
  const uniqueRestockDays = new Map<string, Date>();
  for (const sighting of confirmedSightings) {
    uniqueRestockDays.set(dateKey(sighting.seenAt), sighting.seenAt);
  }
  const restockDates = [...uniqueRestockDays.values()].sort((a, b) => a.getTime() - b.getTime());
  const lastConfirmed = restockDates.at(-1) ?? null;
  const daysSinceLastConfirmedRestock = lastConfirmed ? Math.max(0, daysBetween(lastConfirmed, now)) : null;
  const averageRestockIntervalDays = averageRestockInterval(restockDates);
  const mostCommonRestockDayEntries = topEntries(confirmedSightings.map((sighting) => dayNames[sighting.seenAt.getDay()]));
  const mostCommonRestockWindowEntries = topEntries(confirmedSightings.map((sighting) => timeWindowFor(sighting.seenAt)));
  const mostCommonRestockDays = mostCommonRestockDayEntries.map((entry) => entry.value);
  const mostCommonRestockTimeWindows = mostCommonRestockWindowEntries.map((entry) => entry.value);
  const observedToday = mostCommonRestockDays.includes(today);
  const topObservedDay = mostCommonRestockDayEntries[0];
  const topObservedWindow = mostCommonRestockWindowEntries[0];
  const recentVisit = normalizedSightings.sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())[0] ?? null;
  const recentVisitAge = recentVisit ? daysBetween(recentVisit.seenAt, now) : null;
  const recentPositiveVisit =
    recentVisit && recentVisitAge !== null && recentVisitAge <= 1 && positiveVisitResults.has(recentVisit.resultType);
  const recentEmptyShelf =
    recentVisit && recentVisitAge !== null && recentVisitAge <= 1 && recentVisit.resultType === "empty_shelf";
  const overdueScore = calculateOverdueScore(daysSinceLastConfirmedRestock, averageRestockIntervalDays);

  let score = input.confidenceScore;
  const reasons: string[] = [];

  if (isToday) {
    score += 18;
    reasons.push(`${today} is a tracked restock day`);
  } else if (observedToday) {
    score += 12;
    reasons.push(`${today} is a common historical restock day`);
  } else if (isTomorrow) {
    score += 6;
    reasons.push(`${tomorrow} is the next tracked restock day`);
  } else {
    score -= 8;
    reasons.push("today is not a normal restock day");
  }

  if (topObservedDay && topObservedWindow && topObservedDay.count >= 3) {
    score += 12;
    reasons.push(
      `this store restocked ${topObservedDay.count} recent times on ${topObservedDay.value}s around ${topObservedWindow.value}`
    );
  } else if (confirmedSightings.length >= 2) {
    score += Math.min(8, confirmedSightings.length * 2);
    reasons.push(`${confirmedSightings.length} confirmed restock sightings are in history`);
  }

  if (daysSinceLastConfirmedRestock === null) {
    score -= 8;
    reasons.push("no confirmed sighting yet");
  } else if (overdueScore > 0) {
    score += overdueScore;
    reasons.push(`${daysSinceLastConfirmedRestock} days since the last confirmed sighting`);
  } else if (daysSinceLastConfirmedRestock <= 1) {
    score -= 14;
    reasons.push("a sighting was logged very recently");
  } else {
    reasons.push(`${daysSinceLastConfirmedRestock} days since the last confirmed sighting`);
  }

  if (recentEmptyShelf) {
    score -= 12;
    reasons.push("latest field result was an empty shelf");
  } else if (recentPositiveVisit && recentVisit?.resultType === "vendor_spotted") {
    score += 10;
    reasons.push("vendor was spotted recently");
  }

  const clamped = Math.max(0, Math.min(100, score));
  let probability: Probability = "LOW";
  if (clamped >= 72) probability = "HIGH";
  else if (clamped >= 48) probability = "MEDIUM";
  const nextDay = nextTrackedDay(restockDays.length ? restockDays : mostCommonRestockDays, now);
  const preferredWindow = topObservedWindow?.value === "Off-hours" ? input.typicalRestockTimeWindow : topObservedWindow?.value;
  const nextLikelyRestockWindow =
    isToday || observedToday
      ? preferredWindow || input.typicalRestockTimeWindow
      : nextDay
        ? `Next ${nextDay.day}, ${preferredWindow || input.typicalRestockTimeWindow}`
        : input.typicalRestockTimeWindow;
  const isLikelyToday = probability !== "LOW" && (isToday || observedToday || overdueScore >= 18 || Boolean(recentPositiveVisit));

  return {
    probability,
    likelyRestockWindow: nextLikelyRestockWindow,
    nextLikelyRestockWindow,
    daysSinceLastConfirmedRestock,
    averageRestockIntervalDays,
    mostCommonRestockDays,
    mostCommonRestockTimeWindows,
    overdueScore,
    confidenceScore: clamped,
    sampleSize: confirmedSightings.length,
    isLikelyToday,
    reason: reasons.join("; ")
  };
}
