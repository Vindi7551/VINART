import { describe, expect, it } from 'vitest';
import { createSpawnAgentsTool } from '../src/designharness/tools/spawn-agents';

describe('spawn_agents tool', () => {
  const tool = createSpawnAgentsTool({ sessionId: 's1' });

  it('注册为 spawn_agents，jobs 是必填数组', () => {
    expect(tool.name).toBe('spawn_agents');
    expect(tool.parameters.required).toEqual(['shared', 'jobs']);
    expect(tool.description).toContain('子 agent');
  });

  it('jobs 的工具枚举里没有递归 spawn', () => {
    const props = tool.parameters.properties as {
      jobs: { items: { properties: { tools: { items: { enum: string[] } } } } };
    };
    expect(props.jobs.items.properties.tools.items.enum).not.toContain('spawn_agents');
    expect(props.jobs.items.properties.tools.items.enum).toContain('get_design');
  });
});
