import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/ThemeProvider.jsx";
import { MeProvider } from "./lib/useMe.jsx";
import { ActiveOrgProvider } from "./lib/ActiveOrgProvider.jsx";
import { ConnectionsProvider } from "./lib/useConnections.jsx";
import { DateRangeProvider } from "./lib/PeriodProvider.jsx";
import { ChatProvider } from "./lib/ChatProvider.jsx";
import { migrateLegacyKeys } from "./lib/storage.js";
import "./theme.css";

migrateLegacyKeys();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <MeProvider>
        <ActiveOrgProvider>
          <ConnectionsProvider>
            <DateRangeProvider>
              <ChatProvider>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </ChatProvider>
            </DateRangeProvider>
          </ConnectionsProvider>
        </ActiveOrgProvider>
      </MeProvider>
    </ThemeProvider>
  </React.StrictMode>
);
