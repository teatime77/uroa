/**
 * Field mapping notes: legacy JSON → UnifiedLesson v0.1
 *
 * diagram (root array of blocks)
 * - modulePayloads.diagram ← raw array (same shape as `loadJson` input)
 * - timeline: use step `runDiagram` after modules.diagram = true
 *
 * game (stage / dev / prod object)
 * - modulePayloads.game ← raw object (uis/menus/actions/imports)
 * - timeline: `runGameWorld` (loader will call loadWorld / SymbolRef.importLibrary in a later phase)
 *
 * movie (all-kyozai bundle)
 * - resources[]: add { id, uri } pointing to bundle URL or embed subset
 * - modulePayloads.movie ← { type, version, docs } slice or full bundle
 * - timeline: `runMovieDoc`
 *
 * webgpu (package array)
 * - modulePayloads.webgpu ← package entry or full test.json array
 * - timeline: `runWebgpuPackage`
 *
 * Detailed converters live in future `adapters/*` modules.
 */
export const LEGACY_MAPPING_VERSION = "0.1.0-notes" as const;
