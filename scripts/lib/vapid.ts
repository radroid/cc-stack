// Wrap web-push so we can call it programmatically rather than spawning the CLI
// (which prints to stdout and we'd have to parse).
import webpush from "web-push";

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}
