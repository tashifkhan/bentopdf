import catalog from './tools.generated.json'

export type Tool = {
  slug: string
  name: string
  icon: string
  subtitle: string
}

export type ToolCategory = {
  name: string
  tools: Tool[]
}

export const categories = catalog as ToolCategory[]

export const allTools: Tool[] = categories.flatMap((c) => c.tools)

const bySlug = new Map(allTools.map((t) => [t.slug, t]))

export function getTool(slug: string): Tool | undefined {
  return bySlug.get(slug)
}

export function searchTools(query: string): Tool[] {
  const q = query.trim().toLowerCase()
  if (!q) return allTools
  const seen = new Set<string>()
  const out: Tool[] = []
  for (const tool of allTools) {
    if (seen.has(tool.slug)) continue
    if (
      tool.name.toLowerCase().includes(q) ||
      tool.subtitle.toLowerCase().includes(q) ||
      tool.slug.includes(q)
    ) {
      seen.add(tool.slug)
      out.push(tool)
    }
  }
  return out
}
