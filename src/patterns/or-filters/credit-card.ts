import type { OrPostFilter } from './types.js';

const CC_PRESETS = new Set(['pci-dss', 'finance']);

export const creditCard: OrPostFilter = {
  id: 'credit-card-preset',
  description:
    'Allows credit-card detections only under pci-dss or finance compliance presets.',
  accept(match, ctx) {
    if (match.type !== 'credit-card') return true;
    return CC_PRESETS.has(ctx.preset);
  },
};
