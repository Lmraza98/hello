import { PAGE_CAPABILITIES } from './catalog';
import { capabilityRegistry } from './registry';

let bootstrapped = false;

export function bootstrapCapabilities() {
  if (bootstrapped) return;
  for (const page of PAGE_CAPABILITIES) {
    capabilityRegistry.register(page);
  }
  bootstrapped = true;
}
