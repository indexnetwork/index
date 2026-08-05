import { describe, expect, it } from 'bun:test';
import { renderNetworkContext } from '../metadata.renderer.js';

describe('renderNetworkContext', () => {
  it('renders title and prompt', () => {
    const result = renderNetworkContext({
      title: 'AI Builders',
      prompt: 'A community for AI practitioners to share knowledge.',
    });
    expect(result).toContain('## AI Builders');
    expect(result).toContain('A community for AI practitioners');
  });

  it('renders title only when no prompt', () => {
    const result = renderNetworkContext({ title: 'No Prompt Community' });
    expect(result).toContain('## No Prompt Community');
    expect(result).not.toContain('undefined');
  });
});
