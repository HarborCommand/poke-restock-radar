export const dashboardRealDataLayoutFixture = {
  recentTransactions: [
    {
      reference: "#POS-REAL-DATA-STRESS-REFERENCE-123456",
      orderReference: "#ORDER-GDG-REAL-DATA-12345",
      productName: "Pokémon Trading Card Game Mega Evolution Premium Collection With Oversized Promo Card Booster Packs And Collector Accessories",
      customerName: "Claudio Longform Verified Collector Account",
      customerEmail: "claudio.longform.collector.account@example-test.invalid",
      amount: "$1,248.99",
      profit: "Unknown",
      status: "Completed With Manual Review"
    },
    {
      reference: "#POS-NEGATIVE-PROFIT-REF-987654",
      orderReference: "#ORDER-GDG-NEGATIVE-98765",
      productName: "Pokémon TCG Scarlet Violet Ultra Premium Assortment Bundle With Long Variant Name And Retail Packaging Details",
      customerName: "Alexandra Long Customer Display",
      customerEmail: "alexandra.long.customer.display@example-test.invalid",
      amount: "$2,450.00",
      profit: "-$18.45",
      status: "Partially Refunded"
    }
  ],
  inventoryRows: [
    "Pokémon Trading Card Game Mega Evolution Perfect Order Elite Trainer Box With Long Collector Product Name",
    "Pokémon TCG Mega Moonlit Tin Random Assortment Gengar Or Clefable Ex Long Shelf Label",
    "Pokémon Trading Card Game First Partner Illustration Collection Series Two Premium Product",
    "Mega Evolution Ascended Heroes Mega Ex Box Receive One At Random Long Name",
    "Pokémon TCG Booster Bundle Long Real Storefront Product Name With UPC Metadata"
  ].map((productName, index) => ({
    productName,
    identifier: `UPC/SKU 196214155879-LONG-STRESS-${index + 1}`,
    quantity: index,
    status: index === 0 ? "Out of Stock" : index === 1 ? "Low Stock" : "In Stock"
  })),
  topProducts: [
    "Pokémon Trading Card Game First Partner Illustration Collection Series Two Premium Product Long Ranking Name",
    "Mega Evolution Chaos Rising Sleeved Booster Long Product Name For Numeric Column Protection",
    "Pokémon TCG Scarlet Violet Premium Collection Long Title For Sales Ranking Layout"
  ]
};
