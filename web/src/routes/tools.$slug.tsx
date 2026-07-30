import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'reicon-react'
import { ScaleIn } from '~/components/Motion'
import { getTool } from '~/data/tools'
import { MergePdfTool } from '~/features/tools/MergePdfTool'
import { MultiToolPage } from '~/features/tools/MultiToolPage'
import { GenericToolShell } from '~/features/tools/GenericToolShell'

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

  if (tool.slug === 'pdf-multi-tool') {
    return <MultiToolPage />
  }

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

  return (
    <div className="pt-6">
      <BackLink />
      <ScaleIn>
        <GenericToolShell tool={tool} />
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
