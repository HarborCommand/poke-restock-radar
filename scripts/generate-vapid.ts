import webPush from "web-push";

const subject =
  process.argv.find((arg) => arg.startsWith("--subject="))?.split("=")[1] ||
  process.env.VAPID_SUBJECT ||
  "mailto:admin@poke.local";
const keys = webPush.generateVAPIDKeys();

console.log("# Browser push VAPID keys for Poke Restock Radar");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log(`VAPID_SUBJECT="${subject}"`);
