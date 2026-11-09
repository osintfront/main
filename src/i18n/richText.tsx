import { Fragment, type ReactNode } from 'react';

/**
 * Puts React nodes (links, bold text) into a translated sentence: each `{name}` in the
 * template is replaced by `nodes[name]`; unknown placeholders stay as written. Use it with
 * `t(key)` called without vars, so the placeholders are still in the text.
 */
export function richText(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>;
  });
}
