import { vi } from 'vitest';

// Keep native builtin implementations while making their exports spyable in Node ESM.
vi.mock('fs', { spy: true });
vi.mock('os', { spy: true });
vi.mock('child_process', { spy: true });
