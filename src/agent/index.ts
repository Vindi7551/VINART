// ── Shared ──
export { assemblePrompt, formatSection } from './shared/prompt-builder';
export type { Agent, AgentConfig } from './shared/types';

// ══════════════════════════════════════════
// Agent（基于真实设计团队分工）
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

// ── Concepting Pair（美术指导+文案配对）──
export { createConceptingPair } from './concepting/index';
export type { ConceptingConfig, ConceptingResult } from './concepting/index';

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
