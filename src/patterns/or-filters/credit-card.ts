import type { OrPostFilter } from './types.js';

const CC_PRESETS = new Set(['pci-dss', 'finance']);

export const creditCard: OrPostFilter = {
  id: 'credit-card-preset',
  accept(match, ctx) {
    if (match.type !== 'credit-card') return true;
    return CC_PRESETS.has(ctx.preset);
  },
};
