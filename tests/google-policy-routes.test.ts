import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const publicPolicyRoutes = [
  "src/app/policies/shipping/page.tsx",
  "src/app/policies/returns/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx"
] as const;

test("Google Merchant policy routes are public storefront pages", () => {
  for (const routePath of publicPolicyRoutes) {
    const source = readProjectFile(routePath);
    assert.match(source, /StorefrontHeader/);
    assert.match(source, /StorefrontFooter/);
    assert.match(source, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
    assert.match(source, /metadata/);
    assert.doesNotMatch(source, /requireUser|requireAdmin|auth\(|redirect\("/);
  }
});

test("policy hub and footer expose dedicated policy and trust links", () => {
  const policiesPage = readProjectFile("src/app/policies/page.tsx");
  const aboutPage = readProjectFile("src/app/about/page.tsx");
  const contactPage = readProjectFile("src/app/contact/page.tsx");
  const policyLinks = readProjectFile("src/components/StorefrontPolicies.tsx");
  const storefrontClient = readProjectFile("src/components/StorefrontClient.tsx");
  const combinedPolicyHub = `${policiesPage}\n${policyLinks}`;

  for (const href of ["/policies/shipping", "/policies/returns", "/privacy", "/terms"]) {
    assert.match(combinedPolicyHub, new RegExp(`href[:=]"${href.replace(/\//g, "\\/")}"|href: "${href.replace(/\//g, "\\/")}"`));
    assert.match(storefrontClient, new RegExp(`href="${href.replace(/\//g, "\\/")}"`));
  }

  assert.match(storefrontClient, /href="\/about"/);
  assert.match(storefrontClient, /href="\/contact"/);
  assert.match(storefrontClient, /Store name: GameDayGrabs\. Legal business name: GameDayGrabs LLC\./);
  assert.match(aboutPage, /About GameDayGrabs LLC/);
  assert.match(contactPage, /GameDayGrabs LLC/);
  assert.match(policiesPage, /GameDayGrabs LLC/);
  assert.match(policyLinks, /gamedaygrabs@outlook\.com|contactEmail/);
});

test("shipping and returns policy copy matches Merchant Center-facing commitments", () => {
  const policyContent = readProjectFile("src/components/StorefrontPolicies.tsx");

  assert.match(policyContent, /currently ships online orders within the United States only/);
  assert.match(policyContent, /USPS Ground Advantage is used when available/);
  assert.match(policyContent, /Shipping is calculated in the cart or checkout/);
  assert.match(policyContent, /packing and handling minimum/);
  assert.match(policyContent, /Local Pickup is free/);
  assert.match(policyContent, /Tracking is provided/);
  assert.match(policyContent, /Returns are not accepted/);
  assert.match(policyContent, /Exchanges are not accepted/);
  assert.match(policyContent, /wrong item, damaged item, missing item/);
});

