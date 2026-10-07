/**
 * Icon shim.
 *
 * lucide-react v1 renamed a number of icons and dropped brand marks. Importing
 * through this module keeps call sites stable and gives CMS-authored icon names
 * a safe, allow-listed resolution path.
 */
import type { ComponentType, SVGProps } from 'react';
import {
  CircleCheck,
  CircleX,
  TriangleAlert,
  Info,
  LoaderCircle,
  Trash,
  Type,
  ListFilter,
  House,
  EllipsisVertical,
  ChartBar,
  CircleQuestionMark,
  Grid3x3,
  Shield,
  Zap,
  Users,
  Package,
  Receipt,
  Move,
  Headset,
  GraduationCap,
  RotateCw,
  Star,
  Clock,
  Globe,
  Lock,
  Cloud,
  Server,
  Database,
  Layers,
  Rocket,
  Award,
  ThumbsUp,
  Heart,
  Target,
  Briefcase,
  FileText,
  Mail,
  Phone,
  MapPin,
  Building2,
  TrendingUp,
  Megaphone,
  Gift,
  ClipboardList,
  Quote,
  Table,
  ListOrdered,
  LayoutTemplate,
  Image as ImageIcon,
  Settings,
  Check,
} from 'lucide-react';
import { CMS_ICON_NAMES, isCmsIconName, type CmsIconName } from './icon-names';

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// Canonical aliases for renamed icons.
export const CheckCircle = CircleCheck;
export const XCircle = CircleX;
export const AlertTriangle = TriangleAlert;
export const Spinner = LoaderCircle;
export const TrashIcon = Trash;
export const FilterIcon = ListFilter;
export const HomeIcon = House;
export const MoreIcon = EllipsisVertical;
export const ChartIcon = ChartBar;
export const HelpIcon = CircleQuestionMark;
export const TextIcon = Type;

export { Info, Check, Settings, ImageIcon };

/** Icons an editor may reference by name from a CMS block field — every name in `icon-names.ts`, and no other. */
const CMS_ICONS: Record<CmsIconName, IconComponent> = {
  shield: Shield,
  zap: Zap,
  users: Users,
  package: Package,
  receipt: Receipt,
  move: Move,
  headset: Headset,
  graduation: GraduationCap,
  refresh: RotateCw,
  star: Star,
  clock: Clock,
  globe: Globe,
  lock: Lock,
  cloud: Cloud,
  server: Server,
  database: Database,
  layers: Layers,
  rocket: Rocket,
  award: Award,
  'thumbs-up': ThumbsUp,
  heart: Heart,
  target: Target,
  briefcase: Briefcase,
  file: FileText,
  mail: Mail,
  phone: Phone,
  'map-pin': MapPin,
  building: Building2,
  'trending-up': TrendingUp,
  megaphone: Megaphone,
  gift: Gift,
  clipboard: ClipboardList,
  quote: Quote,
  table: Table,
  list: ListOrdered,
  layout: LayoutTemplate,
  grid: Grid3x3,
  check: Check,
  image: ImageIcon,
};

export function resolveCmsIcon(name: string | null | undefined): IconComponent | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return isCmsIconName(key) ? CMS_ICONS[key] : null;
}

export { CMS_ICON_NAMES };

/*
 * Brand marks, outlined.
 *
 * The filled badges below read as solid blocks on a pale surface — a footer's
 * row of social links wants the same weight as the line icons beside it, not
 * five dark squares. Drawn on lucide's grid (24px, 1.5 stroke, round caps) so
 * they sit with the icons the rest of the site uses.
 */
const line: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function LinkedInLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...line} aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 10.5v6" />
      <path d="M7 7.6v.01" />
      <path d="M11 16.5v-6" />
      <path d="M11 13.2a2.7 2.7 0 0 1 5.4 0v3.3" />
    </svg>
  );
}

export function FacebookLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...line} aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M15 8.2h-1.4a1.9 1.9 0 0 0-1.9 1.9V21" />
      <path d="M9.6 13h4.6" />
    </svg>
  );
}

export function InstagramLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...line} aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M17.2 6.8v.01" />
    </svg>
  );
}

export function YouTubeLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...line} aria-hidden="true" {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.2 9.4 15 12l-4.8 2.6z" />
    </svg>
  );
}

export function XLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...line} aria-hidden="true" {...props}>
      <path d="M4 4l16 16" />
      <path d="M20 4 4 20" />
    </svg>
  );
}

/** Brand marks — lucide v1 no longer ships these. */
export function LinkedInIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13M7.12 20.45H3.55V9h3.57zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0" />
    </svg>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.48 3.24H4.29z" />
    </svg>
  );
}

export function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07" />
    </svg>
  );
}

export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9s.68.82.9 1.38c.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38s-.82.68-1.38.9c-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9s-.68-.82-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38s.82-.68 1.38-.9c.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07c-1.28.06-2.15.26-2.91.56-.79.3-1.46.72-2.13 1.38A5.9 5.9 0 0 0 .63 4.14c-.3.76-.5 1.63-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.63.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.13-1.38a5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0m0 5.84a6.16 6.16 0 1 0 0 12.32A6.16 6.16 0 0 0 12 5.84m0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0" />
    </svg>
  );
}

export function YouTubeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.08 0 12 0 12s0 3.92.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.92 24 12 24 12s0-3.92-.5-5.81M9.55 15.57V8.43L15.82 12z" />
    </svg>
  );
}
