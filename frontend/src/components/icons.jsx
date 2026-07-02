// Shared inline SVG icons (stroke = currentColor unless noted), from the design.
const S = (p) => ({ width: p.s || 18, height: p.s || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" });

export const IcStar = ({ s, stroke = "#fff" }) => (
  <svg width={s || 18} height={s || 18} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" /></svg>
);
export const IcGrid = (p) => (<svg {...S(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
export const IcBars = (p) => (<svg {...S(p)} strokeWidth="2.2"><line x1="5" y1="21" x2="5" y2="12" /><line x1="12" y1="21" x2="12" y2="4" /><line x1="19" y1="21" x2="19" y2="9" /></svg>);
export const IcSearch = (p) => (<svg {...S(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>);
export const IcAds = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>);
export const IcShare = (p) => (<svg {...S(p)}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.9 15.8 7.1M8.2 13.1 15.8 16.9" /></svg>);
export const IcDoc = (p) => (<svg {...S(p)}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 14h6M10 18h6" /></svg>);
export const IcPlug = (p) => (<svg {...S(p)}><path d="M14 7l3-3a3 3 0 0 1 4 4l-3 3M10 17l-3 3a3 3 0 0 1-4-4l3-3" /><path d="M8 16 16 8" /></svg>);
export const IcCog = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></svg>);
export const IcUsers = (p) => (<svg {...S(p)}><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="9" cy="8" r="3.2" /><path d="M16 3.5a3.2 3.2 0 0 1 0 6M21 21v-2a4 4 0 0 0-3-3.8" /></svg>);
export const IcBell = (p) => (<svg {...S(p)} strokeWidth="1.9"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>);
export const IcMenu = (p) => (<svg {...S(p)} strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>);
export const IcChat = (p) => (<svg {...S(p)}><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>);
export const IcCalendar = (p) => (<svg {...S(p)} strokeWidth="1.9"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
export const IcChevDown = (p) => (<svg {...S(p)}><path d="m6 9 6 6 6-6" /></svg>);
export const IcChevUpDown = (p) => (<svg {...S(p)}><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></svg>);
export const IcArrow = (p) => (<svg width={p.s || 18} height={p.s || 18} viewBox="0 0 24 24" fill="none" stroke={p.stroke || "currentColor"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>);
export const IcCheck = ({ s = 12, stroke = "#fff" }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>);
export const IcSun = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></svg>);
export const IcMoon = (p) => (<svg {...S(p)}><path d="M20 14a8 8 0 0 1-9.8-9.8A8 8 0 1 0 20 14z" /></svg>);
export const IcDownload = ({ s = 16, stroke = "#fff" }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 11l5 4 5-4" /><path d="M4 19h16" /></svg>);
export const IcPlus = ({ s = 16, stroke = "#fff" }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>);

// Brand/tool glyphs (colored)
export const GaGlyph = ({ s = 30 }) => (<svg width={s} height={s} viewBox="0 0 24 24"><rect x="3" y="11" width="4.5" height="10" rx="2.2" fill="#F9AB00" /><rect x="9.7" y="6" width="4.5" height="15" rx="2.2" fill="#E37400" /><rect x="16.4" y="3" width="4.5" height="18" rx="2.2" fill="#F9AB00" /></svg>);
export const GscGlyph = ({ s = 28 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6" stroke="#4285F4" strokeWidth="2.4" /><path d="m15 15 5 5" stroke="#34A853" strokeWidth="2.6" strokeLinecap="round" /><circle cx="10.5" cy="10.5" r="2.4" fill="#EA4335" /></svg>);
export const AdsGlyph = ({ s = 28 }) => (<svg width={s} height={s} viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6" height="17" rx="3" transform="rotate(-30 6.5 12)" fill="#FBBC04" /><rect x="14.5" y="3.5" width="6" height="17" rx="3" transform="rotate(30 17.5 12)" fill="#4285F4" /><circle cx="6.4" cy="18" r="3" fill="#34A853" /></svg>);
export const MetaGlyph = ({ s = 30 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#0866FF" strokeWidth="2.4"><path d="M3 15c0-4 1.6-7 4-7 3 0 4 9 7 9 2 0 3.5-2.4 3.5-5.5S20 6 18 6c-3 0-4.5 4-6.5 7" /></svg>);
