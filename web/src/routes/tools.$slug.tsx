import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'reicon-react'
import { ScaleIn } from '~/components/Motion'
import { getTool } from '~/data/tools'
import { MergePdfTool } from '~/features/tools/MergePdfTool'
import { MultiToolPage } from '~/features/tools/MultiToolPage'
import { ToolWorkspace } from '~/features/tools/ToolWorkspace'
import { getToolEntry } from '~/features/tools/processors'

export const Route = createFileRoute('/tools/$slug')({
  component: ToolPage,
  loader: ({ params }) => {
    const tool = getTool(params.slug)
    if (!tool) throw notFound()
    return { tool }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.tool.name} — PDF Tools`
          : 'Tool — PDF Tools',
      },
    ],
  }),
})

function ToolPage() {
  const { tool } = Route.useLoaderData()
  const entry = getToolEntry(tool.slug)

  // Full-screen multi-tool workspace (also backs Organize PDF).
  if (entry.status === 'workspace' && entry.kind === 'multi-tool') {
    return <MultiToolPage />
  }

  // Polished dedicated UI for merging.
  if (tool.slug === 'merge-pdf') {
    return (
      <div className="pt-6">
        <BackLink />
        <ScaleIn>
          <MergePdfTool />
        </ScaleIn>
      </div>
    )
  }

  // Everything else → beUI workspace, which also renders the unavailable state.
  return (
    <div className="pt-6">
      <BackLink />
      <ScaleIn>
        <ToolWorkspace tool={tool} />
      </ScaleIn>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/"
      className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-accent hover:text-accent"
    >
      <ArrowLeft size={14} color="currentColor" />
      Back to tools
    </Link>
  )
}
