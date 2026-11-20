import { createFileRoute, notFound } from '@tanstack/react-router';
import { BackLink } from '~/components/Chrome';
import { ScaleIn } from '~/components/Motion';
import { getTool } from '~/data/tools';
import { EditPdfPage } from '~/features/tools/EditPdfPage';
import { FormCreatorPage } from '~/features/tools/FormCreatorPage';
import { MergePdfTool } from '~/features/tools/MergePdfTool';
import { MultiToolPage } from '~/features/tools/MultiToolPage';
import { ToolWorkspace } from '~/features/tools/ToolWorkspace';
import { WorkflowPage } from '~/features/tools/WorkflowPage';
import { getToolEntry } from '~/features/tools/processors';
import { seo } from '~/utils/seo';

export const Route = createFileRoute('/tools/$slug')({
  component: ToolPage,
  loader: ({ params }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    return { tool };
  },
  head: ({ loaderData }) =>
    loaderData
      ? seo({
          title: `${loaderData.tool.name} | BentoPDF`,
          description: `${loaderData.tool.subtitle} Use ${loaderData.tool.name} in your browser. Files stay on your device.`,
          path: `/tools/${loaderData.tool.slug}`,
        })
      : { meta: [{ title: 'Page not found | BentoPDF' }] },
});

function ToolPage() {
  const { tool } = Route.useLoaderData();
  const entry = getToolEntry(tool.slug);

  // Full-screen workspaces take over the page entirely.
  if (entry.status === 'workspace') {
    if (entry.kind === 'multi-tool') return <MultiToolPage />;
    if (entry.kind === 'editor') return <EditPdfPage />;
    if (entry.kind === 'form-creator') return <FormCreatorPage />;
    if (entry.kind === 'workflow') return <WorkflowPage />;
  }

  return (
    <div className="page-head tool-page">
      <BackLink />
      <ScaleIn>
        {/* Dedicated merge UI; everything else uses the generic workspace,
            which also renders the unavailable state. */}
        {tool.slug === 'merge-pdf' ? (
          <MergePdfTool tool={tool} />
        ) : (
          <ToolWorkspace tool={tool} />
        )}
      </ScaleIn>
    </div>
  );
}
