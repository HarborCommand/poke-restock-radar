# GameDayGrabs Shipping Policy Notes

This note separates shipping calculation correctness from future customer-facing shipping policy.

- Carrier pass-through pricing: calculate the smallest realistic parcel from item dimensions, packing material, and box fit, then request the live Shippo/USPS rate.
- Subsidized retail shipping policy: an owner-controlled layer can later cap or discount what the customer pays while preserving the actual carrier cost internally.
- Free shipping threshold: a future store policy choice, separate from parcel calculation and carrier rating.

Current recommendation: keep using real Shippo/USPS quotes after the parcel calculation is realistic. Add any free-shipping, capped-shipping, or merchant-subsidy policy later as an explicit owner-controlled setting.
