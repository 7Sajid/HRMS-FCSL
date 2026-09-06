/**
 * Hand-written stroke icons. No icon library: this is a dozen shapes, and a
 * dependency for a dozen shapes is a dependency to keep patched for ever.
 */
type Props = { className?: string };
const base = (className = "h-5 w-5") => ({
  className,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconUser = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);

export const IconDocuments = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const IconContacts = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2c0 5 8.8 10.4 8.8 10.4s8.8-5.4 8.8-10.4z" />
  </svg>
);

export const IconCalendar = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IconCertificate = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="9" r="5" />
    <path d="M8.5 13.5 7 22l5-2.5L17 22l-1.5-8.5" />
  </svg>
);

export const IconApprovals = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconTeam = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20c0-3.3 3-5 7-5s7 1.7 7 5" />
    <path d="M17 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.4.6 4 2 4 4.5" />
  </svg>
);

export const IconGrid = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11M15 9v11" />
  </svg>
);

export const IconInbox = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M4.5 6h15l1.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
  </svg>
);

export const IconBranch = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14" />
    <path d="M9 21v-5h6v5M9 11h.01M15 11h.01" />
  </svg>
);

export const IconTerminal = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 17v4M7 9l2.5 2L7 13" />
  </svg>
);

export const IconReport = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 21h18" />
    <path d="M6 21V11M11 21V5M16 21v-7M21 21v-4" />
  </svg>
);

export const IconShield = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 3 4 6v6c0 5 3.4 8.2 8 9.4 4.6-1.2 8-4.4 8-9.4V6z" />
  </svg>
);

export const IconSettings = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
);

export const IconExit = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </svg>
);

export const IconBell = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconMenu = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconUpload = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const IconImport = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 4v12M8 12l4 4 4-4" />
    <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
  </svg>
);

/**
 * Name → component, so navigation can cross the server/client boundary.
 *
 * A Server Component cannot hand a function to a Client Component — React has
 * to serialise what it passes, and a function has no serialisation. The nav is
 * computed on the server (it depends on capabilities, which depend on the
 * database), so it travels as data and the icon is looked up here.
 */
export const ICONS = {
  user: IconUser,
  documents: IconDocuments,
  contacts: IconContacts,
  calendar: IconCalendar,
  certificate: IconCertificate,
  approvals: IconApprovals,
  team: IconTeam,
  grid: IconGrid,
  inbox: IconInbox,
  branch: IconBranch,
  terminal: IconTerminal,
  report: IconReport,
  shield: IconShield,
  settings: IconSettings,
  exit: IconExit,
  bell: IconBell,
  upload: IconUpload,
  import: IconImport,
} as const;

export type IconName = keyof typeof ICONS;
