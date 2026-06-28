# GameDayGrabs Shipping Policy Notes

This note separates shipping calculation correctness from future customer-facing shipping policy.

- Carrier pass-through pricing: calculate the smallest realistic parcel from item dimensions, packing material, and box fit, then request the live Shippo/USPS rate.
- Subsidized retail shipping policy: an owner-controlled layer can later cap or discount what the customer pays while preserving the actual carrier cost internally.
- Free shipping threshold: a future store policy choice, separate from parcel calculation and carrier rating.

Current recommendation: keep using real Shippo/USPS quotes after the parcel calculation is realistic. Add any free-shipping, capped-shipping, or merchant-subsidy policy later as an explicit owner-controlled setting.

## Admin Product Package Metadata

- Weigh each product as it will be shipped, including the normal box, mailer, and protective packing.
- Measure the package needed for that SKU in inches: length, width, and height.
- Enter weight in ounces and dimensions in inches in the product shipping section.
- Mark package data as measured only when the packed SKU has actually been weighed and measured. Use estimated when values are reasonable but not verified.
- If package data is unknown, leave it blank. Checkout will use the selected shipping profile, category-aware fallback, or safe fallback instead.
- Customer-facing shipping is still revalidated server-side at checkout; browser cart estimates are not trusted as payment inputs.
