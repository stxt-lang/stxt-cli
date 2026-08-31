/**
 * The two reserved definition namespaces (`@stxt.schema`, `@stxt.template`) and the transform
 * each one compiles with. `install` and `validate` both need to tell a definition root apart
 * from a plain document and run it through the same transform discovery uses; this is the one
 * place that mapping lives.
 */

import { Node, Schema, transformNodeToSchema, transformTemplateNodeToSchema } from "@stxt-lang/core";

/** The reserved namespace schemas are written in (STXT-SCHEMA-SPEC). */
export const SCHEMA_NAMESPACE = "@stxt.schema";

/** The reserved namespace templates are written in (STXT-TEMPLATE-SPEC). */
export const TEMPLATE_NAMESPACE = "@stxt.template";

/** The reserved namespace a definition is written in: one of the two constants above. */
export type DefinitionKind = typeof SCHEMA_NAMESPACE | typeof TEMPLATE_NAMESPACE;

/**
 * Tells whether a namespace is one of the two reserved definition namespaces, narrowing it.
 *
 * @param namespace the effective namespace of a root node.
 * @returns true for `@stxt.schema` and `@stxt.template`.
 */
export function isDefinitionKind(namespace: string): namespace is DefinitionKind {
    return namespace === SCHEMA_NAMESPACE || namespace === TEMPLATE_NAMESPACE;
}

/**
 * The transform that compiles a definition of the given reserved namespace to a {@link Schema}
 * — the same one discovery runs — or null when the namespace is not a definition namespace.
 *
 * @param namespace the effective namespace of a root node.
 * @returns the transform, or null for a plain document namespace.
 */
export function definitionTransformFor(namespace: DefinitionKind): (node: Node) => Schema;
export function definitionTransformFor(namespace: string): ((node: Node) => Schema) | null;
export function definitionTransformFor(namespace: string): ((node: Node) => Schema) | null {
    if (namespace === SCHEMA_NAMESPACE) {
        return transformNodeToSchema;
    }
    if (namespace === TEMPLATE_NAMESPACE) {
        return transformTemplateNodeToSchema;
    }
    return null;
}
