// ── Shared ──
export { assemblePrompt, formatSection } from './shared/prompt-builder';
export type { Agent, AgentConfig } from './shared/types';

// ── Runner（委派循环）──
export { runManager } from './runner';
export type { Subagent, RunnerEvent } from './runner';

// ── Design Director（Manager Agent）──
export { createDesignDirector } from './design-director/index';
export type { DesignDirectorConfig } from './design-director/index';

// ── Worker Subagent 工厂 ──
export { createWriteBrief } from './worker/write-brief';
export { createDefineVisual } from './worker/define-visual';
export { createWriteCopy } from './worker/write-copy';
export { createGenerateLayout } from './worker/generate-layout';
export { createGenerateImage } from './worker/generate-image';
export { createAssemble } from './worker/assemble';

// ══════════════════════════════════════════
// 以下为旧版 Agent 工厂（保留兼容，未被 Subagent 体系删除）
// ══════════════════════════════════════════

// ── Creative Director（创意总监）──
export { createCreativeDirector, createCreativeDirectorFromInput } from './creative-director/index';
export type { CreativeDirectorInput } from './creative-director/prompt';

// ── Art Director（美术指导）──
export { buildArtDirectorContext } from './art-director/prompt';
export { BASE_PROMPT as ART_DIRECTOR_BASE_PROMPT } from './art-director/prompt';

// ── Copywriter（文案）──
export { buildCopywriterContext } from './copywriter/prompt';
export { BASE_PROMPT as COPYWRITER_BASE_PROMPT } from './copywriter/prompt';

// ── Designer（设计师）──
export { createDesigner, createDesignerFromInput } from './designer/index';
export type { DesignerInput } from './designer/prompt';

// ── Illustrator（素材师）──
export { createIllustrator } from './illustrator/index';
export type { IllustratorConfig } from './illustrator/index';
export type { IllustratorInput } from './illustrator/prompt';
export { buildPositivePrompt, buildNegativePrompt, PROMPT_BUILD_GUIDE } from './illustrator/prompt';

// ── Production（制作）──
export { createProductionAgent } from './production/index';
export type { ProductionConfig, ProductionInput, ProductionOutput } from './production/index';
