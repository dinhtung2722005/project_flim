import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, NoticeProvider } from "./lib/state";
import App from "./App";
import {SiteProvider} from "./lib/site";
import "./styles.css";
import "./ux.css";
import "./admin.css";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <NoticeProvider>
        <SiteProvider><App /></SiteProvider>
      </NoticeProvider>
    </AuthProvider>
  </BrowserRouter>,
);
