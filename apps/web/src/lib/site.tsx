import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useData } from "./state";
import type { Row } from "./api";
const SiteContext = createContext<Row>({
  name: "pj-Flim",
  description: "Phim hay, thật gần.",
  supportEmail: null,
});
export function SiteProvider({ children }: { children: ReactNode }) {
  const site = useData<Row>("/site");
  useEffect(() => {
    const refresh = () => site.reload();
    window.addEventListener("pj-flim:site-refresh", refresh);
    return () => window.removeEventListener("pj-flim:site-refresh", refresh);
  }, []);
  return (
    <SiteContext.Provider
      value={
        site.data
          ? { ...site.data.settings, banners: site.data.banners }
          : {
              name: "pj-Flim",
              description: "Phim hay, thật gần.",
              supportEmail: null,
            }
      }
    >
      {children}
    </SiteContext.Provider>
  );
}
export const useSite = () => useContext(SiteContext);
