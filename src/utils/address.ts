import { ethers } from 'ethers';

const CANONICAL_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const KNOWN_BAD_USDC_VARIANTS = new Set([
  '0xa0b86a33e6427ff2b5b8b9a5e5d17b5c4c6f6b7c'
]);

export function ensureAddress(addr: string, { simulationMode = false }: { simulationMode?: boolean } = {}): string {
  if (!addr) throw new Error('Missing address');
  const lower = addr.toLowerCase();
  if (KNOWN_BAD_USDC_VARIANTS.has(lower)) {
    if (simulationMode) return CANONICAL_USDC;
    throw new Error('Incorrect USDC address variant detected');
  }
  return ethers.utils.getAddress(addr);
}