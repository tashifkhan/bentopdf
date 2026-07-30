import type { ComponentType, SVGProps } from 'react'
import {
  ArrowLeft,
  BoltLightning,
  CheckSquare,
  Clipboard,
  CloseCircle,
  Code,
  Copy,
  Document,
  DocumentText,
  Download,
  Eye,
  File,
  Gallery,
  Layers,
  Lock,
  Moon,
  Pen,
  PenSquare,
  Restart,
  Scissors,
  Search,
  Settings,
  ShieldCheck,
  Crop,
  Sun,
  Trash,
  Upload,
  Widget,
} from 'reicon-react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number; color?: string }
type IconComp = ComponentType<IconProps>

/** Map phosphor-style tool icons → reicon components */
const map: Record<string, IconComp> = {
  'tree-structure': Widget,
  'pencil-ruler': PenSquare,
  browsers: Layers,
  scissors: Scissors,
  lightning: BoltLightning,
  'pencil-simple': Pen,
  'file-jpg': Gallery,
  'pen-nib': Pen,
  crop: Crop,
  'squares-four': Copy,
  files: Document,
  trash: Trash,
  bookmark: DocumentText,
  'text-aa': DocumentText,
  lock: Lock,
  lockers: Lock,
  eye: Eye,
  code: Code,
  image: Gallery,
  'file-pdf': File,
  'file-doc': Document,
  'file-xls': Document,
  'file-ppt': Document,
  'file-text': DocumentText,
  'file-png': Gallery,
  'file-svg': Gallery,
  'file-zip': Document,
  gear: Settings,
  wrench: Settings,
  shield: ShieldCheck,
  check: CheckSquare,
  upload: Upload,
  download: Download,
  search: Search,
  sun: Sun,
  moon: Moon,
  plus: Document,
  clipboard: Clipboard,
  restart: Restart,
  'arrow-left': ArrowLeft,
  close: CloseCircle,
}

export function ToolIcon({
  name,
  size = 20,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const key = name.replace(/^ph-/, '')
  const Icon = map[key] || File
  return <Icon size={size} className={className} color="currentColor" />
}

export {
  ArrowLeft,
  CheckSquare,
  CloseCircle,
  Document,
  Download,
  Layers,
  Moon,
  Restart,
  Scissors,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash,
  Upload,
}
