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
    update: {
      name: "Radar Admin",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
      preferredZone: "MIAMI",
      customZoneName: null,
      hideDistantStores: false
    },
    create: {
      email: adminEmail,
      name: "Radar Admin",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
      preferredZone: "MIAMI",
      hideDistantStores: false,
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
    update: { name: "Trusted Friend", role: "FRIEND", preferredZone: "MIAMI", hideDistantStores: false },
    create: {
      email: "friend@poke.local",
      name: "Trusted Friend",
      role: "FRIEND",
      passwordHash: await bcrypt.hash("radar-friend", 12),
      preferredZone: "MIAMI",
      hideDistantStores: false,
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
        url: "https://www.pokemoncenter.com/product/999-00001/pokemon-tcg-mega-evolution-chaos-rising-pokemon-center-elite-trainer-box",
        expectedTitleKeywords: "Mega Evolution, Chaos Rising, Elite Trainer Box",
        sku: "PC-CR-ETB",
        upc: "0820650990001",
        retailerProductId: "999-00001",
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
        url: "https://www.target.com/p/-/A-95298172",
        imageUrl: "https://target.scene7.com/is/image/Target/GUEST_de896676-8332-46bd-b36f-d863b43df7ad",
        expectedTitleKeywords: "Mega Evolution, Chaos Rising, Booster Bundle",
        sku: "TARGET-95298172",
        upc: "196214154162",
        dpci: "361-00-0031",
        retailerProductId: "95298172",
        retailPrice: 29.99,
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
        url: "https://www.walmart.com/ip/Pokemon-TCG-Mega-Evolution-Ascended-Heroes-Collection-Box/99900003",
        expectedTitleKeywords: "Mega Evolution, Ascended Heroes, Collection Box",
        sku: "WM-COLLECT",
        upc: "0820650990003",
        retailerProductId: "99900003",
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
        productType: "3-Pack Booster",
        name: "Pokemon TCG Mega Evolution Chaos Rising 3Pk Booster",
        url: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-chaos-rising-3pk-booster/JJG2TL34H3/sku/6673727",
        imageUrl: "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/e0e96fd4-9f8f-4b21-b330-d8998cf5de1d.png",
        expectedTitleKeywords: "Mega Evolution, Chaos Rising, 3Pk Booster",
        sku: "6673727",
        upc: "196214154155",
        retailerProductId: "6673727",
        retailPrice: 13.99,
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
        url: "https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-mega-evolution-ascended-heroes-premium-collection/999005",
        expectedTitleKeywords: "Mega Evolution, Ascended Heroes, Premium Collection",
        sku: "GS-PREMIUM",
        upc: "0820650990005",
        retailerProductId: "999005",
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
        expectedTitleKeywords: "Mega Evolution, Chaos Rising, Sleeved Booster",
        sku: "AMZ-SLEEVE",
        upc: "0820650990006",
        retailerProductId: "B000000000",
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
          imageUrl: "imageUrl" in product ? product.imageUrl : undefined,
          expectedTitleKeywords: product.expectedTitleKeywords,
          name: product.name,
          url: product.url,
          sku: product.sku,
          upc: product.upc,
          dpci: product.dpci,
          retailerProductId: product.retailerProductId,
          retailPrice: product.retailPrice,
          livePrice: null,
          livePriceSource: null,
          liveStockStatus: null,
          liveConfidenceScore: null,
          isDemoData: true,
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
          snapshotReason: "Seeded demo manual status"
        }
      });
    }
  }

  const legacyOrlandoSeedStores = [
    "Target Northside",
    "Walmart Lakeview",
    "Target Orlando Millenia",
    "Walmart Orlando Turkey Lake Rd Supercenter",
    "GameStop Florida Mall",
    "Best Buy Florida Mall"
  ];
  const storeSeeds = [
      {
        retailer: "Target",
        storeName: "Target Hialeah",
        address: "1750 W 37th St",
        city: "Hialeah",
        zone: "MIAMI",
        latitude: 25.8559,
        longitude: -80.3174,
        days: "Tuesday,Friday",
        window: "8:00 AM - 11:00 AM",
        confidence: 68,
        vendorNotes: "Check front card wall and toy aisle endcap."
      },
      {
        retailer: "Target",
        storeName: "Target Dadeland",
        address: "8350 S Dixie Hwy",
        city: "Miami",
        zone: "MIAMI",
        latitude: 25.6915,
        longitude: -80.3054,
        days: "Tuesday,Friday",
        window: "8:30 AM - 11:30 AM",
        confidence: 66,
        vendorNotes: "Dadeland runs can sell through quickly after school/work hours."
      },
      {
        retailer: "Target",
        storeName: "Target Midtown Miami",
        address: "3401 N Miami Ave",
        city: "Miami",
        zone: "MIAMI",
        latitude: 25.8072,
        longitude: -80.1937,
        days: "Tuesday,Friday",
        window: "8:00 AM - 11:00 AM",
        confidence: 72,
        vendorNotes: "Card aisle usually touched after front lanes."
      },
      {
        retailer: "Walmart",
        storeName: "Walmart Hialeah Gardens",
        address: "9300 NW 77th Ave",
        city: "Hialeah Gardens",
        zone: "MIAMI",
        latitude: 25.8586,
        longitude: -80.3225,
        days: "Wednesday,Saturday",
        window: "9:30 AM - 12:30 PM",
        confidence: 60,
        vendorNotes: "Check trading cards near registers and toys."
      },
      {
        retailer: "Walmart",
        storeName: "Walmart Doral",
        address: "8651 NW 13th Ter",
        city: "Doral",
        zone: "MIAMI",
        latitude: 25.7855,
        longitude: -80.337,
        days: "Wednesday,Saturday",
        window: "10:00 AM - 1:00 PM",
        confidence: 58,
        vendorNotes: "Vendor timing varies; sightings drive confidence."
      },
      {
        retailer: "Best Buy",
        storeName: "Best Buy Dadeland",
        address: "8450 S Dixie Hwy",
        city: "Miami",
        zone: "MIAMI",
        latitude: 25.6904,
        longitude: -80.3064,
        days: "Thursday,Friday",
        window: "11:00 AM - 2:00 PM",
        confidence: 54,
        vendorNotes: "Ask only about public shelf availability; no backroom pressure."
      },
      {
        retailer: "GameStop",
        storeName: "GameStop Westland Mall Hialeah",
        address: "1675 W 49th St",
        city: "Hialeah",
        zone: "MIAMI",
        latitude: 25.8667,
        longitude: -80.3169,
        days: "Friday,Saturday",
        window: "12:00 PM - 3:00 PM",
        confidence: 52,
        vendorNotes: "ETB and collection-box timing depends on allocation."
      }
    ];
  await prisma.store.deleteMany({ where: { storeName: { in: legacyOrlandoSeedStores } } });

  const createdStores = new Map<string, string>();
  for (const seed of storeSeeds) {
    const existing = await prisma.store.findFirst({ where: { storeName: seed.storeName } });
    const store = existing
      ? await prisma.store.update({
          where: { id: existing.id },
          data: {
            retailerId: retailers.get(seed.retailer)!,
            address: seed.address,
            city: seed.city,
            state: "FL",
            zone: seed.zone,
            latitude: seed.latitude,
            longitude: seed.longitude,
            typicalRestockDays: seed.days,
            typicalRestockTimeWindow: seed.window,
            vendorNotes: seed.vendorNotes,
            confidenceScore: seed.confidence,
            notes: "Miami-area seed store. Coordinates are manually entered and geocoding-ready."
          }
        })
      : await prisma.store.create({
        data: {
          retailerId: retailers.get(seed.retailer)!,
          storeName: seed.storeName,
          address: seed.address,
          city: seed.city,
          state: "FL",
          zone: seed.zone,
          latitude: seed.latitude,
          longitude: seed.longitude,
          typicalRestockDays: seed.days,
          typicalRestockTimeWindow: seed.window,
          vendorNotes: seed.vendorNotes,
          confidenceScore: seed.confidence,
          notes: "Miami-area seed store. Coordinates are manually entered and geocoding-ready."
        }
      });
    createdStores.set(seed.storeName, store.id);
  }

  const seededStoreIds = Array.from(createdStores.values());
  const existingSeedSightings = await prisma.storeSighting.count({ where: { storeId: { in: seededStoreIds } } });
  if (existingSeedSightings === 0) {
    await prisma.storeSighting.createMany({
      data: [
        {
          storeId: createdStores.get("Target Midtown Miami")!,
          userId: admin.id,
          productSeen: "Booster Bundle",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 0, 9, 42),
          quantityEstimate: "6-10",
          notes: "Middle shelf, two rows."
        },
        {
          storeId: createdStores.get("Target Hialeah")!,
          userId: admin.id,
          productSeen: "ETB",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 1, 10, 5),
          quantityEstimate: "4-6",
          notes: "Front card aisle endcap."
        },
        {
          storeId: createdStores.get("Target Dadeland")!,
          userId: admin.id,
          productSeen: "Sleeved Booster",
          resultType: "stock_seen",
          seenAt: previousWeekday(5, 2, 9, 35),
          quantityEstimate: "10+",
          notes: "Vendor stocked before lunch."
        },
        {
          storeId: createdStores.get("Best Buy Dadeland")!,
          userId: admin.id,
          productSeen: "Pokemon TCG shelf",
          resultType: "empty_shelf",
          seenAt: previousWeekday(2, 0, 18, 20),
          quantityEstimate: "0",
          notes: "No fresh stock left after work."
        },
        {
          storeId: createdStores.get("Walmart Doral")!,
          userId: admin.id,
          productSeen: "Collection Box",
          resultType: "stock_seen",
          seenAt: previousWeekday(3, 0, 10, 50),
          quantityEstimate: "1-3",
          notes: "Low quantity, mixed with older stock."
        },
        {
          storeId: createdStores.get("Walmart Hialeah Gardens")!,
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
          dataSource: "Demo data - manual sample; verify eBay sold comps",
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
