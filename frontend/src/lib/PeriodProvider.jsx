import { createContext, useContext, useState } from "react";

const OPTIONS = [
  { days: 7, label: "laatste 7 dagen" },
  { days: 30, label: "laatste 30 dagen" },
  { days: 90, label: "laatste 90 dagen" },
];

const PeriodCtx = createContext({ days: 30, label: "laatste 30 dagen", options: OPTIONS, setDays: () => {} });

export function PeriodProvider({ children }) {
  const [days, setDaysState] = useState(() => Number(localStorage.getItem("kompas-period")) || 30);
  const setDays = (d) => {
    setDaysState(d);
    localStorage.setItem("kompas-period", String(d));
  };
  const label = OPTIONS.find((o) => o.days === days)?.label || `laatste ${days} dagen`;
  return <PeriodCtx.Provider value={{ days, label, options: OPTIONS, setDays }}>{children}</PeriodCtx.Provider>;
}

export const usePeriod = () => useContext(PeriodCtx);
