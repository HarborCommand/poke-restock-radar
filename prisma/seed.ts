import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function profit(raw: number, graded: number, feeRate: number, gradingCost: number) {
  return Number((graded * (1 - feeRate) - raw - gradingCost).toFixed(2));
}

function maxRawBuy(graded: number, feeRate: number, gradingCost: number) {
  return Number((graded * (1 - feeRate) - gradingCost).toFixed(2));
}

function previousWeekday(dayIndex: number, weeksAgo: number, hour: number, minute: number) {
  const date = new Date();
  const distance = (date.getDay() - dayIndex + 7) % 7;
  date.setDate(date.getDate() - distance - weeksAgo * 7);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@poke.local").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "radar-admin";
  const adminPasswordHash =
    process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_HASH.length > 0
      ? process.env.ADMIN_PASSWORD_HASH
      : await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: "Radar Admin", role: "ADMIN", passwordHash: adminPasswordHash },
    create: {
      email: adminEmail,
      name: "Radar Admin",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
      notificationSettings: {
        create: {
          inApp: true,
          email: false,
          sms: false,
          browserPush: false,
          emailTo: adminEmail
        }
      }
    }
  });

  await prisma.user.upsert({
    where: { email: "friend@poke.local" },
    update: { name: "Trusted Friend", role: "FRIEND" },
    create: {
      email: "friend@poke.local",
      name: "Trusted Friend",
      role: "FRIEND",
      passwordHash: await bcrypt.hash("radar-friend", 12),
      notificationSettings: {
        create: {
          inApp: true,
          email: false,
          sms: false,
          browserPush: false,
          emailTo: "friend@poke.local"
        }
      }
    }
  });

  const retailerSeeds = [
    ["Pokemon Center", "https://www.pokemoncenter.com"],
    ["Target", "https://www.target.com"],
    ["Walmart", "https://www.walmart.com"],
    ["Best Buy", "https://www.bestbuy.com"],
    ["GameStop", "https://www.gamestop.com"],
    ["Amazon", "https://www.amazon.com"]
  ] as const;

  const retailers = new Map<string, string>();
  for (const [name, website] of retailerSeeds) {
    const retailer = await prisma.retailer.upsert({
      where: { name },
      update: { website },
      create: { name, website }
    });
    retailers.set(name, retailer.id);
  }

  async function ensureSeedRelease(data: {
    setName: string;
    productType: string;
    officialReleaseDate: Date;
    preorderDate: Date | null;
    productTypes: string;
    pokemonCenterExclusiveVersion: boolean;
    chaseCards: string;
    demandRating: string;
    estimatedDemand: string;
    priority: string;
    sealedProductPriority: string;
    notes: string;
    productLinks: string;
  }) {
    const existing = await prisma.release.findFirst({ where: { setName: data.setName } });
    if (existing) return prisma.release.update({ where: { id: existing.id }, data });
    return prisma.release.create({ data });
  }

  const summerRelease = await ensureSeedRelease({
    setName: "Mega Evolution-Chaos Rising",
    productType: "Build & Battle Box",
    officialReleaseDate: new Date("2026-05-22T14:00:00.000Z"),
    preorderDate: new Date("2026-05-08T14:00:00.000Z"),
    productTypes: "Build & Battle Box, Booster Bundle, ETB, Booster Display",
    pokemonCenterExclusiveVersion: true,
    chaseCards: "Mega Evolution chase cards; verify final card list before buying.",
    demandRating: "HIGH",
    estimatedDemand: "HIGH",
    priority: "HIGH",
    sealedProductPriority: "HIGH",
    notes: "Real release calendar example from public Pokemon.com coverage. Verify regional product dates before live use.",
    productLinks: "https://www.pokemon.com/uk/pokemon-news/get-a-pokemon-tcg-mega-evolution-chaos-rising-build-battle-box-early"
  });
  const fallRelease = await ensureSeedRelease({
    setName: "Mega Evolution-Ascended Heroes",
    productType: "Booster Bundle",
    officialReleaseDate: new Date("2026-01-30T14:00:00.000Z"),
    preorderDate: null,
    productTypes: "Booster Bundle, ETB, Booster Display, Sleeved Booster",
    pokemonCenterExclusiveVersion: true,
    chaseCards: "Mega Dragonite ex and other Mega Evolution targets; verify final card list.",
    demandRating: "MEDIUM",
    estimatedDemand: "MEDIUM",
    priority: "MEDIUM",
    sealedProductPriority: "MEDIUM",
    notes: "Real release calendar example from public Pokemon.com pages. Dates can vary by product and region.",
    productLinks: "https://www.pokemon.com/uk/pokemon-news/get-the-new-pokemon-tcg-expansion-mega-evolution-ascended-heroes-on-january-30-2026"
  });

  if ((await prisma.product.count()) === 0) {
    const products = [
      {
        retailer: "Pokemon Center",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        productType: "ETB",
        name: "Pokemon TCG Mega Evolution Chaos Rising ETB",
        url: "https://www.pokemoncenter.com/category/trading-card-game",
        sku: "PC-CR-ETB",
        retailPrice: 59.99,
        stockStatus: "SOLD_OUT",
        priority: "HIGH",
        rating: "WATCH",
        manualPriorityOverride: "WATCH",
        sealedResaleNotes: "Pokemon Center version and promos can lift sealed demand.",
        scarcityNotes: "Exclusive version may be allocation constrained.",
        notes: "Watch for Pokemon Center exclusive restocks."
      },
      {
        retailer: "Target",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        productType: "Booster Bundle",
        name: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
        url: "https://www.target.com/s?searchTerm=pokemon+tcg+booster+bundle",
        sku: "TARGET-BUNDLE",
        dpci: "087-12-0001",
        retailPrice: 26.99,
        stockStatus: "IN_STOCK",
        priority: "HIGH",
        rating: "BUY",
        manualPriorityOverride: "BUY",
        sealedResaleNotes: "Booster bundles are low-entry sealed targets.",
        scarcityNotes: "Usually sells through quickly after restocks.",
        notes: "Manual status set from public page."
      },
      {
        retailer: "Walmart",
        releaseId: fallRelease.id,
        setName: fallRelease.setName,
        productType: "Collection Box",
        name: "Pokemon TCG Mega Evolution Ascended Heroes Collection Box",
        url: "https://www.walmart.com/search?q=pokemon%20tcg",
        sku: "WM-COLLECT",
        retailPrice: 39.98,
        stockStatus: "UNAVAILABLE",
        priority: "MEDIUM",
        rating: "WATCH",
        manualPriorityOverride: "WATCH",
        sealedResaleNotes: "Collection boxes depend on promos.",
        scarcityNotes: "Watch vendor timing.",
        notes: "Check public page only."
      },
      {
        retailer: "Best Buy",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        productType: "Sleeved Booster",
        name: "Pokemon TCG Mega Evolution Chaos Rising Sleeved Booster",
        url: "https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+tcg",
        sku: "BB-MINITIN",
        retailPrice: 9.99,
        stockStatus: "PAGE_UPDATED",
        priority: "MEDIUM",
        rating: "WATCH",
        manualPriorityOverride: "WATCH",
        sealedResaleNotes: "Low entry but sealed upside is limited.",
        scarcityNotes: "Demo page-update target.",
        notes: "Page changed; verify manually."
      },
      {
        retailer: "GameStop",
        releaseId: fallRelease.id,
        setName: fallRelease.setName,
        productType: "Premium Collection",
        name: "Pokemon TCG Mega Evolution Ascended Heroes Premium Collection",
        url: "https://www.gamestop.com/toys-games/trading-cards",
        sku: "GS-PREMIUM",
        retailPrice: 49.99,
        stockStatus: "PREORDER_LIVE",
        priority: "HIGH",
        rating: "BUY",
        manualPriorityOverride: "BUY",
        sealedResaleNotes: "Premium collections can move on promo demand.",
        scarcityNotes: "Preorder windows may close quickly.",
        notes: "Manual preorder signal."
      },
      {
        retailer: "Amazon",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        productType: "Sleeved Booster",
        name: "Pokemon TCG Mega Evolution Chaos Rising Sleeved Booster",
        url: "https://www.amazon.com/dp/B000000000",
        sku: "AMZ-SLEEVE",
        retailPrice: 4.49,
        stockStatus: "PRICE_CHANGE",
        priority: "LOW",
        rating: "SKIP",
        manualPriorityOverride: "SKIP",
        sealedResaleNotes: "Skip third-party pricing above retail.",
        scarcityNotes: "No scarcity signal.",
        notes: "Avoid third-party over retail."
      }
    ];

    for (const product of products) {
      const created = await prisma.product.create({
        data: {
          retailerId: retailers.get(product.retailer)!,
          releaseId: product.releaseId,
          setName: product.setName,
          productType: product.productType,
          name: product.name,
          url: product.url,
          sku: product.sku,
          dpci: product.dpci,
          retailPrice: product.retailPrice,
          stockStatus: product.stockStatus,
          priority: product.priority,
          rating: product.rating,
          manualPriorityOverride: product.manualPriorityOverride,
          sealedResaleNotes: product.sealedResaleNotes,
          scarcityNotes: product.scarcityNotes,
          notes: product.notes,
          lastCheckedAt: new Date()
        }
      });

      await prisma.restockHistory.create({
        data: {
          productId: created.id,
          status: created.stockStatus,
          price: created.retailPrice,
          snapshotReason: "Seeded Phase 1 manual status"
        }
      });
    }
  }

  if ((await prisma.store.count()) === 0) {
    const target = await prisma.store.create({
      data: {
        retailerId: retailers.get("Target")!,
        storeName: "Target Northside",
        address: "100 Market Plaza",
        city: "Orlando",
        state: "FL",
        typicalRestockDays: "Tuesday,Friday",
        typicalRestockTimeWindow: "8:00 AM - 11:00 AM",
        vendorNotes: "Card aisle usually touched after front lanes.",
        confidenceScore: 72,
        notes: "Check only public shelves and posted product limits."
      }
    });

    const walmart = await prisma.store.create({
      data: {
        retailerId: retailers.get("Walmart")!,
        storeName: "Walmart Lakeview",
        address: "2200 Lakeview Rd",
        city: "Orlando",
        state: "FL",
        typicalRestockDays: "Wednesday,Saturday",
        typicalRestockTimeWindow: "10:00 AM - 1:00 PM",
        vendorNotes: "Vendor timing varies; sightings drive confidence.",
        confidenceScore: 58,
        notes: "Keep sightings manual and photo optional."
      }
    });

    await prisma.storeSighting.createMany({
      data: [
        {
          storeId: target.id,
          userId: admin.id,
          productSeen: "Booster Bundle",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 0, 9, 42),
          quantityEstimate: "6-10",
          notes: "Middle shelf, two rows."
        },
        {
          storeId: target.id,
          userId: admin.id,
          productSeen: "ETB",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 1, 10, 5),
          quantityEstimate: "4-6",
          notes: "Front card aisle endcap."
        },
        {
          storeId: target.id,
          userId: admin.id,
          productSeen: "Sleeved Booster",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 2, 9, 35),
          quantityEstimate: "10+",
          notes: "Vendor stocked before lunch."
        },
        {
          storeId: target.id,
          userId: admin.id,
          productSeen: "Pokemon TCG shelf",
          resultType: "empty_shelf",
          seenAt: previousWeekday(2, 0, 18, 20),
          quantityEstimate: "0",
          notes: "No fresh stock left after work."
        },
        {
          storeId: walmart.id,
          userId: admin.id,
          productSeen: "Collection Box",
          resultType: "stock_seen",
          seenAt: previousWeekday(3, 0, 10, 50),
          quantityEstimate: "1-3",
          notes: "Low quantity, mixed with older stock."
        },
        {
          storeId: walmart.id,
          userId: admin.id,
          productSeen: "Vendor",
          resultType: "vendor_spotted",
          seenAt: previousWeekday(6, 0, 11, 15),
          quantityEstimate: "Vendor present",
          notes: "Vendor had sealed cases on cart; no checkout automation or special access."
        }
      ]
    });
  }

  if ((await prisma.release.count()) === 0) {
    await prisma.release.createMany({
      data: [
        {
          setName: "Summer 2026 Sample Expansion",
          officialReleaseDate: new Date("2026-07-10T14:00:00.000Z"),
          preorderDate: new Date("2026-06-14T14:00:00.000Z"),
          productTypes: "ETB, Booster Bundle, Booster Box, Sleeved Booster",
          pokemonCenterExclusiveVersion: true,
          chaseCards: "High-demand illustration rares, sample chase targets",
          demandRating: "HIGH",
          priority: "HIGH",
          notes: "Seed sample. Replace with verified official dates before relying on it.",
          productLinks: "https://www.pokemoncenter.com/"
        },
        {
          setName: "Fall 2026 Sample Collection",
          officialReleaseDate: new Date("2026-09-25T14:00:00.000Z"),
          preorderDate: null,
          productTypes: "Collection Box, Premium Collection",
          pokemonCenterExclusiveVersion: false,
          chaseCards: "Promos, sealed collection value",
          demandRating: "MEDIUM",
          priority: "MEDIUM",
          notes: "Manual tracking placeholder.",
          productLinks: "https://www.target.com/"
        }
      ]
    });
  }

  if ((await prisma.card.count()) === 0) {
    const cards = [
      {
        cardName: "Pikachu ex",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        cardNumber: "025/198",
        rarity: "Ultra Rare",
        raw: 18,
        psa9: 45,
        psa10: 128,
        grading: 18,
        rating: "BUY",
        lowPop: false,
        newRelease: true,
        notes: "Seed sample; verify recent eBay sold comps."
      },
      {
        cardName: "Charizard Illustration Rare",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        cardNumber: "199/198",
        rarity: "Special Illustration Rare",
        raw: 92,
        psa9: 145,
        psa10: 340,
        grading: 22,
        rating: "WATCH",
        lowPop: true,
        newRelease: false,
        notes: "Upside depends on raw condition discipline."
      },
      {
        cardName: "Eevee Full Art",
        releaseId: summerRelease.id,
        setName: summerRelease.setName,
        cardNumber: "151/198",
        rarity: "Full Art",
        raw: 14,
        psa9: 32,
        psa10: 82,
        grading: 18,
        rating: "WATCH",
        lowPop: false,
        newRelease: true,
        notes: "PSA 9 margin is tight."
      }
    ];

    for (const card of cards) {
      const fee = 0.1325;
      const created = await prisma.card.create({
        data: {
          cardName: card.cardName,
          releaseId: card.releaseId,
          setName: card.setName,
          cardNumber: card.cardNumber,
          rarity: card.rarity,
          rawAveragePrice: card.raw,
          psa9AverageSalePrice: card.psa9,
          psa10AverageSalePrice: card.psa10,
          estimatedEbayFee: fee,
          estimatedGradingCost: card.grading,
          psa9EstimatedProfit: profit(card.raw, card.psa9, fee, card.grading),
          psa10EstimatedProfit: profit(card.raw, card.psa10, fee, card.grading),
          maxRawBuyPricePsa9: maxRawBuy(card.psa9, fee, card.grading),
          rating: card.rating,
          dataSource: "Manual seed sample; verify eBay sold comps",
          lastRefreshed: new Date(),
          notes: card.notes,
          lowPop: card.lowPop,
          newRelease: card.newRelease
        }
      });

      await prisma.cardPriceSnapshot.create({
        data: {
          cardId: created.id,
          rawAveragePrice: created.rawAveragePrice,
          psa9AverageSalePrice: created.psa9AverageSalePrice,
          psa10AverageSalePrice: created.psa10AverageSalePrice,
          psa9EstimatedProfit: created.psa9EstimatedProfit,
          psa10EstimatedProfit: created.psa10EstimatedProfit,
          rating: created.rating
        }
      });
    }
  }

  if ((await prisma.alert.count()) === 0) {
    const product = await prisma.product.findFirst({
      where: { stockStatus: { in: ["IN_STOCK", "PREORDER_LIVE"] } }
    });
    await prisma.alert.create({
      data: {
        title: product ? `${product.name} is actionable` : "Radar is ready",
        reason: product
          ? `${product.stockStatus.replaceAll("_", " ").toLowerCase()} was entered manually. Checkout must be completed on the official retailer page.`
          : "Seed data loaded for Phase 1.",
        priority: product?.priority || "MEDIUM",
        entityType: product ? "PRODUCT" : "SYSTEM",
        entityId: product?.id,
        productId: product?.id,
        actionUrl: product?.url
      }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
