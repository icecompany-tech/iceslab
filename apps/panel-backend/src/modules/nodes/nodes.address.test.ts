import { expect, it } from 'vitest';
import { CreateNodeSchema, UpdateNodeSchema } from './nodes.schemas.js';

it.each([
  ['node.example', true],
  ['node.example:1', true],
  ['node.example:65535', true],
  ['node.example:0', false],
  ['node.example:65536', false],
  ['node.example:1e3', false],
])('validates optional TCP port in node address %s on create and edit', (address, valid) => {
  const results = [
    CreateNodeSchema.safeParse({ name: 'port-check', address }),
    UpdateNodeSchema.safeParse({ address }),
  ];
  for (const result of results) {
    expect(result.success).toBe(valid);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['address']);
  }
});

it('accepts an edit without a new address', () => {
  expect(UpdateNodeSchema.safeParse({ name: 'same-address' }).success).toBe(true);
});
